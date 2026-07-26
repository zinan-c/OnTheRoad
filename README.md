# On The Road

当前处于 M0“风险定案与工程基线”阶段。仓库已经开始落地工程基线与技术
Spike，但尚未开始业务 CRUD 或产品 UI：

- [产品与技术设计](./docs/DESIGN.md)
- [开发计划](./docs/DEVELOPMENT_PLAN.md)

M0 严格执行 `A01–A04、A08–A12`，技术 Spike 产物不代表后续业务能力已经验收。

## M0 工程基线

- Node.js：`24.14.0`
- pnpm：`9.15.4`
- 安装：`pnpm install --frozen-lockfile`
- 工具链检查：`pnpm run toolchain:check`
- 全质量门禁：`pnpm run quality`
- clean-checkout smoke：`pnpm run ci:smoke`

`pnpm run quality` 通过 Turbo 对所有 workspace 执行真实 ESLint、TypeScript、
Vitest 和 build。PDF Spike 还需要与 `@playwright/test` 版本匹配的 Chromium；
CI 会在对应任务中安装 Chromium。本地若使用预装浏览器，可显式设置
`OTR_A11_CHROMIUM_PATH`，源代码中不得写入开发机绝对路径。

### 需求交付顺序索引

| # | 交付项 | 文档位置 |
|---:|---|---|
| 1 | 需求理解与必要假设 | DESIGN §1 |
| 2 | 需要产品方确认的问题 | DESIGN §2 |
| 3 | 推荐总体架构 | DESIGN §5 |
| 4 | 技术选型及取舍 | DESIGN §6 |
| 5 | Mermaid 架构图 | DESIGN §7 |
| 6 | 同步流程 | DESIGN §8 |
| 7 | 异步流程 | DESIGN §9 |
| 8 | 任务状态机 | DESIGN §10 |
| 9 | REST API 详细设计 | DESIGN §11 |
| 10 | 数据模型与 SQL DDL | DESIGN §12 |
| 11 | 队列、重试、幂等和一致性 | DESIGN §13 |
| 12 | 安全设计 | DESIGN §14 |
| 13 | 临时存储及自动清理 | DESIGN §15 |
| 14 | 部署与扩容 | DESIGN §16 |
| 15 | 可观测性 | DESIGN §17 |
| 16 | MVP 范围 | DEVELOPMENT_PLAN §1 |
| 17 | 第二阶段扩展 | DEVELOPMENT_PLAN §2 |
| 18 | 推荐项目目录 | DEVELOPMENT_PLAN §3 |
| 19 | 关键模块伪代码 | DEVELOPMENT_PLAN §7 |
| 20 | 测试策略和验收标准 | DEVELOPMENT_PLAN §9–11 |
