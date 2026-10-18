import { inArray } from "drizzle-orm";

import { formatBriefEmbeddingText, getBakuDate } from "../src/lib/briefs";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { closeDb, getDb } from "../src/server/db";
import {
  attachments,
  briefAttachments,
  chunks,
  dailyBriefs,
  documents,
} from "../src/server/db/schema";
import { chunkDocument } from "../src/server/ingest/chunker";
import { closeStorage, getStorage } from "../src/server/storage/s3";

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

const demoBriefIds = [
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd1001",
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd1002",
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd1003",
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd1004",
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd1005",
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd1006",
] as const;

const briefTemplates = [
  {
    title: "Demo brifi: şəhər nəqliyyatı üzrə gündəlik müşahidə",
    body: "## Nəqliyyat\nBu mətn yalnız sintetik demo və test məlumatıdır. Şərti marşrutda pik saatlarda gözləmə vaxtı əvvəlki ölçmə ilə müqayisədə azalıb. Müşahidə müddəti qısa olduğundan nəticə bütün şəhərə şamil edilmir.\n\n## Ölçmə\n| Göstərici | Əvvəl | Sınaq |\n|---|---:|---:|\n| Gözləmə vaxtı | 18 dəqiqə | 11 dəqiqə |\n| Ölçmə günləri | 5 | 5 |",
    status: "published" as const,
    photoCount: 2,
  },
  {
    title: "Demo brifi: su təchizatı müraciətlərinin xülasəsi",
    body: "## Əsas müşahidə\nYalnız demo üçün yaradılmış şərti məlumatda müraciətlərin çoxu axşam saatlarında təzyiqin azalması ilə bağlıdır. Ölçmələr üç məhəllənin iki həftəlik müşahidəsinə əsaslanır.\n\n## Növbəti addım\nNasazlıq nöqtələrini müəyyən etmək üçün ölçmə cədvəlinin davam etdirilməsi təklif olunur. Bu nəticələr real infrastruktur barədə məlumat deyil.",
    status: "published" as const,
    photoCount: 0,
  },
  {
    title: "Demo brifi: rayon kitabxanasının rəqəmsal xidməti",
    body: "## İlk ay\nSintetik pilot məlumatına əsasən elektron kataloqdan 40 nəfər istifadə edib, 9 nəfər kitab sifariş edib.\n\n## Cədvəl: şərti göstəricilər\n| Göstərici | Say |\n|---|---:|\n| Kataloqa baxış | 40 |\n| Sifariş | 9 |",
    status: "published" as const,
    photoCount: 1,
  },
  {
    title: "Demo brifi: parkların suvarma qrafiki",
    body: "## Pilot\nBu sintetik brifdə suvarmanın səhər saatlarına keçirildiyi şərti sınaq təsvir olunur. Nümunə sahəsində su sərfi əvvəlki həftəyə nəzərən azalıb.\n\n## Məhdudiyyət\nÖlçmə yalnız bir həftə aparılıb və digər mövsümlərə aid nəticə vermir.",
    status: "published" as const,
    photoCount: 2,
  },
  {
    title: "Demo brifi: xidmət müraciətlərinin emalı",
    body: "## Gündəlik xülasə\nTəlim üçün uydurulmuş ssenaridə müraciətlər mövzu üzrə qruplaşdırılıb və cavab müddəti həftəlik müqayisə edilib. Nümunə nəticələr yalnız proqramın nümayişi üçündür.\n\nİlkin qruplaşdırma ümumi sualların bir neçə mövzuda cəmləndiyini göstərir.",
    status: "published" as const,
    photoCount: 0,
  },
  {
    title: "Demo qaralama: həftəlik müşahidələr",
    body: "## Qaralama\nBu sintetik qaralama axtarış indeksinə daxil edilməməlidir. Mətn yekun redaktədən sonra dərc olunacaq.",
    status: "draft" as const,
    photoCount: 1,
  },
] as const;

