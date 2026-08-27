# ADR-006：国际地图使用 Mapbox Static Tiles 与 Geocoding v6 Permanent

- 状态：Accepted；代码和离线 mock 测试已接入，真实 token smoke 与发布审批仍是 release gate
- 日期：2026-08-27
- Supersedes：[`ADR-003`](./003-online-nominatim-map-runtime.md) 中关于
  `international_primary` / `hybrid` 的当前运行时决定；ADR-003 保留为历史记录
- 保持不变：[`ADR-005`](./005-amap-primary-online-map-runtime.md) 对
  `cn_primary` 的官方高德决定

## 决定

境内 `cn_primary` 继续使用官方高德 Search/Reverse、Web JS、Directions 和
Static Map。境外 `international_primary` 使用以下两条明确分离的 Mapbox
能力：

| 能力 | Provider | 运行时边界 |
| --- | --- | --- |
| 浏览器地图 | Mapbox Static Tiles `streets-v12` 512 | MapLibre raster source，`tileSize=512`、`maxzoom<=22`、Mapbox logo 与 attribution |
| 地点搜索/反查 | Mapbox Geocoding API v6 | On The Road API 服务端代理；`permanent=true`、`autocomplete=false`、WGS84 |

Mapbox Geocoding v6 Permanent 不是 Search Box，也不宣称提供完整的 POI
Permanent 能力。产品只实现显式 forward/reverse geocoding；实时逐键补全、
Search Box 临时结果和常规批量 POI 解析均不在本决定内。

`hybrid` 只用于 API/Worker 等有请求上下文的服务：带中国国家上下文或位于
固定中国 WGS84 边界内的请求走高德，其余走 Mapbox。Provider 错误不会静默
切换 Provider 或改写 `mapProfile`。

## Profile 与 Trip 边界

当前 `/api/map/config` 是部署级 endpoint，不含 Trip ID，不能从持久化的
Trip `mapProfile` 安全决定浏览器 provider。因此 Web 在
`MAP_PROFILE=hybrid` 时 fail closed，返回
`MAP_PROFILE_REQUIRES_TRIP_SCOPE`；它不会伪造一个同时适用于中国和海外的
单一图层。要在同一进程按 Trip 动态切换，需另行实现带 Trip 授权和 profile
选择的 runtime-config endpoint，并由 Web 显式消费；本 ADR 不扩大该范围。

`MAP_PROFILE=international_primary` 是可独立启动的境外部署。该部署的
Trip 必须使用 `international_primary`；现有地点候选更新 endpoint 也会拒绝
部署 provider 与 Trip profile 不一致的请求。

## 凭证、URL 与缓存

- `MAPBOX_PUBLIC_TOKEN` 仅用于浏览器 tile URL。它应在 Mapbox 控制台限制允许
  的 HTTPS origin/域名和所需 scope；公开 token 不等于服务端 geocoding token。
- `MAPBOX_GEOCODING_TOKEN` 只注入 API/Worker/PDF Worker 的服务端环境，绝不
  出现在 `/api/map/config`、HTML、日志或客户端 bundle。
- Static Tiles 和 Geocoding 使用不同 token 和独立 endpoint 配置。默认 endpoint
  必须是 `api.mapbox.com` 的官方 HTTPS host；禁止把请求失败静默改到 OSM、
  Nominatim、fixture 或其他未审计 host。
- MapLibre 的 raster source 使用 `streets-v12/tiles/512`、`tileSize=512`；
  浏览器使用受 origin 限制的 public token 直接访问 Mapbox CDN，遵循上游
  `Cache-Control`，不经应用服务端转发瓦片。页面同时显示 Mapbox logo 和
  `© Mapbox © OpenStreetMap contributors` attribution。
- API 对 forward/reverse 使用独立 timeout、缓存和限流策略，并规范化
  401/403、429、timeout、5xx、transport 和 invalid payload。日志只保留
  provider、状态和安全 fingerprint，不记录地址全文、坐标或 token。

## 未覆盖能力

本 item 不实现 Mapbox Directions 或 Mapbox Static Images。国际部署若请求
路线规划，必须得到明确的 unavailable/degraded 状态；Worker 不得把它换成
fixture 或高德路线。国际 PDF/路径能力应作为独立 provider item 评估。

## 配置与验收

最小自测配置（`.env`，不要把真实 secret 提交仓库）：

```dotenv
MAP_PROFILE=international_primary
MAP_AUTOCOMPLETE_ENABLED=false
MAP_EXPLICIT_SEARCH_ENABLED=true
MAPBOX_PUBLIC_TOKEN=pk.<domain-restricted-public-token>
MAPBOX_GEOCODING_TOKEN=sk.<server-only-permanent-token>
OTR_MAPBOX_TILE_SIZE=512
OTR_MAPBOX_MAX_ZOOM=22
OTR_MAPBOX_LIVE_SMOKE=0
```

离线 required tests 使用 fake fetch，不需要真实 key，也不访问 Mapbox。发布前
另行在受控环境设置 `OTR_MAPBOX_LIVE_SMOKE=1`，并由受控脚本/人工流程执行并记录
tile、forward、reverse 的状态、耗时、attribution 和 token scope；该开关只是
显式发布门禁，不会自动发起公网请求，live smoke 也不是 CI required-case 的
替代品。`MAP_PROFILE=cn_primary` 的高德配置和测试保持不变。

相关实现：`packages/providers/src/geocoding/mapbox.ts`、
`packages/config/src/env.ts`、`apps/api/src/modules/locations/search.ts`、
`apps/web/src/features/map/maplibre-runtime.mjs`。
