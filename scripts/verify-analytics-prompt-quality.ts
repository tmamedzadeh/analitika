import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

import { ANALYTICS_SERVER_DEADLINE_MS, type AnalyticsSource } from "../src/lib/analytics";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { getGeminiErrorCategory } from "../src/server/ai/gemini-gateway";
import { withAiDiagnostics } from "../src/server/ai/diagnostics";
import {
  analyticsPublicationFailureReasons,
  validateCitations,
} from "../src/server/analytics/citations";
import { readServerEnv } from "../src/server/env";
import { buildAnalyticsPrompt } from "../src/server/prompts/analytics";

// All data below is invented, open test data. Nothing is read from the project
// database, document storage, history, or production analytics endpoint.
function source(
  n: number,
  material: string,
  text: string,
  ratings: Pick<AnalyticsSource, "sourceReliability" | "infoCredibility"> = {
    sourceReliability: "A",
    infoCredibility: 1,
  },
): AnalyticsSource {
  return {
    n,
    sourceKind: "document",
    documentId: `synthetic-${material}`,
    briefId: null,
    chunkId: `synthetic-${material}-${n}`,
    title: `Açıq sintetik sınaq: ${material}`,
    sectionTitle: "Sınaq ssenarisi",
    text,
    quote: text,
    charStart: 0,
    charEnd: text.length,
    docDate: "2026-10-01",
    briefDate: null,
    direction: "OSINT",
    isTable: false,
    attachmentCount: 0,
    classification: "open",
    ...ratings,
  };
}

const hormuz = [
  source(
    1,
    "dəniz-hərəkəti",
    "Sınaq ssenarisində sentyabrın son həftəsində Hörmüz boğazından ticarət gəmilərinin keçidi davam edib. Gəmilər üçün yeni təhlükəsizlik bildirişləri verilib, bəzi operatorlar keçid vaxtını yenidən planlaşdırıb. Tam bağlanma qeydə alınmayıb. Müşahidə olunan dəyişiklik gəmi hərəkətinin dayanması deyil, təhlükəsizlik prosedurlarının sərtləşməsidir. Material hərbi əməliyyatın başlanması barədə məlumat vermir.",
  ),
  source(
    3,
    "logistika",
    "Sınaq ssenarisində iki logistika operatoru marşrut üzrə sığorta əlavəsinin və gözləmə vaxtının artdığını bildirib. Xərclərin artımı müşahidə olunan təhlükəsizlik bildirişləri ilə əlaqələndirilir. Alternativ daşınma imkanlarının mövcudluğu qeyd olunur, lakin onların bütün cari yük axınını əvəz edə biləcəyi göstərilmir. Materialda dünya enerji qiymətləri üzrə rəqəm və ya proqnoz yoxdur.",
    { sourceReliability: "B", infoCredibility: 2 },
  ),
  source(
    6,
    "dəniz-hərəkəti",
    "Sınaq ssenarisinin hərbi-siyasi kontekstində tərəflər dənizdə müşayiət və patrul fəaliyyətini artırıb. Rəsmi bəyanatlar çəkindirməyə yönəlib; qarşılıqlı əlaqə kanalları açıq saxlanılıb. Patrulların eyni ərazidə daha sıx fəaliyyəti və daha mürəkkəb yoxlama prosedurları hadisələrin idarə edilməsini çətinləşdirən amillər kimi göstərilir. Gəmi hərəkəti davam etdiyi üçün təzyiq hazırda keçidin tam dayandırılması ilə deyil, risk və əməliyyat yükünün artması ilə bağlıdır.",
  ),
  source(
    8,
    "regional-ticarət",
    "Sınaq ssenarisində regional ixracatçıların yük qrafikləri boğazdan fasiləsiz keçiddən asılıdır. Gözləmə vaxtının uzanması çatdırılma qrafiklərinin dəyişməsinə səbəb olub. Enerji məhsulları üzrə faktiki ixracın azaldığına dair göstərici yoxdur. Sığorta və gözləmə xərclərinin uzun müddət yüksək qalması operatorların xərclərinə əlavə təzyiq yarada bilər; bu təsirin miqyası barədə ölçülmüş nəticə verilməyib. Sakitləşmə və ya gərginliyin artması üzrə dəqiq tarix göstərilmir.",
    { sourceReliability: "B", infoCredibility: 2 },
  ),
];