function dateDaysAgo(today: string, daysAgo: number): string {
  const date = new Date(`${today}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function demoBriefsFor(today: string) {
  return briefTemplates.map((brief, index) => ({
    id: demoBriefIds[index]!,
    date: dateDaysAgo(today, index),
    ...brief,
  }));
}

const demoPng = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/uXcAAAAASUVORK5CYII=",
    "base64",
  ),
);

async function seedDemo(): Promise<void> {
  const db = getDb();
  const ids = demoDocuments.map((document) => document.id);
  const today = getBakuDate();
  const demoBriefs = demoBriefsFor(today);
  const briefIds = demoBriefs.map((brief) => brief.id);
  const oldBriefFiles = await db
    .select({ storageKey: briefAttachments.storageKey })
    .from(briefAttachments)
    .where(inArray(briefAttachments.briefId, briefIds));
  const oldDocumentFiles = await db
    .select({ storageKey: attachments.storageKey })
    .from(attachments)
    .where(inArray(attachments.documentId, ids));

  if (process.argv.includes("--clean")) {
    if (oldBriefFiles.length > 0 || oldDocumentFiles.length > 0) {
      const storage = getStorage();
      await Promise.all(
        [...oldBriefFiles, ...oldDocumentFiles].map((file) => storage.delete(file.storageKey)),
      );
    }
    await db.delete(dailyBriefs).where(inArray(dailyBriefs.id, briefIds));
    await db.delete(documents).where(inArray(documents.id, ids));
    console.log("Synthetic demo documents, briefs, chunks, and brief photos were deleted.");
    return;
  }

  const documentSourceChunks = demoDocuments.flatMap((document) =>
    chunkDocument(document.body, document.title).map((chunk) => ({ document, chunk })),
  );
  const indexedBriefs = demoBriefs.filter((brief) => brief.status === "published");
  const briefSourceChunks = indexedBriefs.flatMap((brief) =>
    chunkDocument(brief.body, brief.title).map((chunk) => ({ brief, chunk })),
  );
  const embeddingProvider = createGeminiProviders().embeddings;
  const embeddingInputs = [
    ...documentSourceChunks.map(({ chunk }) => chunk.embeddingText),
    ...briefSourceChunks.map(({ brief, chunk }) =>
      formatBriefEmbeddingText(brief.title, brief.date, chunk.text),
    ),
  ];
  const vectors = await embeddingProvider.embedDocuments(embeddingInputs, { maxAttempts: 1 });
  const embeddingModel = embeddingProvider.model;
  if (
    vectors.length !== embeddingInputs.length ||
    vectors.some(
      (vector) => vector.length !== 768 || vector.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new Error("Gemini embeddings must contain 768 finite dimensions.");
  }

  const photoRows = demoBriefs.flatMap((brief) =>
    Array.from({ length: brief.photoCount }, (_, ord) => ({
      id: crypto.randomUUID(),
      briefId: brief.id,
      storageKey: `briefs/${brief.id}/demo-${ord + 1}.png`,
      name: `demo-foto-${ord + 1}.png`,
      mime: "image/png",
      size: demoPng.byteLength,
      ord,
    })),
  );
  const storage = getStorage();
  for (const photo of photoRows) {
    await storage.put({ key: photo.storageKey, body: demoPng, contentType: "image/png" });
  }

  const now = new Date();
  await db.transaction(async (transaction) => {
    await transaction.delete(dailyBriefs).where(inArray(dailyBriefs.id, briefIds));
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
    await transaction.insert(dailyBriefs).values(
      demoBriefs.map((brief) => {
        const totalChunks = briefSourceChunks.filter((entry) => entry.brief.id === brief.id).length;
        const published = brief.status === "published";
        return {
          id: brief.id,
          briefDate: brief.date,
          title: brief.title,
          body: brief.body,
          status: brief.status,
          authorId: "admin",
          indexStatus: published ? "ready" : "none",
          indexProgress: {
            percent: published ? 100 : 0,
            totalChunks,
            completedChunks: published ? totalChunks : 0,
          },
          publishedAt: published ? now : null,
          updatedAt: now,
        };
      }),
    );
    if (photoRows.length > 0) await transaction.insert(briefAttachments).values(photoRows);
    await transaction.insert(chunks).values([
      ...documentSourceChunks.map(({ document, chunk }, index) => ({
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
      ...briefSourceChunks.map(({ brief, chunk }, index) => ({
        documentId: null,
        briefId: brief.id,
        ord: chunk.ord,
        sectionTitle: chunk.sectionTitle,
        text: chunk.text,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        isTable: chunk.isTable,
        embedding: vectors[documentSourceChunks.length + index]!,
        embeddingModel,
      })),
    ]);
  });
  const retainedKeys = new Set(photoRows.map((photo) => photo.storageKey));
  await Promise.all(
    oldBriefFiles
      .filter((file) => !retainedKeys.has(file.storageKey))
      .map((file) => storage.delete(file.storageKey)),
  );
  await Promise.all(oldDocumentFiles.map((file) => storage.delete(file.storageKey)));

  console.log(
    `Seeded ${demoDocuments.length} synthetic documents and ${demoBriefs.length} synthetic briefs. Run 'bun run db:seed:demo -- --clean' to delete them.`,
  );
}

try {
  await seedDemo();
} catch (error) {
  console.error("Demo document seeding failed.", error);
  process.exitCode = 1;
} finally {
  closeStorage();
  await closeDb();
}
