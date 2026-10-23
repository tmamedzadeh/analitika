# ZIRVƏ V1 — Phase 4: Final QA & Engineering Readiness

23 октября 2026, Asia/Baku. Проверена локальная рабочая версия. **Вердикт: NO-GO** для выпуска: исторические P1 C/E и D не закрыты. Технически успешные локальные проверки не заменяют семантическую приёмку Gemini. STOP-GATE Фазы 4; Production GO не объявляется.

## A. Git & Change Integrity

- Ветка `main`, HEAD `8edcab6a9885d374c25db8dce25c5df29f9f8e95` сохранены.
- При входе: 55 staged, 10 unstaged tracked, 8 untracked файлов; staged и unstaged пересекаются. Прочитаны `AGENTS.md`, отчёты 2a/2b/3, финальный аудит и семантическое evidence предыдущего аудита, обе части diff. Более ранний финальный аудит описывает свой исторический HEAD, а не текущий baseline.
- Staged patch SHA-256 до/после: `28c1b0f355b6017b1f0aa15441be6384df4220e7807c7df80741374c8a4080d9`. Индекс Git не изменён. Исходные patches и hashes 69 ранее изменённых/новых файлов сохранены в `.release-backup.local/phase-4/baseline.json`.
- Из этих 69 файлов изменены только два теста: `src/test/analytics-layout.test.tsx` и `src/server/analytics/context-pipeline.test.ts`. Остальные 67 совпадают с baseline побайтно. Реализации, отчёты и evidence предыдущих фаз сохранены.
- Новые файлы Фазы 4: этот отчёт; `PHASE_4_BROWSER.json`, `PHASE_4_CONTEXT_REVIEW.json`; `scripts/verify-phase-4-ui.ts`, `scripts/verify-phase-4-context.ts`; две browser fixtures `scripts/fixtures/phase-4-*`; `src/test/fixtures/phase-4-context.ts`; `src/server/prompts/analytics-grounding.test.ts`. Ни один production-модуль в Фазе 4 не изменён.
- Итог: 55 staged / 11 unstaged tracked; 17 отдельных untracked файлов, включая восемь предыдущей фазы. Папка fixtures в кратком `git status` может отображаться одной строкой.
- Без commit, staging, push, merge, amend, rebase, reindex или deployment. Неожиданных изменений исходных файлов нет. Локальные build artifacts и служебные логи находятся в игнорируемых каталогах.

Исправленный UI-тест сохраняет один материал, два cited chunks, точные `[2]`/`[8]` и ссылки на соответствующие anchors. В answer mode проверяются два отображения счётчика `1 material / 2 fragments`, исключается завышенный cited count. Отдельный sources-only тест сохраняет retrieved counts. Устаревшее пояснение в UI не возвращалось.

## B. Full Test Results

| Проверка                    | Итог и границы доказательства                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Vitest                 | PASS: 485 tests / 64 files, 0 failures, 0 skipped; 487.38s. До добавления трёх grounding cases: 482/63 PASS                                                                                          |
| TypeScript app / evaluation | PASS, `--noEmit --incremental false`, оба проекта                                                                                                                                                    |
| ESLint                      | PASS: 0 errors; прежний Fast Refresh warning `src/components/ui/button.tsx:48`                                                                                                                       |
| Production build            | PASS: client + SSR + Nitro/Vercel output через фактическую конфигурацию проекта. Это локальная сборка                                                                                                |
| Edge desktop/mobile         | PASS: 18 isolated checks; 0 page errors, 0 external requests. [Evidence](PHASE_4_BROWSER.json)                                                                                                       |
| Context usefulness review   | PASS: 7 synthetic scenarios; только 1 expanded. [Evidence](PHASE_4_CONTEXT_REVIEW.json)                                                                                                              |
| Static security / integrity | PASS в заявленном объёме: staging/HEAD сохранены, неожиданных изменений нет; четыре credential-pattern проверки изменённых файлов без совпадений; 32 клиентских artifacts без серверных env-маркеров |
| References                  | PASS: 385 files, 206 relative Markdown links, 753 local imports; failures 0                                                                                                                          |
| Whitespace                  | Unstaged diff clean. `git diff --cached --check` возвращает прежнюю пустую строку в EOF `ZIRVE_PHASE_2A_REPORT.md:76`. Этот staged report не исправлялся и не маскировался                           |

