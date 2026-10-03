import io, csv, json, zipfile
from .domain import metrics, validate, DomainError, digest


def safe(value):
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def csv_bytes(rows):
    out = io.StringIO(newline="")
    if rows:
        writer = csv.DictWriter(out, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows({k: safe(v) for k, v in r.items()} for r in rows)
    return ("\ufeff" + out.getvalue()).encode("utf-8")


def evidence_zip(run, dataset, solution, selection):
    report = validate(dataset, solution["assignments"], solution["metrics"])
    if run["status"] != "completed" or not report["selectable"]:
        raise DomainError("SOLUTION_INVALID", "该方案不能正式导出")
    metric, details = metrics(dataset, solution["assignments"])
    assignments = [
        {
            "turnaround_id": t["turnaround_id"],
            "arrival_at": t["arrival_at"],
            "departure_at": t["departure_at"],
            "gate_id": solution["assignments"][t["turnaround_id"]],
        }
        for t in dataset["turnarounds"]
    ]
    manifest = {
        k: run.get(k)
        for k in [
            "id",
            "dataset_id",
            "config",
            "config_hash",
            "created_at",
            "code_version",
            "dependency_versions",
        ]
    }
    manifest.update(
        solution_id=solution["id"],
        assignment_hash=digest(solution["assignments"]),
        rules=dataset["rules"],
        rules_hash=dataset["rules_hash"],
        scope_hash=dataset["scope_hash"],
        file_hashes=dataset["file_hashes"],
        selection=selection,
        stop_reason=run["result"]["stop_reason"],
        canonical_assignments=assignments,
        excluded=dataset["excluded"],
    )
    memory = io.BytesIO()
    with zipfile.ZipFile(memory, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("assignments.csv", csv_bytes(assignments))
        for name, data in [
            ("metrics.json", metric),
            ("validation.json", report),
            ("run_manifest.json", manifest),
        ]:
            z.writestr(name, json.dumps(data, ensure_ascii=False, indent=2))
        if details:
            z.writestr("transfer_details.csv", csv_bytes(details))
        z.writestr(
            "decision_summary.md",
            f"# 分配方案 {solution['id']}\n\n确定性摘要。\n\n未安排固定口：{metric['U']} 条；使用固定口：{metric['G']} 个；中转流程成本：{metric['C'] if metric['C'] is not None else '不适用'} 人·分钟。\n\n仅通过本版已建模约束；不代表机场生产运行批准。成本包含模型惩罚，不是实际节省时间。\n",
        )
    return memory.getvalue()
