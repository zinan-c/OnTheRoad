/**
 * @typedef {{ code: string; label: string; aliases: readonly string[] }} Currency
 * @typedef {{ code: string; label: string; icon: string; color: string }} CostCategory
 * @typedef {{
 *   code: string;
 *   label: string;
 *   aliases: readonly string[];
 *   icon: string;
 *   color: string;
 *   lineStyle: "solid" | "dashed" | "dotted";
 * }} TransportMode
 */

/** @type {readonly Currency[]} */
export const currencies = Object.freeze([
  { code: "CNY", label: "人民币", aliases: ["RMB", "人民币", "¥"] },
  { code: "USD", label: "美元", aliases: ["美元", "US$"] },
  { code: "EUR", label: "欧元", aliases: ["欧元", "€"] },
  { code: "JPY", label: "日元", aliases: ["日元", "円"] },
  { code: "KRW", label: "韩元", aliases: ["韩元", "₩"] },
  { code: "PHP", label: "菲律宾比索", aliases: ["菲律宾比索", "₱"] },
  { code: "THB", label: "泰铢", aliases: ["泰铢", "฿"] },
  { code: "SGD", label: "新加坡元", aliases: ["新加坡元", "S$"] },
  { code: "MYR", label: "马来西亚林吉特", aliases: ["林吉特", "RM"] },
  { code: "VND", label: "越南盾", aliases: ["越南盾", "₫"] },
  { code: "IDR", label: "印度尼西亚盾", aliases: ["印尼盾", "Rp"] },
  { code: "HKD", label: "港币", aliases: ["港币", "HK$"] },
  { code: "TWD", label: "新台币", aliases: ["新台币", "NT$"] },
  { code: "AUD", label: "澳大利亚元", aliases: ["澳元", "A$"] },
  { code: "GBP", label: "英镑", aliases: ["英镑", "£"] },
]);

/** @type {readonly CostCategory[]} */
export const costCategories = Object.freeze([
  { code: "TRANSPORT", label: "交通", icon: "route", color: "#155EEF" },
  { code: "ACCOMMODATION", label: "住宿", icon: "bed", color: "#7A5AF8" },
  { code: "DINING", label: "餐饮", icon: "utensils", color: "#E04F16" },
  { code: "TICKET", label: "票务", icon: "ticket", color: "#039855" },
  { code: "SHOPPING", label: "购物", icon: "shopping-bag", color: "#C11574" },
  { code: "ENTERTAINMENT", label: "娱乐", icon: "sparkles", color: "#DC6803" },
  { code: "VISA", label: "签证", icon: "passport", color: "#026AA2" },
  { code: "INSURANCE", label: "保险", icon: "shield", color: "#475467" },
  { code: "OTHER", label: "其他", icon: "circle-dots", color: "#667085" },
]);

