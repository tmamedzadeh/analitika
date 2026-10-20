import { z } from "zod";

import type { LLMProvider } from "../ai/types";
import { sourceRegistryEntry } from "./source-registry";
import type { OsintLanguage } from "@/lib/osint";

export const MODEL_DOMAIN_TYPES = [
  "state_media",
  "independent_media",
  "domestic_media",
  "international_media",
  "official",
  "think_tank",
  "agency",
  "academic",
  "archive",
  "resolver",
  "other",
] as const;

export type ModelDomainType = (typeof MODEL_DOMAIN_TYPES)[number];
/** Registry and legacy rows may also carry these two types, which models are never asked for. */
export type DomainType = ModelDomainType | "public_broadcaster" | "media";
export type ClassificationSource = "registry" | "manual" | "model";

export type DomainClassification = {
  domain: string;
  type: DomainType;
  source: ClassificationSource;
  classifiedAt: Date;
};

export type StoredClassification = Pick<DomainClassification, "domain" | "type"> & {
  source: ClassificationSource;
  classifiedAt: Date;
};

export const MODEL_CLASSIFICATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const CLASSIFICATION_BATCH_SIZE = 25;

/** Domains whose role is structural (they point to, or copy, other sources) rather than editorial. */
const STRUCTURAL_DOMAINS: ReadonlyMap<string, "resolver" | "archive"> = new Map([
  ["doi.org", "resolver"],
  ["dx.doi.org", "resolver"],
  ["handle.net", "resolver"],
  ["hdl.handle.net", "resolver"],
  ["web.archive.org", "archive"],
  ["archive.org", "archive"],
  ["archive.ph", "archive"],
  ["archive.today", "archive"],
  ["archive.is", "archive"],
]);

export function normalizeClassificationDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

export function structuralDomainType(domain: string): "resolver" | "archive" | undefined {
  const host = normalizeClassificationDomain(domain);
  for (const [known, type] of STRUCTURAL_DOMAINS) {
    if (host === known || host.endsWith(`.${known}`)) return type;
  }
  return undefined;
}

/**
 * Registry and structural domains are known without any lookup. The registry stays first so that
 * its language-specific entries keep winning over cached or model-derived data.
 */
export function knownDomainClassification(
  domain: string,
  language?: OsintLanguage,
): { type: DomainType; affiliation?: string } | undefined {
  const host = normalizeClassificationDomain(domain);
  const registered = sourceRegistryEntry(host, language);
  if (registered) return { type: registered.type, affiliation: registered.affiliation };
  const structural = structuralDomainType(host);
  if (structural) return { type: structural };
  return undefined;
}

/**
 * The Wayback Machine embeds the archived address in the path, so the original can be read without
 * a network request. Returns null for anything that is not a recognisable Wayback snapshot.
 */
export function originalUrlFromArchive(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (normalizeClassificationDomain(parsed.hostname) !== "web.archive.org") return null;
    const match = /^\/web\/(?:\d{1,14}[a-z_]{0,3}|\*)\/(https?:\/\/.+)$/i.exec(
      parsed.pathname + parsed.search,
    );
    if (!match?.[1]) return null;
    const original = new URL(match[1]);
    if (original.protocol !== "http:" && original.protocol !== "https:") return null;
    if (structuralDomainType(original.hostname) === "archive") return null;
    return original.toString();
  } catch {
    return null;
  }
}

export type OriginResolution = {
  /** URL that was actually read and is cited. */
  url: string;
  /** Domain the source should be attributed to. */
  domain: string;
  /** Set only when an archive copy or resolver link was traced to a different original domain. */
  originalUrl?: string;
  via?: "archive" | "resolver";
};

export async function resolveSourceOrigin(
  url: string,
  resolveFinal: (url: string) => Promise<string>,
): Promise<OriginResolution> {
  const host = normalizeClassificationDomain(new URL(url).hostname);
  const base: OriginResolution = { url, domain: host };
  const structural = structuralDomainType(host);
  if (!structural) return base;

  let original: string | null = null;
  if (structural === "archive") original = originalUrlFromArchive(url);
  else {
    try {
      original = await resolveFinal(url);
    } catch {
      original = null;
    }
  }
  if (!original) return base;
  try {
    const originalHost = normalizeClassificationDomain(new URL(original).hostname);
    if (originalHost === host || structuralDomainType(originalHost)) return base;
    return { url, domain: originalHost, originalUrl: original, via: structural };
  } catch {
    return base;
  }
}

