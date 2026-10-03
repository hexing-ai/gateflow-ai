"""Generate redistributable synthetic fixtures and genuine optimizer results."""

import sys, csv, json
from pathlib import Path
from datetime import datetime, timedelta

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.domain import build_dataset, metrics
from app.optimizer import solve
from app.exports import evidence_zip
from app.domain import digest


def generate():
    folder = ROOT / "samples"
    folder.mkdir(exist_ok=True)
    gates = []
    for terminal in ["T", "S"]:
        for i in range(1, 7):
            gates.append(
                {
                    "gate_id": f"{terminal}{i:02}",
                    "terminal": terminal,
                    "region": ["North", "Center", "South"][(i - 1) % 3],
                    "arr_types": "D,I",
                    "dep_types": "D,I",
                    "body_type": "W" if i >= 5 else "N",
                }
            )
    turns = []
    for i in range(48):
        arr = datetime(2026, 10, 3, 5, 30) + timedelta(minutes=i * 15 + (i % 3) * 10)
        dep = arr + timedelta(minutes=65 + (i % 5) * 15)
        turns.append(
            {
                "turnaround_id": f"SYN{i + 1:03}",
                "arrival_at": arr.strftime("%Y-%m-%d %H:%M"),
                "departure_at": dep.strftime("%Y-%m-%d %H:%M"),
                "arrival_flight": f"GF{100 + i}",
                "departure_flight": f"GF{200 + i}",
                "arrival_type": "I" if i % 4 == 0 else "D",
                "departure_type": "I" if i % 6 == 0 else "D",
                "body_type": "W" if i % 5 == 0 else "N",
            }
        )
    transfers = []
    for i in range(39):
        j = i + 3 + (i % 4)
        transfers.append(
            {
                "transfer_group_id": f"PAX{i + 1:03}",
                "passenger_count": 8 + (i * 7) % 39,
                "arrival_flight": turns[i]["arrival_flight"],
                "arrival_date": "2026-10-03",
                "departure_flight": turns[j]["departure_flight"],
                "departure_date": "2026-10-03",
            }
        )
    for name, rows in [
        ("gates", gates),
        ("turnarounds", turns),
        ("transfers", transfers),
    ]:
        with (folder / f"{name}.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
    d = build_dataset(
        {
            k: (folder / f"{k}.csv").read_bytes()
            for k in ["gates", "turnarounds", "transfers"]
        },
        "2026-10-03",
    )
    d.update(id="synthetic-demo-v1", name="T/S 航站楼 · 合成运行日")
    result = solve(d, mode="transfer", seconds=None, evaluations=2400, seed=42)
    for sol in result["solutions"]:
        sol["transfers"] = metrics(d, sol["assignments"])[1]
    output = {
        "dataset": d,
        "run": {
            "id": "demo-run-v1",
            "dataset_id": d["id"],
            "status": "completed",
            "config": {"mode": "transfer", "seed": 42, "evaluations": 2400},
            "result": result,
        },
        "precomputed": True,
        "source": "synthetic",
        "notice": "合成样例 · 预计算结果 · 非实时机场数据",
    }
    (folder / "demo.json").write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":"))
    )
    exports = folder / "exports"
    exports.mkdir(exist_ok=True)
    run = output["run"]
    run.update(
        config_hash=digest(run["config"]),
        code_version="gateflow-v1",
        created_at="2026-10-03T00:00:00+00:00",
    )
    for solution in result["solutions"]:
        (exports / (solution["id"] + ".zip")).write_bytes(
            evidence_zip(
                run,
                d,
                solution,
                {"type": "precomputed_sample", "solution_id": solution["id"]},
            )
        )
    print(
        json.dumps(
            {
                "turnarounds": len(turns),
                "gates": len(gates),
                "groups": len(transfers),
                "candidates": len(result["solutions"]),
                "evaluations": result["evaluations"],
            }
        )
    )


if __name__ == "__main__":
    generate()
