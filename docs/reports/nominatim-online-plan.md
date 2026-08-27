# Online Nominatim / Map Runtime 迁移计划

> **历史计划 / superseded（2026-08-27）**：本文保留原迁移过程和当时的
> 验收状态。当前 `international_primary` / `hybrid` 境外 geocoding 与
> MapLibre tiles 已改由 Mapbox 承担，现行决定见
> [`ADR-006`](../adr/006-mapbox-international-map-runtime.md)。本文的
> Nominatim endpoint、限流和 smoke 项不再是新部署配置。

## 状态

这是 HERE → 公共在线 Nominatim 的历史文档先行决策和实施计划。它记录当时
的适配器、API proxy、限流/缓存和 fixture 隔离状态，不是当前部署的实现或
验收门禁。当前权威决策是 [`ADR-006`](../adr/006-mapbox-international-map-runtime.md)
（境外 Mapbox）和 [`ADR-005`](../adr/005-amap-primary-online-map-runtime.md)
（境内 AMap）；原 HERE Spike 仍保留为历史证据。

## 目标运行时

本地开发使用 `dev` profile；`dev`、`qa`、`prod` 默认启用在线地图：

1. 搜索/反查：本地、dev、qa、prod 均由 On The Road API 代理访问公共 Nominatim。
2. 瓦片：通过环境配置使用在线 OSM-derived tile source，并展示 attribution。
3. 路径规划：通过独立在线 Directions endpoint；Nominatim 不承担该能力。
4. `fixture`：只用于 CI、离线回归、故障降级和确定性演示。

## 必须完成的实现切片

| 切片 | 结果 |
|---|---|
| Nominatim adapter | 已完成：search/reverse、WGS84、candidate normalization、错误映射 |
| API policy boundary | 已完成：后端代理、1 req/s 全局令牌桶、cache、无 autocomplete |
| Profile routing | 已完成：`international_primary` → Nominatim；`hybrid` 中国高德、海外 Nominatim |
| Online tile runtime | dev/qa/prod 的 tile URL、attribution、cache、故障降级 |
| Online directions runtime | 选择并接入非 HERE provider，完成 Worker/API/UI 链路 |
| Environment smoke | 三环境各执行 search、reverse、tile、route、故障/限流检查 |
| HERE removal | 删除 HERE 配置、secret、adapter、测试 fixture 名称和当前文档引用 |

## 接受标准

- 真实在线 Nominatim search/reverse 在 dev、qa、prod 各完成一次受控 smoke。
- 不产生 autocomplete 请求；公共 Nominatim 请求不超过全应用 1 req/s。
- 重复查询命中缓存，429/5xx/timeout 有可解释状态和退避。
- 瓦片请求带正确 attribution、User-Agent/Referer 和缓存行为；不执行预取。
- 在线 Directions provider 不是 HERE，且真实路线可以从 Worker 持久化到 API/MapLibre。
- CI required-case 仍为 fixture，且能够证明没有访问公共地图服务。
- `rg -i 'HERE|OTR_HERE'` 的结果只能是历史证据、当前迁移/移除说明或 release audit；当前配置、Provider registry、运行手册和生产决策不再把 HERE 作为候选。

## 现阶段明确不做

- 公共 Nominatim autocomplete。
- 公共 Nominatim 常规 Excel 批量 geocoding。
- 用 Nominatim 代替瓦片或路径规划。
- 将 tile/Directions 失败静默降级为真实路线。
- 在 CI required-case 中调用公网地图服务。
