// Synthetic browser-only services. No server clients, credentials or external requests.
import { getBakuDate } from "../../src/lib/briefs";
import { plainTextDocument, projectRichText } from "../../src/lib/rich-text";
import { directionIds } from "../../src/lib/directions";
export const parentId = "00000000-0000-4000-8000-000000000001";
export const chunkId = "00000000-0000-4000-8000-000000000002";
const bodyRich = plainTextDocument(
  "Regional iqtisadi əlaqələr üzrə məlumat\n\nMənbələr regionda müşahidə olunan hadisələrin əsas istiqamətlərini qeyd edir. Bu hissə seçilmiş fraqment kimi göstərilir.\n\nTəhlildə mənbələrin etibarlılığı və məlumatın təsdiq dərəcəsi ayrıca nəzərə alınır.",
);
const body = projectRichText(bodyRich).text;
export const calls: Array<{ kind: string; data: unknown }> = [];
export async function getSettingsIdentity() {
  return { username: "Analitik", role: "user", clearance: "open" };
}
export async function listRecentAnalyticsQueries() {
  return [
    {
      id: "legacy",
      query: "Tarixçədə saxlanılmış sorğu",
      status: "done",
      createdAt: new Date().toISOString(),
      durationMs: 1000,
    },
  ];
}
export async function getAnalyticsQueryHistory() {
  return {
    id: "legacy",
    query: "Tarixçədə saxlanılmış sorğu",
    status: "done",
    answer: "Mənbədə regional hadisələr üzrə müşahidələr təqdim olunur [1].",
    sources: [],
    filters: {
      period: "7d",
      includeBriefs: false,
      directionIds: [...directionIds],
      minSourceReliability: "C",
      minInfoCredibility: "4",
    },
    createdAt: new Date().toISOString(),
    model: "synthetic",
    durationMs: 1000,
  };
}
export async function getBrief() {
  return {
    brief: {
      id: parentId,
      date: getBakuDate(),
      title: "İnformasiya bülleteni",
      summary: "Regional vəziyyətin qısa icmalı.",
      body,
      bodyRich,
      status: "published",
      indexStatus: "ready",
      indexProgress: { percent: 100, totalChunks: 1, completedChunks: 1 },
      photos: [],
      publishedAt: new Date().toISOString(),
      highlight: { chunkId, start: body.indexOf("Mənbələr"), end: body.indexOf("Təhlildə") - 2 },
    },
    canEdit: true,
    canDelete: false,
    previousId: null,
    nextId: null,
  };
}
export async function getBriefFormContext() {
  return {};
}
export async function deleteBrief() {
  throw new Error("Fixture cannot delete");
}
export async function getDocumentFormContext() {
  return { classifications: ["open"] };
}
export const createDocumentSchema = { safeParse: () => ({ success: false }) };
export async function prepareDocumentUploads() {
  throw new Error("Fixture cannot upload");
}
export async function saveDocument() {
  throw new Error("Fixture cannot save");
}
export async function deleteDocument() {
  throw new Error("Fixture cannot delete");
}
export async function getDocumentDetails() {
  return {
    id: parentId,
    title: "Regional iqtisadi əlaqələr və təhlükəsizlik üzrə məlumat",
    body,
    bodyRich,
    direction: "OSINT",
    classification: "secret",
    sourceReliability: null,
    infoCredibility: null,
    docDate: getBakuDate(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "ready",
    progress: {},
    step: "ready",
    canManage: false,
    photos: [],
    chunks: [
      {
        id: chunkId,
        sectionTitle: "Əsas məlumatlar",
        text: body,
        charStart: body.indexOf("Mənbələr"),
        charEnd: body.indexOf("Təhlildə") - 2,
        isTable: false,
      },
    ],
  };
}
export async function listBriefs({ data }: { data: unknown }) {
  calls.push({ kind: "brief", data });
  return {
    items: Array.from({ length: 6 }, (_, i) => ({
      id: `brief-${i}`,
      date: getBakuDate(),
      title: "İnformasiya bülleteni",
      summary:
        "Regionda iqtisadi və təhlükəsizlik vəziyyəti üzrə gündəlik məlumatlar. Mənbələrə əsaslanan xülasə və əsas hadisələrin icmalı. "
          .repeat(3)
          .slice(0, 400),
      status: "published",
      indexStatus: "ready",
      indexProgress: {},
      photoCount: 0,
    })),
    nextCursor: null,
  };
}
export async function listDocuments({ data }: { data: unknown }) {
  calls.push({ kind: "document", data });
  return {
    items: Array.from({ length: 6 }, (_, i) => ({
      id: `document-${i}`,
      title:
        i === 0
          ? "Regional iqtisadi əlaqələr və təhlükəsizlik üzrə uzun başlıqlı materialın icmalı"
          : "Regional vəziyyətin icmalı",
      docDate: getBakuDate(),
      createdAt: new Date().toISOString(),
      direction: "OSINT",
      classification: "open",
      status: "ready",
      preview:
        "Mənbələrin təqdim etdiyi məlumatlar və əsas müşahidələr. Təhlil üçün seçilmiş sənədin qısa məzmunu.",
      hasAttachments: false,
      canManage: false,
    })),
    nextCursor: null,
  };
}
export async function retryDocumentIndexing() {
  return {};
}
export async function discardBriefUploads() {
  return {};
}
export async function prepareBriefUploads() {
  throw new Error("Fixture cannot upload");
}
export async function saveBrief() {
  throw new Error("Fixture cannot save");
}
