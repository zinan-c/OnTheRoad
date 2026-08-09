"use client";

import { STANDARD_COLUMNS } from "@on-the-road/importer";
import { useState } from "react";

export type MappingRow = { readonly source: string; readonly target: string; readonly sample: string; readonly candidates: readonly { target: string; score: number; explanation: string }[] };

export function MappingEditor({ rows, errors, onChange, onSave }: { readonly rows: readonly MappingRow[]; readonly errors: readonly { code: string; message: string }[]; readonly onChange: (source: string, target: string) => void; readonly onSave: () => void | Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function save() { setSaving(true); try { await onSave(); } finally { setSaving(false); } }
  return <section aria-label="导入列映射" className="mappingEditor">
    <header><h2>确认列映射</h2><p>建议来自表头别名和示例值，可逐项修改。</p></header>
    {errors.length > 0 ? <div role="alert"><ul>{errors.map((error, index) => <li key={`${error.code}-${index}`}>{error.message}</li>)}</ul></div> : null}
    <table><thead><tr><th>源列</th><th>示例</th><th>目标字段</th><th>建议说明</th></tr></thead><tbody>{rows.map((row) => <tr key={row.source}><td>{row.source}</td><td>{row.sample || "无示例"}</td><td><select value={row.target} onChange={(event) => onChange(row.source, event.target.value)}><option value="">跳过</option>{STANDARD_COLUMNS.map((target) => <option key={target} value={target}>{target}</option>)}</select></td><td>{row.candidates.find(({ target }) => target === row.target)?.explanation ?? (row.target ? "手工映射" : "未映射")}</td></tr>)}</tbody></table>
    <button type="button" onClick={() => void save()} disabled={saving}>{saving ? "保存中" : "保存映射"}</button>
  </section>;
}
