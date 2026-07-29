# On The Road 测试用例设计与代码落点

> 版本：0.1
> 日期：2026-07-26
> 执行顺序：[DEVELOP_EXECUTION_PLAN.md](./DEVELOP_EXECUTION_PLAN.md)
> 验收基线：[DEVELOPMENT_MILESTONE.md](./DEVELOPMENT_MILESTONE.md)

## 0. 用例执行规范

### 0.1 用例层级

- `01`：实现前契约/Red Case。先写测试并确认因缺少目标行为而失败。
- `02`：异常、边界、竞态或安全 Case。Critical Task 必须在实现主体前落地。
- `03`：实现完成后补齐的集成/E2E/证据 Case。没有此代码，Task 不得标记完成。

### 0.2 通用约束

- 单元/属性测试使用 Vitest/Jest + fast-check；组件使用 Testing Library；浏览器使用 Playwright。
- PostgreSQL/PostGIS、Redis/BullMQ、MinIO、ClamAV 使用双轨测试：本机原生轨覆盖日常启动和快速集成，Compose/Testcontainers 轨在 CI/staging 覆盖 Linux、网络、资源和故障恢复；不以纯 mock 证明持久化不变量。
- 身份使用双轨测试：开发身份/Mock OIDC 轨覆盖日常登录、会话和 owner 安全门禁，真实 Staging IdP 轨在发布前覆盖登记回调、HTTPS Cookie、登出和真实密钥轮换；mock OIDC 不得作为发布身份凭据。
- 并发测试使用 barrier/latch 控制提交顺序；时间相关测试使用 fake clock；故障使用显式 fault injection。
- Provider contract 使用本地 mock server；CI 不访问公共地图服务。
- PDF 必须由独立 parser 打开，并逐页渲染验证；“页面出现下载按钮”不是 PDF 成功测试。
- 每个 Case 的测试名称必须包含完整 Case ID，例如 `test("TC-C06-02 late geocode cannot overwrite manual point", ...)`。
- Case 代码落点可按框架调整扩展名，但 ID、测试层级和断言不得丢失。

### 0.3 固定 fixture

- `minimal-five-day`：M0–M2 契约/Spike。
- `full-five-day`：M3–M6 E2E/PDF。
- `geo-golden`：至少 10 个中外 WGS84/GCJ-02/BD-09 点及同名候选。
- `imports/{standard,error,duplicate,malicious}`：xlsx/xls/csv。
- `media/{benign,eicar,wrong-mime,decode-bomb}`。
- `pdf/{50-pages,100-pages,ready-only}`。

---

## M0 Task Cases

### A01

- `TC-A01-01` — Workspace quality commands；代码：`tests/workspace/quality-scripts.spec.ts`。给定干净 workspace，逐项执行 lint/typecheck/unit/build；断言所有 workspace 被覆盖且任一命令非零会使总任务失败。
- `TC-A01-02` — Version/cache failure；代码：`tests/workspace/toolchain-guard.spec.ts`。注入错误 Node/pnpm 版本与故意类型错误；断言启动快速失败、缓存不能把失败伪装为通过。
- `TC-A01-03` — Clean checkout CI smoke；代码：`.github/workflows/ci.yml`、`tests/workspace/clean-install.spec.ts`。无 node_modules 环境安装并执行全套质量命令；断言生成物无未提交 diff。

### A02

- `TC-A02-01` — Native bootstrap/health；代码：`tests/infra/native-health.spec.mjs`。从隔离数据目录运行原生启动命令两次；断言版本检查、PID/端口隔离和初始化幂等，并验证 PostGIS extension、authenticated Redis、MinIO bucket 与 ClamAV TCP readiness。
- `TC-A02-02` — Native restart/degraded scanner；代码：`tests/infra/native-recovery.spec.mjs`。保留数据重启原生服务、清理残留 PID，并让 ClamAV 不可用；断言 PostgreSQL/Redis/对象数据保留，媒体 readiness fail-closed，停止命令不终止非本项目进程。
- `TC-A02-03` — Dev gate/Compose handoff；代码：`tests/infra/dev-gate.e2e.spec.mjs`。从干净项目状态运行 Native Track 两次，断言幂等且共享健康探针全绿；随后尝试 Compose parity。Compose 可用时验证等价 capability/readiness；不可用时断言保存可行动失败原因，并且发布 checklist 包含全部 Compose 强制项。Native Case 全绿且 handoff 完整即可通过当前 A02，但未完成的 Compose 项继续阻断正式发布。

### A03

- `TC-A03-01` — Minimal config schema；代码：`packages/config/test/env.spec.ts`。加载最小合法配置；断言 Web/API/Worker/PDF Worker 得到类型化一致配置。
- `TC-A03-02` — Secret/error redaction；代码：`packages/config/test/env-negative.spec.ts`。缺变量、非法 URL、冲突 profile、生产开发凭据；断言监听前退出且消息不含 Secret 值。
- `TC-A03-03` — `.env.example` boot；代码：`tests/config/example-env.e2e.spec.ts`。仅使用 example 的无 Key 模式启动；断言 capabilities 返回明确降级能力。

### A04

- `TC-A04-01` — OpenAPI generation；代码：`packages/contracts/test/generation.spec.ts`。从 spec 生成客户端；断言无手工 diff且 ID/日期/分页/ETag/Idempotency 类型存在。
- `TC-A04-02` — Breaking change/Problem Details；代码：`packages/contracts/test/compatibility.spec.ts`、`apps/api/test/problem-details.e2e-spec.ts`。删除字段并触发未知异常；断言 CI 阻断破坏变化，错误含 code/status/traceId 且无 stack。
- `TC-A04-03` — Generated client round-trip；代码：`tests/contracts/generated-client.e2e.spec.ts`。用生成客户端调用示例 API；断言成功响应和 4xx 均正确反序列化。

### A08

- `TC-A08-01` — Provider golden points；代码：`spikes/provider/provider-golden.spec.ts`。对 10+ 中外点执行搜索/反查/转换；断言领域输出 WGS84 且误差在 ADR 阈值内。
- `TC-A08-02` — Ambiguity/429/no-key；代码：`spikes/provider/provider-failure.spec.ts`。返回跨国同名、429、超时和无 Key；断言不静默切换/选中，错误与 Retry-After 被规范化。
- `TC-A08-03` — Repeatable spike report；代码：`spikes/provider/provider-spike.e2e.spec.ts`。两次运行同 fixture；断言候选/坐标/attribution 稳定，并生成 Go/No-Go 数据。

### A09

