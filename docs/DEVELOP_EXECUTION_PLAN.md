# On The Road 开发执行计划

> 版本：0.1
> 日期：2026-07-26
> 上游基线：[DEVELOPMENT_MILESTONE.md](./DEVELOPMENT_MILESTONE.md)
> 测试明细：[TEST_CASES.md](./TEST_CASES.md)
> 用途：供多个 AI agent 按 Milestone → Task → Test Case 领取、实现、验证和交接。
> 当前游标：M0–M4 Dev Track 已关门；当前进入 M5 规划，M5–M6 尚未宣称完成。当前状态见 [文档状态索引](./README.md)。

## 0. 执行约束

本文不重复 Task 的目标、范围和验收定义；这些内容以 `DEVELOPMENT_MILESTONE.md` 为唯一事实源。本文只定义执行顺序、依赖、Test Case、并行边界和交接要求。

### 0.1 每个 Task 的固定执行协议

1. 读取 `DEVELOPMENT_MILESTONE.md` 中对应 Task 全部字段，并读取 `TEST_CASES.md` 中三个对应 Case。
2. 检查依赖 Task 的 `TC-<Task>-03` 是否通过；未通过不得假设依赖已经完成。
3. 领取共享修改锁，检查工作区已有改动，不覆盖其他 agent 的未提交修改。
4. 先落地 `TC-<Task>-01`；`P0 / Critical` 还必须先落地 `TC-<Task>-02`，并证明测试在缺少实现时以预期原因失败。
5. 实现 Task；只修改 Task 范围内文件。需要跨模块时先补 ADR，并在交接记录中声明。
6. 实现完成后必须额外补齐 `TC-<Task>-03` 的集成/E2E/运行证据代码；不能用手工截图替代。
7. 运行 `01 + 02 + 03`、受影响包测试和当前 Milestone 已可运行的 Integration Case。
8. 交接时报告：修改文件、测试命令/结果、migration/contract 变化、共享锁释放、未解决风险和下一 Task 的可启动状态。

M0、M2、M3、M4、M5 Gate 还必须提交一次架构/安全差异复审记录，检查模块边界、Provider/文件/网络攻击面、状态机和 Plan B 是否因本里程碑实现发生变化。M3 的补充复审与签署归档在 `docs/reports/m3-rnd-final-review.md`。每次 Gate 演示同时运行固定五日 fixture 和一条从空账号开始的真实路径；fixture 不能替代创建、权限与持久化验证。

A02 使用双轨状态：Native Track 的启动、恢复和 dev gate 全绿即可标记当前阶段 `A02 Complete` 并放行后续开发。Compose Track 必须在本轮尝试；若环境不可用，记录原因并转入发布 checklist，不阻断当前 Milestone，但发布前必须补齐。2026-08-11 的本地 Compose 健康、持久化、EICAR 和 fail-closed 证据已归档，当前 A02 已关闭；CI/staging release parity 仍由发布 checklist 管理。

A05 同样使用双轨状态：Dev Identity/Mock OIDC Track 的登录、会话、owner/BOLA、密钥轮换模拟和 dev gate 全绿即可标记当前阶段 `A05 Complete` 并放行后续开发。Staging IdP Track 必须在本轮尝试；若缺少 staging 环境、IdP 配置或可达回调，记录原因并转入发布 checklist，不阻断当前 Milestone，但真实 Authorization Code + PKCE 回调、HTTPS Cookie、登出和真实密钥轮换未通过时不得正式发布。

### 0.2 Test Case 编号

- `TC-A01-01`：Task A01 的实现前契约/Red Case。
- `TC-A01-02`：Task A01 的异常、边界、竞态或安全 Case。
- `TC-A01-03`：Task A01 完成后必须补齐的集成/E2E/证据 Case。
- `TC-Mx-INT-yy`：Milestone 级集成 Case；所属 Task 全部 `03` 通过后运行。
- Case 的步骤、断言和具体测试文件只在 `TEST_CASES.md` 展开。