const modelClassificationSchema = z.object({
  domains: z
    .array(z.object({ domain: z.string().min(1).max(253), type: z.enum(MODEL_DOMAIN_TYPES) }))
    .max(CLASSIFICATION_BATCH_SIZE),
});

export type ClassificationStore = {
  read(domains: string[]): Promise<StoredClassification[]>;
  writeModel(rows: Array<{ domain: string; type: DomainType }>): Promise<void>;
};

export type ClassificationOutcome = {
  classifications: Map<string, DomainClassification>;
  /** Domains that stayed unclassified because the model call failed or omitted them. */
  unresolved: string[];
  modelCalls: number;
};

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

export async function classifyWithModel(
  domains: readonly string[],
  light: Pick<LLMProvider, "generateObject">,
  signal: AbortSignal,
): Promise<Map<string, ModelDomainType>> {
  const output = new Map<string, ModelDomainType>();
  if (!light.generateObject) return output;
  const requested = new Set(domains);
  const response = await light.generateObject(
    {
      temperature: 0,
      timeoutMs: 15_000,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      thinkingLevel: "minimal",
      maxOutputTokens: 1_200,
      maxAttempts: 1,
      system:
        "Classify each web domain by the type of publisher it most likely belongs to. Types: state_media (state-owned or state-controlled media), independent_media (editorially independent outlets), domestic_media (national or local media not clearly state-run or independent), international_media (foreign broadcasters and international outlets), official (government, ministry, military or intergovernmental body), think_tank (research or policy institute), agency (news wire or press agency), academic (university, journal or scholarly repository), archive (web archive or copy service), resolver (DOI, handle or link-resolving service), other. Use only the domain name; use other when it is not recognisable. Return every requested domain exactly as given.",
      prompt: JSON.stringify({ domains }),
    },
    modelClassificationSchema,
  );
  for (const item of response.domains) {
    const domain = normalizeClassificationDomain(item.domain);
    if (requested.has(domain) && !output.has(domain)) output.set(domain, item.type);
  }
  return output;
}

/**
 * Priority is registry, then manual, then model. Registry/structural domains never reach the
 * store or the model. Stored model rows expire after MODEL_CLASSIFICATION_TTL_MS. Storage and
 * model failures degrade to "unresolved" so the caller can fall back to its heuristic.
 */
export async function classifyDomains(
  domains: readonly string[],
  deps: {
    store: ClassificationStore;
    classify: (domains: string[]) => Promise<Map<string, ModelDomainType>>;
    now?: () => Date;
  },
): Promise<ClassificationOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const classifications = new Map<string, DomainClassification>();
  const unresolved: string[] = [];
  let modelCalls = 0;
  const pending: string[] = [];

  for (const raw of new Set(domains.map(normalizeClassificationDomain))) {
    if (!raw) continue;
    const known = knownDomainClassification(raw);
    if (known) {
      classifications.set(raw, {
        domain: raw,
        type: known.type,
        source: "registry",
        classifiedAt: now,
      });
    } else pending.push(raw);
  }
  if (!pending.length) return { classifications, unresolved, modelCalls };

  let stored: StoredClassification[] = [];
  try {
    stored = await deps.store.read(pending);
  } catch {
    stored = [];
  }
  const byDomain = new Map(stored.map((row) => [normalizeClassificationDomain(row.domain), row]));
  const toClassify: string[] = [];
  for (const domain of pending) {
    const row = byDomain.get(domain);
    const fresh =
      row &&
      (row.source === "manual" ||
        (row.source === "model" &&
          now.getTime() - row.classifiedAt.getTime() < MODEL_CLASSIFICATION_TTL_MS));
    if (row && fresh) classifications.set(domain, { ...row, domain });
    else toClassify.push(domain);
  }

  const toStore: Array<{ domain: string; type: DomainType }> = [];
  for (const group of chunks(toClassify, CLASSIFICATION_BATCH_SIZE)) {
    modelCalls += 1;
    let result = new Map<string, ModelDomainType>();
    try {
      result = await deps.classify(group);
    } catch {
      result = new Map();
    }
    for (const domain of group) {
      const type = result.get(domain);
      if (!type) {
        unresolved.push(domain);
        continue;
      }
      classifications.set(domain, { domain, type, source: "model", classifiedAt: now });
      toStore.push({ domain, type });
    }
  }
  if (toStore.length) {
    try {
      await deps.store.writeModel(toStore);
    } catch {
      // A cache write failure must not lose the classification already obtained.
    }
  }
  return { classifications, unresolved, modelCalls };
}
