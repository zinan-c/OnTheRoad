# ADR-005：高德全在线地图首版（`cn_primary`）

- 状态：Accepted；代码、离线 fixture 测试和配置契约已接入；真实 live smoke 与发布审批仍是 release gate
- 日期：2026-08-23
- Supersedes：[`ADR-003`](./003-online-nominatim-map-runtime.md) 的当前生产地图决定
- 保留历史：ADR-003 继续记录当时的 Nominatim 迁移决策，不覆盖本 ADR
- 范围说明：本 ADR 只决定 `cn_primary`；`international_primary` 和 API/Worker
  的 `hybrid` 固定地域路由由 [`ADR-006`](./006-mapbox-international-map-runtime.md)
  决定，境外不再使用 Nominatim

## 决策

`MAP_PROFILE=cn_primary` 的首版完整地图链路只使用官方高德能力：

```text
Web → same-origin /api/map/config → AMap JS API 2.0
API → AMap Web Service place/text + geocode/regeo
Worker → AMap Directions API 2.0
PDF Worker → AMap Static Map API
```

Search/Reverse、Web 底图、Directions 与 PDF Static Map 不跨 Provider 静默故障切换。`fixture` 是 CI/离线唯一的确定性替身；它不访问公网。`international_primary`/`hybrid` 是显式保留的非 CN profile，不改变 `cn_primary` 的边界。

## 坐标与安全边界

- 领域、API DTO、数据库和 Route API geometry 统一使用带 `crs: "WGS84"` 的 WGS84。
- AMap 请求前统一通过 `packages/providers/src/coordinates/gcj02.ts` 转 WGS84→GCJ02；AMap Search/Reverse/Directions 返回后转 GCJ02→WGS84。
- Web AMap Marker、Polyline、fitBounds、click 和 drag 也通过同一纯模块转换；持久化仍只保存 WGS84。
- `AMAP_API_KEY` 只进入 API/Worker/PDF Worker provider；Web `/api/map/config` 只返回 `AMAP_JS_API_KEY`、`AMAP_JS_SECURITY_CODE`、provider、engine、layer 和 attribution。
- readiness/capabilities 只报告布尔能力和安全字段名，禁止回显 key、security code、查询、坐标或完整带 secret 的 URL。

## 能力映射

| 能力/模式 | AMap API | 行为 |
|---|---|---|
| Search | `/v3/place/text` | 只允许显式搜索，不做 autocomplete |
| Reverse | `/v3/geocode/regeo` | WGS84→GCJ02 请求，结果回 WGS84 |
| WALK | `/v5/direction/walking` | 真实路线 |
| BICYCLE | `/v5/direction/bicycling` | 真实路线 |
| SELF_DRIVE/TAXI/RIDE_HAILING/CHARTER_CAR/BUS/COACH/SHUTTLE | `/v5/direction/driving` | 使用显式 strategy |
| PUBLIC_BUS/METRO/LIGHT_RAIL | `/v5/direction/transit/integrated` | 必须传 `city`/`cityd` |
| MOTORCYCLE | driving（仅显式启用） | 默认 approximate |
| FLIGHT/TRAIN/船/缆车/OTHER/custom | 无 | 明确 approximate；Provider 网络错误不 approximate |
| Web | AMap JS API 2.0 | 标准、卫星、卫星+路网；layer dropdown + localStorage |
| PDF | `https://restapi.amap.com/v3/staticmap` | 有界 URL/响应，失败输出可解释 neutral geometry |

标准地图、卫星影像和卫星+路网通过官方 AMap JS `TileLayer` 能力构建。禁止 public OSM tiles、Geoapify、未文档化 `webrd*.is.autonavi.com` 和对 `cn_primary` 的隐式 MapLibre 在线 fallback。Web SDK 加载失败显示中性网格/文字可编辑；不会伪装成正常 AMap。

## 配置与故障策略

必需的 CN 凭据是 `AMAP_API_KEY`、`AMAP_JS_API_KEY` 和 `AMAP_JS_SECURITY_CODE`。Search/Reverse 有独立的 `OTR_AMAP_TIMEOUT_MS`、`OTR_AMAP_RATE_LIMIT_RPS`、`OTR_AMAP_CACHE_TTL_SECONDS`；Directions/PDF 使用独立 timeout。`OTR_MAP_DEFAULT_LAYER` 只接受三种 catalog id，所有 AMap 输出必须有 `© 高德地图` attribution。

HTTP 401/403、429、5xx、超时、JSON/图像内容类型错误和超限响应均规范化为可诊断 Provider 错误。Search/Reverse/Directions 错误向调用方抛出；PDF 错误转成带 `degraded=true` 和 `degradationReason` 的中性网格/几何图。任何故障都不改 `MAP_PROFILE`、不选择另一个在线 Provider。

## 验证

确定性测试用 fake fetch/fake AMap namespace，禁止网络：坐标精度、Search/Reverse、Directions mode/status、Web marker/route/click/drag/layer、Static Map URL/content-type/size/fallback 都在 package/app unit suite 中覆盖。真实 smoke 只能在 `OTR_AMAP_LIVE_SMOKE=1` 且真实 key 存在时运行，并单独记录 attribution、状态和耗时。
