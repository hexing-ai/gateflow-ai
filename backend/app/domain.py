"""Versioned airport domain. No network or persistence dependencies."""

from __future__ import annotations
import csv
import hashlib
import io
import json
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

RULES = {
    "version": "ts-research-v1",
    "timezone": "Asia/Shanghai",
    "buffer_minutes": 45,
    "step_minutes": 5,
    "penalty_minutes": 180,
    "matrix": [[35, 40, 50, 55], [40, 35, 55, 50], [45, 50, 60, 65], [50, 45, 65, 60]],
}
UNASSIGNED = "UNASSIGNED"
TZ = ZoneInfo(RULES["timezone"])
ALIASES = {
    "登机口": "gate_id",
    "终端厅": "terminal",
    "区域": "region",
    "机体类别": "body_type",
    "到达类型": "arrival_type",
    "出发类型": "departure_type",
    "飞机转场记录号": "turnaround_id",
    "到达日期": "arrival_date",
    "到达时刻": "arrival_time",
    "到达航班": "arrival_flight",
    "出发日期": "departure_date",
    "出发时刻": "departure_time",
    "出发航班": "departure_flight",
    "飞机型号": "aircraft_model",
    "旅客记录号": "transfer_group_id",
    "乘客数": "passenger_count",
}
REQUIRED = {
    "gates": {"gate_id", "terminal", "region", "arr_types", "dep_types", "body_type"},
    "turnarounds": {
        "turnaround_id",
        "arrival_at",
        "departure_at",
        "arrival_flight",
        "departure_flight",
        "arrival_type",
        "departure_type",
        "body_type",
    },
    "transfers": {
        "transfer_group_id",
        "passenger_count",
        "arrival_flight",
        "arrival_date",
        "departure_flight",
        "departure_date",
    },
}


class DomainError(ValueError):
    def __init__(self, code, message, details=None):
        self.code, self.message, self.details = code, message, details or []
        super().__init__(message)


def digest(value):
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode()
    ).hexdigest()


def date_value(s):
    # English month parsing is independent of the machine's locale.
    s = s.strip()
    try:
        return datetime.strptime(s, "%Y-%m-%d").date().isoformat()
    except ValueError:
        parts = s.split("-")
        months = dict(
            zip("jan feb mar apr may jun jul aug sep oct nov dec".split(), range(1, 13))
        )
        if len(parts) == 3 and parts[1].lower() in months:
            year = int(parts[2])
            year = year + 2000 if year < 100 else year
            return (
                datetime(year, months[parts[1].lower()], int(parts[0]))
                .date()
                .isoformat()
            )
        raise ValueError("日期须为 YYYY-MM-DD 或 DD-Mon-YY")


def timestamp(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=TZ)


