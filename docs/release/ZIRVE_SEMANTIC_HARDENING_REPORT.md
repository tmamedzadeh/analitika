# ZIRVƏ V1 — Semantic hardening C/E

23 октября 2026, Asia/Baku. **Адресное изменение prompt и offline regressions подготовлено. Release остаётся NO-GO; C/E live semantic acceptance не переоценивалась. Новых Gemini/AI API calls: 0.**

## Scope and baseline

Прочитаны `AGENTS.md`, [Phase 4](ZIRVE_PHASE_4_REPORT.md), [live acceptance](ZIRVE_LIVE_GEMINI_ACCEPTANCE_REPORT.md), raw answers и manual reviews C/E/D, текущие prompt/tests и verifier. При входе branch `main`, HEAD `987972c697cce6bca1e95e69d75143ebf348193b`. При финальной сверке HEAD уже `8c7a853db18bbc834d84d2266e15e8a198339378` (`minor fix ui`): новый commit содержит только первоначальную staged UI-правку, prompt/tests он не затрагивает. Эта сессия commit/staging/push и других Git mutations не выполняла. Содержимое UI-файла осталось прежним; изменение HEAD принято как внешнее параллельное действие, не отменялось. Remote/API в этой offline-итерации не вызывались.

При входе уже существовали изменения verifier, staged UI-правка и неотслеживаемые live acceptance report/artifacts. Они сохранены. В этой итерации изменены только:

- [analytics.ts](../../src/server/prompts/analytics.ts) — четыре существующих system instructions.
- [analytics.test.ts](../../src/server/prompts/analytics.test.ts) — contracts и четыре новых test cases.
- [analytics-grounding.test.ts](../../src/server/prompts/analytics-grounding.test.ts) — контрастные synthetic examples и явная проверка ограничений structural gate.
- Этот новый отчёт.

Новая evaluation infrastructure и semantic postprocessor не создавались. Проверочные scripts/logs/baseline hashes в ignored `.release-backup.local/semantic-hardening/` — локальные служебные файлы, не production code.

## Root causes

**C:** источник различал создание линии и стабильный массовый выпуск. Ответ превратил различие стадий в установленную основную слабость перехода. Context содержал нужную границу; ошибка относится к grounded reasoning и citation entailment. Старый prompt подробно запрещал выводить слабый потенциал из отсутствия measurements, но не выражал общий запрет на переход «разные стадии → проблемный/задержавшийся переход», превращение возможного риска в фактическую слабость и неподтверждённое ранжирование.

Узкая прежняя ошибка «отсутствие показателей ограничивает сам потенциал» в последнем C прямо не повторена. Тем не менее unsupported weakness в вводном выводе оставила C FAIL. Синтаксически правильные [1]/[6] не подтверждают этот вывод.

**E:** source [1] говорил `Akt qəbul tarixini təsdiqləyir`, ответ добавил `rəsmən`. A/1 и наличие акта не устанавливают государственного издателя или официальный статус. Отдельно `Sınaq toplusunda ... yoxdur` превратилось в неограниченное `mövcud deyil`. Старые инструкции уже запрещали invented official status и глобальный вывод из непредставленного документа, но модель не сохранила их при перефразировании. Правило усилено на уровне смысла: степень уверенности, атрибуция подтверждения, время, scope и эквивалентные формулировки статуса.

Shared anonymous origin и отсутствие M-code leakage в последнем E прошли; они не отменяют official-status FAIL. Причины описаны по сохранённым output/review, без редактирования исторических ответов. Один sample не позволяет экспериментально отделить вклад модели от формулировки prompt.

## Prompt: before and after

