# A11 CJK、静态地图与 50 页 PDF Spike 报告

- 日期：2026-07-26
- 结论：**Go**
- ADR：`docs/adr/004-a11-two-pass-pdf-pagination.md`
- 测试：`TC-A11-01`、`TC-A11-02`、`TC-A11-03`

## 范围与实现

Spike 使用 Playwright Chromium 生成专用 A4 打印页面，固定嵌入 Noto Sans CJK SC 2.004，使用离线静态地图 PNG，并以“两遍渲染 + 最终逐项复核”生成精确目录。文档由封面、目录和 48 个章节构成，共 50 个物理页。正文覆盖中英混排、长文本、页眉页脚、地图、图例来源和 A4 横纵向。

字体信息：

- 文件：`apps/pdf-worker/fonts/NotoSansCJKsc-Regular.otf`
- SHA-256：`c3a9f5223868ca3a2b2e576d8113713b38e8fd8b08a7534b7f018cdecc34874d`
- 版本：2.004
- PDF 字体名：`NotoSansCJKsc-Regular`
- 嵌入：是；子集：是；Unicode：是
- 许可证：OFL-1.1，正文及哈希记录于 `apps/pdf-worker/fonts/OFL.txt` 和 `FONT_MANIFEST.json`

## Red 证据

先创建 `cjk-pagination.spec.ts` 和 `toc-and-resource.spec.ts`，首次运行 2/2 因 `src/spike.ts` 不存在，以 `ERR_MODULE_NOT_FOUND` 失败。实现初版后测试继续捕获了真实问题：

- 页面高度取整导致生成 51 页，而不是 50 页；
- 25 ms 资源门禁错误地被页面导航超时抢先触发；
- contact sheet 的 ImageMagick 命令参数与字体配置不正确；
- 固定 Noto 尚未入库时，字体断言拒绝用系统 Heiti/PingFang 伪装成功；
- `@playwright/test` 升级后浏览器 revision 未安装，默认 executable path 明确失败；通过显式本地 override 完成当前环境验证，同时保留 clean-checkout 默认解析。

上述问题均修复后才记录 Green。

## Green 结果

运行环境：

- Node.js 24.14.0
- `@playwright/test` 1.62.0；当前验证通过 `OTR_A11_CHROMIUM_PATH` 显式选择已安装的 Chromium 1228
- Google Chrome for Testing 149.0.7827.55
- Poppler 26.07.0
- ImageMagick 7.1.2-27
- Chromium browser sandbox 保持默认启用；未设置 `OTR_A11_DISABLE_CHROMIUM_SANDBOX`

测试结果：

| Case | 结果 | 证据 |
|---|---|---|
| TC-A11-01 | Pass | A4 纵向与横向均为 50 页；PDF parser 可打开；中文可提取；每页页眉页脚存在；Noto 字体已嵌入 |
| TC-A11-02 | Pass | 48 个目录项逐条对应最终物理页 3–50；资源延迟超时抛出 `ResourceTimeoutError`，目标 `trip.pdf` 不存在 |
| TC-A11-03 | Pass | 全 50 页转 PNG；0 空白页、0 边缘裁切；地图页含静态地图与 attribution |

TC-A11-01/02 最终一次运行：3 tests passed，总耗时约 9.1 秒。TC-A11-03 最终一次运行：1 test passed，总耗时约 11.8 秒。

产物测量：

- PDF：50 页，A4 594.96 × 841.92 pt，391,524 bytes，PDF 1.4
- 当前证据 PDF SHA-256：`a51229eca7c24ae36a016f4643ffaf3ee6a80d29b7ffbd15ab00efd1ff69c08b`（Chromium 写入生成元数据，因此该哈希只用于锁定本次证据，不作为跨运行确定性门禁）
- 视觉 PNG：统一 909 × 1287 px（110 DPI）
- 最小页面标准差：0.0926541，高于空白门禁 0.018
- 第 2–50 页最小边缘均值：1.0，高于裁切门禁 0.985
- 静态地图 PNG：1200 × 560；SHA-256 `f00b838c9196c0630368a8c8185dccf2334f923c0d8e34c2fea85c05f79b8ba5`

## 视觉证据

- `spikes/pdf/artifacts/a11-visual/a11-50-pages.pdf`
- `spikes/pdf/artifacts/a11-visual/per-page-evidence.json`
- `spikes/pdf/artifacts/a11-visual/all-pages-contact-sheet.png`
- `spikes/pdf/artifacts/a11-visual/page-01-cover.png`
- `spikes/pdf/artifacts/a11-visual/page-02-toc.png`
- `spikes/pdf/artifacts/a11-visual/page-03-map.png`

Contact sheet 和三张代表页已人工复核：中文无明显缺字，目录从 3 到 50 连续且与章节一致，页眉页脚位于安全区，地图及 attribution 可见，未见裁切、空白页或失图。

## 运行方式与 CI 要求

```bash
pnpm --filter @on-the-road/pdf-spike lint
pnpm --filter @on-the-road/pdf-spike typecheck
pnpm --filter @on-the-road/pdf-spike unit
pnpm --filter @on-the-road/pdf-spike build
pnpm --filter @on-the-road/pdf-spike test:visual
```

CI 镜像必须安装与 `@playwright/test` 匹配的 Chromium、Poppler 和 ImageMagick。若浏览器由镜像预装，可设置 `OTR_A11_CHROMIUM_PATH`；不得在源代码中写入开发机绝对路径。当前 Codex 文件系统沙箱内直接启动 Chromium 会 `SIGABRT`，因此本次浏览器测试在获批的沙箱外本地进程中运行；这不是关闭 Chromium 自身 sandbox。

## 风险与后续

- 正式 F04 模板内容密度高于 Spike，仍需对 100+ 页、超高图片、长 URL 和跨页表格重复相同的最终物理页验证。
- 视觉阈值能阻止空白和边缘裁切，但不能取代人工/基线图差异复核；后续应在固定 Linux 镜像冻结 golden。
- Playwright package 与浏览器 revision 必须一起升级；revision 缺失应快速失败，不得扫描或硬编码开发机缓存路径作为默认行为。
