import httpx, json, time, concurrent.futures
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
headers = {"x-gateflow-client": "web"}
c = httpx.Client(base_url="http://127.0.0.1:8000", headers=headers, timeout=10)
secret = json.loads((ROOT / ".local/credentials.json").read_text())
r = c.post("/api/auth/login", json={"password": secret["password"]})
r.raise_for_status()
files = {
    k: (k + ".csv", (ROOT / "samples" / f"{k}.csv").read_bytes(), "text/csv")
    for k in ["gates", "turnarounds", "transfers"]
}
d = c.post("/api/datasets", data={"day": "2026-10-03"}, files=files).json()
config = {"dataset_id": d["id"], "mode": "transfer", "budget": "quick", "seed": 42}
p = c.post("/api/config/preview", json=config).json()
body = {
    **config,
    "idempotency_key": "smoke-" + str(time.time()),
    "confirmed_hash": p["config_hash"],
    "credential": p["credential"],
}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    outputs = list(pool.map(lambda _: c.post("/api/runs", json=body), range(4)))
assert all(r.status_code == 200 for r in outputs), [r.text for r in outputs]
rid = outputs[0].json()["id"]
assert len({r.json()["id"] for r in outputs}) == 1
started = time.monotonic()
while time.monotonic() - started < 45:
    r = c.get("/api/runs/" + rid).json()
    if r["status"] not in ["queued", "running", "validating", "cancelling"]:
        break
    time.sleep(0.3)
assert r["status"] == "completed", r
sid = r["result"]["solutions"][0]["id"]
sel = c.post("/api/runs/" + rid + "/selection", json={"solution_id": sid}).json()
e = c.get("/api/selections/" + sel["id"] + "/export")
assert e.status_code == 200 and e.content.startswith(b"PK")
# Exercise a live cancellation. Queued or running are both observable valid entry points.
body["idempotency_key"] += "-cancel"
r2 = c.post("/api/runs", json=body).json()
rid2 = r2["id"]
for _ in range(20):
    r2 = c.get("/api/runs/" + rid2).json()
    if r2["status"] == "running":
        break
    time.sleep(0.1)
cancel = c.post("/api/runs/" + rid2 + "/cancel")
assert cancel.status_code == 200, cancel.text
for _ in range(60):
    r2 = c.get("/api/runs/" + rid2).json()
    if r2["status"] == "cancelled":
        break
    time.sleep(0.1)
assert r2["status"] == "cancelled", r2
result = {
    "status": "passed",
    "parallel_submissions": 4,
    "unique_runs": 1,
    "solver_status": r["status"],
    "candidates": len(r["result"]["solutions"]),
    "evaluations": r["result"]["evaluations"],
    "seconds": round(time.monotonic() - started, 2),
    "zip_bytes": len(e.content),
    "cancellation": r2["status"],
}
(ROOT / "docs/backend-smoke.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result))