| Существующий фрагмент | До | После |
| --- | --- | --- |
| Статус вывода | Факт / заявление / аналитическая оценка / прогноз | Явно различаются факт, заявление, возможный риск, аналитическая гипотеза и неизвестный показатель; прогноз не выдаётся за произошедшее событие. Прежние различия бюджета, плана, договора, периода сохранены |
| Непредставленное evidence | Отсутствие документа не равно его несуществованию; примеры платежа/поставки/исполнения | Общее сохранение уверенности, того, кто и чем подтверждает тезис, времени и scope при парафразе и синтезе; компактный контраст «в этих материалах нет подтверждения» / «подтверждения нет вообще». Сохранён запрет выводить несовершившееся событие из отсутствия evidence |
| Оценка потенциала | Длинный пример, привязанный к выпуску, производительности и тестам | Общее правило о разных стадиях, неподтверждённом завершении, утверждённом плане и масштабе результата. Метрики ограничивают оценку, не реальный потенциал. Возможный риск не становится установленной слабостью; ранжирование требует сравнительной базы. Прямо подтверждённую слабость разрешено называть слабостью |
| Статус источника | A/1 не доказывает official status; примеры `rəsmi` / `rəsmən təsdiqlənmiş` | Акт не доказывает государственное происхождение. Уверенность и официальный статус не усиливаются ни через `rəsmən`, ни через `dövlət tərəfindən təsdiqlənib` / `şübhəsiz doğrudur`. Такие выражения допустимы при явном source evidence соответствующего статуса и уверенности. D/5 не означает ложность |

Ключевые новые формулы:

> Mərhələlərin fərqli olması keçidin problemli, gecikmiş və ya mümkünsüz olduğunu sübut etmir.

> Mənbədə birbaşa təsdiqlənən zəifliyi isə açıq adlandır, əsaslandırılmış riski şərti təsiri ilə izah et.

> Parafraz və sintezdə iddianın əminlik dərəcəsini, təsdiqin kimə və nəyə əsaslandığını, zaman və əhatə sərhədini saxla; mənbənin əminliyini artırma.

Вместо накопления дополнительных блоков заменены четыре прежних абзаца. System prompt: **8877 → 9349 символов, +472 / +5,32%**; UTF-8 **10282 → 10832 bytes**; число строк/абзацев осталось **24**, число статических правил — **23**. Это char/byte measurement, не точные Gemini token counts.

- До: system SHA-256 `4d1479f538ab74177ea3de998b4bc4c7bca3c44d62e37c82b04ba112ba7e4f1d`.
- После: system SHA-256 `6ab0aade891488ed2c3d144b7c6e0eccee635d19acf870e299cf638960bba7cc`.

Код вне system block совпадает с исходным при нормализации Git line endings: source grouping/numbering, exact source text, query composition, auxiliary handling и options не менялись. В system остаются прежние правила причинной обоснованности, связи фактов между источниками, conditional forecasts, сравнений по одинаковым критериям, профессионального азербайджанского и отказа от формального limitations closing.

## Offline regression scenarios

Расширен существующий handwritten table; страны и формулировки live fixtures не зашиты в новые production-правила. В тестах используются, в частности, насосы, склад, услуга, логистика и поставщики.

| Группа | Контраст / положительный контроль |
| --- | --- |
| C — measurements | Отсутствие объёма/производительности ограничивает оценку масштаба, не реальную мощность |
| C — stages | Прототип и серийное производство — разные стадии; это не доказательство слабого или задержанного перехода |
| C — completion | Нет подтверждения завершения в отчёте; это не утверждение, что обновление склада осталось незавершённым |
| C — scale | Начало работы услуги в одной точке не доказывает широкий масштаб результата |
| C — supply risk | Зависимость допускает содержательный условный вывод о риске при сбое; фактическая остановка не выдумывается |
| C — real weakness, положительный контроль | Источник прямо фиксирует трёхдневную остановку из-за компонентов и слабость; ответ вправе назвать её слабостью. Безусловная осторожность здесь противоречила бы evidence |
| C — ranking | Возможный риск без сравнения не становится «главным» или «самым уязвимым» |
| C — comparative ranking, положительный контроль | При сравнении двух причин простоя допустим ограниченный вывод о большем воздействии одной; он не распространяется на все проблемы предприятия |
| E — date/act/A1 | Подтверждение даты и A/1 не добавляют официальный/государственный статус |
| E — equivalent upgrades | Отдельно проверены `rəsmən təsdiqlənib`, `dövlət tərəfindən təsdiqlənib`, `şübhəsiz doğrudur`: не только одно запрещённое слово |
| E — explicit official evidence, положительный контроль | При прямо указанном официальном сообщении государственного органа атрибутированное `rəsmən təsdiqləyir` допустимо; это не доказывает последующую эксплуатацию |
| E — scope | Сохранено `Sınaq toplusunda`; из отсутствия документа в коллекции не выводится его глобальное несуществование |
| E — unconfirmed versus false | Неподтверждённое анонимное списание не объявляется ложным |
| E — certainty/time/attribution | Сообщение оператора о возможной задержке в июле не превращается в бесспорную задержку сейчас |
| E — shared origin | Sparse [3]/[6] сохраняют D/5 и один первоисточник; повтор не становится двумя независимыми подтверждениями, M-коды не добавляются |
| D — implementation | Сохранён прежний пример intent ≠ implementation; добавлен контраст утверждённого service plan и уже проведённого курса |
| D — analytical contract | Одинаковые критерии сравнения, условные перспективы, полезные выводы, отсутствие обязательного `Məhdudiyyətlər` и fixed word count, thinking `medium`, ceiling 4096 |

