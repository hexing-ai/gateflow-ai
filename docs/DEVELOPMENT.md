# 开发、模型与数据说明

从仓库根目录执行以下命令。首次体验可先使用 README 中的前端演示，无需启动本节服务。

## 本地开发

Python 3.12、Node.js 22。开发辅助脚本通过 `pgserver` 启动真实 PostgreSQL；生产使用 Compose 的数据库服务。

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
npm ci --prefix web
.venv/bin/python scripts/dev_backend.py
# 另一个终端
npm run dev --prefix web
```

前端：`http://127.0.0.1:5173`；API 文档：`http://127.0.0.1:8000/docs`。本机随机密码保存在 `.local/credentials.json`，该目录已忽略，不要提交或公开。开发页面由 Vite 代理 API。

## 模型接入

服务端支持 OpenAI-compatible Chat Completions。仅在服务端环境设置 `LLM_BASE_URL`（HTTPS，含 `/v1`）、`LLM_API_KEY`、`LLM_MODEL` 与 `LLM_PROVIDER`，重启 API 后由所有者在设置中同意发送范围并启用。不要将密钥写入 `VITE_*` 环境变量。

每个请求最多两次模型调用，账号每日上限 100 次；响应经 Pydantic schema 校验。配置卡必须经用户确认，模型不能修改分配、最终选用、删除数据或下发指令。解释使用限定的解读重点与真实证据 ID，数值及差额来自程序，不接受模型自由生成数字结论。未配置价格时显示费用未知。没有模型时仍可完成表单闭环。

本仓库包含模拟供应商的适配测试；不宣称已完成某家真实模型的端到端验收或 60 条发布评测集。

## 数据与规则

- 三类 CSV 的标准字段见 `samples/*.csv`，支持 UTF-8 / UTF-8-BOM、带引号的多行中文表头。
- 使用运行日占用区间相交规则；原始时间保留，图表可以裁切。固定使用 `Asia/Shanghai`。
- 同一周转在一个固定口，N/W 同类匹配，到达/出发 D/I 分别匹配；离港后缓冲 45 分钟。
- `UNASSIGNED` 是未安排固定口，不是一个无限容量的远机位。
- 资源模式最小化 `(U,G)`；成本模式最小化 `(U,G,C)`。C 是流程时间与惩罚的加权和，单位人·分钟。
- 流程矩阵仅适用于 T/S 研究布局，不包含真实步行、捷运和机场生产规则。
- 未知机型不默认窄体。原 CSV 若只有机型代码，须提供明确映射，或先转换为带 `body_type` 的标准模板。

这是一款离线分析工具，不直接连接机场生产系统。

## 测试与复现

```bash
PYTHONPATH=backend .venv/bin/pytest backend/tests -q
.venv/bin/python scripts/generate_demo.py
npm run build --prefix web
# 在本机后端启动后，验证真实 worker、并发请求、取消和导出
.venv/bin/python scripts/smoke_backend.py
```

固定种子、评价次数和依赖环境可复现；墙钟预算停止不保证位级一致。完整依赖锁定于 `backend/requirements.lock` 和 `web/package-lock.json`。验证记录只报告实际执行的检查。


[返回首页](../README.md)
