from __future__ import annotations
import os, json, uuid, time, base64
from pathlib import Path
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
import importlib.metadata
import jwt
from argon2 import PasswordHasher
from fastapi import (
    FastAPI,
    Request,
    Response,
    HTTPException,
    Depends,
    UploadFile,
    File,
    Form,
)
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict
from typing import Literal
from .domain import DomainError, build_dataset, digest, metrics, validate, RULES
from .store import initialize, transaction, get, put, listing
from .exports import evidence_zip
from . import ai

ROOT = Path(__file__).resolve().parents[2]
BUDGETS = {"quick": 30, "standard": 60, "thorough": 180}
ACTIVE = {"queued", "running", "validating", "cancelling"}


def full_mode():
    return os.getenv("APP_MODE", "demo") == "full"


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix):
    return prefix + "_" + uuid.uuid4().hex[:20]


def secret():
    value = os.getenv("AUTH_SECRET", "")
    if len(value) < 32:
        raise RuntimeError("AUTH_SECRET 至少 32 字符")
    return value


@asynccontextmanager
async def lifespan(app):
    if full_mode():
        secret()
        initialize()
    yield


app = FastAPI(title="GateFlow API", version="1.0.0", lifespan=lifespan)


@app.exception_handler(DomainError)
async def domain_error(request, exc):
    return JSONResponse(
        status_code=422,
        content={"code": exc.code, "message": exc.message, "details": exc.details},
    )


@app.middleware("http")
async def guard(request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if request.headers.get("x-gateflow-client") != "web":
            return JSONResponse(
                status_code=403, content={"message": "缺少请求校验标识"}
            )
        origin = request.headers.get("origin")
        allowed = os.getenv("PUBLIC_ORIGIN", str(request.base_url).rstrip("/"))
        if origin and origin.rstrip("/") != allowed:
            return JSONResponse(status_code=403, content={"message": "跨站请求被拒绝"})
    if int(request.headers.get("content-length", "0")) > 16 * 1024 * 1024:
        return JSONResponse(
            status_code=413, content={"message": "上传总大小超过 16 MB"}
        )
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def owner(request: Request):
    if not full_mode():
        raise HTTPException(403, "公开演示为只读模式")
    try:
        claims = jwt.decode(
            request.cookies.get("gateflow_session", ""), secret(), algorithms=["HS256"]
        )
        if claims["sub"] != "owner":
            raise ValueError()
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(401, "请登录工作空间")
    return "owner"


def required(s, oid, kind):
    obj = get(s, oid, kind)
    if not obj:
        raise HTTPException(404, "对象不存在或已删除")
    return obj


def event(s, name, **data):
    put(s, uid("event"), "event", {"name": name, "at": now(), **data})


class Login(BaseModel):
    password: str = Field(max_length=300)


_failures = {}


@app.post("/api/auth/login")
def login(body: Login, request: Request, response: Response):
    if not full_mode():
        raise HTTPException(403, "演示模式不提供登录")
    addr = request.client.host
    attempts = [t for t in _failures.get(addr, []) if time.time() - t < 300]
    if len(attempts) >= 10:
        raise HTTPException(429, "登录尝试过多，请稍后重试")
    try:
        PasswordHasher().verify(
            os.environ.get("OWNER_PASSWORD_HASH", ""), body.password
        )
    except Exception:
        _failures[addr] = attempts + [time.time()]
        raise HTTPException(401, "密码不正确")
    _failures.pop(addr, None)
    token = jwt.encode(
        {"sub": "owner", "exp": datetime.now(timezone.utc) + timedelta(hours=8)},
        secret(),
        algorithm="HS256",
    )
    response.set_cookie(
        "gateflow_session",
        token,
        httponly=True,
        samesite="strict",
        secure=os.getenv("COOKIE_SECURE", "true") == "true",
        max_age=28800,
    )
    return {"owner": True}


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("gateflow_session")
    return {"ok": True}


@app.get("/api/session")
def session(request: Request):
    authenticated = False
    if full_mode():
        try:
            owner(request)
            authenticated = True
        except HTTPException:
            pass
    return {
        "mode": "full" if full_mode() else "demo",
        "authenticated": authenticated,
        "rules": RULES,
        "ai": ai.settings() if authenticated else {"configured": False},
        "version": "1.0.0",
    }


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "full" if full_mode() else "demo"}


