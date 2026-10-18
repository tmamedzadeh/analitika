import { z } from "zod";

import { departmentIds } from "./departments";
import { az } from "./i18n/az";
import { imageMimeFromSignature } from "./briefs";

export const requestUrgencies = ["normal", "urgent", "critical"] as const;
export const requestStatuses = ["new", "in_progress", "answered", "rejected"] as const;
export const requestSourceReliabilityValues = ["A", "B", "C", "D", "E", "F"] as const;
export const requestInfoCredibilityValues = [1, 2, 3, 4, 5, 6] as const;
export const requestMaxAttachmentSize = 10 * 1024 * 1024;
export const requestMaxAttachments = 10;

export const requestMimeByExtension = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export type RequestMime = (typeof requestMimeByExtension)[keyof typeof requestMimeByExtension];

export function requestMimeFromSignature(bytes: Uint8Array): RequestMime | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") {
    return "application/pdf";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return imageMimeFromSignature(bytes);
}

export function requestUploadMatches(input: {
  expectedMime: RequestMime;
  expectedSize: number;
  actualSize: number;
  actualContentType?: string | undefined;
  signature: Uint8Array;
}): boolean {
  return (
    input.expectedSize > 0 &&
    input.expectedSize <= requestMaxAttachmentSize &&
    input.actualSize === input.expectedSize &&
    (input.actualContentType === undefined || input.actualContentType === input.expectedMime) &&
    requestMimeFromSignature(input.signature) === input.expectedMime
  );
}

export function requestMimeFromName(name: string): RequestMime | null {
  const extension = name.split(".").at(-1)?.toLocaleLowerCase();
  if (!extension) return null;
  return requestMimeByExtension[extension as keyof typeof requestMimeByExtension] ?? null;
}

const requestDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, az.requests.validation.date)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, az.requests.validation.date);

export const requestAttachmentMetadataSchema = z.object({
  name: z.string().trim().min(1, az.requests.validation.fileName).max(255),
  mime: z.enum(Object.values(requestMimeByExtension) as [RequestMime, ...RequestMime[]], {
    message: az.requests.validation.fileType,
  }),
  size: z
    .number()
    .int()
    .min(1, az.requests.validation.fileSize)
    .max(requestMaxAttachmentSize, az.requests.validation.fileSize),
});

export const requestAttachmentInputSchema = requestAttachmentMetadataSchema.refine(
  (file) => requestMimeFromName(file.name) === file.mime,
  {
    message: az.requests.validation.fileType,
  },
);

export const infoRequestInputSchema = z.object({
  department: z.enum(departmentIds, { message: az.requests.validation.department }),
  requestDate: requestDateSchema,
  urgency: z.enum(requestUrgencies, { message: az.requests.validation.urgency }),
  purpose: z
    .string()
    .trim()
    .min(1, az.requests.validation.required)
    .max(1000, az.requests.validation.textTooLong),
  details: z
    .string()
    .trim()
    .min(1, az.requests.validation.required)
    .max(20_000, az.requests.validation.textTooLong),
  sourceReliability: z.enum(requestSourceReliabilityValues),
  infoCredibility: z.number().int().min(1).max(6),
  note: z
    .string()
    .trim()
    .max(4000, az.requests.validation.textTooLong)
    .transform((value) => value || null),
  attachments: z.array(requestAttachmentInputSchema).max(requestMaxAttachments, {
    message: az.requests.validation.tooManyFiles,
  }),
});

export const requestStatusInputSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(requestStatuses),
});

export const requestAnswerDocumentInputSchema = z.object({
  requestId: z.string().uuid(),
  answerDocumentId: z.string().uuid().nullable(),
});

export const requestIdSchema = z.object({ requestId: z.string().uuid() });

export type InfoRequestInput = z.infer<typeof infoRequestInputSchema>;