### 0.3 共享修改锁与并行检查

| Lock | 保护内容 | 并行规则 |
|---|---|---|
| `LOCK-WORKSPACE` | 根 `package.json`、workspace、Turbo、根 TypeScript/测试配置 | 同时只允许一个 Task 修改；其他 Task 可在已稳定配置上开发 |
| `LOCK-CONTRACT` | `packages/contracts/openapi.yaml`、生成客户端、事件 schema | 可并行设计，生成/提交必须串行；后合并者先 rebase 并重新生成 |
| `LOCK-DB-MIGRATION` | migration 序号、共享 schema index、seed 总入口 | schema 实现可分支并行，migration 编号/总入口串行 |
| `LOCK-CONFIG` | Currency/Mode/Category/map profile 集中配置 | 同时只允许一个 Task 改同一配置文件；消费方可并行 |
| `LOCK-FIXTURE` | 五日 seed、Excel/PDF golden、共享图片/地图资产 | 测试可读并行；更新 golden/seed 必须串行且附原因 |
| `LOCK-WEB-SHELL` | Trip workspace layout、全局 Query/store/provider、路由骨架 | feature 组件可并行；共享 shell 合并串行 |
| `LOCK-MAP-CORE` | MapLibre wrapper、统一选中 store、route layer source | Location picker、route style、print map 只在接口冻结后并行 |
| `LOCK-IMPORT-SCHEMA` | ImportJob/Row/Ledger/Claim/MediaTask 状态与 migration | E04 冻结核心 schema 后，E06–E09 可分模块并行；状态字段变更串行 |
| `LOCK-PDF-TEMPLATE` | print route、print CSS、分页锚点、字体 | F03/F04 接口先后执行；F05 可并行改 Worker，不直接改模板 |
| `LOCK-CI` | `.github/workflows/*`、全局 required checks | 测试文件可并行；workflow 合并由一个 agent 串行处理 |
| `LOCK-DOCS` | README、共享运行/配置文档 | 各模块先写局部文档；G07 汇总时串行整理 |

并行判断：

- 标记为“可并行”的 Task 仍需先满足依赖，并且不能同时持有同一独占锁。
- 两个 Task 若只修改不同 `apps/*` 或不同 `packages/*` 子模块，可并行。
- 预计文件包含同一 wildcard 不代表必然冲突；领取前必须用 `rg --files` 和 `git diff --name-only`（存在 Git 时）解析到实际文件。
- 发现其他 agent 已修改目标文件时，停止编辑该文件，先协调 ownership；不得重写或回滚他人改动。
- `apps/*` 不相互 import；共享类型进入 `packages/*`。违反这一点时即使测试通过也不得交接。

### 0.4 Agent 交接清单

每个 Task 的最终交接消息必须包含：

```text
Milestone / Task:
Dependencies verified:
Locks acquired/released:
Files changed:
TC-<Task>-01:
TC-<Task>-02:
TC-<Task>-03:
Milestone integration cases executed:
Migration/OpenAPI/event schema impact:
Feature flag / Plan B:
Known residual risks:
Next tasks unblocked:
```

---

## M0 执行顺序：风险定案与工程基线

### M0 Wave 0

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| A01 | 无 | TC-A01-01、TC-A01-02 | TC-A01-03 | 可与 A11/A12 并行；独占 `LOCK-WORKSPACE`、涉及 workflow 时持有 `LOCK-CI` |
| A11 | 无 | TC-A11-01、TC-A11-02 | TC-A11-03 | 可与 A01/A12 并行；独占 `LOCK-PDF-TEMPLATE`，fixture 更新需 `LOCK-FIXTURE` |
| A12 | 无 | TC-A12-01、TC-A12-02 | TC-A12-03 | 可与 A01/A11 实现并行；更新共享资产独占 `LOCK-FIXTURE` |

