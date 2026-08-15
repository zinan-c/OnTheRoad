# A09 MapLibre Spike Go/No-Go 报告

> 历史范围说明：本报告只证明本地 fixture tile、MapLibre 交互和无底图降级。它不证明 dev/qa/prod 的在线瓦片、公共 Nominatim 或在线 Directions 已接通；post-M4 在线地图目标见 [`ADR-003`](../adr/003-online-nominatim-map-runtime.md)。

## 结论

**GO：MapLibre 6.0.0 在当前 macOS 固定环境中完成点选、Marker 移动、fit bounds、四种路线样式及无底图/WebGL 降级验证。**

本结论仅覆盖 M0 本地 Spike，不包含生产底图、真实路线、外部 tile SLA 或其他操作系统兼容性。在线瓦片仍需执行 allowlist、attribution、cache、超时和不预取的环境 smoke。

## Gate 证据

- fixture：`minimal-five-day@1`
- MapLibre：`6.0.0`
- TC-A09-01：2 个纯契约测试及浏览器键盘 Marker 移动通过
- TC-A09-02：tile failure、0/1/同点及 WebGL failure 共 5 类降级状态通过
- TC-A09-03：flight、walk、road、ferry 四个实际渲染 feature、图例与 attribution 通过
- 浏览器：本机已安装 Google Chrome；没有下载浏览器
- 网络：禁用；底图为本地确定性 SVG fixture tile
- 截图：`spikes/maplibre/evidence/map-styles.png`

视觉 Gate 不只检查 layer ID：测试等待 MapLibre `idle`，并断言 `queryRenderedFeatures` 至少返回四个路线 feature，避免样式已注册但像素尚未渲染的假阳性。

## 降级策略

公共或生产底图不可用时显示中性网格和明确状态，不自动切换未知底图；文字行程仍可编辑，用户仍可通过键盘或地图交互产生合法 WGS84 选择。WebGL 完全不可用时显示结构化空态，不宣称地图成功。

## 可重复命令

```sh
pnpm --filter @on-the-road/maplibre-spike run lint
pnpm --filter @on-the-road/maplibre-spike run typecheck
pnpm --filter @on-the-road/maplibre-spike run unit
pnpm --filter @on-the-road/maplibre-spike run build

OTR_A09_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
OTR_A09_DISABLE_CHROMIUM_SANDBOX=1 \
pnpm --filter @on-the-road/maplibre-spike run test:e2e

OTR_A09_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
OTR_A09_DISABLE_CHROMIUM_SANDBOX=1 \
pnpm --filter @on-the-road/maplibre-spike run test:visual
```

浏览器测试只绑定 `127.0.0.1`，不访问公网。