- `TC-A09-01` — Map interaction contract；代码：`spikes/maplibre/map-interaction.spec.tsx`。点选、拖 Marker、fit bounds；断言输出合法 WGS84 与选中事件。
- `TC-A09-02` — No basemap/WebGL edge；代码：`spikes/maplibre/map-degraded.e2e.spec.ts`。阻断 tile，测试 0/1/同点和 WebGL failure；断言中性网格/结构化空态出现。
- `TC-A09-03` — Route style visual；代码：`spikes/maplibre/map-styles.visual.spec.ts`。渲染飞机/步行/道路/船运；断言截图、图例、文本和 attribution 符合 golden。

### A10

- `TC-A10-01` — Three-format parsing；代码：`spikes/importer/format-roundtrip.spec.ts`。解析 xlsx/xls/csv 及 1900/1904 日期；断言行数/类型/golden 一致。
- `TC-A10-02` — Malformed/resource attack；代码：`spikes/importer/import-security.spec.ts`。输入 ZIP bomb、损坏文件、超 shared strings/公式；断言在资源上限内失败且不执行公式。
- `TC-A10-03` — 5,000-row benchmark；代码：`spikes/importer/import-benchmark.spec.mjs`。任意开发/CI 主机重复解析并校验 GO/NO-GO 计算；发布容量门禁使用 `spikes/importer/reports/A10.json` 中固定环境的耗时/RSS 证据，避免把共享 CI runner 当作可比基准环境。

### A11

- `TC-A11-01` — CJK/50-page render；代码：`spikes/pdf/cjk-pagination.spec.ts`。打印中英混排 50 页；断言 parser 可开、中文可提取、页数和页眉页脚存在。
- `TC-A11-02` — Exact TOC/resource failure；代码：`spikes/pdf/toc-and-resource.spec.ts`。逐条比较目录与最终锚点页并延迟字体/地图；断言错页或超时导致测试失败且无成功产物。
- `TC-A11-03` — Per-page visual regression；代码：`spikes/pdf/pdf-visual.e2e.spec.ts`。逐页转 PNG；断言无空白、裁切、失图，地图资产与 attribution 可见。

### A12

- `TC-A12-01` — Fixture schema/invariants；代码：`packages/test-fixtures/test/minimal-five-day.spec.ts`。断言日期连续、坐标合法、引用完整、资产存在。
- `TC-A12-02` — Offline/hash stability；代码：`packages/test-fixtures/test/offline-assets.spec.ts`。阻断公网并重复生成；断言无外链且 golden hash 稳定。
- `TC-A12-03` — Cross-spike consumption；代码：`tests/fixtures/spike-consumers.spec.ts`。依次运行 Provider/Map/Importer/PDF loader；断言四者读取同一 fixture version。

---

## M1 Task Cases

### A05

- `TC-A05-01` — Login/session contract；代码：`apps/api/test/identity/session.e2e-spec.ts`。开发身份和 mock OIDC 登录/登出；断言 HttpOnly/Secure/SameSite、state/nonce 和过期行为。
- `TC-A05-02` — Owner/BOLA and environment boundary；代码：`tests/security/owner-access.e2e.spec.ts`、`apps/api/test/identity/environment-guard.spec.ts`。User B 猜测 User A 的各资源 ID，并分别以 development/staging/production 配置启动开发身份；断言跨 owner 返回 404/403 且无存在性泄露，开发身份在非 development 环境 fail closed。
- `TC-A05-03` — Dev gate/Staging IdP handoff；代码：`tests/identity/dev-auth-gate.e2e.spec.ts`。运行开发身份和 mock OIDC 完整流程并模拟新旧签名 key 轮换，断言 Principal/Session/owner 语义一致且 Secret 不进日志；随后尝试真实 Staging IdP smoke。环境可用时运行 `tests/identity/oidc-release.e2e.spec.ts` 验证真实回调，环境或配置不可用时断言保存可行动原因且发布 checklist 包含全部强制项。Dev Case 全绿且 handoff 完整即可通过当前 A05，但未完成的 Staging IdP 项继续阻断正式发布。

### A06

- `TC-A06-01` — Outbox/inbox once-only effect；代码：`apps/worker/test/outbox-inbox.integration.spec.ts`。重复投递同 event ID；断言消费者副作用一次。
- `TC-A06-02` — Crash/Redis loss reconciliation；代码：`apps/worker/test/job-reconciliation.integration.spec.ts`。commit 后 publish 前杀进程、再清 Redis；断言 DB 扫描恢复且同 aggregate 多 event 不被吞。
- `TC-A06-03` — HTTP idempotency integration；代码：`apps/api/test/idempotency.e2e-spec.ts`。同 key 同 body 重放、同 key 异 body；断言前者返回原响应，后者冲突。

### A07

- `TC-A07-01` — Trace propagation；代码：`packages/observability/test/trace-propagation.spec.ts`。Web request 进入 API/outbox/Worker；断言 trace/request/job 关联。
- `TC-A07-02` — PII/high-cardinality guard；代码：`packages/observability/test/redaction.spec.ts`。注入地址、电话、Key、签名 URL；断言日志/trace 无原文且 ID 不作为 metrics label。
- `TC-A07-03` — Telemetry degradation；代码：`tests/observability/sink-failure.e2e.spec.ts`。关闭 collector；断言业务仍成功并有本地可诊断错误。

### B01

- `TC-B01-01` — Enum completeness；代码：`packages/config/test/reference-data.spec.ts`。断言全部币种、费用类别和交通方式 code/视觉字段存在。
- `TC-B01-02` — Seed/id alias constraints；代码：`packages/database/test/reference-seed.integration.spec.ts`。重复 seed、输入 RMB、尝试删除系统 Mode；断言幂等、持久化 CNY、系统项受保护。
- `TC-B01-03` — Reference API round-trip；代码：`apps/api/test/system/reference-data.e2e-spec.ts`。查询并由生成客户端解析；断言配置/DB/API 一致。

### B02

- `TC-B02-01` — Trip/Destination CRUD；代码：`apps/api/test/trips/trip-crud.e2e-spec.ts`。创建、读、改、筛选、软删恢复；断言所有字段持久化。
- `TC-B02-02` — Version/owner/constraint；代码：`apps/api/test/trips/trip-invariants.e2e-spec.ts`。旧 If-Match、跨 owner、非法 profile/date/order；断言 409/权限/DB 约束。
- `TC-B02-03` — Restart persistence；代码：`tests/trips/trip-persistence.e2e.spec.ts`。创建后重启 API/DB client；断言列表与详情一致且 audit 存在。

### B03