### M0 Wave 1

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| A02 | A01 | TC-A02-01、TC-A02-02 | TC-A02-03 | Native Track 可与 A03/A04/A08–A10 并行；`infra/native` 与 `infra/compose` 可分区修改，但共享 env/readiness 契约需串行 review |
| A03 | A01 | TC-A03-01、TC-A03-02 | TC-A03-03 | 可并行；修改根 `.env.example` 时与 A02 协调，持 `LOCK-WORKSPACE` |
| A04 | A01 | TC-A04-01、TC-A04-02 | TC-A04-03 | 可并行；独占 `LOCK-CONTRACT`，workflow 修改持 `LOCK-CI` |
| A08 | A12 | TC-A08-01、TC-A08-02 | TC-A08-03 | 可与 A09/A10 并行；golden 更新持 `LOCK-FIXTURE` |
| A09 | A12 | TC-A09-01、TC-A09-02 | TC-A09-03 | 可与 A08/A10 并行；Spike 内地图代码独立，不修改正式 `LOCK-MAP-CORE` |
| A10 | A12 | TC-A10-01、TC-A10-02 | TC-A10-03 | 可与 A08/A09 并行；Excel fixture 更新持 `LOCK-FIXTURE` |

### M0 Gate

执行：`TC-M0-INT-01`、`TC-M0-INT-02`。四类 Spike 任一 No-Go 时先修改 ADR、依赖图和对应 Plan B，不启动其后续关键路径。

---

## M1 执行顺序：旅行基础与异步底座

### M1 Wave 0

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| A05 | A03 | TC-A05-01、TC-A05-02 | TC-A05-03 | Dev Track 可与 A06/A07/B01/C01 并行；identity 路由和 Web public shell 分区领取；Staging IdP 结果或阻塞必须交接到发布 checklist |
| A06 | A02 | TC-A06-01、TC-A06-02 | TC-A06-03 | 可并行；Job migration 持 `LOCK-DB-MIGRATION` |
| A07 | A01 | TC-A07-01、TC-A07-02 | TC-A07-03 | 可并行；应用 telemetry 文件按 app 分区，不同时改根 collector 配置 |
| B01 | A02 | TC-B01-01、TC-B01-02 | TC-B01-03 | 可并行；独占 `LOCK-CONFIG`，seed 入口持 `LOCK-DB-MIGRATION` |
| C01 | A04 | TC-C01-01、TC-C01-02 | TC-C01-03 | 可并行；Provider contracts 稳定前 C02/F02 不启动 |

### M1 Wave 1

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| B02 | A02、A04、B01 | TC-B02-01、TC-B02-02 | TC-B02-03 | 可与 D01 并行；Trip migration 持 `LOCK-DB-MIGRATION`，OpenAPI 持 `LOCK-CONTRACT` |
| D01 | A02、A05 | TC-D01-01、TC-D01-02 | TC-D01-03 | 可与 B02 并行；Attachment migration 与 B02 串行领取 `LOCK-DB-MIGRATION` |

### M1 Wave 2

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| B03 | B02 | TC-B03-01、TC-B03-02 | TC-B03-03 | 可与 C03/B04 并行；Trip module 文件细分 ownership，migration 持锁 |
| C03 | A04、B02 | TC-C03-01、TC-C03-02 | TC-C03-03 | 可与 B03/B04 并行；独占 Location/Geocoding schema，修改 ImportRow 时登记 `LOCK-IMPORT-SCHEMA` |
| B04 | A04、B02 | TC-B04-01、TC-B04-02 | TC-B04-03 | 可与后端 Task 并行；持 `LOCK-WEB-SHELL` 仅修改 Trip list/wizard shell |

### M1 Gate

执行：`TC-M1-INT-01`、`TC-M1-INT-02`。只有 outbox 恢复、owner 隔离和 Trip/Day 原子创建均通过，M2 才可领取业务编辑 Task。M1 可使用通过 Dev Track 的 `A05 Complete`；这不构成真实 Staging IdP 或发布就绪证据，发布前仍必须关闭 A05 release checklist。G08 已从 M1 移出并标记为 Deprecated，不再领取、实现或阻断本 Gate；决策记录见 [`deprecated/G08-beta-cohort.md`](./deprecated/G08-beta-cohort.md)。