Воспроизводимый окончательный unit-прогон:

```powershell
$env:BUN_RUNTIME_TRANSPILER_CACHE_PATH=''
bun --no-env-file run scripts/test.ts --no-cache --configLoader runner --pool=threads --maxWorkers 1 --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.json
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.eval.json
node node_modules/eslint/bin/eslint.js --no-cache .
bun --no-env-file run scripts/check-references.ts
bun --no-env-file run scripts/verify-phase-4-context.ts
bun --no-env-file run scripts/verify-phase-4-ui.ts
```

Нестандартные runners прочитаны до запуска. Unit runner удаляет sensitive env и запрещает unmocked fetch. Browser runner использует собственный Vite без project config и env, точные aliases серверных функций на synthetic fixtures, loopback origin и блокировку внешних запросов. Context runner импортирует чистые функции и запрещает fetch. Build helper удаляет sensitive env, отключает env loading, ставит test-runtime marker против dotenv, запрещает fetch и запускает `createBuilder({ envDir: false }, null).buildApp()`. Nitro потребовал разрешённый расширенный filesystem-доступ для Windows tracing; внешние действия не выполнялись.

Промежуточные попытки не скрыты: первый полный прогон с двумя workers успешно завершил 482 tests / 63 files за 283.10s ещё до добавления трёх grounding counterexamples. Его вывод появился с задержкой; первоначальное предположение о зависании было ошибочным. Следующий промежуточный прогон с `pool=threads`, двумя workers был остановлен без результата после примерно 113s; это не доказательство зависания или дефекта приложения. Окончательная таблица относится к полному последовательному прогону со всеми добавленными тестами. Первый browser startup превысил 15 секунд; увеличено только navigation wait стенда до 60 секунд. Последующие ошибки локаторов accessible name/pending label исправлены в стенде. Финальный browser прогон чистый. ESLint сначала обнаружил форматирование нового runner; исправлено, повторный полный lint успешен.

В unit logs встречаются предупреждения React о test-root `<html>` внутри `<div>`, пустом `href` и отдельных обновлениях вне `act`. Они не скрывались; isolated browser не зарегистрировал page errors. Build также сохраняет прежние notices: `vite-tsconfig-paths`, non-route `attachments.test.ts`, experimental Node type stripping. Эти сообщения не равнозначны runtime-проверке deployed сайта.

Скриншоты находятся в `.release-backup.local/phase-4/`. Визуально просмотрены mobile document catalog, mobile analytics progress и desktop settings: контент не перекрывается. Автоматически проверены initial skeleton, сохранение карточек при background refresh, отсутствие сдвига заголовка после delayed indicator, локальная pagination, filtered empty/error/retry, settings pending/error и стабильная ширина кнопки, login pending/401/429, keyboard submit/navigation, 44px cancel, reduced motion и отсутствие page overflow. Это выборочные измерения, не универсальная гарантия отсутствия CLS/flashing. Существующие loader tests проверяют delay/quick completion; route переход проверен с синтетическим loader. Реальные auth/storage/jobs здесь не запускались.

### Critical regression review