const budget = [
  source(
    1,
    "büdcə-layihəsi",
    "Yalnız sintetik sınaq ssenarisində: Ermənistanın 2027-ci il üçün müdafiə xərcləri büdcə layihəsində 700 milyard dram nəzərdə tutulur. Bu, 1 oktyabr 2026-cı il tarixli layihə göstəricisidir. Mənbədə parlamentin yekun təsdiqi və ya faktiki xərc barədə məlumat yoxdur. Müqayisə üçün eyni sınaq materialında 2026-cı ilin təsdiqlənmiş müdafiə ayırması 650 milyard dram göstərilir. Dollar ekvivalenti və məzənnə verilməyib.",
  ),
];

const industry = [
  source(
    1,
    "sənaye-hesabatı",
    "Sınaq ssenarisində İranın iki müdafiə müəssisəsində raket və pilotsuz uçuş aparatları üçün mühərrik və idarəetmə modullarının istehsal xətləri yenilənib. Hesabat yığım və texniki xidmət imkanlarının genişləndiyini göstərir. Kritik elektron komponentlərin bir hissəsi idxaldan asılıdır. Materialda istehsal həcmi, məhsuldarlıq və döyüş şəraitində sınaq nəticələri açıqlanmır.",
    { sourceReliability: "B", infoCredibility: 2 },
  ),
  source(
    3,
    "rəsmi-bəyanat",
    "Sınaq ssenarisində bir qurum yeni pilotsuz sistemin sınaqlarının tamamlandığını və raket istehsalının artırıldığını bəyan edib. Bu, qurumun bəyanatıdır; təqdim edilmiş materialda istehsal üzrə faktiki say və texniki sınaq protokolu yoxdur. İddia olunan uçuş məsafəsi və dəqiqlik üzrə ölçülmüş göstərici verilmir.",
    { sourceReliability: "C", infoCredibility: 3 },
  ),
  source(
    6,
    "sənaye-hesabatı",
    "Sınaq ssenarisində mövcud platformaların texniki xidməti və heyət hazırlığı təşkil olunub. Hesabatda istismar müddətinin uzadılması üçün texniki xidmətin əhəmiyyəti göstərilir. İdxal komponentləri üzrə tədarük fasilələrinin istehsalın sabitliyinə təsir edə biləcəyi qeyd olunur. Yeni xəttin qurulması ilə sabit kütləvi istehsalın əldə edilməsi ayrıca mərhələlərdir.",
    { sourceReliability: "B", infoCredibility: 2 },
  ),
];

const cooperation = [
  source(
    1,
    "əməkdaşlıq-icmalı",
    "Sınaq ssenarisində Rusiya və İran arasında üç əməkdaşlıq istiqaməti təsvir olunur. Texniki xidmət üzrə fəaliyyət göstərən birgə mərkəz üçün iş planı təsdiqlənib. Heyət hazırlığı istiqamətində ilkin kurs keçirilib. Yeni platformaların birgə istehsalı barədə niyyət protokolu imzalanıb, istehsala başlandığına dair məlumat yoxdur. Bu istiqamətlər eyni icra mərhələsində deyil.",
  ),
  source(
    3,
    "əməkdaşlıq-detalları",
    "Sınaq ssenarisində texniki xidmət mərkəzinin işi mövcud avadanlığın istismarını dəstəkləməyə yönəlib; hazırlıq kursu texniki heyətin bacarıqlarına aiddir. Birgə istehsal niyyət protokolu gələcək istehsalın təşkili üzrə danışıqları nəzərdə tutur. Müqavilə qiyməti, texnologiya transferinin şərtləri və istehsal müddəti açıqlanmır. Bütün istiqamətlər üzrə tərəflərin siyasi razılığı ilə əməli icra arasında fərq saxlanmalıdır.",
    { sourceReliability: "B", infoCredibility: 2 },
  ),
];

