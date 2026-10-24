import type { ImageMetadata } from "@/server/storage/image-metadata";
import { sql } from "drizzle-orm";
import type { RichDocument } from "@/lib/rich-text";
import {
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const emptyUuidArray = sql.raw("'{}'::uuid[]");
const emptyJsonObject = sql.raw("'{}'::jsonb");
const tsvectorColumn = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

export const documentStatus = pgEnum("document_status", [
  "queued",
  "processing",
  "ready",
  "failed",
]);
export const userRole = pgEnum("user_role", ["admin", "user"]);

export const appUsers = pgTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull().default("user"),
    clearance: text("clearance").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("app_users_username_unique_idx").on(table.username),
    index("app_users_role_active_idx").on(table.role, table.active),
    check(
      "app_users_username_check",
      sql.raw("username = lower(btrim(username)) AND char_length(username) BETWEEN 1 AND 50"),
    ),
    check(
      "app_users_clearance_check",
      sql.raw("clearance IN ('open', 'secret', 'top_secret', 'special')"),
    ),
  ],
).enableRLS();

export const appSessions = pgTable(
  "app_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("app_sessions_token_hash_unique_idx").on(table.tokenHash),
    index("app_sessions_user_idx").on(table.userId),
  ],
).enableRLS();

export const authLoginAttempts = pgTable(
  "auth_login_attempts",
  {
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [
    index("auth_login_attempts_window_idx").on(table.windowStart),
    check("auth_login_attempts_nonnegative_check", sql.raw("attempts >= 0")),
  ],
).enableRLS();

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    bodyRich: jsonb("body_rich").$type<RichDocument>().notNull(),
    department: text("department"),
    direction: text("direction"),
    docDate: date("doc_date"),
    language: text("language").notNull().default("az"),
    classification: text("classification").notNull().default("open"),
    sourceReliability: char("source_reliability", { length: 1 }),
    infoCredibility: smallint("info_credibility"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    status: documentStatus("status").notNull().default("queued"),
    chunkCount: integer("chunk_count").notNull().default(0),
    step: text("step").notNull().default("queued"),
    progress: jsonb("progress").notNull().default(emptyJsonObject),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("documents_status_created_idx").on(table.status, table.createdAt),
    check(
      "documents_rich_projection_check",
      sql.raw(
        "body = public.rich_text_plain(body_rich) AND jsonb_typeof(body_rich) = 'object' AND body_rich->>'type' = 'doc' AND octet_length(body_rich::text) <= 4000000",
      ),
    ),
    index("documents_doc_date_idx").on(table.docDate),
    index("documents_department_idx").on(table.department),
    index("documents_direction_idx").on(table.direction),
    check(
      "documents_department_check",
      sql.raw("department IS NULL OR department IN ('d1', 'd2', 'd3', 'd4', 'd5')"),
    ),
    check(
      "documents_direction_check",
      sql.raw(
        "direction IS NULL OR direction IN ('HUMINT', 'OSINT', 'IMINT', 'SIGINT', 'CYBINT', 'GEOINT', 'MASINT', 'TECHINT', 'FININT', 'TACINT_CI')",
      ),
    ),
    check("documents_chunk_count_nonnegative", sql.raw("chunk_count >= 0")),
    check(
      "documents_classification_check",
      sql.raw("classification IN ('open', 'secret', 'top_secret', 'special')"),
    ),
    check(
      "documents_source_reliability_check",
      sql.raw("source_reliability IS NULL OR source_reliability IN ('A', 'B', 'C', 'D', 'E')"),
    ),
    check(
      "documents_info_credibility_check",
      sql.raw("info_credibility IS NULL OR info_credibility BETWEEN 1 AND 5"),
    ),
  ],
).enableRLS();

