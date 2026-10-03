# 部署说明

## GitHub Pages：公开演示

仓库的 `pages.yml` 工作流执行 `npm ci`、TypeScript 检查与 Vite 构建，再发布 `web/dist`。构建时使用 `VITE_DEMO_ONLY=true` 与仓库子路径 `VITE_BASE_PATH=/gateflow-ai/`，因此不请求私人 API，也不需要模型密钥。

公开构建仅含合成 CSV、预计算结果和证据包。部署使用 GitHub Actions OIDC；无需把个人 GitHub token 写进仓库。

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