const reliability = [
  source(
    1,
    "yoxlama-hesabatı",
    "Sınaq ssenarisində avadanlığın qəbulu 1 oktyabr tarixli qəbul aktında təsdiqlənir. Akt qəbul tarixini təsdiqləyir, avadanlığın döyüş şəraitində nəticəsini və ya sonrakı istismarını təsdiqləmir.",
  ),
  source(
    3,
    "anonim-iddia",
    "Sınaq ssenarisində anonim şəxs avadanlığın artıq istismardan çıxarıldığını iddia edir. Sınaq toplusunda bu iddianı təsdiqləyən texniki baxış aktı, ikinci müstəqil mənbə və ya rəsmi açıqlama yoxdur.",
    { sourceReliability: "D", infoCredibility: 5 },
  ),
  source(
    6,
    "anonim-iddia",
    "Eyni anonim şəxsin eyni avadanlığın istismardan çıxarılması barədə sözləri bu materialın başqa bölməsində təkrar edilir. Bu hissə yeni müstəqil təsdiq deyil.",
    { sourceReliability: "D", infoCredibility: 5 },
  ),
];

const cases = [
  { id: "A-overview", query: "Hörmüz boğazı barədə ətraflı məlumat ver.", sources: hormuz },
  {
    id: "B-factual",
    query: "Ermənistanın 2027-ci il üçün müdafiə büdcəsi barədə hansı məlumatlar var?",
    sources: budget,
  },
  {
    id: "C-assessment",
    query: "İranın raket və pilotsuz sistemlər üzrə müdafiə-sənaye potensialını qiymətləndir.",
    sources: industry,
  },
  {
    id: "D-comparison",
    query: "Rusiya və İran arasında hərbi əməkdaşlığın əsas istiqamətlərini müqayisə et.",
    sources: cooperation,
  },
  {
    id: "E-reliability",
    query:
      "Avadanlığın qəbul və istismardan çıxarılması barədə bu məlumatların etibarlılıq səviyyəsi nə dərəcədədir?",
    sources: reliability,
  },
  {
    id: "F-insufficient",
    query:
      "Ermənistanın 2027-ci il üçün təsdiqlənmiş müdafiə büdcəsinin dəqiq ABŞ dolları ekvivalenti nə qədərdir?",
    sources: budget,
  },
] as const;