- Network dispatch вынесен из source-access transactions. `beforeRequest` запускается после gateway ожидания перед каждым фактическим SDK dispatch, повтором и fallback; после проверки повторно проверяется abort. SDK retries отключены, gateway владеет бюджетом. Тесты реальных adapters с mocked HTTP проверяют три dispatches embedding → rerank → generation для всех `open/secret/top_secret/special`, при flag OFF и ON. Classification не вводит отдельный запрет Gemini для разрешённых материалов.
- Проверяются active account, текущий clearance, committed parent, точный chunk UUID, parent, текст и offsets. Все отправленные rerank excerpts проверяются, включая кандидатов вне итоговых десяти. Перед публикацией повторно проверяется полный ordered mapping `[n]`. Короткая synchronous публикация выполняется под locks; AI там отсутствует.
- Expansion добавляет полную identity-проверку UUID/parent/text/offset/ord/section/table/model. После обнаруженной замены/revocation нет публикации старого ответа; optional preparation SQL error допускает baseline только после rollback и обязательного baseline guard.
- SSE проходит starting → retrieval → sources → generation → validation; validation retry возвращается в generation. Draft не публикуется; финальный текст приходит только после structural validation и final access check. Проверены fallback, cancel, server deadline, disconnect, history final persistence race; terminal state не перезаписывается поздней отменой. UI освобождается по final до EOF и по своему deadline даже при transport, игнорирующем abort.
- `Son sorğular`: немедленно очищает старый ответ, показывает loading выбранной записи, abort предыдущего и epoch guard исключают поздний success/failure/cleanup; тот же pending ID не запускает дубль. History повторно проверяет текущий доступ; скрытые provenance hashes не попадают в public sources/counts.
- Это point-in-time гарантии: материал, уже переданный провайдеру при разрешённом доступе, нельзя отозвать задним числом. Concurrent replacement проверен моделями транзакций/lock-протокола, не реальным Postgres stress test.

## C. Executive Analytics

Локально подтверждены prompt contracts: азербайджанский, запрет выдуманных фактов/статусов, отсутствие fixed word count и обязательного limitations closing, разделение факта/утверждения/оценки, учёт единого первичного материала, запрет технических M-кодов. Citation validator проверяет membership, ranges, форму и completeness/finish reason; он **не проверяет entailment, грамматику, официальность или причинную обоснованность**.

Добавлены три handwritten C/E/D counterexamples в `analytics-grounding.test.ts`. Правильный и ошибочный варианты каждого проходят одинаковую structural gate — тест намеренно делает этот предел явным, не объявляет ошибочный текст правильным. При C отсутствие измерений ограничивает возможность оценки, не саму мощность. При E A/1 не доказывает официальный статус; неподтверждённое D/5 не равно ложному, M2 не должен попадать в ответ. При D проведённый курс, утверждённый план и намерение производства — разные стадии. Реальных model outputs в этих тестах нет.

Историческое evidence [semantic review](FINAL_ANALYTICS_SEMANTIC_REVIEW.md) остаётся действующим: C-repeat дал неподдержанный вывод, E приписал официальный статус и вывел M2, D не завершился за 105.001s. Последние guards не имеют нового live evidence. Это **открытые P1**, а не семантический PASS.

### Минимальный план live acceptance — подготовлен, НЕ ВЫПОЛНЕН

Нужно отдельное разрешение владельца на следующие пределы. Только явно вымышленные open fixtures из `scripts/verify-analytics-prompt-quality.ts`; без DB, retrieval, embeddings, rerank, S3, history и Inngest. Expansion OFF. Сначала C и E, затем отдельный D, последовательно; никакого массового A/B и повторного автоматического прогона после неудачи.

| Case / точный вопрос                                                                                            | Необходимый результат и editorial rejection criteria                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C — `İranın raket və pilotsuz sistemlər üzrə müdafiə-sənaye potensialını qiymətləndir.`                         | Синтез upgrades/service/training и import dependency; слова о завершённых tests остаются атрибутированным заявлением. Не выводить слабую мощность/технический провал из отсутствия объёмов, производительности и протоколов. Не превращать новую линию в доказанную массовую выработку. Проверить [1]/[3]/[6] рядом с соответствующими выводами |
| E — `Avadanlığın qəbul və istismardan çıxarılması barədə bu məlumatların etibarlılıq səviyyəsi nə dərəcədədir?` | Приёмка 1 октября относится к приёмке, не к combat performance/дальнейшей эксплуатации. Объяснить A/1 и D/5 по смыслу, без выдуманного official status. [3]/[6] одной анонимной первоосновы не считать независимым подтверждением. Decommissioning — неподтверждённая, не автоматически ложная информация. Никаких M-кодов                      |
| D — `Rusiya və İran arasında hərbi əməkdaşlığın əsas istiqamətlərini müqayisə et.`                              | Сопоставить service plan / проведённый курс / production intent по одинаковым критериям, сохранить различие реализации. Не придумывать цену/срок/technology-transfer terms. Полный ответ в существующие 105s; ссылки [1]/[3]. Timeout — сохранённый failure, без retry всего сценария                                                           |