- `TC-B03-01` — Date property suite；代码：`packages/domain/test/date-range.property.spec.ts`。生成同日、跨月/年、闰日范围；断言 Day 1…N 连续且 TotalDays 正确。
- `TC-B03-02` — Shrink-with-content guard；代码：`apps/api/test/trips/date-change.integration.spec.ts`。被移除 Day 含 Item；断言 preview 列全影响，未确认 apply 失败且无数据丢失。
- `TC-B03-03` — Atomic create/apply；代码：`apps/api/test/trips/day-generation.e2e-spec.ts`。在 Day 批量插入中注入错误并重试；断言无半成品且幂等。

### B04

- `TC-B04-01` — Wizard/list component；代码：`apps/web/features/trips/trip-wizard.spec.tsx`。填写四步数据并返回修改；断言摘要、校验和提交 payload。
- `TC-B04-02` — Double-submit/error/delete；代码：`apps/web/e2e/trips-failure.spec.ts`。双击、网络失败、删除恢复；断言单 Trip、错误可重试、删除二次确认。
- `TC-B04-03` — Create/reload E2E；代码：`apps/web/e2e/trips-create.spec.ts`。从空账号创建五日两目的地旅行；断言进入 Day 1，刷新/重新登录存在。

### C01

- `TC-C01-01` — Provider interface contract；代码：`packages/providers/test/contract/provider-contract.spec.ts`。fixture adapter 实现五类接口；断言仅输出 WGS84 领域 DTO。
- `TC-C01-02` — Unsupported/error mapping；代码：`packages/providers/test/contract/provider-errors.spec.ts`。关闭各 capability、返回未知错误/缺 attribution；断言显式能力错误。
- `TC-C01-03` — Offline fixture provider；代码：`tests/providers/fixture-provider.e2e.spec.ts`。阻断网络完成 search/reverse/directions/static map；断言结果稳定。

### C03

- `TC-C03-01` — Location state machine；代码：`packages/domain/test/location-state-machine.spec.ts`。遍历合法/非法迁移；断言客户端不能任意设置状态。
- `TC-C03-02` — DB/signature/staging invariants；代码：`packages/database/test/location.integration.spec.ts`。非法坐标、resolved 无 geom、篡改/过期 token、staged row；断言 DB 拒绝且正式 Location 不增加。
- `TC-C03-03` — State replay/version CAS；代码：`apps/api/test/locations/location-state.e2e-spec.ts`。resolved/ambiguous/failed 重载并并发更新；断言状态/候选/version 稳定。

### D01

- `TC-D01-01` — Presigned append-only upload；代码：`packages/storage/test/presigned-upload.integration.spec.ts`。创建会话并上传；断言随机 key、限定大小/type、返回 objectVersion。
- `TC-D01-02` — Overwrite/expiry/owner；代码：`packages/storage/test/upload-security.integration.spec.ts`。重复 put、过期 URL、跨 owner complete；断言拒绝且原对象不变。
- `TC-D01-03` — MinIO round-trip；代码：`apps/api/test/attachments/upload.e2e-spec.ts`。浏览器式直传后 complete/reload；断言 DB 元数据与实际对象 version/checksum 对应。

### G08 — Deprecated

G08 在实现前从 M1/M6 移出。`TC-G08-01`、`TC-G08-02`、`TC-G08-03` 已退役且编号保留，不创建原计划中的 `tests/beta/*`，也不参与 Milestone Gate。原测试意图和替代发布证据见 [`deprecated/G08-beta-cohort.md`](./deprecated/G08-beta-cohort.md)。

---

## M2 Task Cases

### B05

- `TC-B05-01` — Full-field persistence；代码：`apps/api/test/itinerary/item-crud.e2e-spec.ts`。写入各 item type、时间、食宿、交通、预订/联系/备注；断言完整 round-trip。
- `TC-B05-02` — Time/ownership/delete invariants；代码：`apps/api/test/itinerary/item-invariants.integration.spec.ts`。非法时间、跨 Trip 引用、软删后更新；断言拒绝且历史关联不被物理销毁。
- `TC-B05-03` — Copy/reload lifecycle；代码：`tests/itinerary/item-lifecycle.e2e.spec.ts`。新增、复制到 Day、修改、软删、重启；断言 ID/版本/可见性正确。

### B06

- `TC-B06-01` — Editor field groups；代码：`apps/web/features/itinerary/item-editor.spec.tsx`。桌面/手机填写核心字段；断言 schema 与 API payload。
- `TC-B06-02` — Empty/error/conflict accessibility；代码：`apps/web/features/itinerary/editor-states.spec.tsx`。注入空 Day、字段错误、409、慢请求；断言可恢复状态、错误关联和键盘可用。
- `TC-B06-03` — Daily edit E2E；代码：`apps/web/e2e/itinerary-edit.spec.ts`。一天新增多类 Item 并刷新；断言时间线/详情与 DB 一致，手机核心路径可用。

### B07

- `TC-B07-01` — Ordered-set property；代码：`packages/domain/test/itinerary-order.property.spec.ts`。生成合法/漏/多/重复/跨 Day ID；断言只接受完整同 Day 集合。
- `TC-B07-02` — Concurrent reorder barrier；代码：`apps/api/test/itinerary/reorder-race.integration.spec.ts`。两客户端同 baseVersion；断言一个成功、一个 409、无部分顺序。
- `TC-B07-03` — Mouse/touch/keyboard reorder；代码：`apps/web/e2e/itinerary-reorder.spec.ts`。三种输入重排并模拟保存失败；断言持久顺序和失败回滚。

### B08

- `TC-B08-01` — Debounced autosave；代码：`apps/web/features/itinerary/use-autosave.spec.tsx`。fake clock 连续编辑；断言合并请求且 saved 只在服务端成功后出现。
- `TC-B08-02` — Out-of-order/offline；代码：`apps/web/features/itinerary/autosave-race.spec.tsx`。B 响应先于 A、断网/409；断言旧响应不覆盖新值，输入和 retry 保留。
- `TC-B08-03` — Leave/re-enter E2E；代码：`apps/web/e2e/autosave-leave.spec.ts`。未保存离开、保存后刷新；断言提示正确且最终值一致。

### B09

- `TC-B09-01` — Custom Mode CRUD；代码：`apps/api/test/itinerary/transport-mode.e2e-spec.ts`。创建/编辑/停用 trip-scoped Mode；断言视觉字段和 owner。
- `TC-B09-02` — System/referenced protection；代码：`apps/api/test/itinerary/transport-mode-invariants.spec.ts`。删除系统/跨 Trip/已引用 Mode；断言拒绝或按停用规则处理。
- `TC-B09-03` — Settings-to-item integration；代码：`apps/web/e2e/custom-transport-mode.spec.ts`。设置中新增后立即选择到 Item；断言刷新后标签/图标/颜色一致。

