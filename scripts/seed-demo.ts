import { inArray } from "drizzle-orm";

import { createGeminiProviders } from "../src/server/ai/gemini";
import { closeDb, getDb } from "../src/server/db";
import { chunks, documents } from "../src/server/db/schema";
import { chunkDocument } from "../src/server/ingest/chunker";

const demoTag = "demo-synthetic";
const demoDocuments = [
  {
    id: "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd0001",
    department: "d1",
    title: "Sınaq sənədi: Bakı parklarının saxlanması",
    body: "## Pilot nəticəsi\nBu sənəd yalnız demo və test üçündür. Şərti Bakı pilotunda parkların suvarma qrafiki səhər saatlarına keçirildikdən sonra bitkilərin sağlamlıq göstəricisi yaxşılaşıb. Nümunə ölçmədə su sərfi əvvəlki həftə ilə müqayisədə 12 faiz azalıb.",
    tags: ["demo-synthetic", "parklar", "su"],
    sourceReliability: "A" as const,
    infoCredibility: 1 as const,
  },
  {
    id: "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd0002",
    department: "d2",
    title: "Sınaq sənədi: məhəllələrdə su təchizatı",
    body: "## Pilot müşahidəsi\nBu sənəd yalnız demo və test üçündür. Şərti üç məhəllədə su təchizatı ilə bağlı müraciətlərin çoxu axşam təzyiqinin azalması barədə olub. İki həftəlik sınaqda boru təzyiqinin ölçülməsi nasazlıq nöqtələrinin tapılmasına kömək edib.",
    tags: ["demo-synthetic", "su", "infrastruktur"],
    sourceReliability: "B" as const,
    infoCredibility: 2 as const,
  },
  {
    id: "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd0003",
    department: "d3",
    title: "Sınaq sənədi: şərti suvarma layihəsi iddiası",
    body: "## Yoxlanılmamış iddia\nBu sənəd yalnız demo və test üçün uydurulub. Anonim məktubda yeni suvarma layihəsinin kənd təsərrüfatı məhsuldarlığını iki dəfə artırdığı iddia edilir. Məktubun müəllifi və ölçmə üsulu məlum deyil; iddia başqa mənbə ilə təsdiqlənməyib.",
    tags: ["demo-synthetic", "kənd təsərrüfatı", "su"],
    sourceReliability: "D" as const,
    infoCredibility: 5 as const,
  },
  {
    id: "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd0004",
    department: "d4",
    title: "Sınaq sənədi: avtobus marşrutunun sınağı",
    body: "## Nəqliyyat\nBu sənəd yalnız demo və test üçündür. Şərti mərkəz marşrutunda pik saatlarda əlavə avtobusun qoşulması gözləmə müddətini 18 dəqiqədən 11 dəqiqəyə endirib. Müşahidə yalnız beş iş günü aparılıb.\n\n## Cədvəl: marşrut göstəriciləri\n| Göstərici | Dəyər |\n|---|---|\n| Pik saat gözləmə — əvvəl | 18 dəqiqə |\n| Pik saat gözləmə — sınaq zamanı | 11 dəqiqə |\n| Müşahidə müddəti | 5 iş günü |",
    tags: ["demo-synthetic", "nəqliyyat"],
    sourceReliability: "C" as const,
    infoCredibility: 3 as const,
  },
  {
    id: "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd0005",
    department: "d1",
    title: "Sınaq sənədi: kənd təsərrüfatında suya qənaət",
    body: "## Sahə qeydi\nBu sənəd yalnız demo və test üçündür. Şərti təsərrüfatda damcı suvarma üsulu suyun birbaşa bitki kökünə çatdırılması üçün tətbiq olunub. Nümunə sahəsində su sərfi azalıb, lakin məhsul artımı barədə ölçmə aparılmayıb.",
    tags: ["demo-synthetic", "kənd təsərrüfatı", "su"],
    sourceReliability: "B" as const,
    infoCredibility: 4 as const,
  },
  {
    id: "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd0006",
    department: "d2",
    title: "Sınaq sənədi: kitabxana xidmətləri",
    body: "## Rəqəmsal xidmət\nBu sənəd yalnız demo və test üçündür. Şərti rayon kitabxanası elektron kataloq və onlayn sifariş formasını sınaqdan keçirib. Bir ay ərzində 40 istifadəçi kataloqa baxıb, 9 nəfər kitab sifariş edib.\n\n## Cədvəl: ilk ayın göstəriciləri\n| Göstərici | Say |\n|---|---:|\n| Kataloqa baxan istifadəçilər | 40 |\n| Kitab sifarişi verənlər | 9 |",
    tags: ["demo-synthetic", "kitabxana", "rəqəmsal xidmət"],
    sourceReliability: "F" as const,
    infoCredibility: 6 as const,
  },
] as const;

async function seedDemo(): Promise<void> {
  const db = getDb();
  const ids = demoDocuments.map((document) => document.id);
  if (process.argv.includes("--clean")) {
    await db.delete(documents).where(inArray(documents.id, ids));
    console.log("Synthetic demo documents and their chunks were deleted.");
    return;
  }

  const sourceChunks = demoDocuments.flatMap((document) =>
    chunkDocument(document.body, document.title).map((chunk) => ({ document, chunk })),
  );
  const vectors = await createGeminiProviders().embeddings.embedDocuments(
    sourceChunks.map(({ chunk }) => chunk.embeddingText),
    { maxAttempts: 1 },
  );
  const embeddingModel = createGeminiProviders().embeddings.model;
  if (
    vectors.length !== sourceChunks.length ||
    vectors.some(
      (vector) => vector.length !== 768 || vector.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new Error("Gemini embeddings must contain 768 finite dimensions.");
  }

  const today = new Date().toISOString().slice(0, 10);
  await db.transaction(async (transaction) => {
    await transaction.delete(documents).where(inArray(documents.id, ids));
    await transaction.insert(documents).values(
      demoDocuments.map((document) => ({
        id: document.id,
        title: document.title,
        body: document.body,
        department: document.department,
        docDate: today,
        tags: [...document.tags],
        sourceReliability: document.sourceReliability,
        infoCredibility: document.infoCredibility,
        status: "ready" as const,
        step: "ready",
        progress: { percent: 100, totalChunks: 1, completedChunks: 1 },
      })),
    );
    await transaction.insert(chunks).values(
      sourceChunks.map(({ document, chunk }, index) => ({
        documentId: document.id,
        ord: chunk.ord,
        sectionTitle: chunk.sectionTitle,
        text: chunk.text,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        isTable: chunk.isTable,
        embedding: vectors[index]!,
        embeddingModel,
      })),
    );
  });

  console.log(
    "Seeded " +
      demoDocuments.length +
      " synthetic Azerbaijani documents with tag '" +
      demoTag +
      "'. Run 'bun run db:seed:demo -- --clean' to delete them.",
  );
}

try {
  await seedDemo();
} catch (error) {
  console.error("Demo document seeding failed.", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
