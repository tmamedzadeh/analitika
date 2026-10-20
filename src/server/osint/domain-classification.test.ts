import { describe, expect, it, vi } from "vitest";

import {
  CLASSIFICATION_BATCH_SIZE,
  MODEL_CLASSIFICATION_TTL_MS,
  classifyDomains,
  classifyWithModel,
  knownDomainClassification,
  originalUrlFromArchive,
  resolveSourceOrigin,
  structuralDomainType,
  type ClassificationStore,
  type ModelDomainType,
  type StoredClassification,
} from "./domain-classification";

const NOW = new Date("2026-06-01T00:00:00Z");

function memoryStore(initial: StoredClassification[] = []) {
  const rows = new Map(initial.map((row) => [row.domain, row]));
  const store: ClassificationStore = {
    read: vi.fn(async (domains: string[]) =>
      domains.flatMap((d) => (rows.has(d) ? [rows.get(d)!] : [])),
    ),
    writeModel: vi.fn(async (written) => {
      for (const row of written) {
        if (rows.get(row.domain)?.source === "manual") continue;
        rows.set(row.domain, { ...row, source: "model", classifiedAt: NOW });
      }
    }),
  };
  return { store, rows };
}

describe("structural and registry domains", () => {
  it("classifies DOI resolvers and web archives without any lookup", () => {
    expect(structuralDomainType("doi.org")).toBe("resolver");
    expect(structuralDomainType("www.doi.org")).toBe("resolver");
    expect(structuralDomainType("web.archive.org")).toBe("archive");
    expect(structuralDomainType("archive.ph")).toBe("archive");
    expect(structuralDomainType("notarchive.org")).toBeUndefined();
    expect(knownDomainClassification("doi.org")?.type).toBe("resolver");
    expect(knownDomainClassification("web.archive.org")?.type).toBe("archive");
  });

  it("keeps the language-specific registry first", () => {
    expect(knownDomainClassification("bbc.com", "fa")?.type).toBe("international_media");
    expect(knownDomainClassification("bbc.com", "en")?.type).toBe("public_broadcaster");
    expect(knownDomainClassification("unlisted.example")).toBeUndefined();
  });
});

