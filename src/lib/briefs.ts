import { z } from "zod";

import { az } from "./i18n/az";

export const MAX_BRIEF_PHOTOS = 10;
export const MAX_BRIEF_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_BRIEF_BODY_LENGTH = 200_000;
export const BRIEF_PAGE_SIZE = 12;

export const briefStatuses = ["published"] as const;
export const briefIndexStatuses = ["none", "queued", "processing", "ready", "failed"] as const;

export type BriefStatus = (typeof briefStatuses)[number];
export type BriefIndexStatus = (typeof briefIndexStatuses)[number];
export type BriefIndexProgress = { percent: number; totalChunks: number; completedChunks: number };
export type BriefPhoto = { id: string; name: string; url: string };
export type Brief = {
  id: string;
  date: string;
  title: string;
  body: string;
  status: BriefStatus;
  indexStatus: BriefIndexStatus;
  indexProgress: BriefIndexProgress;
  photos: BriefPhoto[];
  publishedAt: string | null;
  highlight: { chunkId: string; start: number; end: number } | null;
};
export type BriefListItem = Omit<Brief, "body" | "photos" | "publishedAt" | "highlight"> & {
  excerpt: string;
  photoCount: number;
  coverUrl?: string | null;
};
export type BriefCursor = { date: string; id: string; score?: number | undefined };

export const briefIdSchema = z.string().uuid();

export const briefDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

export const briefInputSchema = z.object({
  date: briefDateSchema,
  title: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(MAX_BRIEF_BODY_LENGTH),
  status: z.enum(briefStatuses),
});

export const briefPhotoMetadataSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().min(1).max(MAX_BRIEF_PHOTO_BYTES),
});

export function photoError(files: { size: number }[], existing = 0): string | null {
  if (files.length + existing > MAX_BRIEF_PHOTOS) return az.briefs.validation.tooManyPhotos;
  if (files.some((file) => file.size < 1 || file.size > MAX_BRIEF_PHOTO_BYTES)) {
    return az.briefs.validation.photoSize;
  }
  return null;
}

export function imageMimeFromSignature(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function inspectBriefPhoto(
  file: Pick<File, "type" | "size" | "slice">,
): Promise<{ mime: "image/jpeg" | "image/png" | "image/webp"; size: number } | null> {
  if (file.size < 1 || file.size > MAX_BRIEF_PHOTO_BYTES) return null;
  const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const mime = imageMimeFromSignature(signature);
  if (!mime) return null;
  return { mime, size: file.size };
}

export function getBakuDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baku",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

export function getWeekStartDate(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  const weekday = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - ((weekday + 6) % 7));
  return value.toISOString().slice(0, 10);
}

export function briefExcerpt(markdown: string, maxLength = 200): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?|```$/g, " "))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[>*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function briefDate(date: string) {
  const value = new Date(`${date}T12:00:00.000Z`);
  const months = [
    "yanvar",
    "fevral",
    "mart",
    "aprel",
    "may",
    "iyun",
    "iyul",
    "avqust",
    "sentyabr",
    "oktyabr",
    "noyabr",
    "dekabr",
  ];
  const weekdays = [
    "bazar",
    "bazar ertəsi",
    "çərşənbə axşamı",
    "çərşənbə",
    "cümə axşamı",
    "cümə",
    "şənbə",
  ];
  return {
    day: String(value.getUTCDate()),
    month: `${months[value.getUTCMonth()]} ${value.getUTCFullYear()}`,
    monthName: months[value.getUTCMonth()],
    weekday: weekdays[value.getUTCDay()],
  };
}

export function briefHead(title: string, description: string) {
  return {
    meta: [
      { title: `${title} · Gündəlik bülletenlər` },
      { name: "description", content: description },
      { property: "og:title", content: `${title} · Gündəlik bülletenlər` },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  };
}

export function briefRoute(briefId: string): string {
  return `/brifler/${encodeURIComponent(briefId)}`;
}

export function briefChunkRoute(briefId: string, chunkId: string): string {
  return `${briefRoute(briefId)}?chunk=${encodeURIComponent(chunkId)}`;
}

export function formatBriefEmbeddingText(title: string, date: string, chunkText: string): string {
  return `${title} / ${date}\n${chunkText}`;
}

export function briefRouteForSearchSource(source: {
  sourceKind: "document" | "brief";
  documentId: string | null;
  briefId: string | null;
  chunkId: string;
}): string | null {
  if (source.sourceKind === "brief") {
    return source.briefId ? briefChunkRoute(source.briefId, source.chunkId) : null;
  }
  return source.documentId
    ? `/senedler/${encodeURIComponent(source.documentId)}?chunk=${encodeURIComponent(source.chunkId)}`
    : null;
}

export function briefSearchLabel(date: string): string {
  return `${az.analytics.openBrief} · ${date}`;
}
