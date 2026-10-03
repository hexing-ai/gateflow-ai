export const base = import.meta.env.BASE_URL;
export const staticOnly = import.meta.env.VITE_DEMO_ONLY === "true";
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "x-gateflow-client": "web",
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (!response.ok) {
    let data;
    try {
      data = await response.json();
    } catch {
      data = { message: "请求失败，请检查服务状态" };
    }
    throw new Error(
      (data.message ||
        (typeof data.detail === "string"
          ? data.detail
          : JSON.stringify(data.detail)) ||
        "请求失败") +
        (data.details?.length
          ? "\n" +
            data.details
              .slice(0, 8)
              .map(
                (d: { record: number; reason: string }) =>
                  `记录 ${d.record}：${d.reason}`,
              )
              .join("\n")
          : ""),
    );
  }
  return response.json();
}
export const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
export const percent = (n: number | null) =>
  n == null ? "—" : (n * 100).toFixed(1) + "%";
export const statusName: Record<string, string> = {
  queued: "排队中",
  running: "计算中",
  validating: "校验中",
  completed: "已完成",
  cancelling: "取消中",
  cancelled: "已取消",
  no_candidates: "未找到可用候选",
  failed: "运行失败",
};