`analytics-grounding.test.ts`: **3 → 20 tests** — 16 табличных scenarios, 3 A/1 paraphrase variants, 1 multi-fragment provenance case. `analytics.test.ts`: добавлены **4 contracts**. Общее увеличение suite — **21 test**.

**Граница доказательства:** правильные и ошибочные handwritten тексты намеренно одинаково проходят действующий structural citation validator. Tests фиксируют наличие инструкций, передачу synthetic evidence/metadata и эту ограниченность; не реализуют entailment detection и не доказывают, что Gemini теперь выдаёт правильные ответы. Тесты не превращают unsupported examples в semantic PASS. Никакие проверки citations не отключены.

## Validation

| Проверка | Результат |
| --- | --- |
| Full safe Vitest | **506/506 PASS**, 64 files, 0 failed/skipped; контрольный native child **exit code 0**, 66.47s |
| TypeScript app | PASS, `--noEmit --incremental false -p tsconfig.json` |
| TypeScript scripts/evaluation | PASS, `--noEmit --incremental false -p tsconfig.eval.json` |
| Full ESLint | PASS: 0 errors; прежний Fast Refresh warning `src/components/ui/button.tsx:48` |
| Prompt metrics | PASS: 4 заменённых абзаца; вне system block изменений нет; hashes/размеры указаны выше |
| Integrity / references | **PASS**: 59 protected files, 0 hash mismatches; reference checker 396 files / 220 relative Markdown links / 754 local imports / 0 failures; unstaged и staged whitespace checks чистые |

Первый full suite сообщил 506 PASS за 92.24s, но PowerShell перенаправление native stderr создало `NativeCommandError` и внешний shell status 1. Поэтому итоговый запуск сохранил stdout/stderr напрямую через `spawnSync` и отдельно записал реальный child exit code 0: 506 PASS за 66.47s. Тестовые предупреждения не скрываются; оба лога и `unit-exit.json` сохранены в ignored `.release-backup.local/semantic-hardening/`. В логах остаются прежние React notices о `act`, пустом `href` и test-root nesting, а также ожидаемые ошибки synthetic failure paths. Они не являются дополнительными test failures.

Full suite запускается через существующий `scripts/test.ts`: sensitive environment очищается, `NODE_ENV=test`, env-файлы не загружаются; `src/test/setup.ts` запрещает unmocked fetch. Используются unit tests/synthetic mocks. Имена DB, storage и Inngest в test cases относятся к mock-сценариям, внешние сервисы не запускались. Browser/E2E, production build, integration scripts и verifier с `--live` не запускались.

Команды локальной проверки:

```powershell
bun --no-env-file run scripts/test.ts --no-cache --configLoader runner --pool=threads --maxWorkers 1 --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.json
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.eval.json
node node_modules/eslint/bin/eslint.js --no-cache .
bun --no-env-file run scripts/check-references.ts
git diff --check
git diff --cached --check
```

## Analytical depth and remaining uncertainty

Риск чрезмерной осторожности остаётся: общее правило может заставить модель повторять оговорки или отказываться от обоснованного вывода. Поэтому positive controls разрешают прямо подтверждённую слабость, сравнительно установленный больший риск и официальный статус при явном evidence. Production instructions по-прежнему требуют объединять факты, объяснять значение и условные последствия и не ослаблять обоснованные выводы лишним сомнением. Оговорка относится к конкретному тезису, а не к обязательному завершающему разделу.