---

## M2 执行顺序：行程编辑与地点确认

### M2 Wave 0

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| B05 | B03、C03 | TC-B05-01、TC-B05-02 | TC-B05-03 | 可与 B06/B09/C02/C04/C05/D02/E01 并行；schema 持 `LOCK-DB-MIGRATION`、契约持 `LOCK-CONTRACT` |
| B06 | A04、B03、C03；可先用生成契约/mock | TC-B06-01、TC-B06-02 | TC-B06-03 | 可与 B05 并行；持 `LOCK-WEB-SHELL`，不得修改 map core |
| B09 | B01、B02 | TC-B09-01、TC-B09-02 | TC-B09-03 | 可并行；改集中 Mode config 时独占 `LOCK-CONFIG` |
| C02 | C01 | TC-C02-01、TC-C02-02 | TC-C02-03 | 可并行；只实现 geocoding adapter，不改 Provider contract |
| C04 | C03 | TC-C04-01、TC-C04-02 | TC-C04-03 | 可与 C05 并行；Location 组件目录独占，不改 map core |
| C05 | C01 | TC-C05-01、TC-C05-02 | TC-C05-03 | 可与 C04 并行；独占 `LOCK-MAP-CORE` |
| D02 | A02、A06、D01 | TC-D02-01、TC-D02-02 | TC-D02-03 | Worker/平台 lane 独立；Attachment schema 变更持 `LOCK-DB-MIGRATION` |
| E01 | B01 | TC-E01-01、TC-E01-02 | TC-E01-03 | 可并行；模板/别名字典更新与 A10 fixture 协调 `LOCK-FIXTURE` |

### M2 Wave 1

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| B07 | B05、B06 | TC-B07-01、TC-B07-02 | TC-B07-03 | 可与 B08/C06/D04/E02 并行；API 与 Web 文件分别领取，避免同时改 timeline root |
| B08 | B06 | TC-B08-01、TC-B08-02 | TC-B08-03 | 可并行；只改 autosave/leave guard，不重构 editor shell |
| C06 | C03、C05 | TC-C06-01、TC-C06-02 | TC-C06-03 | 可并行；修改 map picker 前领取 `LOCK-MAP-CORE` |
| D04 | B01、B05 | TC-D04-01、TC-D04-02 | TC-D04-03 | 可并行；Expense migration 持 `LOCK-DB-MIGRATION` |
| E02 | A06、D01、D02 | TC-E02-01、TC-E02-02 | TC-E02-03 | 可并行；Importer contract 尚未由 E04 扩展时不得预写 staging 规则 |

### M2 Gate

执行：`TC-M2-INT-01`、`TC-M2-INT-02`、`TC-M2-INT-03`。Marker 晚到写回、恶意上传或排序原子性任一失败，M3 Route/图库不得启动。

---

## M3 执行顺序：路线、图片、费用与 Excel staging

### M3 Wave 0

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| C07 | A06、C03、B05 | TC-C07-01、TC-C07-02 | TC-C07-03 | 可与 C09/D03/D05/E03/E04 并行；Route migration 持 `LOCK-DB-MIGRATION` |
| C09 | B06、C05 | TC-C09-01、TC-C09-02 | TC-C09-03 | 可并行；短时持 `LOCK-MAP-CORE` 接入 selection store |
| D03 | D01、D02 | TC-D03-01、TC-D03-02 | TC-D03-03 | 可并行；图库与 timeline 只通过公开组件接口集成 |
| D05 | D04 | TC-D05-01、TC-D05-02 | TC-D05-03 | 可并行；费用页面独立，不改 print summary |
| E03 | E02 | TC-E03-01、TC-E03-02 | TC-E03-03 | 可与 E04 并行，先以 mapping DTO 契约工作；契约变更持 `LOCK-CONTRACT` |
| E04 | E01、E02 | TC-E04-01、TC-E04-02 | TC-E04-03 | 可与 E03 并行；独占 `LOCK-IMPORT-SCHEMA` 与 `LOCK-DB-MIGRATION` |

