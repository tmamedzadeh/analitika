/** Read-only rollout check. Does not migrate, reindex, convert images or expose content. */
import postgres from "postgres";
const url = process.env["DATABASE_URL_MIGRATE"] ?? process.env["DATABASE_URL"];
if (!url) throw new Error("Database connection is not configured.");
const client = postgres(url, { prepare: false, max: 1, connect_timeout: 10, onnotice: () => {} });
try {
  const result = await client.begin("read only", async (sql) => {
    await sql`set local statement_timeout = '10s'`;
    const [counts] =
      await sql`select count(*)::int as total, count(*) filter (where classification is distinct from 'open')::int as non_open from public.daily_briefs`;
    const [ratings] =
      await sql`select count(*) filter (where source_reliability = 'F')::int as source_f, count(*) filter (where info_credibility = 6)::int as info_6 from public.documents`;
    const policies =
      await sql`select tablename, policyname, coalesce(qual, '') ilike '%classification%' or coalesce(with_check, '') ilike '%classification%' as uses_classification from pg_policies where schemaname = 'public' and tablename in ('daily_briefs', 'brief_attachments', 'chunks')`;
    return { counts, ratings, policies };
  });
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2));
  if (result.counts?.["non_open"] !== 0) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      status: "unavailable",
      type: error instanceof Error ? error.name : "unknown",
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
