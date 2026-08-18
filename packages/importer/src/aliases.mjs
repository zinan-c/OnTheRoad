import { currencies } from "@on-the-road/config/reference-data";

export const ALIAS_DICTIONARY_VERSION = "1.0.0";

export const STANDARD_COLUMNS = Object.freeze([
  "Day",
  "Date",
  "DayOfWeek",
  "IsWorkday",
  "Place",
  "Time",
  "Target",
  "ExternalSource",
  "ExternalId",
  "Desc",
  "Hotel",
  "Dining",
  "Duration",
  "Mode",
  "StartLocation",
  "EndLocation",
  "Cost",
  "Currency",
  "CostCategory",
  "Remark",
  "Address",
  "Latitude",
  "Longitude",
  "ImageURLs",
]);

const ALIASES = Object.freeze({
  Day: ["Day", "天", "第几天"],
  Date: ["Date", "日期", "出行日期"],
  DayOfWeek: ["DayOfWeek", "星期", "周几"],
  IsWorkday: ["IsWorkday", "工作日", "是否工作日"],
  Place: ["Place", "Location", "目的地", "地点"],
  Time: ["Time", "时间"],
  Target: ["Target", "Title", "事项", "目标", "标题"],
  ExternalSource: ["ExternalSource", "外部来源", "来源"],
  ExternalId: ["ExternalId", "ExternalID", "外部 ID", "外部编号"],
  Desc: ["Desc", "描述", "详情"],
  Hotel: ["Hotel", "酒店", "住宿"],
  Dining: ["Dining", "餐饮", "用餐"],
  Duration: ["Duration", "Dur", "耗时", "时长"],
  Mode: ["Mode", "交通方式", "交通"],
  StartLocation: ["StartLocation", "起点", "出发地"],
  EndLocation: ["EndLocation", "终点", "到达地"],
  Cost: ["Cost", "费用", "金额"],
  Currency: ["Currency", "币种", "货币"],
  CostCategory: ["CostCategory", "费用类别", "消费类别"],
  Remark: ["Remark", "备注"],
  Address: ["Address", "地址"],
  Latitude: ["Latitude", "Lat", "纬度"],
  Longitude: ["Longitude", "Lng", "经度"],
  ImageURLs: ["ImageURLs", "图片链接", "图片地址"],
});

export const COLUMN_ALIASES = Object.freeze(
  Object.fromEntries(
    Object.entries(ALIASES).map(([column, aliases]) => [
      column,
      Object.freeze([...aliases]),
    ]),
  ),
);

const LOOKUP = new Map(
  Object.entries(COLUMN_ALIASES).flatMap(([column, aliases]) =>
    aliases.map((alias) => [alias.trim().toLocaleLowerCase("en-US"), column])),
);

const CURRENCY_CODES = new Map(
  currencies.map(({ code }) => [code.toLocaleLowerCase("en-US"), code]),
);

/** @param {unknown} value */
export function canonicalColumn(value) {
  if (typeof value !== "string") return undefined;
  return LOOKUP.get(value.trim().toLocaleLowerCase("en-US"));
}

/** @param {unknown} value */
export function normalizeCurrencyAlias(value) {
  if (typeof value !== "string") return value;
  const normalized = value.normalize("NFKC").trim();
  if (/^(?:RMB|CNY)$/iu.test(normalized)) return "CNY";
  return CURRENCY_CODES.get(normalized.toLocaleLowerCase("en-US")) ?? normalized;
}

/** @param {unknown} value */
export function safeSpreadsheetText(value) {
  const text = String(value ?? "");
  return /^[=+\-@]/u.test(text) ? `'${text}` : text;
}
