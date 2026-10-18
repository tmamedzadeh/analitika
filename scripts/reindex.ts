import { and, asc, count, eq, isNull, ne, or } from "drizzle-orm";
import { createGeminiProviders } from "../src/server/ai/gemini";
import {
  GeminiRequestBudget,
  getGeminiQuotaKey,
  isGeminiQuotaError,
} from "../src/server/ai/gemini-gateway";
import { closeDb, getDb } from "../src/server/db";
import { chunks, documents } from "../src/server/db/schema";

const BATCH_SIZE = 20;
const MODEL = process.env.GEMINI_EMBED_MODEL?.trim();
const providerFlag = process.argv.find((arg) => arg.startsWith("--provider="))?.split("=")[1];
if (providerFlag && providerFlag !== "gemini")
  throw new Error("Only --provider=gemini is supported in this build.");
if (!MODEL) throw new Error("GEMINI_EMBED_MODEL is required.");

const db = getDb();
const provider = createGeminiProviders().embeddings;
const budget = new GeminiRequestBudget(50_000);
const needsReindex = or(ne(chunks.embeddingModel, MODEL), isNull(chunks.embedding));
try {
  const [countRow] = await db.select({ total: count() }).from(chunks).where(needsReindex);
  const total = Number(countRow?.total ?? 0);
  let completed = 0;
  console.log("Embedding reindex started: chunks=" + total + ", batch=" + BATCH_SIZE + ".");
  while (true) {
    const rows = await db
      .select({
        id: chunks.id,
        text: chunks.text,
        sectionTitle: chunks.sectionTitle,
        title: documents.title,
        embeddingModel: chunks.embeddingModel,
      })
      .from(chunks)
      .innerJoin(documents, eq(chunks.documentId, documents.id))
      .where(needsReindex)
      .orderBy(asc(chunks.id))
      .limit(BATCH_SIZE);
    if (!rows.length) break;
    const input = rows.map((row) =>
      (row.title + " / " + row.sectionTitle + "\n" + row.text).trim(),
    );
    const vectors = await provider.embedDocuments(input, { requestBudget: budget });
    if (
      vectors.length !== rows.length ||
      vectors.some(
        (vector) => vector.length !== 768 || vector.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new Error("Gemini did not return valid 768-dimensional vectors.");
    }
    await db.transaction(async (transaction) => {
      for (const [index, row] of rows.entries()) {
        await transaction
          .update(chunks)
          .set({ embedding: vectors[index]!, embeddingModel: MODEL })
          .where(and(eq(chunks.id, row.id), eq(chunks.embeddingModel, row.embeddingModel)));
      }
    });
    completed += rows.length;
    console.log(
      "Reindex progress: " +
        Math.min(completed, total) +
        "/" +
        total +
        "; Gemini API calls=" +
        budget.calls +
        ".",
    );
  }
  console.log(
    "Reindex complete: updated=" + completed + "; Gemini API calls=" + budget.calls + ".",
  );
} catch (error) {
  const quota = getGeminiQuotaKey(error);
  console.error(
    quota && isGeminiQuotaError(error)
      ? "Gemini quota exhausted for " + quota + ". Progress is saved; rerun to resume."
      : "Reindex stopped. Progress is saved by embedding_model; rerun the same command to resume.",
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
