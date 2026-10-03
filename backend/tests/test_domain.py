import csv, io
from pathlib import Path
import pytest
from app.domain import (
    build_dataset,
    read_csv,
    validate,
    metrics,
    DomainError,
    UNASSIGNED,
)
from app.optimizer import solve

SAMPLES = Path(__file__).resolve().parents[2] / "samples"


def encode(rows):
    s = io.StringIO()
    w = csv.DictWriter(s, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(rows)
    return s.getvalue().encode()


def fixture():
    g = [
        {
            "gate_id": "T1",
            "terminal": "T",
            "region": "North",
            "arr_types": "D,I",
            "dep_types": "D,I",
            "body_type": "N",
        }
    ]
    t = [
        {
            "turnaround_id": "A",
            "arrival_at": "2026-10-03 08:00",
            "departure_at": "2026-10-03 09:00",
            "arrival_flight": "IN1",
            "departure_flight": "OUT1",
            "arrival_type": "D",
            "departure_type": "D",
            "body_type": "N",
        },
        {
            "turnaround_id": "B",
            "arrival_at": "2026-10-03 09:45",
            "departure_at": "2026-10-03 10:30",
            "arrival_flight": "IN2",
            "departure_flight": "OUT2",
            "arrival_type": "D",
            "departure_type": "D",
            "body_type": "N",
        },
    ]
    return g, t


def build(g, t, groups=None):
    f = {"gates": encode(g), "turnarounds": encode(t)}
    if groups:
        f["transfers"] = encode(groups)
    return build_dataset(f, "2026-10-03")


def test_buffer_boundary_and_metrics_tampering():
    g, t = fixture()
    d = build(g, t)
    a = {"A": "T1", "B": "T1"}
    assert validate(d, a)["valid"]
    d["turnarounds"][1]["arrival_at"] = "2026-10-03 09:44"
    assert not validate(d, a)["valid"]
    assert any(x["rule"] == "BR-004" for x in validate(d, a)["errors"])
    d = build(g, t)
    m, _ = metrics(d, a)
    m["U"] = 10
    assert not validate(d, a, m)["valid"]


def test_cross_day_full_interval_and_previous_buffer():
    g, t = fixture()
    t[0]["arrival_at"] = "2026-10-02 08:00"
    t[0]["departure_at"] = "2026-10-04 02:00"
    t[1]["arrival_at"] = "2026-10-02 20:00"
    t[1]["departure_at"] = "2026-10-02 23:30"
    d = build(g, t)
    assert len(d["turnarounds"]) == 2
    assert not validate(d, {"A": "T1", "B": "T1"})["valid"]


def test_multiline_chinese_header_no_skipped_records():
    raw = '"旅客\n记录号",乘客数,"到达\n航班","到达\n日期","出发\n航班","出发\n日期"\nT0001,2,IN1,03-Oct-26,OUT2,03-Oct-26\n'
    assert read_csv(raw.encode(), "transfers")[0]["transfer_group_id"] == "T0001"


def test_unknown_model_and_duplicate_key():
    g, t = fixture()
    del t[0]["body_type"]
    t[0]["aircraft_model"] = "unknown"
    # Serialize compatible columns without dropping the model.
    t = [t[0]]
    with pytest.raises(DomainError):
        build(g, t)
    g, t = fixture()
    t[1]["turnaround_id"] = "A"
    with pytest.raises(DomainError):
        build(g, t)


def test_ambiguity_excluded_and_coverage():
    g, t = fixture()
    t.append({**t[0], "turnaround_id": "C"})
    groups = [
        {
            "transfer_group_id": "P",
            "passenger_count": "2",
            "arrival_flight": "IN1",
            "arrival_date": "2026-10-03",
            "departure_flight": "OUT2",
            "departure_date": "2026-10-03",
        }
    ]
    d = build(g, t, groups)
    assert d["excluded"][0]["reason"] == "匹配多条"
    assert d["coverage"] == {"matched": 0, "total": 2, "excluded": 2, "rate": 0}


def test_cost_unassigned_and_no_false_paths():
    g, t = fixture()
    t[1]["arrival_at"] = "2026-10-03 07:30"
    t[1]["departure_at"] = "2026-10-03 08:40"
    groups = [
        {
            "transfer_group_id": "P",
            "passenger_count": "2",
            "arrival_flight": "IN1",
            "arrival_date": "2026-10-03",
            "departure_flight": "OUT2",
            "departure_date": "2026-10-03",
        }
    ]
    d = build(g, t, groups)
    m, rows = metrics(d, {"A": "T1", "B": "T1"})
    assert m["C"] == 70 and m["average_process_minutes"] == 35
    m, rows = metrics(d, {"A": "T1", "B": UNASSIGNED})
    assert (
        m["C"] == 360
        and rows[0]["process_minutes"] is None
        and m["average_process_minutes"] is None
    )
    d["turnarounds"][1]["departure_at"] = "2026-10-03 08:34"
    assert metrics(d, {"A": "T1", "B": "T1"})[0]["C"] == 360


@pytest.mark.parametrize(
    "assignment",
    [{"A": "UNKNOWN", "B": "T1"}, {"A": "T1"}, {"A": "T1", "B": "T1", "C": "T1"}],
)
def test_invalid_assignments(assignment):
    g, t = fixture()
    assert not validate(build(g, t), assignment)["valid"]


def test_compatibility_and_empty_assignment():
    g, t = fixture()
    d = build(g, t)
    d["turnarounds"][0]["body_type"] = "W"
    assert not validate(d, {"A": "T1", "B": "T1"})["valid"]
    assert not validate(d, {"A": UNASSIGNED, "B": UNASSIGNED})["selectable"]


def test_seed_reproducibility_and_independent_validation():
    files = {
        k: (SAMPLES / f"{k}.csv").read_bytes()
        for k in ["gates", "turnarounds", "transfers"]
    }
    d = build_dataset(files, "2026-10-03")
    a = solve(d, seconds=None, evaluations=160, seed=42)
    b = solve(d, seconds=None, evaluations=160, seed=42)
    assert a["solutions"] and a["solutions"] == b["solutions"]
    assert all(
        validate(d, s["assignments"], s["metrics"])["selectable"]
        for s in a["solutions"]
    )