### M3 Wave 1

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| C08 | C05、C07 | TC-C08-01、TC-C08-02 | TC-C08-03 | 可与 E05 并行；接入 route layer 时独占 `LOCK-MAP-CORE` |
| E05 | E03、E04 | TC-E05-01、TC-E05-02 | TC-E05-03 | 可与 C08 并行；只读 Import DTO，不改 schema |

### M3 Gate

执行：`TC-M3-INT-01`、`TC-M3-INT-02`。同时冻结 E04 staging contract；E06/E07 的前置切片必须 rebase 到该契约后才进入 M4。

---

## M4 执行顺序：Excel 闭环与 PDF 骨架

### M4 Wave 0

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| E06 | C02、E04 | TC-E06-01、TC-E06-02 | TC-E06-03 | 可与 E07/F01/F02 并行；只改 GeocodingJob 扩展，schema 变更持 `LOCK-IMPORT-SCHEMA` |
| E07 | C06、E04 | TC-E07-01、TC-E07-02 | TC-E07-03 | 可与 E06 并行；import location picker 与普通 picker 复用公开接口 |
| F01 | A06、B05 | TC-F01-01、TC-F01-02 | TC-F01-03 | 可与 E06/E07/F02 并行；Export migration 持 `LOCK-DB-MIGRATION`，契约持 `LOCK-CONTRACT` |
| F02 | C07 | TC-F02-01、TC-F02-02 | TC-F02-03 | 可与 F01 并行；print map route 接口登记 `LOCK-PDF-TEMPLATE`，地图 fixture 持 `LOCK-FIXTURE` |

### M4 Wave 1

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| E08 | E04、E06、E07、C07 | TC-E08-01、TC-E08-02 | TC-E08-03 | 可与 F03/F05 并行；与 E09 同属 Import，migration/Job 状态修改必须串行持 `LOCK-IMPORT-SCHEMA` |
| E09 | D02、D03、E04 | TC-E09-01、TC-E09-02 | TC-E09-03 | 可与 F03/F05 并行；与 E08 的 schema 合并串行，Media Worker 文件独立 |
| F03 | D03、D05、F01 | TC-F03-01、TC-F03-02 | TC-F03-03 | 可与 E08/E09/F05 并行；独占 `LOCK-PDF-TEMPLATE` |
| F05 | A11、F01、F02 | TC-F05-01、TC-F05-02 | TC-F05-03 | 可与 F03 并行；只消费 print-ready 契约，不修改 template；Compose 文件需与平台修改协调 |

### M4 Gate

执行：`TC-M4-INT-01`、`TC-M4-INT-02`、`TC-M4-INT-03`。并发导入、SSRF/lease、snapshot 竞争任一测试失败均阻止 M5。

---

## M5 执行顺序：PDF 闭环与功能冻结

### M5 Wave 0

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| F04 | A11、F03 | TC-F04-01、TC-F04-02 | TC-F04-03 | 可与 F07/G01 并行；独占 `LOCK-PDF-TEMPLATE`，golden 更新持 `LOCK-FIXTURE` |
| F07 | F01、F05；可用状态 fixture | TC-F07-01、TC-F07-02 | TC-F07-03 | 可与 F04/G01 并行；Export UI 独立，不改 print template |
| G01 | A12、B–F 已稳定契约；各里程碑增量建设 | TC-G01-01、TC-G01-02 | TC-G01-03 | 可并行读取各模块；最终冻结独占 `LOCK-FIXTURE` 和 seed migration 入口 |

