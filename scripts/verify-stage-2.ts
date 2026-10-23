import { and, eq, inArray } from "drizzle-orm";

import type { AnalyticsFilters } from "../src/lib/analytics";
import { directions } from "../src/lib/directions";
import { isLowReliability } from "../src/lib/reliability";
import { handleAnalyticsSearchRequest } from "../src/server/analytics/endpoint";
import { closeDb, getDb } from "../src/server/db";
import { queryLogs } from "../src/server/db/schema";

type SearchEvent = {
  type: string;
  sources?: Array<{
    n: number;
    chunkId: string;
    documentId: string;
    direction: string | null;
    sourceReliability: "A" | "B" | "C" | "D" | "E" | "F";
    infoCredibility: 1 | 2 | 3 | 4 | 5 | 6;
  }>;
  text?: string;
  answer?: string;
  incomplete?: boolean;
  durationMs?: number;
  message?: string;
};

const filteredDemoFilters: AnalyticsFilters = {
  includeBriefs: false,
  period: "all",
  directionIds: directions.map(({ id }) => id),
  minSourceReliability: "all",
  minInfoCredibility: "all",
};
const answerDemoFilters: AnalyticsFilters = {
  ...filteredDemoFilters,
  minSourceReliability: "all",
  minInfoCredibility: "all",
};

async function readEvents(response: Response): Promise<{
  events: SearchEvent[];
  firstDeltaMs: number | null;
}> {
  if (!response.ok) throw new Error("Search endpoint returned " + response.status + ".");
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error("Search endpoint did not return an event stream.");
  }
  if (!response.body) throw new Error("Search endpoint returned an empty body.");

  const startedAt = Date.now();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: SearchEvent[] = [];
  let buffer = "";
  let firstDeltaMs: number | null = null;

  const parseFrame = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) return;
    const event = JSON.parse(data) as SearchEvent;
    events.push(event);
    if (event.type === "delta" && firstDeltaMs === null) firstDeltaMs = Date.now() - startedAt;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      parseFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) parseFrame(buffer);
  return { events, firstDeltaMs };
}

async function searchRequest(
  query: string,
  filters: AnalyticsFilters,
  mode: "answer" | "sources",
): Promise<Response> {
  return handleAnalyticsSearchRequest(
    new Request("http://localhost/api/analytics/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": crypto.randomUUID(),
      },
      body: JSON.stringify({ query, filters, mode }),
    }),
  );
}

async function verifyStage2(): Promise<void> {
  const db = getDb();
  const marker = "stage2-verification-" + crypto.randomUUID();
  const filterQuery = "su təchizatı və suya qənaət " + marker;
  const answerQuery = "su təchizatı və suvarma müşahidələri " + marker;
  const noSourcesQuery = "astronomik teleskopların optik xüsusiyyətləri";

  try {
    const filterResponse = await searchRequest(
      filterQuery,
      {
        ...filteredDemoFilters,
        minSourceReliability: "B",
        minInfoCredibility: "4",
      },
      "sources",
    );
    const filtered = await readEvents(filterResponse);
    const filteredSources =
      filtered.events.find((event) => event.type === "sources")?.sources ?? [];
    if (filteredSources.length === 0) throw new Error("Filtered search returned no demo sources.");
    if (
      filteredSources.some(
        (source) => !["A", "B"].includes(source.sourceReliability) || source.infoCredibility > 4,
      )
    ) {
      throw new Error("Reliability filters were not applied before result fusion.");
    }
    if (!filtered.events.some((event) => event.type === "final")) {
      throw new Error("Fragment-only search did not finish its stream.");
    }

    const answerResponse = await searchRequest(answerQuery, answerDemoFilters, "answer");
    const answerStream = await readEvents(answerResponse);
    const answerSources =
      answerStream.events.find((event) => event.type === "sources")?.sources ?? [];
    const firstDeltaIndex = answerStream.events.findIndex((event) => event.type === "delta");
    const sourceIndex = answerStream.events.findIndex((event) => event.type === "sources");
    const final = answerStream.events.find((event) => event.type === "final");
    if (answerSources.length === 0 || sourceIndex < 0) {
      throw new Error("Answer search did not send sources to the client.");
    }
    if (
      !answerSources.some(
        (source) => source.sourceReliability === "D" && source.infoCredibility === 5,
      )
    ) {
      throw new Error("The synthetic D/5 source was not returned for its reliability badge check.");
    }
    if (firstDeltaIndex < 0 || sourceIndex > firstDeltaIndex) {
      throw new Error("The answer stream did not send sources before its first text delta.");
    }
    if (!final || typeof final.answer !== "string") {
      const streamError = answerStream.events.find((event) => event.type === "error");
      throw new Error(streamError?.message ?? "The answer stream did not finish.");
    }

    const sourceByNumber = new Map(answerSources.map((source) => [source.n, source]));
    for (const match of final.answer.matchAll(/\[(\d+)\]/g)) {
      const number = Number(match[1]);
      if (!sourceByNumber.has(number)) throw new Error("An unknown citation survived validation.");
    }
    const citedLowReliability = [...final.answer.matchAll(/\[(\d+)\]/g)].some((match) => {
      const source = sourceByNumber.get(Number(match[1]));
      return source ? isLowReliability(source.sourceReliability, source.infoCredibility) : false;
    });
    if (
      citedLowReliability &&
      !final.answer.toLocaleLowerCase().includes("bu məlumat aşağı etibarlılıq dərəcəsinə malikdir")
    ) {
      throw new Error("The low-reliability citation warning is missing.");
    }

    const noSourcesResponse = await searchRequest(noSourcesQuery, answerDemoFilters, "answer");
    const noSourcesStream = await readEvents(noSourcesResponse);
    const noSources =
      noSourcesStream.events.find((event) => event.type === "sources")?.sources ?? [];
    const noSourcesFinal = noSourcesStream.events.find((event) => event.type === "final");
    if (noSources.length !== 0 || noSourcesFinal?.answer !== "Mənbələrdə məlumat tapılmadı.") {
      throw new Error(
        "Out-of-corpus query returned " +
          noSources.length +
          " sources and answer " +
          JSON.stringify(noSourcesFinal?.answer ?? null) +
          ".",
      );
    }

    const logRows = await db
      .select({ query: queryLogs.query, answer: queryLogs.answer, module: queryLogs.module })
      .from(queryLogs)
      .where(
        and(
          inArray(queryLogs.query, [filterQuery, answerQuery, noSourcesQuery]),
          eq(queryLogs.module, "analytics"),
        ),
      );
    if (logRows.length !== 3)
      throw new Error("All three search requests were not recorded in query_logs.");

    console.log(
      "Hybrid search returned " +
        filteredSources.length +
        " filtered demo sources; SSE sent sources before the answer and query logs were persisted.",
    );
    console.log(
      "First answer token: " +
        (answerStream.firstDeltaMs === null
          ? "not measured"
          : (answerStream.firstDeltaMs / 1000).toFixed(2) + " s"),
    );
  } finally {
    await db
      .delete(queryLogs)
      .where(inArray(queryLogs.query, [filterQuery, answerQuery, noSourcesQuery]));
  }
}

try {
  await verifyStage2();
} catch {
  console.error(
    "Stage 2 integration verification failed; check database, Storage, and Gemini configuration.",
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
