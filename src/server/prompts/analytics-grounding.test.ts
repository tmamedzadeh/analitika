import { describe, expect, it } from "vitest";
import { asSource, contextFixture } from "@/test/fixtures/analytics-context";
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
    requiredGuard: "potensialın real miqyasını qiymətləndirməyə imkan vermir",
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
    id: "D: intention is not implementation",
    question: "Texniki xidmət, hazırlıq və birgə istehsalı müqayisə et.",
    evidence:
      "Texniki xidmət mərkəzi üçün iş planı təsdiqlənib. İlkin hazırlıq kursu keçirilib. Birgə istehsal üzrə yalnız niyyət protokolu imzalanıb; istehsala başlandığına dair məlumat yoxdur.",
    grounded:
      "İlkin kurs keçirilib, mərkəz üçün iş planı təsdiqlənib. Birgə istehsal isə niyyət mərhələsində göstərilir; istehsala başlanması təqdim edilmiş mənbədə təsdiqlənmir [1].",
    unsupported: "Üç istiqamət üzrə əməli icra eyni səviyyədədir və birgə istehsala başlanıb [1].",
    requiredGuard: "razılaşmanı müqavilə və onun icrası ilə qarışdırma",
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
    // Both pass structural gates. Editorial entailment must distinguish them.
    for (const answer of [scenario.grounded, scenario.unsupported]) {
      const validation = validateCitations(answer, [source]);
      expect(validation.failureReasons).toEqual([]);
      expect(canPublishAnalyticsAnswer(answer, "stop", validation)).toBe(true);
    }
  });
});