### C02

- `TC-C02-01` — Geocoder adapter contract；代码：`packages/providers/test/geocoding/adapter-contract.spec.ts`。中文/英文/context 搜索与反查；断言 normalized candidate/capability/attribution。
- `TC-C02-02` — Rate/cache/policy faults；代码：`packages/providers/test/geocoding/rate-cache.spec.ts`。fake clock 429/Retry-After、5xx、相同 query 不同 context；断言限流、退避、cache 隔离，不对 Nominatim autocomplete。
- `TC-C02-03` — API + controlled smoke；代码：`apps/api/test/locations/search.e2e-spec.ts`。fixture adapter 全跑、配置时少量 staging smoke；断言不静默切 Provider且日志脱敏。

### C04

- `TC-C04-01` — Debounced candidate UX；代码：`apps/web/features/locations/location-input.spec.tsx`。输入中文/英文并推进 fake clock；断言 capability-aware 请求、地理上下文展示。
- `TC-C04-02` — Ambiguous/out-of-order/failure；代码：`apps/web/features/locations/location-input-failure.spec.tsx`。两个相近候选、请求乱序、无结果；断言不预选且五种恢复动作可达。
- `TC-C04-03` — Select-or-text E2E；代码：`apps/web/e2e/location-search.spec.ts`。选择候选与纯文字保存各一次；断言 Location 状态和持久数据正确。

### C05

- `TC-C05-01` — Marker/fit selector；代码：`apps/web/features/map/map-model.spec.ts`。0/1/多/同点坐标；断言 GeoJSON、bounds 和 Day+序号 marker。
- `TC-C05-02` — Tile/WebGL/fullscreen failure；代码：`apps/web/e2e/map-degraded.spec.ts`。阻断 tile、模拟 WebGL error/resize/Escape；断言文字编辑不受阻且中性/空态正确。
- `TC-C05-03` — All/day/destination map E2E；代码：`apps/web/e2e/map-markers.spec.ts`。切换筛选；断言 Marker、图例、attribution 和 bounds 与 fixture 一致。

### C06

- `TC-C06-01` — Pick/reverse/manual coordinate；代码：`apps/api/test/locations/coordinate-adjust.e2e-spec.ts`。地图点选、反查失败、手工边界坐标；断言仍可保存 WGS84 resolved。
- `TC-C06-02` — Late geocode CAS barrier；代码：`apps/api/test/locations/manual-vs-geocode-race.integration.spec.ts`。先发 geocode、再拖 Marker、最后释放响应；断言旧写影响 0 行。
- `TC-C06-03` — Drag persistence E2E；代码：`apps/web/e2e/location-map-adjust.spec.ts`。桌面/触控拖动并刷新；断言 `manuallyAdjusted=true`、坐标和审计存在。

### D02

- `TC-D02-01` — Safe image pipeline；代码：`apps/worker/test/media/image-pipeline.integration.spec.ts`。benign 图片从 uploaded→processing→ready；断言尺寸、thumb、checksum/version。
- `TC-D02-02` — Malware/MIME/bomb/fail-closed；代码：`apps/worker/test/media/media-security.integration.spec.ts`。EICAR、错误 MIME、解码炸弹、scanner down；断言 failed 且 quarantine 不可读。
- `TC-D02-03` — Retry/orphan reconciliation；代码：`tests/media/media-recovery.e2e.spec.ts`。ACK 前杀 Worker、制造孤儿衍生物；断言幂等 ready 和精确清理。

### D04

- `TC-D04-01` — Decimal/rate calculation；代码：`packages/domain/test/expense-calculation.property.spec.ts`。0、高精度、多小数位和汇率；断言定点舍入规则。
- `TC-D04-02` — Missing rate/ownership；代码：`apps/api/test/expenses/expense-invariants.e2e-spec.ts`。缺汇率、负数、未知币种、跨 Trip 关联；断言未折算分组或拒绝。
- `TC-D04-03` — Expense API summary seed；代码：`apps/api/test/expenses/expense-summary.integration.spec.ts`。保存 CNY/USD 并更新汇率；断言原币保留、快照可解释且 Route cost 不重复统计。

### E01

- `TC-E01-01` — Template columns/aliases；代码：`packages/importer/test/template-schema.spec.ts`。断言全部标准列和中英别名存在且版本固定。
- `TC-E01-02` — Formula/RMB/duration aliases；代码：`packages/importer/test/template-input-safety.spec.ts`。输入 `=+-@` 文本、RMB、Dur；断言防公式注入并规范到 CNY/Duration。
- `TC-E01-03` — Template self-import；代码：`apps/api/test/imports/template-roundtrip.e2e-spec.ts`。下载、打开、inspect；断言 Excel 可读且映射到自身字段。

### E02

- `TC-E02-01` — Workbook inspection；代码：`apps/worker/test/import/workbook-inspect.integration.spec.ts`。xlsx/xls/csv、多 sheet、BOM；断言 sheet/columns/samples 正确。
- `TC-E02-02` — Malicious/limit matrix；代码：`apps/worker/test/import/workbook-security.integration.spec.ts`。空/加密/ZIP bomb/损坏/超限/公式；断言明确错误、资源受限且不重试永久错误。
- `TC-E02-03` — Upload-to-inspect E2E；代码：`apps/web/e2e/import-upload-inspect.spec.ts`。真实上传三格式；断言 Job 阶段、错误和列预览可刷新恢复。

---

## M3 Task Cases

### C07

- `TC-C07-01` — Segment generation matrix；代码：`packages/domain/test/routing/segment-generation.spec.ts`。覆盖日内、跨日、transport Start→End、effective endpoint、缺 Mode→OTHER；断言 kind、端点和到达日。
- `TC-C07-02` — Generation/sourceVersion race；代码：`apps/worker/test/directions/route-generation-race.integration.spec.ts`。barrier 让旧 rebuild/route 晚到并并发锁 Day/Segment；断言旧结果 obsolete、无 active 重复和死锁。
- `TC-C07-03` — Change-to-rebuild E2E；代码：`tests/routing/route-rebuild.e2e.spec.ts`。重排、改坐标/Mode、删除 Item、Redis 重投；断言先同步 obsolete 再生成当前段。

### C08