async function main() {
  const env = readServerEnv();
  const acceptance = process.argv.includes("--acceptance");
  const live = process.argv.includes("--live");
  const selectedIds = process.argv
    .filter((argument) => argument.startsWith("--case="))
    .map((argument) => argument.slice("--case=".length));
  if (selectedIds.some((id) => !cases.some((testCase) => testCase.id === id))) {
    throw new Error("Unknown verification case.");
  }
  let selectedCases = selectedIds.length
    ? cases.filter((testCase) => selectedIds.includes(testCase.id))
    : [...cases];
  if (acceptance) {
    const order = ["C-assessment", "E-reliability", "D-comparison"];
    if (selectedIds.some((id) => !order.includes(id))) throw new Error("Unauthorized case.");
    selectedCases = order.flatMap((id) =>
      cases.filter(
        (testCase) => testCase.id === id && (!selectedIds.length || selectedIds.includes(id)),
      ),
    );
  }
  const configuration = {
    chatModel: env.AI_CHAT_MODEL,
    lightModel: env.AI_LIGHT_MODEL,
    backupModel: env.AI_BACKUP_MODEL,
    thinkingLevel: env.ANALYTICS_THINKING_LEVEL,
    maxOutputTokens: buildAnalyticsPrompt("", []).maxOutputTokens,
    deadlineMs: ANALYTICS_SERVER_DEADLINE_MS,
    maxAttemptsPerRoute: 1,
    sdkMaxRetries: 0,
    contextExpansion: env.ENABLE_CONTEXT_EXPANSION,
  };
  if (!live) {
    console.log(
      JSON.stringify({
        mode: "dry-run; pass --live to send synthetic fixtures to the configured Gemini provider",
        cases: selectedCases.map(({ id }) => id),
        credentialsAvailable: Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY),
        analyticsModelConfigured: Boolean(env.AI_CHAT_MODEL),
        configuration,
        databaseReads: 0,
        providerCalls: 0,
      }),
    );
    return;
  }
  if (!acceptance) throw new Error("Live execution requires bounded --acceptance mode.");
  if (env.ENABLE_CONTEXT_EXPANSION !== "false") throw new Error("Expansion must be disabled.");
  if (
    !env.GOOGLE_GENERATIVE_AI_API_KEY ||
    !env.AI_CHAT_MODEL ||
    !env.AI_LIGHT_MODEL ||
    !env.AI_BACKUP_MODEL
  ) {
    throw new Error("Live verification unavailable: configured Gemini credentials/model missing.");
  }
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const reportDir = `docs/release/live-gemini-${runId}`;
  mkdirSync(reportDir);
  const provider = createGeminiProviders().analytics;
  const results: Array<Record<string, unknown>> = [];
  const runStartedAt = Date.now();
  let totalDispatches = 0;
  let logicalGenerations = 0;
  const persist = () =>
    writeFileSync(
      `${reportDir}/run.json`,
      JSON.stringify(
        {
          runId,
          configuration,
          generatedAt: new Date().toISOString(),
          dataPolicy:
            "Invented open fixtures only; no DB/storage/history/retrieval/embedding/rerank/indexing. Not production RAG acceptance.",
          bounds: { logicalGenerations: 3, sdkDispatches: 9, perCaseDispatches: 3 },
          logicalGenerations,
          sdkDispatches: totalDispatches,
          elapsedMs: Date.now() - runStartedAt,
          providerUsageStats: provider.usageStats,
          usageCaveat:
            "Adapter usageStats coerces missing fields to zero; use per-dispatch wire usage nulls for availability. Output may include thinking; do not add thinking again.",
          selectedCases: selectedCases.map(({ id }) => id),
          remainingCases: selectedCases.slice(results.length).map(({ id }) => id),
          results,
        },
        null,
        2,
      ) + "\n",
    );
  persist();
  console.log(JSON.stringify({ reportDir, configuration }));
  for (const testCase of selectedCases) {
    const startedAt = Date.now();
    const prompt = buildAnalyticsPrompt(
      `Yalnız açıq sintetik sınaq ssenarisini təhlil et; bu materiallar real cari xəbərlər deyil. ${testCase.query}`,
      testCase.sources,
      env.ANALYTICS_THINKING_LEVEL,
    );
    const dispatches: Array<Record<string, unknown>> = [];
    const diagnostics: Array<Record<string, unknown>> = [];
    const fallbacks: Array<Record<string, unknown>> = [];
    const originalFetch = globalThis.fetch;
    const originalConsole = { info: console.info, warn: console.warn, error: console.error };
    const diagnosticOnly = (...args: unknown[]) => {
      const line = args[0];
      if (typeof line === "string" && line.startsWith("[analytics-ai] ")) {
        diagnostics.push(JSON.parse(line.slice("[analytics-ai] ".length)));
        originalConsole.info(line);
      }
    };
    const record: Record<string, unknown> = {
      id: testCase.id,
      query: testCase.query,
      sources: testCase.sources,
      startedAt: new Date(startedAt).toISOString(),
      deadlineAt: new Date(startedAt + ANALYTICS_SERVER_DEADLINE_MS).toISOString(),
      systemPromptSha256: createHash("sha256").update(prompt.system).digest("hex"),
      fullPromptSha256: createHash("sha256").update(JSON.stringify(prompt)).digest("hex"),
      configuration,
      dispatches,
      diagnostics,
      fallbacks,
      semanticReview: { status: "PENDING_MANUAL_REVIEW" },
    };
    const casePath = `${reportDir}/${testCase.id}.json`;
    writeFileSync(casePath, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
    logicalGenerations += 1;
    const allowedModels = [env.AI_CHAT_MODEL, env.AI_LIGHT_MODEL, env.AI_BACKUP_MODEL];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const model = /^\/v1beta\/models\/([^/]+):generateContent$/.exec(url.pathname)?.[1];
      if (
        url.protocol !== "https:" ||
        url.hostname !== "generativelanguage.googleapis.com" ||
        !model ||
        !allowedModels.includes(model) ||
        init?.method !== "POST" ||
        dispatches.length >= 3 ||
        totalDispatches >= 9 ||
        Date.now() >= startedAt + ANALYTICS_SERVER_DEADLINE_MS
      ) {
        throw new Error("Verification network/budget guard rejected dispatch.");
      }
      const sentAt = Date.now();
      const entry: Record<string, unknown> = {
        model,
        startedAt: new Date(sentAt).toISOString(),
        startElapsedMs: sentAt - startedAt,
      };
      dispatches.push(entry);
      totalDispatches += 1;
      // Persist intent immediately. No URL query, body, headers or raw error is stored.
      writeFileSync(casePath, JSON.stringify(record, null, 2) + "\n");
      persist();
      try {
        const response = await originalFetch(input, init);
        entry["headersElapsedMs"] = Date.now() - sentAt;
        entry["status"] = response.status;
        if (response.ok) {
          const body = (await response.clone().json()) as Record<string, unknown>;
          const usage = body["usageMetadata"] as Record<string, unknown> | undefined;
          const number = (key: string) => (typeof usage?.[key] === "number" ? usage[key] : null);
          entry["usage"] = {
            inputTokens: number("promptTokenCount"),
            candidateTokens: number("candidatesTokenCount"),
            thinkingTokens: number("thoughtsTokenCount"),
            totalTokens: number("totalTokenCount"),
            cachedInputTokens: number("cachedContentTokenCount"),
          };
        }
        return response;
      } catch (error) {
        entry["errorCategory"] = getGeminiErrorCategory(error);
        throw error;
      } finally {
        entry["elapsedMs"] = Date.now() - sentAt;
        writeFileSync(casePath, JSON.stringify(record, null, 2) + "\n");
      }
    }) as typeof fetch;
    console.info = console.warn = console.error = diagnosticOnly;
    try {
      const generated = await withAiDiagnostics(
        {
          requestId: `${runId}-${testCase.id}`,
          startedAt,
          stage: "generation",
          generationAttempt: 1,
        },
        () =>
          provider.generateTextWithMetadata({
            ...prompt,
            maxAttempts: 1,
            deadlineAt: startedAt + ANALYTICS_SERVER_DEADLINE_MS,
            beforeRequest: async () => {
              if (dispatches.length >= 3 || totalDispatches >= 9)
                throw new Error("SDK dispatch budget exhausted.");
            },
            onFallback: (event) => {
              fallbacks.push({ ...event, elapsedMs: Date.now() - startedAt });
            },
          }),
      );
      const validation = validateCitations(generated.text, testCase.sources);
      const failureReasons = analyticsPublicationFailureReasons(
        generated.text,
        generated.finishReason,
        validation,
      );
      if (failureReasons.length) process.exitCode = 1;
      Object.assign(record, {
        status: "completed",
        model: generated.model,
        finishReason: generated.finishReason,
        elapsedMs: Date.now() - startedAt,
        answer: generated.text,
        validatedAnswer: validation.answer,
        publicationFailureReasons: failureReasons,
        structuralValidation: validation,
        structuralStatus: failureReasons.length ? "FAIL" : "PASS",
        deadlineStatus: Date.now() - startedAt <= ANALYTICS_SERVER_DEADLINE_MS ? "PASS" : "FAIL",
        usedLowReliability: validation.usedLowReliability,
      });
      console.log(
        JSON.stringify({
          id: testCase.id,
          finishReason: generated.finishReason,
          publicationFailureReasons: failureReasons,
        }),
      );
    } catch (error) {
      // Provider errors can contain request data and headers; never print/store them.
      const category = getGeminiErrorCategory(error);
      Object.assign(record, {
        status: "provider-failed",
        category,
        model: dispatches.at(-1)?.["model"] ?? null,
        answer: null,
        validatedAnswer: null,
        finishReason: null,
        structuralStatus: "INCOMPLETE",
        deadlineStatus: category === "timeout" ? "FAIL" : "INCOMPLETE",
        elapsedMs: Date.now() - startedAt,
      });
      console.log(JSON.stringify({ id: testCase.id, status: "provider-failed", category }));
      process.exitCode = 1;
    } finally {
      globalThis.fetch = originalFetch;
      Object.assign(console, originalConsole);
      record["dispatchCount"] = dispatches.length;
      results.push(record);
      writeFileSync(casePath, JSON.stringify(record, null, 2) + "\n");
      persist();
    }
    console.log(JSON.stringify({ id: testCase.id, casePath, dispatchCount: dispatches.length }));
    if (record["status"] === "provider-failed") break;
    if (process.argv.includes("--review-gate") && results.length < selectedCases.length) {
      const reader = createInterface({ input: process.stdin, output: process.stdout });
      const decision = await reader.question(
        "Local review checkpoint: type continue after reviewing the saved case: ",
      );
      reader.close();
      if (decision.trim() !== "continue") break;
    }
  }
  persist();
  console.log(`Saved synthetic-only report: ${reportDir}/run.json`);
}

main().catch(() => {
  console.error("Prompt verification could not start; no provider error or secret was printed.");
  process.exitCode = 1;
});
