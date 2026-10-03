# 部署说明

## GitHub Pages：公开演示

仓库的 `pages.yml` 工作流执行 `npm ci`、TypeScript 检查与 Vite 构建，再发布 `web/dist`。构建时使用 `VITE_DEMO_ONLY=true` 与仓库子路径 `VITE_BASE_PATH=/gateflow-ai/`，因此不请求私人 API，也不需要模型密钥。

公开构建仅含合成 CSV、预计算结果和证据包。部署使用 GitHub Actions OIDC；无需把个人 GitHub token 写进仓库。

在 macOS / Linux 本地复核 Pages 构建时，构建与预览都要使用相同子路径：

```bash
VITE_DEMO_ONLY=true VITE_BASE_PATH=/gateflow-ai/ npm run build --prefix web
VITE_BASE_PATH=/gateflow-ai/ npm run preview --prefix web
```

访问终端所示端口下的 `/gateflow-ai/`。普通本地体验直接运行 README 中的 `npm run demo --prefix web`，无需设置子路径。

## 完整应用：Compose

1. 按 README 初始化 `.env`，不要提交该文件。
2. `docker compose up --build -d` 启动 PostgreSQL、API 和一个独立 worker。
3. 生产环境配置 HTTPS 反向代理，修改 `.env` 的 `PUBLIC_ORIGIN` 与 `COOKIE_SECURE=true`，重启 API。只允许同来源请求，浏览器登录用 HttpOnly、SameSite=Strict cookie。
4. 查询 `/api/health`；访问 `/docs` 检查 API；登录后用标准样例走通一次上传、生成、取消和导出。
5. `docker compose logs api worker` 查看日志。数据库卷为 `pgdata`；备份与保留期限由部署者配置。

应用当前用 `create_all` 初始化数据库，适用于全新实例；后续修改表结构前应引入版本化迁移，不应直接覆盖运行数据。API 和 worker 使用相同代码及规则版本。仅运行一个 API 实例、一个 worker；横向扩展前需要独立评估认证限流、任务租约和存储负载。

## 火山引擎后续接入

本次发布选择 GitHub Pages 在线演示，未创建火山引擎资源。完整应用依赖持久 PostgreSQL 和持续运行的独立 worker，不能把全部能力当作一个静态站点上传。

后续可在支持容器与持久服务的环境部署当前 Compose 拓扑。若选 veFaaS，需要先根据平台文档确定 API、外部 PostgreSQL 与后台求解 worker 的运行方式、网络、时限和资源配置，再执行应用部署与验证。本仓库不包含未验证的 veFaaS 资源标识、网关或发布命令。

## 生产前验证

- 真实供应商模型连通性、费用统计、账户数据条款与固定 AI 评测集。
- 目标机器上的 1,000 条周转与 10,000 客流组容量测试。
- HTTPS、恢复备份、账号密码和数据留存配置。
- 研究矩阵与实际机场规则的适用性。

这些检查不是公开只读样例的运行依赖，也不应由演示结果替代。

## 配置项与本地运行检查

建议用 `scripts/create_env.py` 生成完整 `.env`，不要把 `.env.example` 中的占位符直接用于部署。

| 配置 | 用途 |
| --- | --- |
| `POSTGRES_PASSWORD` | Compose 数据库密码；初始化脚本生成随机值 |
| `AUTH_SECRET` | 登录会话签名；初始化脚本生成 |
| `OWNER_PASSWORD_HASH` | Argon2 密码摘要；脚本交互生成，保留引号以免 Compose 解释 `$` |
| `PUBLIC_ORIGIN` | 浏览器实际来源，包括协议和端口 |
| `COOKIE_SECURE` | 本地 HTTP 为 false，生产 HTTPS 为 true |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_PROVIDER` | 可选服务端模型配置 |

Compose 中 API 与 worker 的 `DATABASE_URL` 根据数据库密码生成；不需要自行将数据库开放到公网。

```bash
docker compose ps
curl http://localhost:8000/api/health
docker compose logs --tail=100 api worker
```

当健康检查返回成功后，访问首页并登录。用 `samples/gates.csv`、`samples/turnarounds.csv` 和 `samples/transfers.csv`，选择 `2026-10-03` 走通一次分析。演示模式不接受上传；只有完整后端且登录后开放私人数据功能。

停止服务但保留数据：

```bash
docker compose down
```

不要在需要保留数据时添加 `-v`。数据库卷的备份应通过 PostgreSQL 工具完成，并在目标环境验证恢复流程。

## 常见启动问题

- **本地只想看界面**：执行 `npm run demo --prefix web`。`npm run dev` 面向完整开发，会尝试连接本机 API。
- **Node.js 版本不兼容**：使用 Node.js 22，再执行 `npm ci --prefix web`。
- **Vite 端口被占用**：以终端输出地址为准，或用 `npm run demo --prefix web -- --port 5178` 指定端口。
- **完整应用登录失败**：确认 `PUBLIC_ORIGIN` 与访问地址一致；localhost 与 127.0.0.1 是不同来源。本地 HTTP 使用 `COOKIE_SECURE=false`。
- **任务长时间排队**：检查 worker 日志与数据库连接；仅 API 启动不能执行后台计算。
- **模型未启用**：检查服务端环境配置并由所有者在设置中确认发送范围；表单分析不依赖模型。

本仓库提供容器配置；本机未提供 Docker daemon，因此并未以本机运行结果声称目标云环境已完成容器验收。后端模块和真实 PostgreSQL 开发链路的执行记录见 [验证记录](VALIDATION.md)。
