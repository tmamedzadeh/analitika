import { describe, expect, it } from "vitest";
import { asSource, contextFixture, contextId } from "@/test/fixtures/analytics-context";
import { canPublishAnalyticsAnswer, validateCitations } from "@/server/analytics/citations";
import { buildAnalyticsPrompt } from "./analytics";

// Handwritten counterexamples document the boundary of structural validation.
// These are neither model outputs nor an automated semantic acceptance grader.
const scenarios = [
  {
    id: "C: absence of measurements",
    question: "Zavodun istehsal potensialını qiymətləndir.",
    evidence: "Zavodun yığım xətti yenilənib. İstehsal həcmi və məhsuldarlıq açıqlanmır.",
    grounded:
      "Yığım xətti yenilənib; istehsalın real miqyasını qiymətləndirmək üçün göstəricilər verilmir [1].",
    unsupported: "Göstəricilərin açıqlanmaması zavodun real istehsal gücünü məhdudlaşdırır [1].",
    requiredGuard:
      "Ölçülərin olmaması real potensialı deyil, onu qiymətləndirmə imkanını məhdudlaşdırır",
  },
  {
    id: "E: ratings do not establish official status",
    question: "Qəbul aktı və istismardan çıxarılma iddiası nə dərəcədə etibarlıdır?",
    evidence:
      "Qəbul aktında avadanlığın 1 oktyabrda qəbulu göstərilir. Mənbənin rəsmi statusu göstərilmir. İstismardan çıxarılma anonim iddiadır; müstəqil təsdiq yoxdur.",
    grounded:
      "Akt avadanlığın qəbulunu göstərir, lakin mənbənin rəsmi statusu göstərilmir. İstismardan çıxarılma təsdiqlənməmiş iddiadır [1].",
    unsupported:
      "A/1 olduğuna görə qəbul rəsmən təsdiqlənib. M2 material qrupu istismardan çıxarılmanın yanlış olduğunu sübut edir [1].",
    requiredGuard: "A/1 qiyməti onun rəsmi sənəd olduğunu öz-özünə sübut etmir",
  },
  {
    id: "C: different stages do not establish a transition weakness",
    question: "Nasos istehsalının inkişafını qiymətləndir.",
    evidence: "Prototipin hazırlanması və sabit seriya istehsalı ayrı mərhələlərdir.",
    grounded: "Prototipin hazırlanması və sabit seriya istehsalı fərqli mərhələlərdir [1].",
    unsupported: "Seriya istehsalına keçid zavodun əsas zəifliyidir və bu keçid gecikir [1].",
    requiredGuard:
      "Mərhələlərin fərqli olması keçidin problemli, gecikmiş və ya mümkünsüz olduğunu sübut etmir",
  },
  {
    id: "C: no completion evidence does not establish incompletion",
    question: "Anbarın yenilənməsi başa çatıbmı?",
    evidence: "Təqdim edilmiş hesabatda anbarın yenilənməsinin tamamlanması barədə məlumat yoxdur.",
    grounded: "Yenilənmənin tamamlanması təqdim edilmiş hesabatda təsdiqlənmir [1].",
    unsupported: "Anbarın yenilənməsi yarımçıq qalıb [1].",
    requiredGuard: "Tamamlanmanın təsdiqlənməməsi prosesin yarımçıq qaldığını",
  },
  {
    id: "C: commencement does not establish scale",
    question: "Yeni xidmətin əhatə dairəsini qiymətləndir.",
    evidence:
      "Yeni xidmət bir məntəqədə fəaliyyətə başlayıb. Xidmət göstərilən şəxslərin sayı açıqlanmır.",
    grounded:
      "Xidmət bir məntəqədə başlayıb; əhatə miqyasını say göstəricisi olmadan qiymətləndirmək mümkün deyil [1].",
    unsupported:
      "Xidmətin fəaliyyətə başlaması genişmiqyaslı nəticənin əldə edildiyini sübut edir [1].",
    requiredGuard: "fəaliyyətə başlanması isə miqyaslı nəticəni sübut etmir",
  },
  {
    id: "C: conditional supply risk remains a useful conditional assessment",
    question: "Tədarükün istehsala təsirini qiymətləndir.",
    evidence:
      "İstehsal idxal komponentlərindən asılıdır. Tədarükdə fasilə yaranarsa, istehsalın sabitliyi pozula bilər; faktiki fasilə qeydə alınmayıb.",
    grounded:
      "İdxaldan asılılıq tədarük fasiləsi yaranarsa istehsalın sabitliyi üçün risk yaradır; faktiki fasilə qeydə alınmayıb [1].",
    unsupported: "İdxaldan asılılıq artıq istehsalı dayandırıb və faktiki zəiflik yaradıb [1].",
    requiredGuard: "əsaslandırılmış riski şərti təsiri ilə izah et",
  },
  {
    id: "C: directly documented weakness must not be diluted into blanket uncertainty",
    question: "Xəttin fəaliyyətindəki zəifliyi qiymətləndir.",
    evidence:
      "Komponent çatışmazlığı səbəbindən xətt üç gün dayanıb. Hesabat bu asılılığı istehsalın təsdiqlənmiş zəifliyi kimi göstərir.",
    grounded:
      "Komponent asılılığı xətti üç gün dayandırıb və hesabatda təsdiqlənmiş istehsal zəifliyi kimi göstərilir [1].",
    unsupported:
      "Mənbədə yalnız mümkün risk var, faktiki dayanma və ya təsdiqlənmiş zəiflik yoxdur [1].",
    requiredGuard: "Mənbədə birbaşa təsdiqlənən zəifliyi isə açıq adlandır",
  },
  {
    id: "C: ranking a risk requires comparative evidence",
    question: "Layihənin risklərini qiymətləndir.",
    evidence:
      "Layihə bir təchizatçıdan asılıdır. Bu asılılıq tədarük riski yarada bilər. Digər risklərlə müqayisə verilməyib.",
    grounded:
      "Bir təchizatçıdan asılılıq mümkün tədarük riskidir; digər risklərlə müqayisə verilməyib [1].",
    unsupported: "Təchizatçı asılılığı layihənin ən həssas həlqəsi və başlıca problemidir [1].",
    requiredGuard: "sıralamalar müqayisəli əsas tələb edir",
  },
  {
    id: "C: comparative evidence permits a bounded principal-weakness conclusion",
    question: "Hesabatda müqayisə edilən iki zəiflikdən hansı daha ciddi təsir göstərib?",
    evidence:
      "Hesabat iki zəifliyi müqayisə edir: enerji fasiləsi xətti bir gün, komponent çatışmazlığı isə üç gün dayandırıb. Bu iki səbəb arasında əsas dayanma mənbəyi komponent çatışmazlığıdır.",
    grounded:
      "Hesabatda müqayisə edilən iki zəiflik arasında komponent çatışmazlığı daha uzun dayanma yaradıb: enerji fasiləsinin bir gününə qarşı üç gün [1].",
    unsupported:
      "Komponent çatışmazlığı müəssisənin bütün sahələr üzrə yeganə və ən böyük problemidir [1].",
    requiredGuard: "sıralamalar müqayisəli əsas tələb edir",
  },
  {
    id: "E: a date-confirming act does not establish official provenance",
    question: "Qəbul tarixini və sənədin mənşəyini izah et.",
    evidence: "Akt avadanlığın 2 sentyabr tarixində qəbulunu təsdiqləyir.",
    grounded:
      "Akt qəbulun 2 sentyabr tarixində olduğunu təsdiqləyir; sənədin rəsmi mənşəyi bu fraqmentdə göstərilmir [1].",
    unsupported: "Akt qəbul tarixini rəsmən təsdiqləyir və dövlət mənşəlidir [1].",
    requiredGuard: "aktın olması da dövlət mənşəyini göstərmir",
  },
  {
    id: "E: explicitly official content permits attributed official confirmation",
    question: "İdarənin qəbul barədə məlumatını izah et.",
    evidence:
      "Dövlət idarəsinin rəsmi açıqlaması qəbul tarixinin 2 sentyabr olduğunu rəsmən təsdiqləyir. Sonrakı istismar barədə məlumat verilmir.",
    grounded:
      "Dövlət idarəsinin rəsmi açıqlaması qəbulun 2 sentyabr tarixində olduğunu rəsmən təsdiqləyir; sonrakı istismar barədə məlumat verilmir [1].",
    unsupported: "Rəsmi açıqlama avadanlığın sonrakı istismarını da şübhəsiz təsdiqləyir [1].",
    requiredGuard: "yalnız müvafiq status və əminlik mənbədə açıq təsdiqləndikdə işlədilə bilər",
  },
  {
    id: "E: lack of corroboration retains collection scope",
    question: "Bu yoxlama materiallarında hansı təsdiq var?",
    evidence: "Sınaq toplusunda çatdırılmanı təsdiqləyən sənəd yoxdur.",
    grounded: "Sınaq toplusunda çatdırılmanı təsdiqləyən sənəd təqdim edilməyib [1].",
    unsupported: "Çatdırılmanı təsdiqləyən sənəd ümumiyyətlə mövcud deyil [1].",
    requiredGuard:
      "'Bu materiallarda təsdiq yoxdur' ifadəsi 'ümumiyyətlə təsdiq yoxdur' demək deyil",
  },
  {
    id: "E: unconfirmed decommissioning is not established falsehood",
    question: "İstismardan çıxarılma iddiasını qiymətləndir.",
    evidence:
      "Anonim şəxs avadanlığın istismardan çıxarıldığını bildirib. Təqdim edilmiş topluda iddianın müstəqil təsdiqi yoxdur.",
    grounded:
      "Anonim şəxsin istismardan çıxarılma iddiası təqdim edilmiş topluda müstəqil təsdiqlənmir [1].",
    unsupported:
      "Müstəqil təsdiq olmadığından anonim şəxsin istismardan çıxarılma iddiası yalandır [1].",
    requiredGuard: "iddianın yalan olduğunu sübut etmir",
  },
  {
    id: "E: paraphrasing preserves attributed uncertainty and time",
    question: "Daşınma barədə məlumatdan hansı nəticə çıxır?",
    evidence: "Operator iyulda gecikmə ola biləcəyini bildirib; faktiki gecikmə təsdiqlənmir.",
    grounded:
      "Operator iyul üçün mümkün gecikmə barədə məlumat verib; faktiki gecikmə təsdiqlənmir [1].",
    unsupported: "Daşınma hazırda şübhəsiz gecikir [1].",
    requiredGuard: "təsdiqin kimə və nəyə əsaslandığını, zaman və əhatə sərhədini saxla",
  },
  {
    id: "D: intention is not implementation",
    question: "Texniki xidmət, hazırlıq və birgə istehsalı müqayisə et.",
    evidence:
      "Texniki xidmət mərkəzi üçün iş planı təsdiqlənib. İlkin hazırlıq kursu keçirilib. Birgə istehsal üzrə yalnız niyyət protokolu imzalanıb; istehsala başlandığına dair məlumat yoxdur.",
    grounded:
      "İlkin kurs keçirilib, mərkəz üçün iş planı təsdiqlənib. Birgə istehsal isə niyyət mərhələsində göstərilir; istehsala başlanması təqdim edilmiş mənbədə təsdiqlənmir [1].",
    unsupported: "Üç istiqamət üzrə əməli icra eyni səviyyədədir və birgə istehsala başlanıb [1].",
    requiredGuard: "razılaşmanı müqavilə və onun icrası ilə qarışdırma",
  },
  {
    id: "D: an approved plan is not a completed activity",
    question: "Xidmət planı ilə keçirilmiş kursu müqayisə et.",
    evidence:
      "Xidmət mərkəzi üçün plan təsdiqlənib; planın icrası barədə məlumat yoxdur. Hazırlıq kursu keçirilib.",
    grounded:
      "Kurs keçirilib, xidmət planının icrası isə bu materialda təsdiqlənmir; mərhələlər fərqlənir [1].",
    unsupported: "Plan təsdiqləndiyi üçün xidmət də kurs kimi tam icra olunub [1].",
    requiredGuard: "təsdiqlənmiş plan onun icrasını",
  },
];

