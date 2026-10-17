import { createGeminiProviders } from "../src/server/ai/gemini";
import { GeminiRerankProvider } from "../src/server/ai/rerank";

const provider = new GeminiRerankProvider(createGeminiProviders().light);

try {
  const ids = await provider.rerank(
    "Hansı fraqmentdə sınaq marşrutunun pik saat gözləmə müddəti göstərilir?",
    [
      {
        id: "relevant-table",
        excerpt: "Pik saat gözləmə — əvvəl 18 dəqiqə; sınaq zamanı 11 dəqiqə.",
      },
      { id: "other-source", excerpt: "Elektron kataloqa 40 istifadəçi baxıb." },
    ],
    { timeoutMs: 4_000 },
  );
  if (ids.length !== 2 || ids[0] !== "relevant-table" || ids[1] !== "other-source") {
    throw new Error("Structured rerank returned an unexpected candidate order.");
  }
  console.log("Gemini LIGHT structured-JSON rerank smoke passed for synthetic candidates.");
} catch {
  console.error(
    "Gemini LIGHT structured-JSON rerank smoke failed; no prompt or response was printed.",
  );
  process.exitCode = 1;
}