describe("classifyDomains priority and caching", () => {
  it("never sends registry or structural domains to the store or model", async () => {
    const { store } = memoryStore();
    const classify = vi.fn(async () => new Map<string, ModelDomainType>());
    const outcome = await classifyDomains(["reuters.com", "doi.org", "web.archive.org"], {
      store,
      classify,
      now: () => NOW,
    });
    expect(outcome.classifications.get("reuters.com")).toMatchObject({
      type: "agency",
      source: "registry",
    });
    expect(outcome.classifications.get("doi.org")?.type).toBe("resolver");
    expect(outcome.classifications.get("web.archive.org")?.type).toBe("archive");
    expect(store.read).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(outcome.modelCalls).toBe(0);
  });

  it("prefers a manual row over the model and never asks the model about it", async () => {
    const { store } = memoryStore([
      {
        domain: "example-ministry.example",
        type: "official",
        source: "manual",
        classifiedAt: new Date("2020-01-01T00:00:00Z"),
      },
    ]);
    const classify = vi.fn(async () => new Map<string, ModelDomainType>());
    const outcome = await classifyDomains(["example-ministry.example"], {
      store,
      classify,
      now: () => NOW,
    });
    expect(outcome.classifications.get("example-ministry.example")).toMatchObject({
      type: "official",
      source: "manual",
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it("reuses a fresh model row and reclassifies an expired one", async () => {
    const { store, rows } = memoryStore([
      {
        domain: "fresh.example",
        type: "think_tank",
        source: "model",
        classifiedAt: new Date(NOW.getTime() - 1000),
      },
      {
        domain: "stale.example",
        type: "other",
        source: "model",
        classifiedAt: new Date(NOW.getTime() - MODEL_CLASSIFICATION_TTL_MS - 1000),
      },
    ]);
    const classify = vi.fn(
      async (domains: string[]) =>
        new Map<string, ModelDomainType>(domains.map((domain) => [domain, "independent_media"])),
    );
    const outcome = await classifyDomains(["fresh.example", "stale.example"], {
      store,
      classify,
      now: () => NOW,
    });
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledWith(["stale.example"]);
    expect(outcome.classifications.get("fresh.example")?.type).toBe("think_tank");
    expect(outcome.classifications.get("stale.example")).toMatchObject({
      type: "independent_media",
      source: "model",
    });
    expect(rows.get("stale.example")?.type).toBe("independent_media");
  });

  it("does not let a model answer overwrite a manual row in the store", async () => {
    const { store, rows } = memoryStore([
      { domain: "kept.example", type: "official", source: "manual", classifiedAt: NOW },
    ]);
    await store.writeModel([{ domain: "kept.example", type: "other" }]);
    expect(rows.get("kept.example")?.type).toBe("official");
  });

  it("classifies unknown domains in batches and caches the answers", async () => {
    const { store, rows } = memoryStore();
    const domains = Array.from(
      { length: CLASSIFICATION_BATCH_SIZE + 3 },
      (_, i) => `site${i}.example`,
    );
    const classify = vi.fn(
      async (batch: string[]) =>
        new Map<string, ModelDomainType>(batch.map((d) => [d, "domestic_media"])),
    );
    const outcome = await classifyDomains(domains, { store, classify, now: () => NOW });
    expect(classify).toHaveBeenCalledTimes(2);
    expect(classify.mock.calls[0]![0]).toHaveLength(CLASSIFICATION_BATCH_SIZE);
    expect(outcome.modelCalls).toBe(2);
    expect(outcome.unresolved).toEqual([]);
    expect(rows.size).toBe(domains.length);
  });
});

describe("classifyDomains failure isolation", () => {
  it("leaves domains unresolved when the model fails, without throwing or caching", async () => {
    const { store } = memoryStore();
    const outcome = await classifyDomains(["a.example", "b.example"], {
      store,
      classify: async () => {
        throw new Error("model down");
      },
      now: () => NOW,
    });
    expect(outcome.unresolved.sort()).toEqual(["a.example", "b.example"]);
    expect(outcome.classifications.size).toBe(0);
    expect(store.writeModel).not.toHaveBeenCalled();
  });

  it("keeps partial model answers and reports omitted domains", async () => {
    const { store } = memoryStore();
    const outcome = await classifyDomains(["a.example", "b.example"], {
      store,
      classify: async () => new Map<string, ModelDomainType>([["a.example", "academic"]]),
      now: () => NOW,
    });
    expect(outcome.classifications.get("a.example")?.type).toBe("academic");
    expect(outcome.unresolved).toEqual(["b.example"]);
  });

  it("survives store read and write failures", async () => {
    const store: ClassificationStore = {
      read: async () => {
        throw new Error("relation does not exist");
      },
      writeModel: async () => {
        throw new Error("read-only");
      },
    };
    const outcome = await classifyDomains(["a.example"], {
      store,
      classify: async () => new Map<string, ModelDomainType>([["a.example", "official"]]),
      now: () => NOW,
    });
    expect(outcome.classifications.get("a.example")?.type).toBe("official");
  });
});

describe("classifyWithModel", () => {
  it("accepts only requested domains and normalizes them", async () => {
    const generateObject = vi.fn(async () => ({
      domains: [
        { domain: "WWW.A.example", type: "think_tank" },
        { domain: "unrequested.example", type: "official" },
        { domain: "a.example", type: "other" },
      ],
    }));
    const result = await classifyWithModel(
      ["a.example"],
      { generateObject: generateObject as never },
      new AbortController().signal,
    );
    expect([...result]).toEqual([["a.example", "think_tank"]]);
    const input = (generateObject.mock.calls[0] as unknown[])[0] as { prompt: string };
    expect(input.prompt).toBe(JSON.stringify({ domains: ["a.example"] }));
  });

  it("returns nothing when structured output is unavailable", async () => {
    const result = await classifyWithModel(["a.example"], {}, new AbortController().signal);
    expect(result.size).toBe(0);
  });
});

describe("archive and resolver origin", () => {
  it("reads the original from a Wayback snapshot without a network call", async () => {
    expect(
      originalUrlFromArchive(
        "https://web.archive.org/web/20240102030405/https://example.org/a?b=1",
      ),
    ).toBe("https://example.org/a?b=1");
    expect(originalUrlFromArchive("https://web.archive.org/web/2024id_/http://example.org/x")).toBe(
      "http://example.org/x",
    );
    expect(
      originalUrlFromArchive(
        "https://web.archive.org/web/2024/https://web.archive.org/web/1/https://a.example/",
      ),
    ).toBeNull();
    expect(originalUrlFromArchive("https://web.archive.org/about")).toBeNull();
    expect(originalUrlFromArchive("https://example.org/web/2024/https://a.example/")).toBeNull();

    const resolveFinal = vi.fn();
    const origin = await resolveSourceOrigin(
      "https://web.archive.org/web/20240102030405/https://example.org/a",
      resolveFinal,
    );
    expect(origin).toMatchObject({ domain: "example.org", via: "archive" });
    expect(origin.originalUrl).toBe("https://example.org/a");
    expect(resolveFinal).not.toHaveBeenCalled();
  });

  it("resolves a DOI link to the publisher domain", async () => {
    const origin = await resolveSourceOrigin(
      "https://doi.org/10.1000/xyz",
      async () => "https://journal.example/articles/xyz",
    );
    expect(origin).toMatchObject({
      url: "https://doi.org/10.1000/xyz",
      domain: "journal.example",
      via: "resolver",
    });
  });

  it("keeps the resolver or archive domain when the original cannot be established", async () => {
    expect(
      await resolveSourceOrigin("https://doi.org/10.1000/xyz", async () => {
        throw new Error("timeout");
      }),
    ).toEqual({ url: "https://doi.org/10.1000/xyz", domain: "doi.org" });
    expect(
      await resolveSourceOrigin(
        "https://doi.org/10.1000/xyz",
        async () => "https://doi.org/10.1000/xyz",
      ),
    ).toEqual({ url: "https://doi.org/10.1000/xyz", domain: "doi.org" });
    expect(
      await resolveSourceOrigin("https://web.archive.org/web/2024/not-a-url", vi.fn()),
    ).toEqual({ url: "https://web.archive.org/web/2024/not-a-url", domain: "web.archive.org" });
  });

  it("does not follow redirects for ordinary domains", async () => {
    const resolveFinal = vi.fn();
    expect(await resolveSourceOrigin("https://reuters.com/a", resolveFinal)).toEqual({
      url: "https://reuters.com/a",
      domain: "reuters.com",
    });
    expect(resolveFinal).not.toHaveBeenCalled();
  });
});