Конфигурация: существующие `AI_CHAT_MODEL → AI_LIGHT_MODEL → AI_BACKUP_MODEL`, без изменения route/cooldown/quota; зафиксировать разрешённые resolved model IDs перед запуском. В `.env.example` это `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`; production values в Фазе 4 не читались и не подтверждались. Thinking — действующий `ANALYTICS_THINKING_LEVEL` (schema default medium), output ceiling 4096, абсолютный deadline 105s/case, `maxAttempts:1` на route, SDK `maxRetries:0`. Никакого endpoint validation-retry в этом prompt verifier.

Объём разрешения: **2 logical generations C/E, максимум 6 SDK dispatches; отдельный D — 1 logical generation, максимум 3 dispatches; вместе не более 9** при трёх уникальных configured routes. Успех первого route означает один dispatch. Один общий 105s бюджет на каждый logical case, не 105s на каждый fallback; максимум 315s суммарных case budgets плюс запуск/сохранение. Биллинг unsuccessful/thinking requests заранее точно неизвестен; 9 dispatches — верхняя граница числа, не обещание точной token-стоимости. Batch прекращается при первом provider error; после semantic rejection дальнейшие кейсы только в пределах отдельно согласованного плана, без reruns. Не менять модель или увеличивать время, чтобы получить зелёный результат.

Перед будущим запуском обеспечить отдельные Phase-4 timestamped output files, не перезаписывая historical C/E/D JSON; текущий verifier выбирает имя по case IDs, поэтому старые команды нельзя слепо повторять. Для C/E и D сохранить question/source text, prompt hash, raw/validated answer, finishReason, actual model/fallback, dispatch count, elapsed и доступные usage. Ошибки хранить sanitized, без headers/secrets/raw provider error. На каждый factual/causal тезис составить таблицу «тезис → точный [n] → цитируемый текст → supported/unsupported»; отдельный редактор проверяет профессиональный азербайджанский, заголовки, логичность, полноту, отсутствие шаблонов/повторов и пропорциональность ответа. Все существенные unsupported claims, invented status, M-code leakage или незавершённый ответ означают FAIL независимо от citation validation.

Для D локально проверены 75s generation, timeout/retry/cancel/fallback механизмы и metadata diagnostics (requestId, stage, model, attempt, status/category, elapsed, finishReason). Они позволяют отличить будущую задержку queue/retry/dispatch от completion, но историческую provider-side причину не устанавливают. Не приписывать старый timeout квоте, модели, reasoning или deployment без evidence. Успех одного будущего D — ограниченная проверка воспроизведения, не гарантия production latency после retrieval.

## D. Context Expansion

Flag остаётся **OFF по умолчанию**, `.env.example=false`, schema default false. Production env не менялся. OFF не добавляет preparation SQL и сохраняет baseline prompt; предыдущая побайтовая проверка baseline доступна в `.release-backup.local/phase-3/baseline-prompt-check.json`, актуальные тесты покрывают OFF/no-eligible behavior. Ни одного дополнительного AI/embedding/rerank вызова.

ON: первые три результата, пригодные нетабличные chunks ≥800 chars с разделом; один neighbor batch для ord±1 с тем же parent/model/section, максимум шесть кандидатов и три auxiliary excerpts. Preparation — максимум 6 statements для одного parent kind / 7 для mixed kinds, независимо от количества anchors; локальные 250ms statement / 100ms lock timeouts. Dispatch/final revalidation добавляет один batch максимум 13 identities. Parent locks согласованы с существующим atomic index replacement; версия не склеивается по одному ord.

