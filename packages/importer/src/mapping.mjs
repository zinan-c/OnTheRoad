import { STANDARD_COLUMNS, canonicalColumn } from "./aliases.mjs";
import { stableHash } from "./fingerprint.mjs";

export const MAPPING_VERSION = "1.0.0";
export const REQUIRED_MAPPING_TARGETS = Object.freeze(["Target"]);

/** @param {unknown} value */
function text(value) { return String(value ?? "").trim(); }

/** @param {string} target @param {unknown[]} samples */
function sampleScore(target, samples) {
  const values = samples.map((/** @param {unknown} value */ value) => text(value)).filter(Boolean);
  if (values.length === 0) return { score: 0, explanation: "没有可用样例" };
  if (["Latitude", "Longitude"].includes(target) && values.every((value) => Number.isFinite(Number(value)))) return { score: 0.2, explanation: "样例均为数字坐标" };
  if (target === "Date" && values.some((value) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/u.test(value))) return { score: 0.2, explanation: "样例符合日期格式" };
  if (target === "ImageURLs" && values.some((/** @type {string} */ value) => /^https?:\/\//iu.test(value))) return { score: 0.2, explanation: "样例包含图片 URL" };
  return { score: 0, explanation: "样例未提供额外证据" };
}

/** @param {{sourceColumns: readonly string[], sampleRows?: Record<string, unknown>[]}} input */
export function suggestMappings({ sourceColumns, sampleRows = [] }) {
  return sourceColumns.map((source) => {
    const direct = canonicalColumn(source);
    const samples = sampleRows.map((row) => row[source]).filter((value) => value !== undefined);
    const candidates = STANDARD_COLUMNS.map((target) => {
      const sample = sampleScore(target, samples);
      const aliasScore = direct === target ? 1 : target.toLocaleLowerCase("en-US") === source.trim().toLocaleLowerCase("en-US") ? 0.95 : 0;
      return {
        target,
        score: Math.min(1, aliasScore + sample.score),
        explanation: aliasScore > 0 ? `表头别名匹配 ${target}；${sample.explanation}` : sample.explanation,
      };
    }).filter(({ score }) => score > 0).sort((left, right) => right.score - left.score || left.target.localeCompare(right.target));
    return { source, candidates };
  });
}

/** @param {Record<string, string | null | undefined>} mapping */
export function canonicalizeMapping(mapping) {
  return Object.fromEntries(Object.entries(mapping)
    .filter(([, target]) => typeof target === "string" && target.length > 0)
    .sort(([left], [right]) => left.localeCompare(right)));
}

/** @param {Record<string, string | null | undefined>} mapping */
export function mappingContractHash(mapping) {
  return stableHash({ version: MAPPING_VERSION, mapping: canonicalizeMapping(mapping) });
}

/** @param {{mapping: Record<string, string | null | undefined>, sourceColumns: readonly string[], requiredTargets?: readonly string[], sheetNames?: readonly string[]}} input */
export function validateMapping({ mapping, sourceColumns, requiredTargets = REQUIRED_MAPPING_TARGETS, sheetNames = [] }) {
  const canonical = canonicalizeMapping(mapping);
  const issues = [];
  const targets = Object.entries(canonical);
  const targetSources = new Map();
  for (const [source, target] of targets) {
    if (!sourceColumns.includes(source)) issues.push({ code: "SOURCE_COLUMN_UNKNOWN", source, target, message: "源列不存在或已被重命名" });
    const previous = targetSources.get(target);
    if (previous) issues.push({ code: "TARGET_DUPLICATE", source, target, message: `目标字段已映射自 ${previous}` });
    else targetSources.set(target, source);
  }
  for (const target of requiredTargets) {
    if (!targetSources.has(target)) issues.push({ code: "TARGET_REQUIRED", target, message: "缺少必填目标字段" });
  }
  if (sheetNames.length > 1) issues.push({ code: "MULTI_SHEET_REVIEW_REQUIRED", message: "多 sheet 映射需要逐 sheet 确认" });
  return { valid: issues.length === 0, mapping: canonical, issues, hash: mappingContractHash(canonical) };
}