- `TC-C08-01` — Route style contract；代码：`apps/web/features/map/route-style.spec.ts`。输入系统/自定义 Mode 与质量；断言 color/line/icon/text。
- `TC-C08-02` — Invalid/failed/approximate geometry；代码：`apps/web/features/map/route-layer-failure.spec.tsx`。未知 Mode、failed/obsolete、飞机跨海；断言不崩溃并显示质量/降级说明。
- `TC-C08-03` — Route visual/detail E2E；代码：`apps/web/e2e/routes-visual.spec.ts`。点击各类段；断言线型截图及起终点、时间、耗时、费用、备注详情。

### C09

- `TC-C09-01` — Shared selection store；代码：`apps/web/features/map/map-timeline-selection.spec.ts`。选择 Item/Marker/Segment；断言单一选中 ID 和 focus 指令。
- `TC-C09-02` — Missing/filtered/not-ready；代码：`apps/web/features/map/map-timeline-edge.spec.tsx`。无坐标、被筛选、地图未 ready、快速点击；断言无错误定位和陈旧选择。
- `TC-C09-03` — Bidirectional focus E2E；代码：`apps/web/e2e/map-timeline-link.spec.ts`。卡片→Marker、Marker→虚拟列表、全屏→返回；断言滚动、高亮、URL 恢复和键盘 focus。

### D03

- `TC-D03-01` — Upload/gallery component；代码：`apps/web/features/attachments/gallery.spec.tsx`。模拟进度和五种状态；断言比例预览、说明/排序/封面控件。
- `TC-D03-02` — Interrupted/delete/order conflict；代码：`apps/web/features/attachments/gallery-failure.spec.tsx`。上传中断、complete 丢响应、409 排序、删除中引用；断言重试/回滚/确认。
- `TC-D03-03` — Real gallery E2E；代码：`apps/web/e2e/attachments-gallery.spec.ts`。MinIO 多图上传、排序、说明、灯箱、日封面、刷新；断言 DB/object/UI 一致。

### D05

- `TC-D05-01` — Five-dimension selectors；代码：`apps/web/features/expenses/cost-summary.spec.ts`。按天/目的地/类别/方式/原币种计算；断言各维合计与 Expense 一致。
- `TC-D05-02` — Missing-rate/budget UX；代码：`apps/web/features/expenses/cost-summary-states.spec.tsx`。缺汇率、预算空/超支、0 费用；断言“已知实际/暂定剩余”和未折算组。
- `TC-D05-03` — Cost page E2E；代码：`apps/web/e2e/cost-summary.spec.ts`。编辑 CNY/USD 和汇率后刷新；断言显示原金额/汇率、五类统计和日小计。

### E03

- `TC-E03-01` — Mapping suggestion score；代码：`packages/importer/test/mapping-suggestion.spec.ts`。中英别名与样例值；断言推荐目标和解释。
- `TC-E03-02` — Duplicate/missing/multisheet mapping；代码：`apps/web/features/imports/mapping-errors.spec.tsx`。两源列映同目标、缺必填、多 sheet；断言阻止保存或逐项提示。
- `TC-E03-03` — Editable mapping E2E；代码：`apps/web/e2e/import-mapping.spec.ts`。接受/修改建议并重载；断言 canonical mapping 保存且手机复杂映射提示转桌面。

### E04

- `TC-E04-01` — Normalize/validate golden；代码：`packages/importer/test/normalize-validate.spec.ts`。覆盖日期、时间、金额、币种、Mode、坐标、ImageURLs；断言 normalized row 与逐 field issue。
- `TC-E04-02` — Fingerprint/hash/ledger invariants；代码：`packages/database/test/import-staging.integration.spec.ts`。mapping 顺序变化、sourceRowKey 重复、跨 Job ledger 查询；断言 canonical hash 稳定且唯一约束生效。
- `TC-E04-03` — Workbook-to-staging E2E；代码：`apps/worker/test/import/staging.e2e-spec.ts`。处理混合文件；断言计数/分页/原始值/规范值可重放且正式 Item 数不变。

### E05

- `TC-E05-01` — Preview count invariant；代码：`apps/web/features/imports/preview-model.spec.ts`。输入各状态；断言总数等于 new/update/duplicate/error/unresolved/skipped 的约定分区。
- `TC-E05-02` — Pagination/status-change/skip confirmation；代码：`apps/web/features/imports/preview-states.spec.tsx`。轮询改变状态、超长值、跳过错误；断言列表不重复且明确确认数量。
- `TC-E05-03` — 5,000-row preview E2E；代码：`apps/web/e2e/import-preview.spec.ts`。筛选/分页/虚拟滚动；断言交互可用、不渲染全部 DOM且页面不声称已导入。

---

## M4 Task Cases

### E06

- `TC-E06-01` — Batch scheduling/progress；代码：`apps/worker/test/geocoding/batch-scheduling.integration.spec.ts`。为缺坐标行建 Job；断言 cache hit、总/完成单位和 Provider 分桶。
- `TC-E06-02` — 429/partial failure/cancel；代码：`apps/worker/test/geocoding/batch-failure.integration.spec.ts`。fake clock 注入 Retry-After、5xx、永久失败、取消/Redis 清空；断言单行失败隔离和可调和。
- `TC-E06-03` — Staging geocode E2E；代码：`apps/web/e2e/import-batch-geocode.spec.ts`。启动批量解析并刷新；断言 resolving/ambiguous/failed/ready 真实且无正式 Location。

### E07

- `TC-E07-01` — Staged location decisions；代码：`apps/api/test/imports/staged-location.integration.spec.ts`。候选、地图点、手工坐标、纯文字决策；断言只更新 staged JSON/actor/time。
- `TC-E07-02` — Candidate expiry/conflict/large queue；代码：`apps/web/features/imports/unresolved-errors.spec.tsx`。过期 token、并发行跳过、反查失败、大量未确认；断言可恢复且计数一致。
- `TC-E07-03` — Unresolved map E2E；代码：`apps/web/e2e/import-unresolved-locations.spec.ts`。逐项处理三类地点；断言正式 Location 数仍不变并可进入 ready_to_import。

### E08

- `TC-E08-01` — Exact replay/fingerprint claim；代码：`apps/worker/test/import/commit-idempotency.integration.spec.ts`。同文件换 key/Job、清 staging 后重传、不同源同 fingerprint；断言一个 insert，其余 ledger skip。
- `TC-E08-02` — Insert/update race + cancel/resume；代码：`apps/worker/test/import/commit-race.integration.spec.ts`。barrier 执行 insert↔insert、update↔insert，chunk 后取消再 resume；断言 owner-aware claim、committedRows、文字不重写。
- `TC-E08-03` — Confirm-to-route E2E；代码：`apps/web/e2e/import-confirm.spec.ts`。确认混合 new/update/duplicate/error；断言正式 Item/Location/Expense、ledger/claim 和 route generation 可对账。

### E09