@app.get("/api/demo")
def demo():
    p = ROOT / "samples" / "demo.json"
    if not p.is_file():
        raise HTTPException(503, "样例尚未生成")
    return json.loads(p.read_text())


@app.get("/api/templates/{kind}")
def template(kind: str):
    if kind not in {"gates", "turnarounds", "transfers"}:
        raise HTTPException(404)
    return FileResponse(
        ROOT / "samples" / f"{kind}.csv", filename=f"{kind}.csv", media_type="text/csv"
    )


@app.post("/api/datasets", dependencies=[Depends(owner)])
async def upload(
    day: str = Form(...),
    gates: UploadFile = File(...),
    turnarounds: UploadFile = File(...),
    transfers: UploadFile | None = File(None),
    model_mapping: str = Form("{}"),
):
    files = {}
    for kind, file in [
        ("gates", gates),
        ("turnarounds", turnarounds),
        ("transfers", transfers),
    ]:
        if file:
            data = await file.read(5 * 1024 * 1024 + 1)
            if len(data) > 5 * 1024 * 1024:
                raise DomainError("DATA_TOO_LARGE", "单文件不能超过 5 MB")
            files[kind] = data
    try:
        mapping = json.loads(model_mapping)
        if not isinstance(mapping, dict) or any(
            v not in ("N", "W") for v in mapping.values()
        ):
            raise ValueError()
    except (ValueError, TypeError):
        raise DomainError(
            "DATA_MAPPING_UNKNOWN", "机型映射须为 JSON 对象，取值为 N 或 W"
        )
    try:
        data = build_dataset(files, day, mapping)
    except ValueError as exc:
        if isinstance(exc, DomainError):
            raise
        raise DomainError("DATA_SCHEMA_INVALID", str(exc))
    did = uid("data")
    data.update(id=did, name=f"{day} 运行日", created_at=now(), model_mapping=mapping)
    with transaction() as s:
        put(s, did, "dataset", data)
        put(
            s,
            "raw-" + did,
            "raw",
            {
                "dataset_id": did,
                "files": {k: base64.b64encode(v).decode() for k, v in files.items()},
            },
        )
        event(s, "dataset_checked", dataset_id=did)
    return data


@app.get("/api/datasets", dependencies=[Depends(owner)])
def datasets():
    with transaction() as s:
        return [
            {
                k: o.data[k]
                for k in [
                    "id",
                    "name",
                    "day",
                    "status",
                    "raw_counts",
                    "coverage",
                    "created_at",
                ]
            }
            for o in listing(s, "dataset")
        ]


@app.get("/api/datasets/{did}", dependencies=[Depends(owner)])
def dataset(did: str):
    with transaction() as s:
        return required(s, did, "dataset").data


@app.post("/api/datasets/{did}/confirm", dependencies=[Depends(owner)])
def confirm(did: str):
    with transaction(lock=True) as s:
        obj = required(s, did, "dataset")
        obj.data = {**obj.data, "status": "ready", "excluded_confirmed_at": now()}
        event(s, "scope_confirmed", dataset_id=did)
        return obj.data


@app.get("/api/datasets/{did}/deletion-preview", dependencies=[Depends(owner)])
def preview_delete(did: str):
    with transaction() as s:
        required(s, did, "dataset")
        runs = [o for o in listing(s, "run") if o.data["dataset_id"] == did]
        return {
            "runs": len(runs),
            "solutions": sum(
                len(o.data.get("result", {}).get("solutions", [])) for o in runs
            ),
            "active": any(o.data["status"] in ACTIVE for o in runs),
            "message": "关联运行、聊天和导出记录将删除；已下载文件无法收回。",
        }


@app.delete("/api/datasets/{did}", dependencies=[Depends(owner)])
def delete_dataset(did: str, confirm: bool = False):
    if not confirm:
        raise HTTPException(400, "请确认级联删除范围")
    with transaction(lock=True) as s:
        required(s, did, "dataset")
        runs = [o for o in listing(s, "run") if o.data["dataset_id"] == did]
        if any(o.data["status"] in ACTIVE for o in runs):
            raise HTTPException(409, "请先取消并停止活动任务")
        for obj in s.query(__import__("app.store", fromlist=["Object"]).Object).all():
            if obj.id == did or obj.data.get("dataset_id") == did:
                s.delete(obj)
    return {"deleted": True}


class RunConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dataset_id: str
    mode: Literal["resource", "transfer"] = "transfer"
    budget: Literal["quick", "standard", "thorough"] = "standard"
    seed: int = Field(default=42, ge=0, le=2**32 - 1)
    parent_run_id: str | None = None


class RunSubmission(RunConfig):
    idempotency_key: str = Field(min_length=8, max_length=100)
    confirmed_hash: str
    credential: str


def checked_config(s, body):
    d = required(s, body.dataset_id, "dataset").data
    if d["status"] != "ready":
        raise DomainError("TRANSFER_LINK_GAP", "请先确认客流排除范围")
    if body.mode == "transfer" and not d["transfers"]:
        raise DomainError("TRANSFER_LINK_GAP", "中转模式需要有效客流")
    c = RunConfig.model_validate(
        body.model_dump(include=set(RunConfig.model_fields))
    ).model_dump()
    c.update(
        seconds=BUDGETS[body.budget],
        population=80,
        evaluations=40000,
        rules_hash=d["rules_hash"],
        scope_hash=d["scope_hash"],
    )
    if body.parent_run_id:
        parent = required(s, body.parent_run_id, "run").data
        if parent["dataset_id"] != body.dataset_id:
            raise DomainError("SCOPE_MISMATCH", "复现数据版本必须一致")
    return c


@app.post("/api/config/preview", dependencies=[Depends(owner)])
def preview_config(body: RunConfig):
    with transaction() as s:
        config = checked_config(s, body)
    h = digest(config)
    credential = jwt.encode(
        {
            "sub": "run-confirm",
            "hash": h,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        },
        secret(),
        algorithm="HS256",
    )
    return {"config": config, "config_hash": h, "credential": credential}


@app.post("/api/runs", dependencies=[Depends(owner)])
def start_run(body: RunSubmission):
    with transaction(lock=True) as s:
        config = checked_config(s, body)
        h = digest(config)
        for obj in listing(s, "run"):
            if obj.data["idempotency_key"] == body.idempotency_key:
                if obj.data["config_hash"] != h:
                    raise HTTPException(409, "幂等键对应配置不同")
                return obj.data
        try:
            claims = jwt.decode(body.credential, secret(), algorithms=["HS256"])
            if (
                claims.get("sub") != "run-confirm"
                or claims.get("hash") != h
                or body.confirmed_hash != h
            ):
                raise ValueError()
        except (ValueError, jwt.PyJWTError):
            raise HTTPException(409, "配置卡已失效，请重新确认")
        if any(o.data["status"] in ACTIVE for o in listing(s, "run")):
            raise HTTPException(409, "已有活动任务，请先查看或取消")
        rid = uid("run")
        run = {
            "id": rid,
            "dataset_id": body.dataset_id,
            "config": config,
            "config_hash": h,
            "status": "queued",
            "idempotency_key": body.idempotency_key,
            "created_at": now(),
            "code_version": os.getenv("CODE_VERSION", "gateflow-v1"),
            "dependency_versions": {
                n: importlib.metadata.version(n) for n in ["pymoo", "numpy"]
            },
        }
        put(s, rid, "run", run)
        event(s, "run_submitted", dataset_id=body.dataset_id, run_id=rid)
    return run


@app.get("/api/runs", dependencies=[Depends(owner)])
def runs():
    with transaction() as s:
        return [
            {k: v for k, v in o.data.items() if k != "result"}
            for o in listing(s, "run")
        ]


@app.get("/api/runs/{rid}", dependencies=[Depends(owner)])
def run_detail(rid: str):
    with transaction() as s:
        return required(s, rid, "run").data


@app.post("/api/runs/{rid}/cancel", dependencies=[Depends(owner)])
def cancel(rid: str):
    with transaction(lock=True) as s:
        obj = required(s, rid, "run")
        d = dict(obj.data)
        if d["status"] == "queued":
            d.update(status="cancelled", stop_reason="user_cancelled")
        elif d["status"] == "running":
            d["status"] = "cancelling"
        elif d["status"] != "cancelling":
            raise HTTPException(409, "当前阶段不可取消")
        obj.data = d
        return d


def find_solution(run, sid):
    found = next(
        (s for s in run.get("result", {}).get("solutions", []) if s["id"] == sid), None
    )
    if not found:
        raise HTTPException(404, "方案不存在")
    return found


