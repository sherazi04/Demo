import "dotenv/config";
import { sql } from "@/db/client";

/** Row counts for every table, so empty sections are obvious. */
const rows = await sql<{ table_name: string }[]>`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name`;

const counts: Array<{ name: string; n: number }> = [];
for (const { table_name } of rows) {
  const [row] = await sql.unsafe(`SELECT count(*)::int AS n FROM "${table_name}"`);
  counts.push({ name: table_name, n: Number(row?.["n"] ?? 0) });
}

const empty = counts.filter((c) => c.n === 0);
const filled = counts.filter((c) => c.n > 0);

console.log("\nEMPTY:");
for (const c of empty) console.log(`  ${c.name}`);
console.log("\nPOPULATED:");
for (const c of filled) console.log(`  ${String(c.n).padStart(6)}  ${c.name}`);

const users = await sql`
  SELECT role, status, is_synthetic, count(*)::int AS n
  FROM users GROUP BY 1,2,3 ORDER BY 1,2`;
console.log("\nACCOUNTS:", JSON.stringify(users));

await sql.end();
