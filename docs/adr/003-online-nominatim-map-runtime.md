# ADR-003：在线 Nominatim 与三环境在线地图运行时

- 状态：Accepted；MAP-01 代码实现完成，三环境 smoke 与 MAP-02/03/04 仍待执行
- 日期：2026-08-14
- Supersedes：[`ADR-002`](./002-coordinate-provider.md) 中关于 HERE 的当前 Provider 选择
- 适用环境：本地开发（`dev` profile）、`dev`、`qa`、`prod`

## 决策

On The Road 不再采用 HERE。地点搜索和反向地理编码统一改为通过应用后端代理访问公共 Nominatim：

```text
Web / App → On The Road API → cache + token bucket → https://nominatim.openstreetmap.org
```

浏览器不得直接请求 Nominatim。API 代理负责稳定 User-Agent、联系方式、请求超时、全应用限流、缓存、错误映射和隐私过滤。公共 Nominatim 的低频个人使用可以满足当前产品，但必须遵守其现行政策：最多约 1 req/s、可识别 User-Agent/Referer、可见 attribution、无 autocomplete、无常规批量或周期性请求。

## MAP_PROFILE 语义

| profile | 中国大陆 | 海外 | 搜索/反查能力 |
|---|---|---|---|
| `fixture` | 本地 fixture | 本地 fixture | 离线、确定性 |
| `cn_primary` | 高德 | 不作为国际主 Provider | 显式 search/reverse |
| `international_primary` | 不作为中国主 Provider | 公共 Nominatim | 显式 search/reverse |
| `hybrid` | 高德 | 公共 Nominatim | 按固定中国边界规则选择 |

`mapProfile` 持久化在 Trip/Location 上。Provider 由 profile 和固定地域规则决定；请求失败、429 或配额限制不得静默改写 profile 或切换到另一 Provider。

Nominatim 不支持本产品的实时 autocomplete 语义，因此地点输入采用“用户提交搜索 → 候选 → 用户确认”。公共 Nominatim 不用于常规 Excel 批量地理编码；批量导入中的未解析地点进入受控队列和人工确认流程。

## 本地开发与三环境在线地图约定

本地开发不是第四个产品环境；Native/Compose 下的本地应用进程使用 `dev`
profile 的同一在线地图配置。`dev`、`qa`、`prod` 的默认运行时均为在线地图模式：

| 能力 | `dev` | `qa` | `prod` |
|---|---|---|---|
| 地点搜索/反查 | 公共 Nominatim | 公共 Nominatim | 公共 Nominatim |
| 交互式瓦片 | 配置的 OSM 在线源 | 配置的 OSM 在线源 | 配置的 OSM 在线源 |
| 路径规划 | 配置的在线 Directions endpoint | 配置的在线 Directions endpoint | 配置的在线 Directions endpoint |
| fixture | 显式离线/回归模式 | 显式离线/回归模式 | 仅故障降级和运维验证 |

CI 不是产品运行环境，required-case 和合成监控仍使用 fixture，不访问公共地图服务。`release` 代表生产发布验证流程，不是第四个运行环境。

## 瓦片、路径规划与 Nominatim 的边界

- Nominatim 只提供 geocoding/search/reverse，不提供地图瓦片或路径规划。
- 瓦片通过独立的 `MAP_TILE_URL`/tile provider 配置；必须展示 OSM 或实际瓦片供应商要求的 attribution，遵守缓存和请求识别要求，不做批量预取或离线下载。
- 路径规划通过独立的 `DIRECTIONS_BASE_URL`/Directions provider 配置；它不由 `MAP_PROFILE` 选择，也不能继续使用 HERE。具体在线 Directions provider 需要单独的实现与 smoke gate；在该 gate 关闭前，不能宣称生产在线路线已完成。
- PDF 静态地图只能访问环境 allowlist 内的瓦片源。公共瓦片不得被 PDF 批量预取；无法安全/合规使用在线瓦片时，允许输出带 attribution/降级说明的几何路线和中性网格。
- 瓦片或 Directions 不可用时，UI 显示 `degraded/pending/manual` 状态；不能把直线/弧线伪装成真实导航路线。

## 配置契约

应用层按环境读取以下逻辑配置，具体 Secret 注入方式由部署系统决定：

- `OTR_NOMINATIM_BASE_URL`
- `OTR_NOMINATIM_USER_AGENT`
- `OTR_NOMINATIM_CONTACT`
- `OTR_NOMINATIM_TIMEOUT_MS`
- `OTR_NOMINATIM_RATE_LIMIT_RPS`
- `OTR_NOMINATIM_CACHE_TTL_SECONDS`
- `OTR_MAP_TILE_URL`
- `OTR_MAP_TILE_ATTRIBUTION`
- `OTR_DIRECTIONS_BASE_URL`
- `OTR_DIRECTIONS_ATTRIBUTION`
- `OTR_ONLINE_MAP_REQUIRED`

生产启动必须验证在线 endpoint、attribution、User-Agent/contact 和能力矩阵；缺少在线配置时 fail closed，不自动改成 fixture。`fixture` 只能由显式 profile 或 CI/离线运行模式选择。

## 安全、隐私与可观察性

- 不向公共服务发送个人或机密地址内容；日志、Trace、指标只保留脱敏查询摘要或 hash。
- 缓存键必须包含 provider、profile、locale、query、country context 和 viewbox，避免跨国家/语言污染。
- 记录 Nominatim latency、cache hit、429、5xx、timeout、last successful request 和当前 endpoint；不记录原始地址全文。
- 保留 endpoint 可切换能力，但不做静默故障切换；切换必须是配置变更并有审计记录。

## 参考政策

- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- [Nominatim Search API](https://nominatim.org/release-docs/develop/api/Search/)
- [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