- `TC-E09-01` — Approval-to-ready media task；代码：`apps/worker/test/media/import-media-task.integration.spec.ts`。未批准、批准、拒绝多个 URL；断言未批准不请求，批准后逐阶段并关联 Attachment。
- `TC-E09-02` — SSRF/lease/retry/reconcile；代码：`apps/worker/test/media/import-media-security.integration.spec.ts`。私网/metadata/重定向/DNS rebinding、lease ABA、Redis 清空、retry generation；断言阻断、旧 Worker fenced、计数单调。
- `TC-E09-03` — Parent aggregation/resume E2E；代码：`apps/web/e2e/import-media-lifecycle.spec.ts`。部分 ready/failed、取消续跑、staging 清理；断言父 Job 在收敛前 processing_media，失败为 warning，ledger Item 重新绑定。

### F01

- `TC-F01-01` — Canonical snapshot/hash；代码：`packages/application/test/export/snapshot.spec.ts`。相同事实不同对象 key 顺序与任一子实体变更；断言前者同 hash、后者变 hash。
- `TC-F01-02` — Media preflight matrix/race；代码：`apps/api/test/exports/export-preflight.integration.spec.ts`。枚举所有 Attachment/MediaTask 状态并并发删除/更新；断言 require_all 409、ready_only 固定全量遗漏。
- `TC-F01-03` — Atomic ExportJob API；代码：`apps/api/test/exports/export-job.e2e-spec.ts`。重复请求、创建时编辑 Trip；断言 queued 必有 snapshot，Idempotency/reuse key 正确且后续编辑不改变 Job。

### F02

- `TC-F02-01` — Static map manifest；代码：`apps/pdf-worker/test/maps/static-map.spec.ts`。渲染全局/每日；断言尺寸/checksum/bounds 和 Marker/Route/Legend/Attribution manifest。
- `TC-F02-02` — Tile/WebGL/blank fallback；代码：`apps/pdf-worker/test/maps/static-map-degraded.spec.ts`。阻断 host、空/单点/世界跨度、空白 renderer；断言中性网格或明确失败且禁止未配置 host。
- `TC-F02-03` — Print map visual E2E；代码：`tests/pdf/static-map.visual.spec.ts`。使用 full-five-day 生成 2x 图；断言路线样式、范围、降级说明和视觉 golden。

### F03

- `TC-F03-01` — Print chapter switches；代码：`apps/web/features/exports/print/chapters.spec.tsx`。对模块开关组合渲染 snapshot；断言封面/概览/地图/每日/汇总/备注结构。
- `TC-F03-02` — Long/empty/missing-resource layout；代码：`apps/web/features/exports/print/edge-content.spec.tsx`。超长文本、空章节、缺汇率/图、ready-only；断言不读实时 API且遗漏清单存在。
- `TC-F03-03` — Preview/worker same-template；代码：`tests/pdf/print-template-contract.e2e.spec.ts`。同 snapshot 比较预览 DOM manifest 与 Worker print manifest；断言章节/资源一致。

### F05

- `TC-F05-01` — Worker stage/CAS contract；代码：`apps/pdf-worker/test/export-stage-machine.integration.spec.ts`。queued→各阶段→completed 候选；断言非法/重复 transition 失败。
- `TC-F05-02` — Sandbox/token/cancel faults；代码：`apps/pdf-worker/test/pdf-worker-security.integration.spec.ts`。token 重放/过期、外部 host、资源超时、各阶段取消、Chromium crash；断言无假完成/假下载。
- `TC-F05-03` — Resource-ready render E2E；代码：`apps/pdf-worker/test/pdf-render.e2e-spec.ts`。延迟字体/图/图片后释放；断言等待 ready barrier、生成临时 PDF并最终清理资源。

---

## M5 Task Cases

### F04

- `TC-F04-01` — CJK/page-break visual；代码：`tests/pdf/cjk-page-break.visual.spec.ts`。中英长文本、表格、超高图、横纵；断言无缺字/裁切/错误 break。
- `TC-F04-02` — Exact TOC two-pass；代码：`apps/pdf-worker/test/pagination/exact-toc.spec.ts`。生成草稿、提取锚点、回填再渲染；断言每条目录数字等于最终物理页且结果稳定。
- `TC-F04-03` — 50/100-page regression；代码：`tests/pdf/long-document.e2e.spec.ts`。逐页解析/转 PNG；断言页眉页脚/页码、空白检测、图片比例和目录全通过。

### F06

- `TC-F06-01` — Independent PDF validation；代码：`apps/pdf-worker/test/validation/pdf-validator.spec.ts`。有效/截断/0 页/缺关键中文/缺地图 manifest；断言只有完整产物通过。
- `TC-F06-02` — Upload-cancel/expiry/orphan；代码：`apps/pdf-worker/test/export-artifact-race.integration.spec.ts`。barrier 在上传/complete CAS 取消，模拟过期和版本不符；断言无孤儿可下载、410 不改 completed 历史。
- `TC-F06-03` — Real download/reuse E2E；代码：`apps/web/e2e/pdf-download.spec.ts`。下载命名文件并独立解析，再以相同/不同 hash 重导；断言安全签名、复用键和 checksum。

### F07

- `TC-F07-01` — Export options/readiness UI；代码：`apps/web/features/exports/export-options.spec.tsx`。切换 A4/方向/模块和媒体策略；断言请求及 ready/processing/failed 计数。
- `TC-F07-02` — SSE/retry/cancel/expired states；代码：`apps/web/features/exports/export-job-states.spec.tsx`。断开 SSE、不可重试错误、取消竞争、410；断言 fallback 和真实状态。
- `TC-F07-03` — Preview-to-download E2E；代码：`apps/web/e2e/export-flow.spec.ts`。桌面完整预览与手机默认导出；断言只有 completed 出现真实下载且刷新恢复。

### G01

- `TC-G01-01` — Full seed invariants；代码：`packages/test-fixtures/test/full-five-day.spec.ts`。断言 25+ Item、三餐/住宿/活动、指定 Mode、CNY/USD、每日图片、ambiguous/manual-adjusted、跨日段。
- `TC-G01-02` — Seed rerun/asset integrity；代码：`packages/database/test/demo-seed.integration.spec.ts`。重复 seed、阻断公网、校验资产 hash/许可；断言无重复且全离线。
- `TC-G01-03` — Excel/map/PDF golden coherence；代码：`tests/fixtures/full-fixture-roundtrip.e2e.spec.ts`。用同 seed 导出标准/错误/重复 Excel、地图和 PDF snapshot；断言引用/预期状态一致。

---

## M6 Task Cases

