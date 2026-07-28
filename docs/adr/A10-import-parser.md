# A10 ADR：SheetJS 受限离线表格解析策略

- 状态：Accepted for M0 Spike
- 日期：2026-07-26
- 解析引擎：SheetJS `0.20.3`
- 适用 fixture：`minimal-five-day@1`

## 决策

M0 在 `spikes/importer/vendor/xlsx` 固定官方 SheetJS 0.20.3 运行文件，解析路径实际调用 `XLSX.read` 与 `XLSX.utils.sheet_to_json`。官方 tarball SHA-256 为 `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`，文件和 Apache-2.0 许可记录见 `spikes/importer/vendor/README.md`。

支持：

- UTF-8（可带 BOM）CSV；
- 真实 BIFF8 `.xls` 与 A12 的 Excel 2003 SpreadsheetML `.xls`；
- OOXML `.xlsx`；
- 多 sheet；
- Excel 1900/1904 日期系统。

在 SheetJS 之前执行安全 preflight：文件字节、ZIP 条目数、声明解压量、压缩比、shared strings、路径、加密位、宏条目、XML entity 和公式元素。SheetJS 读取后再次检查所有单元格的 `f` 字段、行列数与单元格长度。因此公式缓存值也不会被当作普通事实导入，且没有公式执行器。

默认门槛：

| 项目 | 门槛 |
|---|---:|
| 压缩输入 | 20 MiB |
| 声明解压总量 | 64 MiB |
| shared strings | 8 MiB |
| ZIP 条目 | 256 |
| 数据行 | 5,000 |
| 列 | 128 |
| 单元格字符 | 32,768 |
| 压缩比 | 100:1 |
| 隔离 Worker V8 heap | 256 MiB |
| 隔离 Worker RSS 门禁 | 384 MiB |
| 隔离 Worker timeout | 10 s |

RSS 门禁与 V8 heap 不相同；它还包含 SheetJS 代码、codepage 表、原始/解压 buffer 与进程本身。基准在独立 Node 子进程中加 `--max-old-space-size=256`，以避免 fixture 生成过程污染解析 RSS。

普通单元测试会验证三种格式的测量结果及 GO/NO-GO 计算，但不要求任意开发机或共享 CI runner 必须复现固定环境的 GO 结论。容量决策以 `reports/A10.json` 记录的 Node、平台、架构和阈值为准；更换基准环境时必须重新生成并评审证据。

## BIFF8 证据

`scripts/generate-biff8-fixture.mjs` 使用 SheetJS 从 A12 XLSX 生成 `fixtures/minimal-five-day-biff8.xls`。`file` 将其识别为 Composite Document File V2，SHA-256 固定为 `2b8618f058fd614118573b2713fd6fc3e33f0c0869683cff91fd15d7118e156d`；重复生成哈希一致。TC-A10-01 用 SheetJS 回读并核对 15 行与 fixture version。

## 生产边界与 Plan B

结论只覆盖 5,000 行、上述三格式白名单和安全门槛，不外推到加密、宏、公式、损坏/嵌套归档或 50,000 行 SLA。若真实样本在同一固定环境超过 2 秒 p95、384 MiB RSS，或需要更严格的 BIFF 兼容，则本路径 No-Go，迁移到独立 Apache POI/Spring Batch Worker，并沿用相同字节、行数、超时、内存和公式禁用门槛。
