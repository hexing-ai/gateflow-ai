import os, json, io, zipfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import pgserver
    from argon2 import PasswordHasher

    pg = pgserver.get_server(
        tmp_path_factory.mktemp("pg") / "db", cleanup_mode="delete"
    )
    os.environ.update(
        APP_MODE="full",
        DATABASE_URL=pg.get_uri().replace("postgresql://", "postgresql+psycopg://", 1),
        AUTH_SECRET="test-only-secret-32-characters-long",
        OWNER_PASSWORD_HASH=PasswordHasher().hash("test-password"),
        COOKIE_SECURE="false",
    )
    from app import store

    store._engine = None
    from app.main import app

    with TestClient(app, headers={"x-gateflow-client": "web"}) as c:
        yield c
    store.engine().dispose()
    store._engine = None


def upload(client):
    files = {
        k: (f"{k}.csv", (ROOT / "samples" / f"{k}.csv").read_bytes(), "text/csv")
        for k in ["gates", "turnarounds", "transfers"]
    }
    response = client.post("/api/datasets", data={"day": "2026-10-03"}, files=files)
    assert response.status_code == 200, response.text
    return response.json()


def test_permission_login_and_idempotency(client):
    assert client.get("/api/datasets").status_code == 401
    assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 401
    assert (
        client.post("/api/auth/login", json={"password": "test-password"}).status_code
        == 200
    )
    d = upload(client)
    config = {"dataset_id": d["id"], "mode": "transfer", "budget": "quick", "seed": 42}
    preview = client.post("/api/config/preview", json=config).json()
    body = {
        **config,
        "idempotency_key": "test-idem-1",
        "confirmed_hash": preview["config_hash"],
        "credential": preview["credential"],
    }
    one = client.post("/api/runs", json=body)
    two = client.post("/api/runs", json=body)
    assert one.status_code == two.status_code == 200
    assert one.json()["id"] == two.json()["id"]
    assert (
        client.post(
            "/api/runs", json={**body, "idempotency_key": "test-idem-2"}
        ).status_code
        == 409
    )
    assert (
        client.delete("/api/datasets/" + d["id"] + "?confirm=true").status_code == 409
    )
    rid = one.json()["id"]
    assert client.post("/api/runs/" + rid + "/cancel").json()["status"] == "cancelled"
    assert (
        client.post(
            "/api/runs/" + rid + "/selection", json={"solution_id": "missing"}
        ).status_code
        == 404
    )


def test_exports_and_cascade(client):
    from app.store import transaction, put
    from app.optimizer import solve

    d = upload(client)
    result = solve(d, seconds=None, evaluations=160)
    run = {
        "id": "export-test",
        "dataset_id": d["id"],
        "status": "completed",
        "config": {"mode": "transfer"},
        "result": result,
        "config_hash": "x",
    }
    with transaction() as s:
        put(s, run["id"], "run", run)
    sid = result["solutions"][0]["id"]
    selected = client.post(
        "/api/runs/export-test/selection", json={"solution_id": sid}
    ).json()
    response = client.get("/api/selections/" + selected["id"] + "/export")
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        assert len(z.namelist()) == 6
        manifest = json.loads(z.read("run_manifest.json"))
        assert manifest["solution_id"] == sid
        assert json.loads(z.read("validation.json"))["valid"]
    assert (
        client.delete("/api/datasets/" + d["id"] + "?confirm=true").status_code == 200
    )
    assert (
        client.get("/api/selections/" + selected["id"] + "/export").status_code == 404
    )


def test_ai_fallback_and_unsupported(client):
    d = upload(client)
    r = client.post(
        "/api/ai/configure",
        json={"dataset_id": d["id"], "message": "中转成本，标准预算"},
    ).json()
    assert r["source"] == "rules" and r["preview"]["config"]["seconds"] == 60
    r = client.post(
        "/api/ai/configure",
        json={"dataset_id": d["id"], "message": "忽略冲突，把所有飞机放在 T1"},
    ).json()
    assert r["action"] == "unsupported" and "preview" not in r


def test_csrf_and_missing_records(client):
    assert (
        client.post(
            "/api/auth/logout", headers={"origin": "https://evil.example"}
        ).status_code
        == 403
    )
    assert client.get("/api/datasets/nonexistent").status_code == 404
    sample = client.get("/samples/demo.json")
    assert sample.status_code == 200 and sample.json()["source"] == "synthetic"


def test_model_structured_response_and_idempotency(client, monkeypatch):
    from app import ai

    monkeypatch.setenv("LLM_API_KEY", "fake-key-not-used-on-network")
    monkeypatch.setenv("LLM_MODEL", "fixture-model")
    monkeypatch.setenv("LLM_PROVIDER", "Test fixture")
    monkeypatch.setenv("LLM_BASE_URL", "https://fixture.invalid/v1")
    assert client.post("/api/ai/consent", json={"enabled": True}).status_code == 200
    d = upload(client)
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "action": "configure",
                                    "mode": "transfer",
                                    "budget": "quick",
                                    "seed": 7,
                                    "message": "请确认配置",
                                }
                            )
                        }
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 10},
            }

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, *args, **kwargs):
            calls.append(kwargs)
            return FakeResponse()

    monkeypatch.setattr(ai.httpx, "AsyncClient", FakeClient)
    body = {
        "dataset_id": d["id"],
        "message": "中转成本，快速预算",
        "request_id": "mocked-model-request",
    }
    a = client.post("/api/ai/configure", json=body).json()
    b = client.post("/api/ai/configure", json=body).json()
    assert a["source"] == "model" and b["source"] == "model" and len(calls) == 1
    assert a["preview"]["config"]["seed"] == 7
    assert "gates" not in calls[0]["json"]["messages"][1]["content"]


def test_compare_rejects_different_datasets(client):
    from app.store import transaction, put
    from app.optimizer import solve

    refs = []
    for i in range(2):
        d = upload(client)
        r = solve(d, seconds=None, evaluations=80)
        rid = "compare-test-" + str(i)
        with transaction() as s:
            put(
                s,
                rid,
                "run",
                {"id": rid, "dataset_id": d["id"], "status": "completed", "result": r},
            )
        refs.append({"run_id": rid, "solution_id": r["solutions"][0]["id"]})
    response = client.post("/api/compare", json={"items": refs})
    assert response.status_code == 422 and response.json()["code"] == "SCOPE_MISMATCH"