export const dailyBriefs = pgTable(
  "daily_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    briefDate: date("brief_date").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    body: text("body").notNull(),
    bodyRich: jsonb("body_rich").$type<RichDocument>().notNull(),
    status: text("status").notNull().default("published"),
    authorId: text("author_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").references(() => appUsers.id, { onDelete: "set null" }),
    indexStatus: text("index_status").notNull().default("none"),
    indexProgress: jsonb("index_progress").notNull().default(emptyJsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    index("daily_briefs_status_date_idx").on(table.status, table.briefDate),
    check(
      "daily_briefs_rich_projection_check",
      sql.raw(
        "body = public.rich_text_plain(body_rich) AND jsonb_typeof(body_rich) = 'object' AND body_rich->>'type' = 'doc' AND octet_length(body_rich::text) <= 4000000",
      ),
    ),
    index("daily_briefs_title_trgm_idx").using("gin", table.title.op("gin_trgm_ops")),
    index("daily_briefs_body_trgm_idx").using("gin", table.body.op("gin_trgm_ops")),
    index("daily_briefs_search_gin_idx").using(
      "gin",
      sql`to_tsvector('simple'::regconfig, lower(translate(normalize(${table.title} || ' || ' || ${table.body}, NFC), 'ƏİIŞÇĞÖÜ', 'əiışçğöü')))`,
    ),
    check("daily_briefs_body_length_check", sql.raw("char_length(body) <= 200000")),
    check("daily_briefs_summary_length_check", sql.raw("char_length(summary) <= 400")),
    check("daily_briefs_status_check", sql.raw("status = 'published'")),
    check(
      "daily_briefs_index_status_check",
      sql.raw("index_status IN ('none', 'queued', 'processing', 'ready', 'failed')"),
    ),
  ],
).enableRLS();

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    briefId: uuid("brief_id").references(() => dailyBriefs.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    sectionTitle: text("section_title").notNull().default(""),
    text: text("text").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    isTable: boolean("is_table").notNull().default(false),
    tsv: tsvectorColumn("tsv").generatedAlwaysAs(sql.raw("to_tsvector('simple'::regconfig, text)")),
    embedding: vector("embedding", { dimensions: 768 }),
    embeddingModel: text("embedding_model").notNull(),
  },
  (table) => [
    unique("chunks_document_ord_unique").on(table.documentId, table.ord),
    unique("chunks_brief_ord_unique").on(table.briefId, table.ord),
    index("chunks_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    index("chunks_tsv_gin_idx").using("gin", table.tsv),
    index("chunks_text_trgm_gin_idx").using("gin", table.text.op("gin_trgm_ops")),
    index("chunks_document_idx").on(table.documentId),
    index("chunks_brief_idx").on(table.briefId),
    check("chunks_char_range_check", sql.raw("char_start <= char_end")),
    check(
      "chunks_source_check",
      sql.raw(
        "(document_id IS NOT NULL AND brief_id IS NULL) OR (document_id IS NULL AND brief_id IS NOT NULL)",
      ),
    ),
  ],
).enableRLS();

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    imageMetadata: jsonb("image_metadata").$type<ImageMetadata>(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    caption: text("caption"),
  },
  (table) => [
    index("attachments_document_idx").on(table.documentId),
    check("attachments_size_nonnegative", sql.raw("size >= 0")),
  ],
).enableRLS();

export const briefAttachments = pgTable(
  "brief_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    briefId: uuid("brief_id")
      .notNull()
      .references(() => dailyBriefs.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    imageMetadata: jsonb("image_metadata").$type<ImageMetadata>(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    ord: integer("ord").notNull(),
  },
  (table) => [
    unique("brief_attachments_brief_ord_unique").on(table.briefId, table.ord),
    index("brief_attachments_brief_idx").on(table.briefId),
    check(
      "brief_attachments_mime_check",
      sql.raw("mime IN ('image/jpeg', 'image/png', 'image/webp')"),
    ),
    check("brief_attachments_size_check", sql.raw("size > 0 AND size <= 10485760")),
    check("brief_attachments_ord_check", sql.raw("ord >= 0 AND ord < 10")),
  ],
).enableRLS();

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    index("rate_limits_window_start_idx").on(table.windowStart),
    check("rate_limits_count_nonnegative", sql.raw("count >= 0")),
  ],
).enableRLS();

export const analyticsQueryStatus = pgEnum("analytics_query_status", [
  "running",
  "done",
  "incomplete",
  "failed",
  "cancelled",
]);

export const analyticsQueries = pgTable(
  "analytics_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdBy: text("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    filters: jsonb("filters").notNull(),
    status: analyticsQueryStatus("status").notNull().default("running"),
    answer: text("answer"),
    sources: jsonb("sources").notNull().default(emptyJsonObject),
    maxClassification: text("max_classification").notNull().default("open"),
    model: text("model"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("analytics_queries_created_user_idx").on(table.createdBy, table.createdAt.desc()),
    index("analytics_queries_created_at_idx").on(table.createdAt),
  ],
).enableRLS();

export const queryLogs = pgTable("query_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  module: text("module").notNull(),
  query: text("query").notNull(),
  filters: jsonb("filters").notNull().default(emptyJsonObject),
  chunkIds: uuid("chunk_ids").array().notNull().default(emptyUuidArray),
  answer: text("answer").notNull(),
  model: text("model").notNull(),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const evalSets = pgTable("eval_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const evalQuestions = pgTable(
  "eval_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evalSetId: uuid("eval_set_id")
      .notNull()
      .references(() => evalSets.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    expectedAnswer: text("expected_answer"),
    expectedChunkIds: uuid("expected_chunk_ids").array().notNull().default(emptyUuidArray),
  },
  (table) => [index("eval_questions_set_idx").on(table.evalSetId)],
).enableRLS();

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evalSetId: uuid("eval_set_id")
      .notNull()
      .references(() => evalSets.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("eval_runs_set_idx").on(table.evalSetId)],
).enableRLS();

export const evalResults = pgTable(
  "eval_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => evalQuestions.id, { onDelete: "cascade" }),
    answer: text("answer"),
    score: real("score"),
    details: jsonb("details").notNull().default(emptyJsonObject),
  },
  (table) => [unique("eval_results_run_question_unique").on(table.runId, table.questionId)],
).enableRLS();