def read_csv(raw: bytes, kind: str, model_mapping=None):
    if len(raw) > 5 * 1024 * 1024:
        raise DomainError("DATA_TOO_LARGE", "单文件不能超过 5 MB")
    try:
        text = raw.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError:
        raise DomainError("DATA_SCHEMA_INVALID", "请转换为 UTF-8 编码后上传")
    reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
    if not reader.fieldnames:
        raise DomainError("DATA_SCHEMA_INVALID", "文件为空或缺少表头")

    def header(h):
        h = "".join(h.split())
        h = ALIASES.get(h, h)
        if kind == "gates":
            h = {"arrival_type": "arr_types", "departure_type": "dep_types"}.get(h, h)
        return h

    headers = [header(h) for h in reader.fieldnames]
    if len(set(headers)) != len(headers):
        raise DomainError("DATA_SCHEMA_INVALID", "存在重复表头")
    rows, errors, seen = [], [], set()
    try:
        for number, source in enumerate(reader, 1):
            try:
                if None in source or any(v is None for v in source.values()):
                    raise ValueError("列数与表头不一致")
                row = {header(k): v.strip() for k, v in source.items()}
                if kind == "turnarounds":
                    for side in ("arrival", "departure"):
                        if (
                            f"{side}_at" not in row
                            and row.get(f"{side}_date")
                            and row.get(f"{side}_time")
                        ):
                            row[f"{side}_at"] = (
                                date_value(row[f"{side}_date"])
                                + " "
                                + row[f"{side}_time"][:5]
                            )
                    if not row.get("body_type"):
                        row["body_type"] = (model_mapping or {}).get(
                            row.get("aircraft_model"), ""
                        )
                        if not row["body_type"]:
                            raise ValueError(
                                "未知机型映射：请提供明确的 body_type 或机型映射表"
                            )
                missing = REQUIRED[kind] - row.keys()
                if missing or any(not row.get(k) for k in REQUIRED[kind]):
                    raise ValueError(
                        "必填字段缺失："
                        + ", ".join(
                            sorted(
                                missing or {k for k in REQUIRED[kind] if not row.get(k)}
                            )
                        )
                    )
                pk = row[
                    {
                        "gates": "gate_id",
                        "turnarounds": "turnaround_id",
                        "transfers": "transfer_group_id",
                    }[kind]
                ]
                if pk in seen or pk == UNASSIGNED or len(pk) > 128:
                    raise ValueError("主键重复、超长或使用保留值")
                seen.add(pk)
                if kind != "transfers":
                    row["body_type"] = row["body_type"].upper()
                    if row["body_type"] not in ("N", "W"):
                        raise ValueError("机体类型只支持 N/W")
                if kind == "gates":
                    row["terminal"] = row["terminal"].upper()
                    if row["terminal"] not in ("T", "S"):
                        raise ValueError("规则包仅支持 T/S 厅")
                    for key in ("arr_types", "dep_types"):
                        val = (
                            row[key]
                            .upper()
                            .replace("，", ",")
                            .replace("/", ",")
                            .replace(" ", ",")
                        )
                        types = sorted(set(val.split(",")) - {""})
                        if not types or not set(types) <= {"D", "I"}:
                            raise ValueError("到发类型集合只支持 D/I")
                        row[key] = types
                if kind == "turnarounds":
                    if timestamp(row["departure_at"]) <= timestamp(row["arrival_at"]):
                        raise ValueError("出发须晚于到达")
                    for key in ("arrival_type", "departure_type"):
                        row[key] = row[key].upper()
                        if row[key] not in ("D", "I"):
                            raise ValueError("航班类型只支持 D/I")
                if kind == "transfers":
                    if (
                        not row["passenger_count"].isdigit()
                        or int(row["passenger_count"]) <= 0
                    ):
                        raise ValueError("人数须为正整数")
                    row["passenger_count"] = int(row["passenger_count"])
                    for key in ("arrival_date", "departure_date"):
                        row[key] = date_value(row[key])
                rows.append(row)
            except (ValueError, KeyError) as exc:
                errors.append({"record": number, "reason": str(exc), "file": kind})
    except csv.Error as exc:
        raise DomainError(
            "DATA_SCHEMA_INVALID", "CSV 引号或记录格式错误", [{"reason": str(exc)}]
        )
    if errors:
        raise DomainError(
            "DATA_SCHEMA_INVALID", "数据检查未通过，请修正报告中的记录", errors
        )
    return rows


def build_dataset(files, day, model_mapping=None):
    day = date_value(day)
    rows = {k: read_csv(v, k, model_mapping) for k, v in files.items() if v}
    gates, all_turns, transfers = (
        rows.get("gates", []),
        rows.get("turnarounds", []),
        rows.get("transfers", []),
    )
    start = timestamp(day + " 00:00")
    end = start + timedelta(days=1)
    turns = [
        t
        for t in all_turns
        if timestamp(t["arrival_at"]) < end
        and timestamp(t["departure_at"]) + timedelta(minutes=45) > start
    ]
    if not gates or not turns:
        raise DomainError("DATA_SCOPE_EMPTY", "运行日没有周转记录或缺少登机口")
    pending = [t for t in transfers if t["arrival_date"] == day]
    if len(gates) > 100 or len(turns) > 1000 or len(pending) > 10000:
        raise DomainError(
            "DATA_TOO_LARGE", "单次分析上限为 100 个口、1,000 条周转、10,000 个客流组"
        )
    incoming, outgoing = defaultdict(list), defaultdict(list)
    for t in all_turns:
        incoming[(t["arrival_flight"], t["arrival_at"][:10])].append(t)
        outgoing[(t["departure_flight"], t["departure_at"][:10])].append(t)
    included = {t["turnaround_id"] for t in turns}
    matched, excluded = [], []
    for group in pending:
        a = incoming[(group["arrival_flight"], group["arrival_date"])]
        b = outgoing[(group["departure_flight"], group["departure_date"])]
        reason = ""
        if not a or not b:
            reason = "未匹配到航班"
        elif len(a) != 1 or len(b) != 1:
            reason = "匹配多条"
        elif a[0]["turnaround_id"] == b[0]["turnaround_id"]:
            reason = "同一周转"
        elif timestamp(b[0]["departure_at"]) <= timestamp(a[0]["arrival_at"]):
            reason = "非正衔接时间"
        elif (
            a[0]["turnaround_id"] not in included
            or b[0]["turnaround_id"] not in included
        ):
            reason = "端点超出分析范围"
        if reason:
            excluded.append({**group, "reason": reason})
        else:
            matched.append(
                {
                    **group,
                    "arrival_id": a[0]["turnaround_id"],
                    "departure_id": b[0]["turnaround_id"],
                }
            )
    total = sum(t["passenger_count"] for t in pending)
    valid = sum(t["passenger_count"] for t in matched)
    scope = {
        "day": day,
        "turnarounds": [t["turnaround_id"] for t in turns],
        "transfers": [t["transfer_group_id"] for t in matched],
    }
    return {
        "day": day,
        "gates": gates,
        "turnarounds": turns,
        "transfers": matched,
        "excluded": excluded,
        "rules": RULES,
        "rules_hash": digest(RULES),
        "scope_hash": digest(scope),
        "file_hashes": {
            k: hashlib.sha256(v).hexdigest() for k, v in files.items() if v
        },
        "raw_counts": {k: len(v) for k, v in rows.items()},
        "total_passengers": sum(t["passenger_count"] for t in transfers),
        "coverage": {
            "matched": valid,
            "total": total,
            "excluded": total - valid,
            "rate": valid / total if total else None,
        },
        "status": "needs_confirmation" if excluded else "ready",
    }


