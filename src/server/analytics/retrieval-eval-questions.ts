export type EvalQuestion = {
  query: string;
  expectedSources: string[];
  sourceKind?: "document" | "brief";
  filters?: { period?: "all" | "30d"; directionIds?: string[] };
  noAnswer?: boolean;
};

/** Stable labels derived from the corpus source keys, not generated UUIDs. */
export const retrievalEvalSources = {
  briefDroneBase: "brief:2026-10-18:drone",
  briefIranMinister: "brief:2026-10-18:minister",
  briefArmeniaBudget: "brief:2026-10-17:budget",
  briefTerritorialClaims: "brief:2026-10-17:territorial",
  briefHormuz: "brief:2026-10-16:hormuz",
  briefIranMissiles: "brief:2026-10-15:missile",
  briefArmeniaDiversification: "brief:2026-10-14:diversification",
  briefRussiaIndustry: "brief:2026-10-13:industry",
  briefIranReconstitution: "brief:2026-10-12:reconstitution",
  briefSouthCaucasus: "brief:2026-10-11:caucasus",
  docDroneBase: "document:2026-10-15:drone",
  docRussiaIndustry: "document:2026-07-14:industry",
  docRussiaBudget: "document:2026-09-28:budget",
  docStrikeCampaign: "document:2026-08-25:strike",
  docIranReconstitution: "document:2026-10-18:reconstitution",
  docHormuz: "document:2026-10-18:hormuz",
  docIranMissiles: "document:2026-06-23:missile",
  docArmeniaBudget: "document:2026-10-01:budget",
  docArmeniaDiversification: "document:2026-08-18:diversification",
  docArmeniaRussia: "document:2026-09-30:armenia-russia",
} as const;

const s = retrievalEvalSources;
export const retrievalEvalQuestions: EvalQuestion[] = [
  // Each expected key is a corpus label derived from date plus a stable subject token.
  {
    query: "Rostov peyk görüntüləri buraxılış platformaları",
    expectedSources: [s.docDroneBase, s.briefDroneBase],
  },
  {
    query: "Rusiyanın müdafiə sənayesi istehsal gücü komponentlər",
    expectedSources: [s.docRussiaIndustry, s.briefRussiaIndustry],
  },
  { query: "Rusiya 2027 müdafiə büdcəsi 17,1 trilyon rubl", expectedSources: [s.docRussiaBudget] },
  {
    query: "kütlə ilə dəqiqliyin birləşdirilməsi zərbə kampaniyası",
    expectedSources: [s.docStrikeCampaign],
  },
  {
    query: "Mehrdad Akhlaqi müdafiə naziri sənaye bazasının bərpası",
    expectedSources: [s.docIranReconstitution, s.briefIranMinister],
  },
  {
    query: "Hörmüz boğazı gəmiçilik sığorta enerji",
    expectedSources: [s.docHormuz, s.briefHormuz],
  },
  {
    query: "İran raket arsenalı PUA regional çəkindirmə",
    expectedSources: [s.docIranMissiles, s.briefIranMissiles],
  },
  { query: "Ermənistan 613 milyard dram müdafiə büdcəsi", expectedSources: [s.docArmeniaBudget] },
  {
    query: "Hindistan Fransa ABŞ müdafiə təchizatının şaxələndirilməsi",
    expectedSources: [s.docArmeniaDiversification, s.briefArmeniaDiversification],
  },
  {
    query: "Ermənistan KTMT Rusiya təhlükəsizlik asılılıqları",
    expectedSources: [s.docArmeniaRussia, s.briefSouthCaucasus],
  },
  {
    query: "potensial gündəlik buraxılış tutumu",
    expectedSources: [s.briefDroneBase],
    sourceKind: "brief",
  },
  {
    query: "mənbənin müstəqil təsdiqləmədiyi ərazi iddiaları",
    expectedSources: [s.briefTerritorialClaims],
    sourceKind: "brief",
  },
  {
    query: "Ermənistan Hindistan müdafiə memorandumu",
    expectedSources: [s.briefArmeniaDiversification],
    sourceKind: "brief",
    filters: { period: "30d" },
  },
  {
    query: "Ermənistan Rusiya təhlükəsizlik əlaqələri",
    expectedSources: [s.docArmeniaRussia],
    filters: { directionIds: ["OSINT"] },
  },
  {
    query: "Rusiya müdafiə sənayesinin komponent təchizatı",
    expectedSources: [s.docRussiaIndustry],
    sourceKind: "document",
  },
  { query: "Azərbaycan 2025 günəbaxan yağı ixracı", expectedSources: [], noAnswer: true },
  {
    query: "Bakı dövlət xəstəxanalarında qrip peyvəndinin rəsmi göstəricisi",
    expectedSources: [],
    noAnswer: true,
  },
];