Новый endpoint-тест сохраняет все десять primary numbers `[1]…[10]`, точные chunk IDs и десять history source entries при добавлении двух auxiliary chunks. Provenance содержит 12 fingerprints, без дополнительных `n`. Auxiliary не становится citation/source count и не заменяет citable text; history хранит private hashes в существующем snapshot, проверяет их даже при выключенном flag и fail-closed скрывает устаревший expanded answer.

Budget включает инструкции и labels: ≤20% primary chars **и** UTF-8 bytes, дополнительно ≤2400 bytes. Exact Gemini token overhead **не измерен**: char/byte bounds не являются гарантией той же token-доли. Это ограничение при будущем решении включать flag.

Практический synthetic review: из семи специально отобранных сценариев expanded только boundary continuation: 2 excerpts, 614 дополнительных chars / 631 UTF-8 bytes, +15.55% по chars. Добавлено языковое завершение/уточнение уже имеющейся мысли, не самостоятельный новый факт. Самодостаточный chunk, новый факт/число, иной section, иной embedding model, отсутствие neighbor и обычная synthetic prose после реального chunker дали baseline без expansion. Числа `777`/`999` из новых соседских фактов в prompt не прошли.

Это **узкая применимость**, не измеренная corpus hit-rate и не доказанный прирост качества model answer. Консервативный vocabulary/overlap filter может делать функцию практически неактивной на многих текстах; лексическая эвристика сама по себе не является semantic proof. Защита ради частоты не ослаблялась. Рекомендация на отдельную итерацию: сначала измерить отказы/полезность на разрешённых данных и точные tokens; до этого оставить OFF.

## E. Data Safety

Реальная БД не читалась и не изменялась. Не было S3/worker/Inngest/API Gemini операций, reindex или изменений production env/secrets. Browser API и формы работали только с памятью isolated fixture. Единственный сервер — временный loopback Vite, закрыт после проверки. Build только создал локальные artifacts.

Реальные документы, бюллетени, chunks, embeddings и history не использовались как targets. Corpus digest не вычислялся, так как DB-доступ не выполнялся. Сохранность корпуса следует из отсутствия операций с ним; независимое DB before/after сравнение не заявляется. Cleanup synthetic DB/storage не требовался — таких fixtures не создавалось.

### Исторический bulletin E2E и минимальный owner scenario

[Последний app browser evidence](FINAL_ANALYTICS_APP_BROWSER.json) содержит FAIL объединённого create/detail/edit/lexical-search сценария. Более ранний `BROWSER_E2E.json` был PASS, но относится к другому artifact hash и не закрывает последующий FAIL. Точную failing operation исторический JSON не устанавливает.

Изолированные route/component tests покрывают create/edit payload, переход на detail, published badge, explicit search submit/empty, filters/pagination. Новый browser покрывает настоящий каталог с synthetic transport. Они не подтверждают реальный HTTP→DB→detail/search round trip. Исторический FAIL остаётся открытым.

Общая БД единственная; отдельная тестовая БД не создавалась. `requireProjectEvaluationDatabase()` проверяет наличие project URL, **не доказывает изоляцию**. Существующий `scripts/verify-browser.ts` не запускался: он создаёт users/documents/bulletins/sessions, работает с storage и вызывает document processing, то есть значительно шире нужного сценария.

Минимальный будущий owner run требует отдельного разрешения и доказанной изоляции open fixtures: уникальный run ID, тестовый пользователь и ровно один новый open bulletin, никаких существующих материалов/attachments и никаких AI/indexing events. `saveBrief` при `needsIndexing` действительно отправляет `briefIndexingRequested`; наличие injectable `sendIndexing` в mutations не отключает delivery в обычном HTTP route. Поэтому до старта нужен scoped test-only transport, изолирующий event dispatch для точных fixture IDs; без него этот план запускать нельзя. Rollback DB-транзакция сама по себе не изолирует записи, сделанные browser HTTP в других connections.