describe("synthetic grounding contracts and explicit validator limits", () => {
  it.each(scenarios)("$id", (scenario) => {
    const chunk = { ...contextFixture().primary[0]!, text: scenario.evidence };
    const source = asSource(chunk, 1);
    const prompt = buildAnalyticsPrompt(scenario.question, [source]);
    expect(prompt.prompt).toContain(scenario.question);
    expect(prompt.prompt).toContain(scenario.evidence);
    expect(prompt.prompt).not.toMatch(/\bM\d+\b/u);
    expect(prompt.system).toContain(scenario.requiredGuard);
    expect(scenario.grounded).not.toMatch(/\bM\d+\b/u);
    expect(scenario.grounded).not.toBe(scenario.unsupported);
    // Both pass structural gates. Editorial entailment must distinguish them.
    for (const answer of [scenario.grounded, scenario.unsupported]) {
      const validation = validateCitations(answer, [source]);
      expect(validation.failureReasons).toEqual([]);
      expect(canPublishAnalyticsAnswer(answer, "stop", validation)).toBe(true);
    }
  });

  it.each(["rəsmən təsdiqlənib", "dövlət tərəfindən təsdiqlənib", "şübhəsiz doğrudur"])(
    "A/1 does not license the unsupported upgrade %s; structural validation cannot detect it",
    (upgrade) => {
      const source = asSource(
        {
          ...contextFixture().primary[0]!,
          text: "Akt avadanlığın qəbul tarixini təsdiqləyir.",
        },
        1,
      );
      const prompt = buildAnalyticsPrompt("Bu məlumatın etibarlılığı nə dərəcədədir?", [source]);
      expect(prompt.prompt).toContain("Mənbə etibarlılığı: A (Tam etibarlı)");
      expect(prompt.prompt).toContain("Məlumat etibarlılığı: 1 (Təsdiqlənib)");
      expect(prompt.system).toContain("A/1 qiyməti onun rəsmi sənəd olduğunu öz-özünə sübut etmir");
      expect(prompt.system).toContain("rəsmi status və ya mütləq doğruluq əlavə etmə");
      const grounded =
        "Akt qəbul tarixini təsdiqləyir; rəsmi status bu fraqmentdə göstərilmir [1].";
      const unsupported = `A/1 qiymətinə görə qəbul ${upgrade} [1].`;
      for (const answer of [grounded, unsupported]) {
        const validation = validateCitations(answer, [source]);
        expect(canPublishAnalyticsAnswer(answer, "stop", validation)).toBe(true);
      }
    },
  );

  it("preserves D/5 and shared anonymous provenance across sparse citations without inventing confirmation", () => {
    const anchor = contextFixture().primary[0]!;
    const sources = [
      {
        ...asSource(
          {
            ...anchor,
            id: contextId(3),
            text: "Anonim şəxs avadanlığın istismardan çıxarıldığını iddia edir. Sınaq toplusunda müstəqil təsdiq yoxdur.",
          },
          3,
        ),
        sourceReliability: "D",
        infoCredibility: 5,
      },
      {
        ...asSource(
          {
            ...anchor,
            id: contextId(6),
            text: "Eyni anonim şəxsin həmin iddiası başqa bölmədə təkrar edilir; bu, müstəqil təsdiq deyil.",
          },
          6,
        ),
        sourceReliability: "D",
        infoCredibility: 5,
      },
    ] as const;
    const prompt = buildAnalyticsPrompt("Bu iddianın etibarlılığını qiymətləndir.", sources);
    expect(
      prompt.prompt.match(/Eyni ilkin materialın fraqmentləri: \[3\], \[6\]\./gu),
    ).toHaveLength(2);
    expect(prompt.prompt.match(/D \(Adətən etibarsız\)/gu)).toHaveLength(2);
    expect(prompt.prompt.match(/5 \(Ehtimal olunmayan\)/gu)).toHaveLength(2);
    expect(prompt.system).toContain(
      "Eyni ilkin mənbədən götürülmüş təkrar xəbərləri müstəqil təsdiq sayma",
    );
    expect(prompt.system).toContain("iddianın yalan olduğunu sübut etmir");
    expect(prompt.system).toContain("mənbənin etibarlılığı ilə konkret məlumatın doğruluğunu ayır");
    expect(prompt.prompt).not.toMatch(/\bM\d+\b/u);
    const grounded =
      "Sınaq toplusunda anonim iddia müstəqil təsdiqlənmir; [3] və [6] eyni ilkin şəxsin sözləridir [3][6].";
    const unsupported = "İki müstəqil mənbə istismardan çıxarılmanı təsdiqləyir [3][6].";
    for (const answer of [grounded, unsupported]) {
      const validation = validateCitations(answer, sources);
      expect(validation.usedLowReliability).toBe(true);
      expect(validation.failureReasons).toEqual([]);
      expect(canPublishAnalyticsAnswer(answer, "stop", validation)).toBe(true);
    }
  });
});
