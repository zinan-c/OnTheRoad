# A12 fixture 来源与再生成说明

`minimal-five-day@1` 是为 On The Road 测试人工编写的合成数据，不代表真实预订、价格、营业时间或路线建议。地点坐标采用 WGS84，并只用于固定契约和视觉测试。

所有地图、图片、表格和 PDF 文本资产均由仓库内生成器创建，不下载或嵌入第三方二进制内容。图片和中性地图为项目生成的 SVG；地图标注须显示 “Synthetic local fixture” 或等价说明，不应冒充在线底图。

在此目录运行：

```sh
npm run generate
npm test
```

生成器固定字段顺序、ZIP 条目顺序和时间戳。`manifest.json` 记录每项资产及整棵资产树的 SHA-256。变更 fixture 时必须同步更新 `fixtureVersion`、重新生成全部资产，并在评审记录中说明原因。
