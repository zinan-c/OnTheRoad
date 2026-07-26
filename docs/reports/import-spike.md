# A10 SheetJS Import Spike Go/No-Go 报告

## 结论

**GO（SheetJS 0.20.3；冻结的 M0 白名单格式；最多 5,000 行）。**

CSV、A12 SpreadsheetML `.xls`、真实 BIFF8 `.xls` 与 OOXML `.xlsx` 均由 SheetJS 实际解析。三种 A12 资产得到一致的 15 行、类型化字段和 `minimal-five-day@1`；真实 BIFF8 回读同样为 15 行。多 sheet、1900/1904 日期系统通过。

损坏 ZIP、声明解压炸弹、超 shared strings、公式、宏、加密和路径穿越均在预检或 SheetJS 后置检查中以稳定错误码停止，未执行公式。

## 固定环境与供应链

- 日期：2026-07-26
- OS：macOS 26.5.2
- 架构：arm64
- Node：v24.14.0（Codex bundled runtime）
- SheetJS：0.20.3，vendored
- 官方 tarball SHA-256：`8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- 网络：运行测试与基准时不需要
- 数据：每种格式 5,000 行，8 次重复
- Parser 子进程：`--max-old-space-size=256`

## SheetJS 固定环境测量

| 格式 | 实际编码 | 输入字节 | p95 |
|---|---|---:|---:|
| CSV | SheetJS CSV writer | 373,922 | 31.033 ms |
| XLS | SheetJS BIFF8 writer | 674,816 | 71.410 ms |
| XLSX | SheetJS OOXML writer | 495,184 | 88.948 ms |

- 独立解析进程最大 `maxRSS`：313,933,824 bytes（299.391 MiB）
- Go 门槛：每格式 p95 ≤ 2,000 ms；`maxRSS` ≤ 402,653,184 bytes（384 MiB）
- Worker 边界：V8 heap 256 MiB；timeout 10 s；5,000 行

测量命令：

```sh
cd spikes/importer
npm run generate:biff8
npm test
npm run benchmark
```

## 安全矩阵

| 输入 | 结果 |
|---|---|
| 损坏 ZIP | `IMPORT_CORRUPT_ARCHIVE` |
| ZIP 声明解压超限/高压缩比 | `IMPORT_RESOURCE_LIMIT` |
| shared strings 超限 | `IMPORT_RESOURCE_LIMIT` |
| XLSX/SpreadsheetML 公式及 SheetJS 暴露的公式单元格 | `IMPORT_FORMULA_FORBIDDEN` |
| CSV 公式型前缀 | `IMPORT_FORMULA_FORBIDDEN` |
| 加密 ZIP | `IMPORT_ENCRYPTED_FILE` |
| VBA 宏条目 | `IMPORT_MACRO_FORBIDDEN` |
| 非法归档路径 | `IMPORT_UNSAFE_ARCHIVE_PATH` |

失败均发生在正式 Import staging 数据创建之前；永久安全/格式错误不得自动重试。

## Plan B

若固定环境超过阈值，或真实输入要求超出白名单，采用隔离 Apache POI/Spring Batch Worker。不得通过提高无限制内存、启用公式执行或移除预检来维持假性 Go。