### G02

- `TC-G02-01` — Core-loop desktop；代码：`apps/web/e2e/core-loop/desktop.spec.ts`。空账号创建→编辑→地点→地图→图片→费用→Excel→PDF；断言 26 项验收的桌面主路径。
- `TC-G02-02` — Mobile/keyboard/recovery；代码：`apps/web/e2e/core-loop/mobile-accessible.spec.ts`。移动 viewport、触控/键盘、刷新/断网；断言 DESIGN §4.11 核心操作可完成。
- `TC-G02-03` — No-op/persistence evidence；代码：`apps/web/e2e/core-loop/button-inventory.spec.ts`。点击主要按钮并重进/重启；断言均有真实副作用或导航，Import/PDF 用 DB/parser 验证。

### G03

- `TC-G03-01` — PDF text/asset manifest suite；代码：`tests/pdf/pdf-content.spec.ts`。断言旅行名、Day 1、中文地点、费用、Marker/Route/Legend/Attribution。
- `TC-G03-02` — Per-page visual difference；代码：`tests/pdf/pdf-pages.visual.spec.ts`。固定镜像/时钟逐页 diff；断言无关键区域变化，差异定位到页。
- `TC-G03-03` — Golden governance；代码：`tests/pdf/golden-integrity.spec.ts`。检测未解释的 golden 更新、字体/Chromium version 漂移；断言需显式 metadata/审批记录。

### G04

- `TC-G04-01` — Auth/CSRF/secret matrix；代码：`tests/security/web-api-security.e2e.spec.ts`。BOLA、CSRF/Origin、CSP、Secret/PII 日志；断言全部防护。
- `TC-G04-02` — Upload/Excel/SSRF/print attack；代码：`tests/security/file-network-security.e2e.spec.ts`。恶意媒体、ZIP/formula、DNS rebinding、print token/allowlist；断言攻击不能越过边界。
- `TC-G04-03` — Security gate report；代码：`tests/security/security-gate.spec.ts`。读取扫描/测试结果；断言 Critical/High 为零，Medium 有 owner/缓解/日期。

### G05

- `TC-G05-01` — Fixed capacity benchmark；代码：`tests/performance/release-capacity.spec.ts`。运行 API、5,000 行 parse、300 行 commit、100 页 PDF、300 Marker；断言 DESIGN §17.4 阈值。
- `TC-G05-02` — Queue/resource recovery；代码：`tests/performance/queue-recovery.spec.ts`。并发 Import/PDF/media，清 Redis、杀 Worker、S3/DB 短故障；断言 backlog/RSS 受控和可调和。
- `TC-G05-03` — Versioned report reproducibility；代码：`tests/performance/capacity-report.spec.ts`。校验环境/镜像/fixture/原始结果；断言报告可复跑且不把短期数据当月 SLO。

### G06

- `TC-G06-01` — Dashboard query correctness；代码：`tests/operations/dashboard.spec.ts`。注入 API/Provider/Import/PDF/Storage 指标；断言 panel query 与单位/label 正确。
- `TC-G06-02` — Alert/runbook fault drill；代码：`tests/operations/alerts.e2e.spec.ts`。触发 5xx、queue age、Job failure、429、upload/outbox；断言路由和 Runbook 可执行且不重启风暴。
- `TC-G06-03` — Daily synthetic loop；代码：`tests/operations/synthetic-trip-export.e2e.spec.ts`。用离线 fixture 创建/导出；断言 trace 可定位且不访问公共 Nominatim。

### G07

- `TC-G07-01` — Documentation command/link check；代码：`tests/docs/documentation.spec.ts`。抽取 README/配置/测试命令和链接；断言存在且无真实 Secret。
- `TC-G07-02` — No-key/multi-arch troubleshooting；代码：`tests/docs/configuration-scenarios.spec.ts`。按文档模拟无 Key、不同 CPU、Provider/PDF 常见故障；断言有可执行降级/排错。
- `TC-G07-03` — Clean-machine rehearsal；代码：`tests/docs/clean-machine.e2e.spec.ts`。未参与项目的环境按文档启动 full fixture 闭环；断言无需隐含步骤。

---

## Milestone Integration Cases

### M0

- `TC-M0-INT-01` — Shared fixture offline pipeline；代码：`tests/milestones/m0/offline-spikes.e2e.spec.mjs`。阻断公网，用同一 minimal fixture 运行 Provider、Map、Importer、PDF Spike；断言版本一致、四类产物完整。
- `TC-M0-INT-02` — Spike Go/No-Go gate；代码：`tests/milestones/m0/spike-gate.spec.mjs`。读取测量和 ADR；断言每项都有阈值、结论、Plan B，任一未知结论使 gate 失败。

### M1

- `TC-M1-INT-01` — Owned atomic Trip bootstrap；代码：`tests/milestones/m1/trip-platform.e2e.spec.ts`。登录后创建五日 Trip，另一用户访问，重启后读取；断言 Day 原子生成、owner 隔离、持久化。
- `TC-M1-INT-02` — Outbox/storage/trace recovery；代码：`tests/milestones/m1/platform-recovery.e2e.spec.ts`。在 publish 前杀 API、清 Redis并上传对象；断言 Job 恢复一次、对象 append-only、trace 串联。

### M2

- `TC-M2-INT-01` — Daily edit/reorder persistence；代码：`tests/milestones/m2/daily-edit.e2e.spec.ts`。编辑完整一天、三种方式重排、刷新；断言字段和顺序一致。
- `TC-M2-INT-02` — Location confirmation race；代码：`tests/milestones/m2/location-confirmation.e2e.spec.ts`。搜索同名候选、点选/拖动并释放晚到 geocode；断言不静默选中且人工坐标获胜。
- `TC-M2-INT-03` — Safe media/import entry；代码：`tests/milestones/m2/media-import-entry.e2e.spec.ts`。上传 benign/EICAR 并下载/inspect 三格式；断言安全状态和真实 Job，正式 Item 未被导入。

### M3

- `TC-M3-INT-01` — Route/gallery/cost workspace；代码：`tests/milestones/m3/workspace-loop.e2e.spec.ts`。重排 A→B→C、改 Mode/坐标、上传图库、录费用；断言路线当前、联动、图片和统计一致。
- `TC-M3-INT-02` — Import staging isolation；代码：`tests/milestones/m3/import-staging.e2e.spec.ts`。映射/校验混合文件并查看 5,000 行预览；断言计数准确、正式 Item/Location 数不变。

### M4

