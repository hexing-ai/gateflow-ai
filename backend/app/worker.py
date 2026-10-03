"""Separate durable worker process. PostgreSQL claims + bounded child solver."""

import time
import multiprocessing as mp
import signal
from sqlalchemy import text
from datetime import datetime, timezone
from .store import initialize, transaction, listing, get, engine
from .optimizer import solve
from .domain import validate

ACTIVE = {"queued", "running", "validating", "cancelling"}


def child(dataset, config, queue):
    try:
        result = solve(
            dataset,
            mode=config["mode"],
            seed=config["seed"],
            seconds=config["seconds"],
            evaluations=config.get("evaluations", 40000),
            notify=lambda v: queue.put(("progress", v)),
        )
        queue.put(("result", result))
    except Exception as exc:
        queue.put(("error", type(exc).__name__))


def execute(rid):
    with transaction() as s:
        run = get(s, rid, "run").data
        dataset = get(s, run["dataset_id"], "dataset").data
    ctx = mp.get_context("spawn")
    queue = ctx.Queue()
    process = ctx.Process(target=child, args=(dataset, run["config"], queue))
    process.start()
    start = time.monotonic()
    last_progress = {}
    result = None
    error = None
    cancelled = False
    try:
        while process.is_alive() or not queue.empty():
            with transaction() as s:
                current = get(s, rid, "run")
                if not current or current.data["status"] == "cancelling":
                    cancelled = True
                    break
            if time.monotonic() - start > run["config"]["seconds"] + 10:
                error = "RUN_TIMEOUT"
                break
            try:
                tag, payload = queue.get(timeout=0.15)
                if tag == "progress":
                    last_progress = payload
                    with transaction(lock=True) as s:
                        obj = get(s, rid, "run")
                        d = dict(obj.data)
                        if d["status"] == "running":
                            d["progress"] = payload
                            d["heartbeat"] = time.time()
                            obj.data = d
                elif tag == "result":
                    result = payload
                else:
                    error = "SOLVER_ERROR"
                    break
            except Exception as exc:
                from queue import Empty

                if not isinstance(exc, Empty):
                    raise
        if process.is_alive():
            process.terminate()
        process.join(timeout=3)
        if process.is_alive():
            process.kill()
            process.join()
        with transaction(lock=True) as s:
            obj = get(s, rid, "run")
            d = dict(obj.data)
            if cancelled or d["status"] == "cancelling":
                d.update(status="cancelled", stop_reason="user_cancelled")
            elif error or result is None:
                d.update(status="failed", error=error or "RUN_INTERRUPTED")
            else:
                d["status"] = "validating"
            obj.data = d
        if result and not cancelled and not error:
            # The persisted result is independently validated in the worker parent.
            good = []
            for solution in result["solutions"]:
                report = validate(dataset, solution["assignments"], solution["metrics"])
                if report["selectable"]:
                    good.append({**solution, "validation": report})
            with transaction(lock=True) as s:
                obj = get(s, rid, "run")
                d = dict(obj.data)
                if d["status"] == "validating":
                    d.update(
                        status="completed" if good else "no_candidates",
                        result={**result, "solutions": good},
                        progress=last_progress,
                        finished_at=datetime.now(timezone.utc).isoformat(),
                    )
                    obj.data = d
    finally:
        if process.is_alive():
            process.terminate()
            process.join(timeout=3)
        queue.close()


def main():
    initialize()
    # Session-level singleton lease makes restart recovery safe across workers.
    lease = engine().connect()
    if not lease.execute(text("SELECT pg_try_advisory_lock(5112002)")).scalar():
        raise RuntimeError("A GateFlow worker is already running")

    def shutdown(*_):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, shutdown)
    with transaction(lock=True) as s:
        for obj in listing(s, "run"):
            if obj.data["status"] in {"running", "validating", "cancelling"}:
                obj.data = {**obj.data, "status": "failed", "error": "RUN_INTERRUPTED"}
    while True:
        rid = None
        with transaction(lock=True) as s:
            runs = listing(s, "run")
            for obj in runs:
                d = dict(obj.data)
                if (
                    d["status"] in {"running", "validating", "cancelling"}
                    and time.time() - d.get("heartbeat", 0) > 240
                ):
                    obj.data = {**d, "status": "failed", "error": "RUN_INTERRUPTED"}
            # One deployment worker, and the database lock also prevents overlapping claims.
            if not any(
                o.data["status"] in {"running", "validating", "cancelling"}
                for o in runs
            ):
                queued = [o for o in runs if o.data["status"] == "queued"]
                if queued:
                    obj = queued[-1]
                    rid = obj.id
                    obj.data = {
                        **obj.data,
                        "status": "running",
                        "heartbeat": time.time(),
                    }
        if rid:
            execute(rid)
        else:
            time.sleep(0.4)


if __name__ == "__main__":
    main()
