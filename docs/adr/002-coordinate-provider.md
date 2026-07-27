# ADR-002：坐标系与地理编码 Provider

- 状态：Accepted for M0
- 日期：2026-07-26
- Task：A08

## 决策

领域坐标统一为 `{ longitude, latitude, crs: "WGS84" }`。任何 Provider 输入必须声明来源 CRS；未声明、未知或越界坐标直接失败，不进行猜测。中国大陆 Provider 返回 GCJ-02 或 BD-09 时，在 adapter 边界转换为 WGS84。

搜索与反查采用 HERE Geocoding & Search API v7 原生 contract。Geocode、Discover 和 Reverse Geocode 使用不同主机，因此三个 endpoint 都必须由 `mapProfile` 显式配置；系统不根据国家、请求失败或 429 自动切换 Provider。M0 profiles：

| profile | Provider | domain CRS | 能力 | endpoint |
|---|---|---|---|---|
| `fixture-cn` | HERE contract/local fixture | WGS84 | geocode、revgeocode；无 autocomplete | explicit |
| `fixture-global` | HERE contract/local fixture | WGS84 | geocode、revgeocode；无 autocomplete | explicit |
| `commercial-required` | HERE API v7 | WGS84 | geocode、revgeocode | explicit；API key required |

`mapProfile` 只由配置 ID 决定，不根据地点动态路由。未知 profile 快速失败。

## 坐标精度

固定 12 点覆盖上海、北京、广州、成都、舟山、普陀山及纽约、伦敦、东京、悉尼，来源包括 WGS84、GCJ-02 和 BD-09。WGS84→GCJ-02 使用标准椭球偏移，GCJ-02→WGS84 使用迭代逆解，BD-09 先逆到 GCJ-02。

- Gate：至少 10 点；
- 每点转换后与 WGS84 golden 的球面误差 ≤ 3 m；
- 当前最大误差：0.082355 m；
- 领域输出不得保留未声明 CRS。

3 m 是契约/转换误差门槛，不代表上游测绘数据本身的定位精度。

## HERE 行为

- 无 bbox 的正向查询使用 `/v1/geocode`；严格 bbox 查询使用 `/v1/discover`；反查使用 `/v1/revgeocode`。adapter 不猜测或重写主机；
- API Key 必填，只从运行时机密配置读取，禁止写入仓库、日志、报告或缓存键；
- 发送语言、limit 和可选 ISO 3166-1 alpha-3 country/bbox context；
- 结果不自动选中；同名候选保留上下文供用户决定；
- HERE `position` 按官方 contract 视为 WGS84，并在 adapter 边界生成统一 DTO；
- 每个候选携带 `© HERE` 来源标识，界面展示及结果存储仍须服从账户当前合同和响应缓存头；
- 429 规范为 `PROVIDER_RATE_LIMITED` 并保留 `Retry-After`；
- 401/403、timeout、5xx、空反查和非法 payload 分别规范化；
- adapter 内不重试、不故障切换，由上层决定何时按 `Retry-After` 重试。

缓存键包含 provider、profile、language、规范化 query、country codes 和 viewbox，避免不同策略/上下文串用。

## 离线与 Plan B

CI 仅使用进程内 HERE Fetch contract fixture，其响应来自 A12 `minimal-five-day@1`，不打开 socket、不访问公共地图服务。底图/搜索不可用时启用 fixture Provider、显式地图点选或手工 WGS84 坐标，并显示降级说明；路线只能标为示意。不得静默切换或静默选中。

真实 HERE smoke 必须单独获得网络批准并通过 `OTR_HERE_API_KEY` 注入凭据，且只执行一个 `limit=1` 的显式查询。它不是 CI required check。

合规审查入口：[HERE General Content Supplier Terms and Notices](https://www.here.com/en-us/terms/general-content-supplier-terms-and-notices)。M0 的静态来源标识只证明 adapter 不丢失 Provider 身份，不替代上线前针对实际账户、地区和展示方式的法律审查。