def compatible(t, g):
    return (
        t["body_type"] == g["body_type"]
        and t["arrival_type"] in g["arr_types"]
        and t["departure_type"] in g["dep_types"]
    )


def metrics(dataset, assignments):
    by_turn = {t["turnaround_id"]: t for t in dataset["turnarounds"]}
    by_gate = {g["gate_id"]: g for g in dataset["gates"]}
    u = sum(v == UNASSIGNED for v in assignments.values())
    used = len(set(assignments.values()) - {UNASSIGNED})
    cost = failed = qualified = weighted = 0
    details = []
    for group in dataset["transfers"]:
        a, b = by_turn[group["arrival_id"]], by_turn[group["departure_id"]]
        ga, gb = (
            by_gate.get(assignments[a["turnaround_id"]]),
            by_gate.get(assignments[b["turnaround_id"]]),
        )
        slack = (
            timestamp(b["departure_at"]) - timestamp(a["arrival_at"])
        ).total_seconds() / 60
        proc = None
        reason = "未分配固定口"
        if ga and gb:
            row = (2 if a["arrival_type"] == "I" else 0) + (ga["terminal"] == "S")
            col = (2 if b["departure_type"] == "I" else 0) + (gb["terminal"] == "S")
            proc = RULES["matrix"][row][col]
            reason = "满足模型条件" if slack >= proc else "流程时间不足"
        success = bool(ga and gb and slack >= proc)
        n = group["passenger_count"]
        contribution = n * (proc if success else 180)
        cost += contribution
        if success:
            qualified += n
            weighted += n * proc
        else:
            failed += n
        details.append(
            {
                **group,
                "arrival_gate": ga["gate_id"] if ga else UNASSIGNED,
                "departure_gate": gb["gate_id"] if gb else UNASSIGNED,
                "process_minutes": proc,
                "connection_minutes": slack,
                "satisfied": success,
                "reason": reason,
                "cost": contribution,
            }
        )
    return {
        "U": u,
        "G": used,
        "N": len(by_turn),
        "allocation_rate": (len(by_turn) - u) / len(by_turn),
        "C": cost if dataset["transfers"] else None,
        "unmet_passengers": failed if dataset["transfers"] else None,
        "average_process_minutes": weighted / qualified if qualified else None,
        "coverage": dataset["coverage"],
    }, details


def validate(dataset, assignments, stored_metrics=None):
    errors = []
    turns = dataset["turnarounds"]
    gates = {g["gate_id"]: g for g in dataset["gates"]}
    intervals = defaultdict(list)
    expected = {t["turnaround_id"] for t in turns}
    if set(assignments) != expected:
        errors.append({"rule": "BR-001", "reason": "分配主键集合不一致"})
    for t in turns:
        tid = t["turnaround_id"]
        gid = assignments.get(tid)
        if gid == UNASSIGNED:
            continue
        if gid not in gates:
            errors.append(
                {"rule": "BR-001", "turnaround_id": tid, "reason": "未知登机口"}
            )
            continue
        if not compatible(t, gates[gid]):
            errors.append(
                {
                    "rule": "BR-003",
                    "turnaround_id": tid,
                    "gate_id": gid,
                    "reason": "机型或到发类型不兼容",
                }
            )
        intervals[gid].append(
            (
                timestamp(t["arrival_at"]),
                timestamp(t["departure_at"]) + timedelta(minutes=45),
                tid,
            )
        )
    for gid, items in intervals.items():
        items.sort()
        last_end = None
        last_id = None
        for start, end, tid in items:
            if last_end and start < last_end:
                errors.append(
                    {
                        "rule": "BR-004",
                        "gate_id": gid,
                        "turnaround_id": tid,
                        "other_id": last_id,
                        "reason": "占用或缓冲冲突",
                    }
                )
            if last_end is None or end > last_end:
                last_end, last_id = end, tid
    calculated = None
    if not errors:
        calculated, _ = metrics(dataset, assignments)
        if stored_metrics is not None and calculated != stored_metrics:
            errors.append({"rule": "METRICS", "reason": "指标复算不一致"})
    return {
        "version": "validator-v1",
        "valid": not errors,
        "selectable": not errors and any(v != UNASSIGNED for v in assignments.values()),
        "errors": errors,
        "metrics": calculated,
    }