В согласованное окно снять canonical ordered digests всех nonfixture corpus rows (documents, briefs, chunks, embeddings, attachments, history и затрагиваемых job rows), без вывода содержимого. Создать бюллетень с уникальными словами `qa<runid> alpha bravo`, проверить URL UUID и detail; изменить только этот bulletin, убедиться в readback; выполнить поиск по двум словам, затем с отсутствующим словом, проверить exact ID и empty state. Записать actionPhase, sanitized HTTP statuses и screenshot на каждой границе. В `finally` удалить только точные fixture IDs, созданные sessions/users/jobs; доказать отсутствие остатков и равенство nonfixture digests до/после. При невозможности доказать isolation/cleanup тест не запускать. Текущая Фаза 4 этого owner run не выполняет.

## F. Unresolved Issues

| Severity / проблема                                  | Установленная причина и реальный риск                                                                                                                                                 | Необходимое действие                                                                                    | Release blocker                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **P1 — C/E semantic acceptance**                     | Исторические unsupported inference / invented official status / M2; последний prompt не проверен Gemini. Structural validation их не отсеивает; риск неверного управленческого вывода | Отдельно разрешённые bounded C/E + полная editorial entailment/Azerbaijani review                       | **Да**                                           |
| **P1 — D comparison deadline**                       | Исторические 105.001s без ответа; provider-side причина неизвестна. Риск недоступности сложного сравнительного ответа                                                                 | Отдельный bounded D, сохранить timings/fallback/usage и результат; не менять бюджеты без доказательства | **Да**                                           |
| **P2 — historical bulletin E2E**                     | Объединённый live FAIL, точная операция неизвестна; mocks не доказывают полный persistence/search flow                                                                                | Минимальный owner scenario с доказанной изоляцией, digest и cleanup                                     | **Да, до подтверждения основного bulletin flow** |
| **P2 — expansion applicability / token measurement** | Узкие lexical/boundary условия; нет corpus benefit или exact provider-token evidence                                                                                                  | Сохранить OFF; отдельная ограниченная оценка перед enablement                                           | Нет при OFF; условие допуска ON                  |
| **P3 — existing tool notices / whitespace**          | Fast Refresh, build/test fixture notices и одна staged EOF blank line                                                                                                                 | Отдельная housekeeping итерация, без переписывания staged evidence                                      | Нет                                              |

Новых P0 или подтверждённых дефектов production-кода в разрешённом локальном объёме не обнаружено. Этот вывод ограничен mocks/static/browser harness и не является сертификацией production concurrency, corpus или provider semantics.

## G. Owner Verification

**Vercel — OWNER VERIFICATION REQUIRED / ПРОВЕРЯЕТ ВЛАДЕЛЕЦ.** Deployed SHA, production build status, runtime configuration/errors и deployment state проверяет владелец. Локальная сборка эти пункты не закрывает.

**Inngest — OWNER VERIFICATION REQUIRED / ПРОВЕРЯЕТ ВЛАДЕЛЕЦ.** Function registration, event processing, worker/recovery runs проверяет владелец. Фаза 4 не вызывала events и не инспектировала production dashboard.

## H. Final Engineering Verdict

**NO-GO.** Локальные изменения подготовлены к review; один известный тестовый mismatch исправлен без возврата устаревшего UI, проверки доступа/публикации и десяти citations сохранены. Но критическая семантическая приёмка C/E, ограниченная live-проверка D и основной bulletin E2E остаются условиями выпуска. Context expansion остаётся OFF. Окончательный Production GO принимает владелец после закрытия blockers и своих Vercel/Inngest проверок.

**STOP-GATE Фазы 4 достигнут.** Ни commit/push/merge, ни live AI, ни reindex/deployment этим отчётом не разрешаются и не выполняются.