Эти contracts снижают риск очевидной деградации, но не измеряют реальное поведение модели. Не подтверждены: следование новым правилам в C/E generation, отсутствие новых форм overclaim, естественность азербайджанского после изменения и отсутствие чрезмерной осторожности в live output. D ранее прошёл за 6.115s **на прежнем prompt hash**; текущая итерация сохраняет его конфигурацию и проверяет только offline D contract. Новый live D PASS или production latency guarantee не заявляются.

Models, routing/fallback, quota/cooldown, thinking configuration, token/output budget, 105-second deadline, retrieval, embedding/rerank, chunking, citation architecture, authorization, DB schema, SSE/progress и Context Expansion не менялись. Expansion остаётся OFF; synthetic unit scenarios могут проверять оба значения flag без включения production expansion.

## Exact minimal future C/E acceptance plan — not executed

Требуется отдельное разрешение владельца. Текущий этап не использовал и не возобновлял прежний live budget.

1. Подтвердить intended code/version, новый system hash, boolean availability credentials и прежние resolved model IDs/thinking/4096 output ceiling. Не читать реальный корпус. `ENABLE_CONTEXT_EXPANSION=false` только у процесса verifier.
2. Использовать неизменённые open synthetic C/E fixtures из существующего verifier и **одну** последовательную генерацию C, затем **одну** E. Максимум **2 logical generations / 6 SDK dispatches**, по одному dispatch на уникальную route, `maxAttempts:1`, SDK `maxRetries:0`, только прежний fallback. Один общий абсолютный deadline **105s на case**, без timeout/token increase.
3. После C сохранить raw/validated answer и провести ручной entailment/editorial review перед E. Semantic FAIL не вызывает rerun; provider failure прекращает batch. Не запускать D, A/B, judges, embeddings, reranking или endpoint validation-retry.
4. Существующий `--acceptance` с `--case=C-assessment --case=E-reliability --review-gate` выбирает только эти два case в нужном порядке. Verifier создаёт unique timestamp+UUID outputs. Его общий schema ceiling 3/9 не является разрешением на третий case: фактические selected cases и per-case cap ограничивают данный план до 2/6.
5. C rejection: stages → реальная слабость/задержка; missing metrics → слабая мощность; условный supply risk → фактическая проблема; «основной/самый уязвимый» без comparison. Положительно оценить содержательный синтез upgrades/support/training/import risk, ясный статус заявления о тестах и сохранение полезных выводов.
6. E rejection: выдуманная официальность в любой формулировке, усиленная уверенность, потерянный collection/time scope, unconfirmed → false, repeat → independent corroboration или M-code leakage. A/1 и D/5 объясняются раздельно от официального статуса; приёмка не доказывает последующую эксплуатацию.
7. Для каждого ответа сохранить prompt hash, exact sources, model/routes/dispatches, timings, finish, nullable usage, structural failures, ручную source-by-source evidence table и азербайджанскую editorial review. Не редактировать raw перед оценкой, не придумывать usage/cost.
8. После C/E — отдельный отчёт и stop-gate. При неудаче только evidence и минимальное предложение; любые новые calls требуют нового разрешения. Bulletin E2E, commit, push и deployment в этот план не входят.

## Final state

| Условие | Итог |
| --- | --- |
| C/E hardening implementation | Подготовлено; offline checks не равны live semantic acceptance |
| C/E release blockers | **OPEN — UPDATED PROMPT REQUIRES OWNER-AUTHORIZED LIVE ACCEPTANCE** |
| D | Historical limited synthetic PASS сохранён; offline comparison contract защищён |
| Bulletin E2E | **OPEN — OWNER AUTHORIZATION REQUIRED** |
| Vercel / Inngest | **OWNER VERIFICATION REQUIRED** |
| Release | **NO-GO** |

Исторические raw outputs/reviews не перезаписаны: финальная hash-сверка 59 protected files включает прежние audit reports/JSON, все 9 artifacts последней live acceptance, verifier, provider/gateway/config, analytics pipeline и UI. Реальная БД, existing documents/chunks, S3, Inngest и AI API не использовались; эта сессия commit/push/merge/rebase/deployment не выполняла. Внешний UI-only commit описан в baseline выше; новые hardening changes остаются unstaged. **STOP: после этого отчёта не переходить к live calls или bulletin E2E. Production GO не объявляется.**
