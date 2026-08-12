import "dotenv/config";
import { sql as raw } from "drizzle-orm";
import { db, sql } from "@/db/client";

/** Ad-hoc diagnostic queries. Not part of the test suite. */
async function main(): Promise<void> {
  const rows = await db.execute<Record<string, unknown>>(raw`
    SELECT
      count(*)::int                                    AS answered,
      count(*) FILTER (WHERE correct)::int             AS correct,
      count(*) FILTER (WHERE correct IS NULL)::int     AS null_correct,
      round(avg(served_difficulty)::numeric, 3)        AS mean_served_difficulty
    FROM attempt_items`);
  console.log("attempt_items:", JSON.stringify([...rows][0]));

  const q = await db.execute<Record<string, unknown>>(raw`
    SELECT count(*)::int AS items,
           round(avg(difficulty_elo)::numeric,3) AS mean_elo,
           round(min(difficulty_elo)::numeric,3) AS min_elo,
           round(max(difficulty_elo)::numeric,3) AS max_elo,
           sum(times_served)::int AS served,
           sum(times_correct)::int AS times_correct
    FROM questions WHERE status='approved'`);
  console.log("approved questions:", JSON.stringify([...q][0]));

  const m = await db.execute<Record<string, unknown>>(raw`
    SELECT round(avg(p_known)::numeric,3) AS mean_topic_mastery,
           count(*)::int AS rows
    FROM topic_mastery`);
  console.log("topic_mastery:", JSON.stringify([...m][0]));

  const recent = await db.execute<Record<string, unknown>>(raw`
    SELECT max(answered_at) AS latest,
           min(answered_at) AS earliest,
           (now()::date - max(answered_at)::date) AS days_since_latest
    FROM attempt_items`);
  console.log("activity window:", JSON.stringify([...recent][0]));
}

main()
  .then(async () => sql.end())
  .catch(async (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    await sql.end();
    process.exitCode = 1;
  });
