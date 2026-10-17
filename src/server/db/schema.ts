import { sql } from "drizzle-orm";
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
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const emptyTextArray = sql.raw("'{}'::text[]");
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
export const osintRunStatus = pgEnum("osint_run_status", ["queued", "running", "done", "failed"]);
export const osintSourceType = pgEnum("osint_source_type", [
  "media",
  "official",
  "think_tank",
  "other",
]);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    department: text("department"),
    docDate: date("doc_date"),
    tags: text("tags").array().notNull().default(emptyTextArray),
    language: text("language").notNull().default("az"),
    classification: text("classification").notNull().default("open"),
    sourceReliability: char("source_reliability", { length: 1 }).notNull().default("F"),
    infoCredibility: smallint("info_credibility").notNull().default(6),
    ownerId: text("owner_id").notNull().default("admin"),
    status: documentStatus("status").notNull().default("queued"),
    step: text("step").notNull().default("queued"),
    progress: jsonb("progress").notNull().default(emptyJsonObject),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("documents_status_created_idx").on(table.status, table.createdAt),
    index("documents_doc_date_idx").on(table.docDate),
    index("documents_department_idx").on(table.department),
    check(
      "documents_department_check",
      sql.raw("department IS NULL OR department IN ('d1', 'd2', 'd3', 'd4', 'd5')"),
    ),
    check(
      "documents_classification_check",
      sql.raw("classification IN ('open', 'secret', 'top_secret', 'special')"),
    ),
    check(
      "documents_source_reliability_check",
      sql.raw("source_reliability IN ('A', 'B', 'C', 'D', 'E', 'F')"),
    ),
    check("documents_info_credibility_check", sql.raw("info_credibility BETWEEN 1 AND 6")),
  ],
);

export const documentAcl = pgTable(
  "document_acl",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.userId] })],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
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
    index("chunks_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    index("chunks_tsv_gin_idx").using("gin", table.tsv),
    index("chunks_text_trgm_gin_idx").using("gin", table.text.op("gin_trgm_ops")),
    index("chunks_document_idx").on(table.documentId),
    check("chunks_char_range_check", sql.raw("char_start <= char_end")),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    caption: text("caption"),
  },
  (table) => [
    index("attachments_document_idx").on(table.documentId),
    check("attachments_size_nonnegative", sql.raw("size >= 0")),
  ],
);

export const infoRequests = pgTable(
  "info_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    department: text("department").notNull(),
    requestDate: date("request_date").notNull(),
    urgency: text("urgency").notNull(),
    purpose: text("purpose").notNull(),
    details: text("details").notNull(),
    sourceReliability: char("source_reliability", { length: 1 }).notNull().default("F"),
    infoCredibility: smallint("info_credibility").notNull().default(6),
    note: text("note"),
    status: text("status").notNull().default("new"),
    answerDocumentId: uuid("answer_document_id").references(() => documents.id),
    requesterId: text("requester_id").notNull().default("admin"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("info_requests_created_idx").on(table.createdAt),
    check("info_requests_urgency_check", sql.raw("urgency IN ('normal', 'urgent', 'critical')")),
    check(
      "info_requests_source_reliability_check",
      sql.raw("source_reliability IN ('A', 'B', 'C', 'D', 'E', 'F')"),
    ),
    check("info_requests_info_credibility_check", sql.raw("info_credibility BETWEEN 1 AND 6")),
    check(
      "info_requests_status_check",
      sql.raw("status IN ('new', 'in_progress', 'answered', 'rejected')"),
    ),
    check(
      "info_requests_department_check",
      sql.raw("department IN ('d1', 'd2', 'd3', 'd4', 'd5')"),
    ),
  ],
);

export const requestAttachments = pgTable(
  "request_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => infoRequests.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
  },
  (table) => [
    index("request_attachments_request_idx").on(table.requestId),
    check("request_attachments_size_nonnegative", sql.raw("size >= 0")),
  ],
);

export const osintRuns = pgTable(
  "osint_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    query: text("query").notNull(),
    languages: text("languages").array().notNull().default(emptyTextArray),
    period: text("period").notNull(),
    status: osintRunStatus("status").notNull().default("queued"),
    step: text("step").notNull().default("queued"),
    progress: jsonb("progress").notNull().default(emptyJsonObject),
    summary: text("summary"),
    error: text("error"),
    cacheKey: text("cache_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("osint_runs_created_idx").on(table.createdAt)],
);

export const osintSources = pgTable(
  "osint_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => osintRuns.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    language: text("language").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    sourceType: osintSourceType("source_type").notNull().default("other"),
    summary: text("summary").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    fetched: boolean("fetched").notNull().default(false),
  },
  (table) => [
    unique("osint_sources_run_n_unique").on(table.runId, table.n),
    index("osint_sources_run_idx").on(table.runId),
  ],
);

export const osintCache = pgTable(
  "osint_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => osintRuns.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("osint_cache_expires_idx").on(table.expiresAt)],
);

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
});

export const evalSets = pgTable("eval_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
);

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
);

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
);
