/** Read-only data-preservation receipt before/after staged migration. No content/credentials emitted. */
import postgres from "postgres";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const url = process.env["DATABASE_URL_MIGRATE"];
if (!url) throw new Error("Migration connection is required.");
const client = postgres(url, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });
const phase = process.argv[2];
if (!["before", "expand", "contract"].includes(phase ?? ""))
  throw new Error("Expected before/expand/contract phase.");
try {
  const receipt = await client.begin("isolation level repeatable read read only", async (sql) => {
    await sql`set local statement_timeout = '15s'`;
    const columns =
      await sql`select table_name, column_name, is_nullable, column_default from information_schema.columns where table_schema='public' and ((table_name='daily_briefs' and column_name='classification') or (table_name='documents' and column_name in ('source_reliability','info_credibility')) or (table_name in ('attachments','brief_attachments') and column_name='image_metadata')) order by table_name,column_name`;
    const hasClassification = columns.some((row) => row["table_name"] === "daily_briefs");
    const [briefs] = hasClassification
      ? await sql`select count(*)::int total, count(*) filter (where classification is distinct from 'open')::int non_open from daily_briefs`
      : await sql`select count(*)::int total from daily_briefs`;
    const [ratings] =
      await sql`select count(*) filter (where source_reliability='F')::int source_f, count(*) filter (where info_credibility=6)::int info_6, count(*) filter (where source_reliability is null)::int source_null, count(*) filter (where info_credibility is null)::int info_null from documents`;
    const digests: Record<string, unknown> = {};
    for (const table of [
      "documents",
      "daily_briefs",
      "chunks",
      "attachments",
      "brief_attachments",
      "analytics_queries",
    ]) {
      const exclusions =
        table === "documents"
          ? " - 'source_reliability' - 'info_credibility'"
          : table === "daily_briefs"
            ? " - 'classification'"
            : table.includes("attachments")
              ? " - 'image_metadata'"
              : "";
      const [row] = await sql.unsafe(
        `select count(*)::int count, md5(coalesce(string_agg(md5((to_jsonb(t)${exclusions})::text), '' order by id), '')) digest from public.${table} t`,
      );
      digests[table] = row;
    }
    const dependencies = hasClassification
      ? await sql`select pg_describe_object(d.classid,d.objid,d.objsubid) dependency, d.deptype from pg_depend d join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid where a.attrelid='public.daily_briefs'::regclass and a.attname='classification' order by 1`
      : [];
    const policies =
      await sql`select tablename,policyname,coalesce(qual,'') ilike '%classification%' or coalesce(with_check,'') ilike '%classification%' uses_classification from pg_policies where schemaname='public' and tablename in ('daily_briefs','brief_attachments','chunks')`;
    const rls =
      await sql`select relname,relrowsecurity from pg_class where oid in ('daily_briefs'::regclass,'documents'::regclass,'brief_attachments'::regclass,'attachments'::regclass,'chunks'::regclass,'analytics_queries'::regclass) order by relname`;
    const constraints =
      await sql`select conrelid::regclass::text table_name,conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid in ('daily_briefs'::regclass,'documents'::regclass) and conname in ('daily_briefs_classification_check','daily_briefs_open_only','documents_source_reliability_check','documents_info_credibility_check') order by conname`;
    const journal =
      await sql`select id,hash,created_at from drizzle.__drizzle_migrations order by created_at desc limit 3`;
    const [activity] =
      await sql`select (select count(*)::int from documents where status in ('queued','processing')) documents_pending, (select count(*)::int from daily_briefs where index_status in ('queued','processing')) briefs_pending, (select count(*)::int from analytics_queries where status='running') analytics_running`;
    return {
      phase,
      checkedAt: new Date().toISOString(),
      connectionFingerprint: createHash("sha256")
        .update(new URL(url).host)
        .digest("hex")
        .slice(0, 16),
      columns,
      briefs,
      ratings,
      digests,
      dependencies,
      policies,
      rls,
      constraints,
      journal,
      activity,
    };
  });
  await writeFile(
    `docs/release/ZIRVE_FINAL_UX_DB_${phase?.toUpperCase()}.json`,
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.briefs?.["non_open"] && receipt.briefs["non_open"] !== 0) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      type: error instanceof Error ? error.name : "unknown",
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