@app.get("/api/runs/{rid}/solutions/{sid}", dependencies=[Depends(owner)])
def detail(rid: str, sid: str):
    with transaction() as s:
        r = required(s, rid, "run").data
        sol = find_solution(r, sid)
        data = required(s, r["dataset_id"], "dataset").data
        _, rows = metrics(data, sol["assignments"])
        event(
            s,
            "solution_viewed",
            dataset_id=r["dataset_id"],
            run_id=rid,
            solution_id=sid,
        )
    return {**sol, "transfers": rows}


class SelectionBody(BaseModel):
    solution_id: str


@app.post("/api/runs/{rid}/selection", dependencies=[Depends(owner)])
def select_solution(rid: str, body: SelectionBody):
    with transaction(lock=True) as s:
        r = required(s, rid, "run").data
        sol = find_solution(r, body.solution_id)
        data = required(s, r["dataset_id"], "dataset").data
        if (
            r["status"] != "completed"
            or not validate(data, sol["assignments"], sol["metrics"])["selectable"]
        ):
            raise DomainError("SOLUTION_INVALID", "当前方案不可选用")
        selections = [o for o in listing(s, "selection") if o.data["run_id"] == rid]
        item = {
            "id": uid("selection"),
            "run_id": rid,
            "dataset_id": r["dataset_id"],
            "solution_id": body.solution_id,
            "created_at": now(),
            "previous_id": selections[0].id if selections else None,
        }
        put(s, item["id"], "selection", item)
        event(
            s,
            "solution_selected",
            dataset_id=r["dataset_id"],
            run_id=rid,
            solution_id=body.solution_id,
        )
        return item


@app.get("/api/selections/{selection_id}/export", dependencies=[Depends(owner)])
def export(selection_id: str):
    with transaction() as s:
        selected = required(s, selection_id, "selection").data
        r = required(s, selected["run_id"], "run").data
        d = required(s, r["dataset_id"], "dataset").data
        sol = find_solution(r, selected["solution_id"])
        data = evidence_zip(r, d, sol, selected)
        eid = uid("export")
        put(
            s,
            eid,
            "export",
            {
                "id": eid,
                "dataset_id": r["dataset_id"],
                "selection_id": selection_id,
                "run_id": r["id"],
                "solution_id": sol["id"],
                "hash": __import__("hashlib").sha256(data).hexdigest(),
                "created_at": now(),
            },
        )
        event(s, "export_completed", dataset_id=r["dataset_id"], export_id=eid)
    return Response(
        data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{r["id"]}_{sol["id"]}.zip"'
        },
    )


class CompareItem(BaseModel):
    run_id: str
    solution_id: str


class CompareBody(BaseModel):
    items: list[CompareItem] = Field(min_length=2, max_length=3)


def comparison(body):
    items = []
    expected = None
    with transaction() as s:
        for ref in body.items:
            r = required(s, ref.run_id, "run").data
            d = required(s, r["dataset_id"], "dataset").data
            sol = find_solution(r, ref.solution_id)
            scope = (r["dataset_id"], d["scope_hash"], d["rules_hash"])
            if expected and scope != expected:
                raise DomainError(
                    "SCOPE_MISMATCH", "数据、规则或客流范围不同，不能比较"
                )
            expected = scope
            items.append({**sol, "run_id": r["id"]})
        base = items[0]["metrics"]
        deltas = [
            {
                k: (item["metrics"][k] - base[k] if base[k] is not None else None)
                for k in ["U", "G", "C", "unmet_passengers"]
            }
            for item in items[1:]
        ]
        details = []
        _, a = metrics(d, items[0]["assignments"])
        for sol in items[1:]:
            _, b = metrics(d, sol["assignments"])
            changes = [
                {
                    "group_id": x["transfer_group_id"],
                    "passengers": x["passenger_count"],
                    "before": x["cost"],
                    "after": y["cost"],
                    "delta": y["cost"] - x["cost"],
                    "from": x["arrival_gate"] + " → " + x["departure_gate"],
                    "to": y["arrival_gate"] + " → " + y["departure_gate"],
                }
                for x, y in zip(a, b)
                if x["arrival_gate"] != y["arrival_gate"]
                or x["departure_gate"] != y["departure_gate"]
            ]
            details.append(
                sorted(changes, key=lambda x: (-abs(x["delta"]), x["group_id"]))
            )
        event(s, "comparison_viewed", dataset_id=expected[0])
    return {
        "items": items,
        "deltas": deltas,
        "changes": details,
        "dataset_id": expected[0],
    }


