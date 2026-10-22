import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

import { ANALYTICS_SERVER_DEADLINE_MS, type AnalyticsSource } from "../src/lib/analytics";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { getGeminiErrorCategory } from "../src/server/ai/gemini-gateway";
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
  const selectedIds = process.argv
    .filter((argument) => argument.startsWith("--case="))
    .map((argument) => argument.slice("--case=".length));
  if (selectedIds.some((id) => !cases.some((testCase) => testCase.id === id))) {
    throw new Error("Unknown verification case.");
  }
  const selectedCases = selectedIds.length
    ? cases.filter((testCase) => selectedIds.includes(testCase.id))
    : cases;
  if (!process.argv.includes("--live")) {
    console.log(
      JSON.stringify({
        mode: "dry-run; pass --live to send synthetic fixtures to the configured Gemini provider",
        cases: selectedCases.map(({ id }) => id),
        credentialsAvailable: Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY),
        analyticsModelConfigured: Boolean(env.AI_CHAT_MODEL),
        databaseReads: 0,
        providerCalls: 0,
      }),
    );
    return;
  }
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY || !env.AI_CHAT_MODEL) {
    throw new Error("Live verification unavailable: configured Gemini credentials/model missing.");
  }
  const provider = createGeminiProviders().analytics;
  const results: Array<Record<string, unknown>> = [];
  for (const testCase of selectedCases) {
    const startedAt = Date.now();
    try {
      const prompt = buildAnalyticsPrompt(
        `Yalnız açıq sintetik sınaq ssenarisini təhlil et; bu materiallar real cari xəbərlər deyil. ${testCase.query}`,
        testCase.sources,
        env.ANALYTICS_THINKING_LEVEL,
      );
      const generated = await provider.generateTextWithMetadata({
        ...prompt,
        maxAttempts: 1,
        deadlineAt: startedAt + ANALYTICS_SERVER_DEADLINE_MS,
      });
      const validation = validateCitations(generated.text, testCase.sources);
      const failureReasons = analyticsPublicationFailureReasons(
        generated.text,
        generated.finishReason,
        validation,
      );
      if (failureReasons.length) process.exitCode = 1;
      results.push({
        id: testCase.id,
        query: testCase.query,
        sources: testCase.sources,
        systemPromptSha256: createHash("sha256").update(prompt.system).digest("hex"),
        model: generated.model,
        finishReason: generated.finishReason,
        elapsedMs: Date.now() - startedAt,
        answer: generated.text,
        validatedAnswer: validation.answer,
        publicationFailureReasons: failureReasons,
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
      results.push({
        id: testCase.id,
        status: "provider-failed",
        category,
        elapsedMs: Date.now() - startedAt,
      });
      console.log(JSON.stringify({ id: testCase.id, status: "provider-failed", category }));
      process.exitCode = 1;
      break;
    }
  }
  // Selected cases write a distinct artifact so resumed checks never overwrite
  // an earlier provider failure or silently claim an uninterrupted successful run.
  const reportPath = selectedIds.length
    ? `docs/analytics-prompt-live-${selectedCases.map(({ id }) => id).join("_")}-audit.json`
    : "docs/analytics-prompt-live-audit.json";
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dataPolicy:
          "Invented open synthetic fixtures only; no database/storage/history access. Not real-world intelligence or proof of live RAG quality.",
        bounds:
          "Six sequential logical generations at most; one attempt per existing provider route; existing model/fallback/quota implementation unchanged; stop on first provider failure.",
        semanticReview:
          "Manual review required for relevance, grounding, Azerbaijani, synthesis, completeness, coherence, boilerplate, repetition, local caveats, citations, executive style and proportional length. Publication validation alone does not establish semantic quality.",
        completedCases: results.filter((result) => typeof result["answer"] === "string").length,
        selectedCases: selectedCases.map(({ id }) => id),
        remainingCases: selectedCases.slice(results.length).map(({ id }) => id),
        usage: provider.usageStats,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Saved synthetic-only report: ${reportPath}`);
}

main().catch(() => {
  console.error("Prompt verification could not start; no provider error or secret was printed.");
  process.exitCode = 1;
});
