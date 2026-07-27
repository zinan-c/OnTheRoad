# A08 Provider Spike Go/No-Go 报告

## 结论

**GO：HERE geocode/discover/revgeocode 原生 contract、WGS84 领域边界、离线 fixture 与一次获批的真实服务 Smoke 均已通过。**

结论不包含生产 SLA、账户配额、autocomplete、自动故障切换或批量 geocoding；CI 永久使用本地 HERE contract fixture。

## 证据

- fixture：`minimal-five-day@1`
- mapProfile：`fixture-cn`
- golden：12 个中外点，覆盖 WGS84 / GCJ-02 / BD-09
- 最大转换误差：0.082355 m
- Gate：至少 10 点；误差 ≤ 3 m
- 搜索候选：2 个 A12 匹配，均未自动选中
- 同名候选：2 个 Springfield，均保留完整标签且未自动选中
- reverse：外滩，输出 WGS84
- attribution：`© HERE`
- 重复运行 evidence SHA-256：`2dd85b8b428c8ce6b8ebc4b1435f113242015b61b34981156c66424e30ed35c9`

真实 Smoke（2026-07-27，单次获批请求）：

- query：`Shanghai`
- limit：1
- 返回：`Shanghai, China`
- 类型：`locality`
- 坐标：`121.4747, 31.25516, WGS84`
- API Key：仅从运行时环境读取，未写入输出、报告或仓库

错误矩阵：

| 情况 | 规范错误 | 行为 |
|---|---|---|
| 429 + Retry-After: 7 | `PROVIDER_RATE_LIMITED` | `retryAfterSeconds=7`，不切换 |
| timeout | `PROVIDER_TIMEOUT` | retryable，不切换 |
| 503 | `PROVIDER_UNAVAILABLE` | retryable，不切换 |
| reverse `items=[]` | `PROVIDER_NO_RESULT` | 保留文字/手工处理 |
| API Key 缺失 | `PROVIDER_CREDENTIALS_MISSING` | 构造 adapter 时快速失败 |
| API Key 被 401/403 拒绝 | `PROVIDER_CREDENTIALS_INVALID` | 不重试、不切换 |
| CRS 缺失/越界 | 坐标错误 | Provider 调用前失败 |
| `items`/position 非法 | `PROVIDER_RESPONSE_INVALID` | 拒绝候选 |

## 可重复命令

```sh
cd spikes/provider
pnpm run unit
pnpm run typecheck
pnpm run lint
pnpm run build
```

## 可选的人工真实 smoke

不要在 CI 或未批准环境执行。API Key 只通过当前 shell 环境注入：

```sh
OTR_ENABLE_HERE_SMOKE=1 \
OTR_HERE_API_KEY='<HERE API key>' \
OTR_HERE_QUERY='Shanghai' \
pnpm --dir spikes/provider run smoke:here
```

默认 endpoint 为 HERE API v7 官方 geocode/discover/revgeocode 主机。该命令只发送一次 `limit=1` geocode；每次运行仍须单独批准，Key 不输出到报告。

## Plan B

使用 A12 fixture Provider、最近地点、显式地图点选与手工 WGS84 坐标；搜索/反查不可用不阻断文字保存。地图和路线显示明确降级说明，不宣称真实路线。