/** @type {readonly TransportMode[]} */
export const transportModes = Object.freeze([
  { code: "WALK", label: "步行", aliases: ["步行", "走路", "walk"], icon: "person-walking", color: "#475467", lineStyle: "dotted" },
  { code: "BICYCLE", label: "自行车", aliases: ["自行车", "单车", "bike"], icon: "bicycle", color: "#039855", lineStyle: "dotted" },
  { code: "MOTORCYCLE", label: "摩托车", aliases: ["摩托车", "机车", "motorcycle"], icon: "motorcycle", color: "#DC6803", lineStyle: "solid" },
  { code: "SELF_DRIVE", label: "自驾", aliases: ["自驾", "驾车", "drive"], icon: "car", color: "#344054", lineStyle: "solid" },
  { code: "TAXI", label: "出租车", aliases: ["出租车", "的士", "taxi"], icon: "taxi", color: "#F79009", lineStyle: "solid" },
  { code: "RIDE_HAILING", label: "网约车", aliases: ["网约车", "打车", "ride hailing"], icon: "car-front", color: "#F04438", lineStyle: "solid" },
  { code: "CHARTER_CAR", label: "包车", aliases: ["包车", "charter car"], icon: "van", color: "#B54708", lineStyle: "solid" },
  { code: "BUS", label: "巴士", aliases: ["巴士", "bus"], icon: "bus", color: "#026AA2", lineStyle: "solid" },
  { code: "COACH", label: "长途客车", aliases: ["长途客车", "大巴", "coach"], icon: "bus-front", color: "#175CD3", lineStyle: "solid" },
  { code: "PUBLIC_BUS", label: "公交车", aliases: ["公交", "公交车", "public bus"], icon: "bus-stop", color: "#0E7090", lineStyle: "solid" },
  { code: "METRO", label: "地铁", aliases: ["地铁", "metro", "subway"], icon: "train-subway", color: "#7A5AF8", lineStyle: "solid" },
  { code: "LIGHT_RAIL", label: "轻轨", aliases: ["轻轨", "light rail"], icon: "tram", color: "#6938EF", lineStyle: "solid" },
  { code: "TRAIN", label: "火车", aliases: ["火车", "train"], icon: "train", color: "#3538CD", lineStyle: "solid" },
  { code: "HIGH_SPEED_RAIL", label: "高铁", aliases: ["高铁", "动车", "high speed rail"], icon: "train-fast", color: "#2E90FA", lineStyle: "solid" },
  { code: "FLIGHT", label: "飞机", aliases: ["飞机", "航班", "flight"], icon: "plane", color: "#155EEF", lineStyle: "dashed" },
  { code: "SHIP", label: "轮船", aliases: ["轮船", "船", "ship"], icon: "ship", color: "#0086C9", lineStyle: "solid" },
  { code: "PUBLIC_BOAT", label: "公共船运", aliases: ["公共船", "客船", "public boat"], icon: "boat", color: "#0BA5EC", lineStyle: "solid" },
  { code: "CHARTER_BOAT", label: "包船", aliases: ["包船", "charter boat"], icon: "sailboat", color: "#06AED4", lineStyle: "solid" },
  { code: "FERRY", label: "轮渡", aliases: ["轮渡", "渡轮", "ferry"], icon: "ferry", color: "#1570EF", lineStyle: "solid" },
  { code: "CABLE_CAR", label: "缆车", aliases: ["缆车", "索道", "cable car"], icon: "cable-car", color: "#93370D", lineStyle: "dashed" },
  { code: "SHUTTLE", label: "接驳车", aliases: ["接驳车", "班车", "shuttle"], icon: "shuttle-van", color: "#4E5BA6", lineStyle: "dashed" },
  { code: "OTHER", label: "其他", aliases: ["其他", "未指定", "other"], icon: "route-off", color: "#667085", lineStyle: "dashed" },
]);

export const currencyAliases = Object.freeze({ RMB: "CNY" });

/** @param {string} input */
export function normalizeCurrencyCode(input) {
  const normalized = input.normalize("NFKC").trim().toUpperCase();
  const code = currencyAliases[/** @type {keyof typeof currencyAliases} */ (normalized)] ?? normalized;
  if (!currencies.some((currency) => currency.code === code)) {
    throw new RangeError(`Unsupported currency code: ${normalized}`);
  }
  return code;
}

export function validateReferenceData() {
  /** @type {string[]} */
  const errors = [];
  for (const [name, entries] of Object.entries({ currencies, costCategories, transportModes })) {
    const codes = entries.map(({ code }) => code);
    if (new Set(codes).size !== codes.length) errors.push(`${name}: duplicate code`);
  }
  for (const entry of [...costCategories, ...transportModes]) {
    if (!/^#[0-9A-F]{6}$/u.test(entry.color)) errors.push(`${entry.code}: invalid color`);
    if (!/^[a-z0-9-]+$/u.test(entry.icon)) errors.push(`${entry.code}: invalid icon`);
  }
  return { valid: errors.length === 0, errors };
}

export function getReferenceData() {
  return { currencies, costCategories, transportModes, currencyAliases };
}
