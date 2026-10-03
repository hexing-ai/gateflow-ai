"""Local PostgreSQL + API + durable worker; secrets stay in ignored .local/."""

import os, sys, subprocess, json, secrets, signal
from pathlib import Path
import pgserver
from argon2 import PasswordHasher

ROOT = Path(__file__).resolve().parents[1]
local = ROOT / ".local"
local.mkdir(exist_ok=True)
server = pgserver.get_server(local / "postgres", cleanup_mode="stop")
uri = server.get_uri().replace("postgresql://", "postgresql+psycopg://", 1)
credentials = local / "credentials.json"
if not credentials.exists():
    password = secrets.token_urlsafe(18)
    credentials.write_text(
        json.dumps(
            {
                "password": password,
                "password_hash": PasswordHasher().hash(password),
                "secret": secrets.token_urlsafe(48),
            }
        )
    )
    credentials.chmod(0o600)
data = json.loads(credentials.read_text())
env = {
    **os.environ,
    "PYTHONPATH": str(ROOT / "backend"),
    "APP_MODE": "full",
    "DATABASE_URL": uri,
    "OWNER_PASSWORD_HASH": data["password_hash"],
    "AUTH_SECRET": data["secret"],
    "COOKIE_SECURE": "false",
    "PUBLIC_ORIGIN": "http://127.0.0.1:5173",
    "PYTHONUNBUFFERED": "1",
}
# The API serves the built frontend on 8000 as well; Vite is used during design.
sys.path.insert(0, str(ROOT / "backend"))
os.environ.update(env)
from app.store import initialize

initialize()
processes = [
    subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ],
        cwd=ROOT,
        env=env,
    ),
    subprocess.Popen([sys.executable, "-m", "app.worker"], cwd=ROOT, env=env),
]
print(
    "Backend: http://127.0.0.1:8000/docs ; owner credentials in .local/credentials.json (not printed)",
    flush=True,
)


def stop(*_):
    for p in processes:
        p.terminate()
    for p in processes:
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
    sys.exit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    for p in processes:
        p.wait()
finally:
    stop()