- `TC-M4-INT-01` — Geocode-confirm-commit-route；代码：`tests/milestones/m4/import-commit.e2e.spec.ts`。批量解析、人工确认、commit、重复 commit；断言正式事实、ledger/claim 和路线可对账且不重复。
- `TC-M4-INT-02` — Import concurrency/media recovery；代码：`tests/milestones/m4/import-media-race.e2e.spec.ts`。并发 Job、SSRF、lease expiry、Redis 清空、取消续跑；断言无重复/越界请求/旧 lease 写回，父状态正确。
- `TC-M4-INT-03` — Frozen snapshot PDF rehearsal；代码：`tests/milestones/m4/export-rehearsal.e2e.spec.ts`。创建 Job 后编辑 Trip，打印地图/章节并在各阶段取消；断言使用旧快照、无假下载。

### M5

- `TC-M5-INT-01` — Full PDF option matrix；代码：`tests/milestones/m5/pdf-options.e2e.spec.ts`。五日 fixture 生成横/纵及模块组合；断言文本、地图、图片、费用、目录和命名。
- `TC-M5-INT-02` — Media/cancel/expiry integrity；代码：`tests/milestones/m5/pdf-integrity.e2e.spec.ts`。测试 require_all/ready_only、各阶段取消和 410；断言遗漏清单、无孤儿下载和可重建。
- `TC-M5-INT-03` — Mobile default export；代码：`tests/milestones/m5/mobile-export.e2e.spec.ts`。手机端创建默认导出、刷新任务、下载；断言真实 PDF 可独立打开。

### M6

- `TC-M6-INT-01` — Release acceptance matrix；代码：`tests/milestones/m6/release-matrix.e2e.spec.ts`。聚合 AC01–26、QG-01–10 和全有效 Task `03` 结果；断言无缺项/跳过关键 Case，Deprecated Case 不进入分母。
- `TC-M6-INT-02` — Recovery/rolling compatibility；代码：`tests/milestones/m6/recovery-compatibility.e2e.spec.ts`。演练 Redis/S3/DB/Worker 故障、备份恢复及新旧 API/Worker/schemaVersion 共存；断言幂等恢复、未知消息隔离、旧应用可回滚。
- `TC-M6-INT-03` — **Deprecated**：原 Plan B and gray sample gate 随 G08 退役；编号保留，不创建 `tests/milestones/m6/gray-plan-b.spec.ts`，不参与 M6 Gate。Plan B 演练由对应 Task Case、`TC-M6-INT-02` 和 Runbook 证据覆盖。

---

## 系统级高风险 TDD 追踪

下表将 `DEVELOPMENT_MILESTONE.md` 的 R01–R44 绑定到实际 Case 代码。一个有效风险映射多个 Case 时，所有 Case 都必须通过；Plan B 的实际演练由对应 Task Case、`TC-M6-INT-02` 和 Runbook 归档。R44 为 Deprecated 历史编号，不参与发布判定。

| Risk | 主 Case | 补充 Case |
|---|---|---|
| R01 | TC-B03-03 | TC-M1-INT-01 |
| R02 | TC-B03-02 | TC-M2-INT-01 |
| R03 | TC-B08-02 | TC-B08-03 |
| R04 | TC-B07-02 | TC-B07-03 |
| R05 | TC-A05-02 | TC-G04-01 |
| R06 | TC-C04-02 | TC-M2-INT-02 |
| R07 | TC-C06-02 | TC-M2-INT-02 |
| R08 | TC-A08-01 | TC-A08-03 |
| R09 | TC-C02-02 | TC-C05-02 |
| R10 | TC-C02-02 | TC-C02-03 |
| R11 | TC-C07-01 | TC-M3-INT-01 |
| R12 | TC-C07-02 | TC-C07-03 |
| R13 | TC-C07-02 | TC-C07-03 |
| R14 | TC-C07-02 | TC-G05-02 |
| R15 | TC-C08-02 | TC-F02-02 |
| R16 | TC-D02-02 | TC-G04-02 |
| R17 | TC-D01-02 | TC-F01-01 |
| R18 | TC-F01-02 | TC-M5-INT-02 |
| R19 | TC-A10-02 | TC-E02-02 |
| R20 | TC-E04-01 | TC-E04-03 |
| R21 | TC-E08-02 | TC-M4-INT-02 |
| R22 | TC-E08-02 | TC-E08-03 |
| R23 | TC-E08-01 | TC-M4-INT-01 |
| R24 | TC-E08-02 | TC-E09-03 |
| R25 | TC-E09-03 | TC-M4-INT-02 |
| R26 | TC-E09-02 | TC-G04-02 |
| R27 | TC-E09-02 | TC-M4-INT-02 |
| R28 | TC-A06-02 | TC-E09-02 |
| R29 | TC-E09-03 | TC-M4-INT-02 |
| R30 | TC-E09-02 | TC-E09-03 |
| R31 | TC-F01-03 | TC-M4-INT-03 |
| R32 | TC-F01-02 | TC-M5-INT-02 |
| R33 | TC-F04-02 | TC-F04-03 |
| R34 | TC-F05-02 | TC-F05-03 |
| R35 | TC-F06-02 | TC-M5-INT-02 |
| R36 | TC-F06-01 | TC-F06-03 |
| R37 | TC-D05-02 | TC-D05-03 |
| R38 | TC-A06-02 | TC-A06-03 |
| R39 | TC-D02-03 | TC-F06-02 |
| R40 | TC-A04-02 | TC-M6-INT-02 |
| R41 | TC-G05-01 | TC-G05-02 |
| R42 | TC-C05-02 | TC-F02-02 |
| R43 | TC-A07-02 | TC-G04-01 |
| R44 | Deprecated | 见 [`deprecated/G08-beta-cohort.md`](./deprecated/G08-beta-cohort.md) |

---

## 测试完成记录格式

每个 Task 在代码仓库中补充 `test-results/<milestone>/<task>.json` 或 CI 等价产物：

```json
{
  "taskId": "C06",
  "cases": {
    "TC-C06-01": "passed",
    "TC-C06-02": "passed",
    "TC-C06-03": "passed"
  },
  "fixtureVersion": "minimal-five-day@1",
  "environment": {
    "commit": "<sha>",
    "node": "24.x",
    "databaseMigration": "<version>"
  },
  "evidence": ["<ci-artifact-or-report>"],
  "knownRisks": []
}
```

规则：

- `skipped` 不等于 `passed`；关键 Case 被跳过时 Task 保持未完成。
- 失败后重试必须保留首次失败 evidence，便于判断 flaky 或真实回归。
- fixture/golden 更新必须在结果中记录新版本和批准原因。
- Milestone Gate 只能读取主干对应 commit 的测试结果，不接受其他分支或本地口头结果。
