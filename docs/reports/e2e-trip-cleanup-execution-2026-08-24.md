# E2E Trip 清理执行记录

- 执行日期：2026-08-24
- 独立验证时间：2026-08-24T13:21:01.950Z
- 授权范围：仅删除强规则命中的 484 条疑似 E2E Trip。
- 数据库非敏感标识：`127.0.0.1:15432/on_the_road_local`，database OID `16384`。
- 数据库 schema 未迁移；对象存储文件未删除；未修改三条保留 Trip。

## 删除集合与保护断言

- 原始候选：486 条。
- 强规则删除集合：484 条。
- 强规则 ID 集合 SHA-256：`ea4e4808a52405695412456e8f65185f8ebd837ae4084a9a9b31f0fb515a16b1`。
- 原报告、删除前重跑报告和数据库直接查询的 ID 集合完全一致。
- 删除前全库 Trip：487 条。
- 删除前 dry-run 完成并显式回滚，输出 `committed: false`。

以下三条明确保留，且均不在删除集合：

| Trip ID | 名称 | 删除后状态 |
| --- | --- | --- |
| `4adec62c-98f5-44b5-8909-15e46a3cd228` | Shanghai and Zhoushan | active |
| `e6bdef50-e95a-4549-b3a4-46121685efd0` | Shanghai and Zhoushan | active |
| `d9221038-a450-4f34-a33d-e78ed987be0f` | 菲律宾海岛潜水之旅（2026-09） | active |

## 删除前备份

- 完整 PostgreSQL custom archive：`/private/tmp/otr-trip-cleanup.itBhIr/on_the_road_local-predelete-20260824T1220Z-pg17.dump`
- 大小：14,559,418 bytes。
- 文件权限：`0600`。
- SHA-256：`82e0cb31f402e06f845dc331de81658f08ecb5b6c00f52cacb90a43ff054eb98`。
- `pg_restore --list` 验证成功：318 个 TOC 条目；来源 PostgreSQL 17.7；备份工具 PostgreSQL 17.10。
- 首次使用 PostgreSQL 16.14 的备份尝试因版本不兼容而中止；该失败发生在任何删除前，成功 archive 使用 PostgreSQL 17 工具重新生成。

恢复时不要直接覆盖当前数据库。先创建隔离恢复库，再使用兼容的 PostgreSQL 17 工具验证并恢复：

```sh
createdb <isolated_restore_database>
/opt/homebrew/opt/postgresql@17/bin/pg_restore \
  --no-owner --no-privileges \
  --dbname=<isolated_restore_database> \
  /private/tmp/otr-trip-cleanup.itBhIr/on_the_road_local-predelete-20260824T1220Z-pg17.dump
```

若只需恢复这 484 条 Trip，应先在隔离库验证，然后基于已记录的精确 ID 集合设计单独的数据合并事务；不得把完整 archive 直接导回正在运行的业务库。

## 单事务执行结果

- 清理脚本：`scripts/cleanup-e2e-trips.mjs`。
- 执行保护：显式 `--execute`、固定确认 token、`--expected-count=484`、ID SHA-256、数据库名与 OID、事务内 `FOR UPDATE` 复核。
- 事务结果：`committed: true`。
- 删除 Trip：484 条。
- 提交前事务内断言：目标 Trip 剩余 0；保留 Trip 3；全库剩余 Trip 3。

删除前目标关联行计数：

| 表或逻辑关联 | 行数 |
| --- | ---: |
| destination | 973 |
| trip_day | 2,027 |
| itinerary_item | 1,122 |
| itinerary_item_audit | 1,162 |
| location | 248 |
| location_coordinate_audit | 12 |
| route_segment | 2,322 |
| attachment | 259 |
| expense | 140 |
| trip_audit | 504 |
| trip_create_request | 484 |
| import_job | 203 |
| import_row（经 import_job 关联） | 56,484 |
| import_inspect_job | 185 |
| import_location_staging | 142 |
| geocoding_batch | 66 |
| geocoding_job | 354 |
| staged_location_decision | 72 |
| import_media_task | 106 |
| import_commit_ledger | 76 |
| import_fingerprint_claim | 76 |
| job_outbox（目标 Trip Day） | 1,194 |
| job_inbox（目标 Trip Day） | 1,194 |
| accommodation | 4 |
| dining_item | 16 |
| custom_transport_mode | 5 |
| trip_exchange_rate | 12 |

事务对不具备直接 Trip cascade、存在限制外键或属于逻辑关联的表先执行精确删除，并断言实际行数等于删除前计数；其余关联行由数据库外键级联删除。事务提交前，所有目标 `trip_id` 关联计数均为 0。

## 提交后只读验证

- 484 个精确目标 ID：0 条存在。
- 强规则匹配：0 条。
- 弱规则 `Shanghai and Zhoushan`：2 条，均存在。
- 菲律宾业务 Trip：1 条，存在。
- 全库剩余 Trip：3 条。
- 所有目标 `trip_id` 关联行：0。

数据库在本次清理前已有以下历史孤儿基线，本次清理未扩大这些计数：

| 关联 | 清理前 | 清理后 |
| --- | ---: | ---: |
| itinerary_item_audit → trip | 526 | 526 |
| trip_audit → trip | 343 | 343 |
| import_row → import_job | 110,134 | 110,134 |

其他带 `trip_id` 的基础表以及 `export_job_asset → export_job` 的孤儿计数均为 0。提交后另观察到 `job_inbox` 中有 19 条记录没有对应 `job_outbox`；该逻辑关联没有数据库外键，删除前未为它建立全局基线，因此本记录不推断其来源。事务已对本次目标的 1,194 条 `job_inbox` 和 1,194 条 `job_outbox` 做了精确相等计数删除。
