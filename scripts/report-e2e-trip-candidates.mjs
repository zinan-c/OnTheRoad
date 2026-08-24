import { mkdir, writeFile } from "node:fs/promises";
import pg from "../packages/database/node_modules/pg/esm/index.mjs";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
const outputPath = process.argv[2] ?? "docs/reports/e2e-trip-deletion-candidates.md";

if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  statement_timeout: 30_000,
  application_name: "on-the-road-e2e-candidate-report",
});

const candidatePredicate = [
  "t.name ~* '^E2E-[0-9]{3}'",
  "t.name ~* '^(C|D|E)[0-9]{2} '",
  "t.name ~* 'Playwright|真实|验证|layout inspect'",
  "t.name = 'Shanghai and Zhoushan'",
].join(" OR ");

try {
  const result = await pool.query(
    "SELECT "
      + "t.id, t.owner_id, t.name, t.status, t.created_at, t.updated_at, "
      + "CASE "
      + "WHEN t.name ~* '^E2E-[0-9]{3}' THEN 'name starts with E2E case id' "
      + "WHEN t.name ~* '^(C|D|E)[0-9]{2} ' THEN 'required-case fixture name' "
      + "WHEN t.name ~* 'Playwright|真实|验证|layout inspect' THEN 'product/regression fixture marker' "
      + "ELSE 'legacy browser fixture name; verify manually' END AS reason, "
      + "(SELECT count(*)::int FROM destination d WHERE d.trip_id = t.id) AS destinations, "
      + "(SELECT count(*)::int FROM trip_day d WHERE d.trip_id = t.id) AS trip_days, "
      + "(SELECT count(*)::int FROM itinerary_item i WHERE i.trip_id = t.id) AS itinerary_items, "
      + "(SELECT count(*)::int FROM location l WHERE l.trip_id = t.id) AS locations, "
      + "(SELECT count(*)::int FROM expense e WHERE e.trip_id = t.id) AS expenses, "
      + "(SELECT count(*)::int FROM attachment a WHERE a.trip_id = t.id) AS attachments, "
      + "(SELECT count(*)::int FROM route_segment r WHERE r.trip_id = t.id) AS route_segments, "
      + "(SELECT count(*)::int FROM trip_audit a WHERE a.trip_id = t.id) AS audit_rows, "
      + "(SELECT count(*)::int FROM trip_create_request r WHERE r.trip_id = t.id) AS create_requests "
      + "FROM trip t WHERE " + candidatePredicate + " ORDER BY t.created_at, t.id",
  );
  const excluded = await pool.query(
    "SELECT id, owner_id, name, status, created_at, updated_at FROM trip t WHERE NOT ("
      + candidatePredicate + ") ORDER BY created_at, id",
  );
  const byReason = new Map();
  for (const row of result.rows) byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
  const lines = [
    "# E2E 行程待删除清单（待确认）",
    "",
    "- 生成时间：" + new Date().toISOString(),
    "- 数据库查询：只读 SELECT；本报告生成过程没有执行 DELETE、UPDATE、TRUNCATE 或 DDL。",
    "- 疑似 E2E 行程：**" + result.rows.length + "** 条。",
    "- 未命中规则的行程：**" + excluded.rows.length + "** 条，均应保留并由人工复核。",
    "",
    "## 判定规则",
    "",
    "- 名称以 E2E-### 开头：直接命中产品 E2E case 命名。",
    "- 名称以 C##、D##、E## 开头：命中 required-case/回归 fixture 命名。",
    "- 名称包含 Playwright、真实、验证或 layout inspect：命中现有测试 fixture 标记。",
    "- Shanghai and Zhoushan：旧浏览器创建流程默认名称，列入候选但必须人工确认。",
    "",
    "## 候选统计",
    "",
    "| 判定依据 | 行程数 |",
    "| --- | ---: |",
    ...[...byReason.entries()].map(([reason, count]) => "| " + reason + " | " + count + " |"),
    "",
    "## 需要保留并复核的非候选行程",
    "",
    "| Trip ID | Owner | 名称 | 状态 | 创建时间 | 更新时间 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...excluded.rows.map((row) => "| " + [row.id, row.owner_id, escapeCell(row.name), row.status, row.created_at.toISOString(), row.updated_at.toISOString()].join(" | ") + " |"),
    "",
    "## 疑似 E2E 行程明细",
    "",
    "| Trip ID | 名称 | Owner | 状态 | 创建时间 | 更新时间 | 判定依据 | Dest | Days | Items | Locations | Expenses | Attachments | Routes | Audit | Create req |",
    "| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...result.rows.map((row) => "| " + [
      row.id, escapeCell(row.name), row.owner_id, row.status,
      row.created_at.toISOString(), row.updated_at.toISOString(), row.reason,
      row.destinations, row.trip_days, row.itinerary_items, row.locations,
      row.expenses, row.attachments, row.route_segments, row.audit_rows, row.create_requests,
    ].join(" | ") + " |"),
    "",
    "## 删除前置条件",
    "",
    "1. 由产品负责人确认候选列表，尤其是 Shanghai and Zhoushan 两条及任何需要保留的测试样例。",
    "2. 先做数据库备份并记录备份校验值。",
    "3. 只允许在明确的维护窗口内执行事务化删除。",
    "4. 删除后复查 Trip 关联表和对象存储，确认没有孤儿数据。",
    "5. 本报告生成后本任务不会自动执行删除。",
    "",
  ];
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, lines.join("\n"), "utf8");
  console.log(JSON.stringify({
    outputPath,
    candidates: result.rows.length,
    excluded: excluded.rows.length,
    byReason: Object.fromEntries(byReason),
  }));
} finally {
  await pool.end();
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}