@app.post("/api/compare", dependencies=[Depends(owner)])
def compare(body: CompareBody):
    return comparison(body)


class Consent(BaseModel):
    enabled: bool


@app.post("/api/ai/consent", dependencies=[Depends(owner)])
def consent(body: Consent):
    with transaction() as s:
        put(
            s,
            "model-consent",
            "settings",
            {
                "enabled": body.enabled,
                "at": now(),
                "provider": ai.settings()["provider"],
                "provider_fingerprint": ai.provider_fingerprint(),
            },
        )
    return {"enabled": body.enabled}


class AIRequest(BaseModel):
    request_id: str = Field(
        default_factory=lambda: uuid.uuid4().hex, min_length=8, max_length=100
    )
    dataset_id: str
    message: str = Field(min_length=1, max_length=2000)


@app.post("/api/ai/configure", dependencies=[Depends(owner)])
def ai_configure(body: AIRequest):
    with transaction() as s:
        d = required(s, body.dataset_id, "dataset").data
    local = ai.local_proposal(body.message)
    # Unsupported hard-constraint requests are blocked before any model call.
    if local.action == "unsupported":
        return {
            **local.model_dump(),
            "source": "rules",
            "reason": "AI_UNSUPPORTED_REQUEST",
        }
    proposal, error = ai.request_model(
        ai.Proposal,
        {
            "message": body.message,
            "has_transfers": bool(d["transfers"]),
            "allowed_budgets": BUDGETS,
        },
        body.request_id,
        body.dataset_id,
    )
    chosen = proposal or local
    result = {
        **chosen.model_dump(),
        "source": "model" if proposal else "rules",
        "reason": error,
    }
    if chosen.action == "configure":
        result["preview"] = preview_config(
            RunConfig(
                dataset_id=body.dataset_id,
                mode=chosen.mode,
                budget=chosen.budget,
                seed=chosen.seed,
            )
        )
    return result


class ExplainBody(AIRequest):
    items: list[CompareItem] = Field(min_length=2, max_length=3)


@app.post("/api/ai/explain", dependencies=[Depends(owner)])
def explain(body: ExplainBody):
    evidence = comparison(CompareBody(items=body.items))
    if evidence["dataset_id"] != body.dataset_id:
        raise DomainError("SCOPE_MISMATCH", "解释对象与数据集不同")
    cards = []
    for idx, delta in enumerate(evidence["deltas"]):
        for key, value in delta.items():
            if value is not None:
                cards.append(
                    {
                        "id": f"comparison-{idx}-{key}",
                        "metric": key,
                        "delta": value,
                        "solution_id": body.items[idx + 1].solution_id,
                    }
                )
    plan, error = ai.request_model(
        ai.ExplanationPlan,
        {
            "question": body.message,
            "evidence": cards,
            "allowed_focus": ["coverage", "cost", "resources", "tradeoff"],
        },
        body.request_id,
        body.dataset_id,
    )
    ids = {c["id"] for c in cards}
    if plan and not set(plan.evidence_ids) <= ids:
        plan = None
        error = "AI_EVIDENCE_MISMATCH"
    headings = {
        "coverage": "先检查固定口覆盖，再评估资源与成本取舍。",
        "cost": "结合流程成本变化与资源代价，评估这组候选方案。",
        "resources": "使用口数减少时，需要同时检查未分配记录的变化。",
        "tradeoff": "这些候选方案体现不同取舍，最终选择取决于本次分析目的。",
    }
    return {
        "source": "model-guided" if plan else "template",
        "reason": error,
        "summary": headings[plan.focus if plan else "tradeoff"],
        "cards": cards,
        "focus_ids": plan.evidence_ids if plan else [],
        "changes": evidence["changes"],
        "boundary": "成本为人·分钟，包含模型惩罚；不代表旅客实际节省时间。仅覆盖可匹配客流，通过本版约束不等于生产运行批准。",
    }


app.mount("/samples", StaticFiles(directory=ROOT / "samples"), name="samples")
WEB = ROOT / "web" / "dist"
if WEB.exists():
    app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")

    @app.get("/{path:path}")
    def web(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        return FileResponse(WEB / "index.html")