### M5 Wave 1

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| F06 | F04、F05 | TC-F06-01、TC-F06-02 | TC-F06-03 | 与 F04/F05 串行汇合；Storage export/cleanup 文件独立，契约变更持锁 |

### M5 Gate

执行：`TC-M5-INT-01`、`TC-M5-INT-02`、`TC-M5-INT-03`。通过后冻结 P0 功能、PDF golden、五日 fixture 和模板版本。

---

## M6 执行顺序：稳定、灰度与 GA

### M6 Wave 0

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| G02 | G01、全部核心功能 | TC-G02-01、TC-G02-02 | TC-G02-03 | 可与 G03–G06 并行；E2E fixture 只读，workflow 修改持 `LOCK-CI` |
| G03 | F06 | TC-G03-01、TC-G03-02 | TC-G03-03 | 可并行；PDF golden 更新独占 `LOCK-FIXTURE` |
| G04 | D–F | TC-G04-01、TC-G04-02 | TC-G04-03 | 可并行扫描；修复实际模块前领取对应模块锁，不做大范围机械覆盖 |
| G05 | E、F | TC-G05-01、TC-G05-02 | TC-G05-03 | 可并行；固定环境运行时避免与其他压测共享资源 |
| G06 | A07 | TC-G06-01、TC-G06-02 | TC-G06-03 | 可并行；Dashboard/alerts 目录按域分区领取 |

### M6 Wave 1

| Task | 依赖 | 实现前 Case | 完成后必须补齐 | 并行与修改冲突 |
|---|---|---|---|---|
| G07 | 全部 | TC-G07-01、TC-G07-02 | TC-G07-03 | 在其他 Task 稳定后汇总；独占 `LOCK-DOCS`，不得改业务实现 |

### M6 Gate

执行：`TC-M6-INT-01`、`TC-M6-INT-02`。所有有效 Task `03`、Milestone Integration Case、风险追踪矩阵和发布门禁均有代码或归档证据后，才可签署 Release Done。`TC-M6-INT-03` 随 G08 一并标记为 Deprecated 并保留编号，真实 Beta cohort 或固定用户样本数不再是 Release Done 的前置条件。

---

## 8. 跨 Milestone 的自动化累积规则

- G01：从 A12 起持续追加 fixture；每个功能 Task 应同步补最小 fixture，G01 只负责最终一致性与冻结。
- G02：B04 后即建立最短 create/reload smoke；B06/C06/C09/D03/E08/F06 完成时分别扩展核心闭环，不在 M6 从零编写。
- G03：A11 建立 PDF 原型基线，F02/F03/F04/F06 分别追加地图、章节、目录与产物验证。
- G04：A05/D02/E02/E09/F05 完成时同步追加 auth/upload/Excel/SSRF/Chromium 攻击测试。
- G05：A10/A11 记录基线，E04/E08/F05/F06 完成后逐段添加 benchmark；M6 只运行固定环境最终报告。
- 每个功能 Task 的 `03` 必须落在仓库测试代码中；仅在外部 issue 中记录 case 不算补齐。

## 9. AI Agent 启动判定

一个 Agent 可以领取 Task 的必要条件：

- 上游 Task 的 `03` 已通过，或执行表明确允许使用冻结 mock/contract 并行。
- 目标文件没有未协调的其他 agent 修改。
- 所需共享锁可获得。
- `TEST_CASES.md` 中该 Task 的 fixture 和断言可实现；若不可实现，先修订 Case/ADR，不直接弱化断言。
- 当前 Task 不需要推翻上游公开契约；需要破坏性修改时返回上游 Milestone 重新评审。

一个 Agent 完成 Task 后必须明确指出：

- 哪些 `01/02` 在实现前落地并观察到预期 Red；
- `03` 新增到了哪个具体测试文件；
- 哪些后续 Task 因此被解锁；
- 是否触发 `LOCK-CONTRACT`、`LOCK-DB-MIGRATION`、`LOCK-FIXTURE` 或其他 agent 需要 rebase 的共享变更。
