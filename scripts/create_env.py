from pathlib import Path
import secrets, getpass
from argon2 import PasswordHasher

p = Path(".env")
if p.exists():
    raise SystemExit(".env already exists; refusing to overwrite")
password = getpass.getpass("Owner password (at least 12 characters): ")
if len(password) < 12:
    raise SystemExit("Password too short")
# Quoted env values prevent Compose interpreting the $ characters in Argon2 hashes.
values = {
    "APP_MODE": "full",
    "POSTGRES_PASSWORD": secrets.token_urlsafe(24),
    "AUTH_SECRET": secrets.token_urlsafe(48),
    "OWNER_PASSWORD_HASH": PasswordHasher().hash(password),
    "COOKIE_SECURE": "false",
    "PUBLIC_ORIGIN": "http://localhost:8000",
    "LLM_BASE_URL": "",
    "LLM_API_KEY": "",
    "LLM_MODEL": "",
    "LLM_PROVIDER": "",
}
p.write_text("\n".join(f"{k}='{v}'" for k, v in values.items()) + "\n")
p.chmod(0o600)
print("Created .env. Use COOKIE_SECURE=true and your HTTPS origin in production.")
