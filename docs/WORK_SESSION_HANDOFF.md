# Актуальный итог — 22 октября 2026

**Production NO-GO.** Продолжено по [финальному заданию](release/PRODUCTION_RELEASE_REQUEST.md), разрешающему commit/push/PR/merge/deploy после gates. Позднее владелец ответил «пропусти это» на запрос Vercel доступа: access-dependent work пропущен, gate не объявлен PASS.

Code commit **dd76d2e624ec43444cda974e5929a6124b4d6696** pushed, [draft PR #1](https://github.com/tmamedzadeh/analitika/pull/1). Vercel auto-preview success (`833Fp43aHCXLFuj4ciH7VfL6BEh1`); никаких manual production deploy/merge. Существующий project automation credential позволил read-only runtime probe без management: preview signed Inngest GET200 / 6functions, production200 / 8functions; unsigned401. Новый preview не считать production. Receipt/preview evidence в release/.

**P0 actual preview generation FAIL:** настоящий HTTP open query вернул sources→error без validated final. Real login/Secure cookie в ту же DB, browser-hydrated document/clearance/retired404 и private attachment PASS. PREVIEW_SMOKE / PREVIEW_MODEL_CONFIG: configured primary gemini-3.8-flash, sources-only done, actual answer FAIL. Причина (provider/config/validation) без logs не установлена; локальные generation3PASS это не перекрывают. Exact preview fixture/object cleanup выполнен. Для GO нужно устранить runtime failure и проверить cloud/revision/rollback, не merge зелёный preview deployment автоматически.

Результат и подробная acceptance matrix: [V1_FINAL_PRODUCTION_REPORT.md](V1_FINAL_PRODUCTION_REPORT.md), актуальный [audit](V1_PROD_HARDENING_AUDIT.md). Git branch codex/zirve-v1-rc-resume, исходная база a45706e8c0979df1babd20851639e0c9d6a99982; итоговые SHA/PR/status — [delivery record](release/GITHUB_FINAL_DELIVERY.json).

Сделано: исправлен clearance bypass document mutations и stale-role brief mutations; prompt ограничен body evidence/реальным числом фактов; quota fallback сообщает actual light model в history; Vitest 4.1.12 закрывает 2 новых advisory. Quality 45/197 PASS, оба tsc/build/audit/frozen PASS, lint 6 старых warnings. Browser 9, live integration 19, local HTTP 9, index edges 7, retrieval edges 6, storage/lexical/drift PASS. Real generation numeric+2 no-answer PASS через разрешённый quota fallback; primary inline sample и manual support spot PASS. Automatic entailment отсутствует.

Fresh retrieval: 17 queries, 20/20 gold IDs; Recall@5 .933333 / @10 1, MRR .842857, nDCG .868204. 16 embedding HTTP200, 1 network/timeout; old baseline сохранён. Не заявлять, что historical @5=1 является свежим результатом.

Live DB: 24 migrations через0023, 13 docs/10 briefs/107 chunks+embeddings, RLS15, grants0, native drift0. Для этой сессии full-row corpus SHA256 before/after снят до fixtures и после cleanup. Applied SQL не менялся, test DB не создавалась. Финальные evidence — FINAL_CHECKS / LIVE_DB_FINAL_AFTER / FINAL_DATA_PRESERVATION.

Cloud API доступен: Inngest app analitika всё ещё old sync 20Oct, 8 функций вместо6, нет document recovery. Старый OSINT cron систематически FAILED; brief recovery/cleanups recent COMPLETED. Три OSINT jobs получили pause200; readback paused state API не показывает. Не sync старый deployment. Нужно опубликовать проверенный код после gates, sync ровно6jobs, реальные scoped open doc+brief/retry/lost-event/restart runs и production smoke на exact release SHA.

Vercel management access отсутствует и пропущен по указанию. Project из GitHub status: tm-d91f/analitika; owner URL https://analitika-one.vercel.app. Main status blocked. Найден historical success a2af6269d81e57e839ecc226e7e1a8ae0014f10f, deployment target2VnHomtKSpAHZ3BcLR373qUBiDp2; это candidate, не confirmed rollback target. Не объявлять GO/merge/deploy без проверки runtime, workers и rollback. История Lovable сохраняется.


---

# Архив предыдущего отчёта (не текущая readiness)

# ZIRVƏ / ANALİTİKA — актуальное продолжение hardening

Обновлено **21 октября 2026, Asia/Baku**. Текущая рабочая ветка: `codex/zirve-v1-rc-resume`, база/HEAD `a45706e8c0979df1babd20851639e0c9d6a99982`. В начале resume `main`, HEAD и свежий remote main совпадали; staged/unstaged/untracked/conflicts = 0. Изменения этой сессии сохранены в рабочей ветке для review; push/merge/deployment не выполнялись. Применённые migrations не изменялись и не запускались.

**Текущий результат: reviewable local candidate, production NO-GO.** Актуальная acceptance matrix на 20 задач и раздельная readiness: [V1_PROD_HARDENING_AUDIT.md](V1_PROD_HARDENING_AUDIT.md). Порядок release: [RELEASE_RUNBOOK.md](release/RELEASE_RUNBOOK.md). Ниже после разделителя сохранён исторический safe-stop checkpoint; его pending E2E/storage/lexical статусы устарели.

## Выполнено при resume

- Исправленный empty locator проверен. Browser E2E выявил и подтвердил исправления history source links/count/empty UI и mobile title overflow. Полный run: 8 сценариев PASS, photo uploads document/brief и authenticated reads, mobile 390px, expiry/logout; DB leftovers 0 и точное удаление storage keys проверено.
- Private storage PASS: signed GET, unsigned/public denial, user-scoped uploads, bounded signature/size/MIME проверки, отдельные server-only committed copies. Повторный staging PUT/discard не меняет committed image. Signed PUT привязан к заявленным Content-Length/Content-Type; mismatch отклонён реальным S3. Bucket config не менялся; 3 существующих document attachments сохранены.
- Expanded lexical PASS: AZ case/NFC/AND/i/ı/ə, month/date/order, реальная граница pagination, normal/forced GIN. Fixtures rollback-only.
- Actual local HTTP gate: 8 PASS — attachment/session/policy, lexical fallback при embedding quota, malformed generation retry/exhaustion, disconnect/cancel, completed history и настоящий 105-секундный deadline. DB/history настоящие, provider transport synthetic в отдельном subprocess; это не cloud/provider availability evidence.
- Retrieval edges: 6 PASS с нулём external calls; access/filters/model/vector/no-match/rerank-policy/abort. HNSW forced plan PASS, normal plan на маленьком corpus — seq scan; performance выводов не делать.
- Index edges: 7 PASS — delete/edit races, malformed/quota retention, восстановление durable queued после DB pool reconnect. Полный worker process restart этим не проверен.
- SDK retries больше не умножают gateway budget; gateway bounded quota/Retry-After и transient 408/5xx retries, общий timeout включает waits. AI_BACKUP_MODEL/Qwen не добавлялись.
- Закрыт пропущенный external question path: V1 вопрос консервативно получает live clearance пользователя, как history. Embedding/rerank/generation остаются open-only; более высокий clearance сохраняет локальный lexical sources search. History дополнительно проверяет live admin role/owner и повторяет metadata visibility после child reads.
- Reindex не считает пропущенный processing/missing source завершённым: готовность проверяется readback, есть skipped count.
- Quality: 45 files / 195 tests PASS; итоговые type/lint/build/E2E и точные evidence — [RC_CHECKS.json](release/RC_CHECKS.json). На новом ПК найдены stale installed dependencies: frozen install восстановил locked Vite 8.1.6 без изменения package/lock.

## Что продолжать

1. Владелец подтвердил production URL **https://analitika-one.vercel.app**, read-only deployment/Inngest доступ проверит отдельно. Нет локальных hosting/Inngest management credentials; GitHub connector даёт 404. GET login/worker 401 не доказывает revision, signing/registration или delivery. Нужны точная revision/env и реальные open document+brief cloud runs, cron recovery и worker restart.
2. Новый live primary Gemini sample (только inline fictional open text, без corpus) получил **503 UNAVAILABLE**, включая bounded retry. [SEMANTIC_SAMPLE.json](release/SEMANTIC_SAMPLE.json). Не менять согласованные модели ради зелёного gate. Три предыдущих live generation PASS сохранены как исторические, текущую availability не доказывают. Manual semantic sample NOT VERIFIED; entailment не реализован.
3. [LIVE_DB_RC.json](release/LIVE_DB_RC.json) — свежий read-only итог после fixtures: 24 migrations, 13 documents / 10 briefs / 107 chunks+embeddings, history 0, integrity 0, RLS 15, client grants 0. [LIVE_DB_RESUME.json](release/LIVE_DB_RESUME.json) — начало resume. Исторический AFTER_MIGRATIONS предшествует 0023. Не применять SQL повторно и не восстанавливать counts искусственно при новых пользовательских данных.
4. Историческая причина задержки 39–47 минут неизвестна без старой event/transition history. DB pool reconnect не заменяет проверку cloud cold restart. Не выдавать controlled transport за внешний Gemini/Inngest.
5. Для resume diff использовать [RESUME_FILE_MANIFEST.json](release/RESUME_FILE_MANIFEST.json), initial inventory, file review и secret scan в release/. Старый CHECKPOINT_FILE_MANIFEST описывает перенос предыдущей сессии и сохранён неизменным.
6. После review и снятия blockers запросить отдельное разрешение на конкретный push/merge/deploy; затем revision verification и production smoke. Не объявлять GO до проверки настоящего runtime. Сохранять Lovable history, corpus, open-only и lexical-only Xülasələr.

---

# Исторический checkpoint передачи до resume

## A. Текущее состояние

Checkpoint: **21 октября 2026, Asia/Baku (UTC+04)**. По запросу владельца полный hardening остановлен для переноса работы через GitHub main. **Production NO-GO; это checkpoint разработки, не завершённый release candidate.**

- Исходная рабочая ветка: `codex/zirve-v1-prod-hardening`; после checkpoint локальный `main` обновлён через fast-forward, текущая ветка — `main`.
- Исходный HEAD: `a2edb75373b69b7f7faf13ae931a9e889d671342`.
- Свежий `origin/main` совпадал с исходным HEAD: новых удалённых коммитов не было, интеграция не требовалась.
- Source checkpoint: `a1c77d40fb9ff473f21a5c60a898ace6ad13c4f0`, `chore: checkpoint ZIRVE V1 production hardening progress`. Успешный push и remote SHA подтверждены в «Delivery record» ниже. Финальный documentation commit — прямой потомок этого checkpoint; его SHA доступен через `git rev-parse HEAD` и в финальном ответе сессии.
- Начальное состояние: 183 staged файла, 0 unstaged/untracked, без конфликтов. [Исходный inventory](release/INITIAL_GIT_INVENTORY.json).
- Перед checkpoint многие файлы были partially staged: индекс содержал старые версии. Актуальные версии отбираются по явному [manifest](release/CHECKPOINT_FILE_MANIFEST.json), без слепого `git add -A`.
- Финальный staged snapshot: **211 изменённых файлов**, unstaged/untracked — 0. Обновлены 40 partially staged файлов; отменены 16 временных additions. Narrow secret scan новых staged строк не обнаружил совпадений; `.env.local` и backups исключены.
- Наши dev/preview серверы 4173/4174/4175 остановлены. Миграций, fixture-тестов и транзакций в процессе нет.
- `.env.local`, secrets, raw logs, дампы, `.release-backup.local/` не передаются в Git. Дома восстановить env из собственного безопасного хранилища.
- Ignored `.release-backup.local/` содержит исходные staged/unstaged binary patches и временные gate-пробы. Это локальные резервные материалы, они не будут доступны после clone. Актуальный код, миграции, verification scripts и безопасные evidence передаются в checkpoint.
- Force push/reset/clean/stash и переписывание опубликованной истории не использовались. Проект связан с Lovable; сохранять опубликованную историю.

### Точка остановки

Завершены live DB reconciliation, controlled indexing/access integration, retrieval baseline и три реальные Gemini generation проверки. Полный UI/security/release gate не завершён. Последний browser run упал на locator filtered empty state; locator исправлен, повторный run не выполнялся. Expanded lexical/storage scripts написаны и typechecked, но не запускались. После safe-stop выполнялись только сохранение, короткие проверки и документация.

## B. Выполненная работа

### Scope и сохранение изменений

Сохранён V1 scope: auth/sessions, users/roles/clearance, documents, Xülasələr/briefs, indexing, Analitika/Core RAG, citations/history/admin. Исходное staged удаление OSINT Web, Information Requests, tags и document-user ACL сохранено. Исторические migrations остаются; OSINT как направление внутреннего документа допустимо.

Подтверждённые временные `_gate-*`, `.gate-backup` и незарегистрированный `0022_database_timezone_baku.sql` убраны из deliverable, originals сохранены локально. DB уже была Asia/Baku; timezone не менялась. Неизвестные пользовательские source changes не выбрасывались. Полный независимый review каждого изменённого файла ещё не завершён.

### Database и indexing

- На существующей Supabase DB успешно применены 0019–0023. До применения 0019 исправлен `CREATE INDEX CONCURRENTLY`, несовместимый с транзакцией Drizzle migrator. Исторические applied SQL не переписывались.
- Выявлены read/write grants anon/authenticated на все 15 app tables при выключенном RLS. 0022 включает RLS и отзывает client/PUBLIC grants. Trusted PostgreSQL server connection сохраняет доступ; приложение не использует Supabase client sessions.
- 0023 переименовывает восемь legacy constraints на месте без пересоздания данных/индексов. Schema и native catalog совпадают со snapshot 0023.
- `scripts/live-schema.ts` сверяет native columns/defaults/generated/checks/FKs/indexes/opclasses/order/enums/RLS. Для canonical definitions использует TEMP objects в транзакции. Ошибочные lossy introspection suggestions не применялись. `scripts/migrate.ts` использует migration connection с безопасной диагностикой.
- Document/brief workers получили уникальные leases, fencing heartbeat/finalize/failure, timeout embedding batch, проверку 768 finite/nonzero vectors и atomic replacement после полной подготовки всех векторов. Ошибка нового прохода не уничтожает committed index.
- `jobs/recover-indexes.ts`: queued/lost events, expired processing, aged failed, timestamp CAS, durable attempt counter и предел пять попыток. Recovery scheduled каждые 15 минут. Убрана постоянная brief idempotency по resource ID, блокировавшая новые редакции.
- Brief save больше не удаляет старые chunks заранее. Content hash исключает retained stale chunks после изменения текста; unchanged committed index пригоден во время retry. Конкурентное редактирование проверяется под lock.
- Document queue failure сохраняет durable queued запись и возвращает UI queue-pending feedback. Detail открывает доступные queued/processing/failed документы и их статус.

### RAG, доступ и citations

- Clearance действует на источники, chunks и history; owner/admin не даёт обхода content clearance. Revalidation проверяет live пользователя/родителя, chunk ID, offsets и точный текст.
- History list/direct фильтрует live source access. Начальная classification учитывает сам вопрос; open result не понижает уже сохранённую classification. Cancel обновляет только running запись, не перетирает completed.
- `ai/processing-policy.ts`: default external processing только open. Classified allowlist требует policy reference, но это не заменяет согласование владельцем. Controlled local providers имеют local boundary. Политика classified обработки не предоставлена.
- Query embeddings timeout 15 секунд с lexical fallback. Endpoint deadline 105 секунд внутри 120-секундного hosting budget, generation attempt deadline 60 секунд. Общие tsc/unit проходят, отдельный runtime timeout/cancel gate ещё нужен.
- Citation validation проверяет структуру, exact normalized excerpts и numbers. Исправлены 100 внутри 2100, decimal/unit cases, citation tokens внутри evidence и malformed markers. **Semantic entailment не реализован**; regression test показывает ограничение.
- Даты фильтров учитывают Baku. CSS typo переноса в `BriefMarkdown.tsx` исправлен без redesign.

### Tooling и зависимости

- Evaluation использует ту же DB с active user/clearance; hardcoded user UUID убран. Отдельная evaluation DB запрещена; `EVALUATION_USER_ID` позволяет явно выбрать пользователя.
- Metrics исправлены: nDCG denominator, repeated chunk credit, Recall по первым k chunk slots. Gold labels разрешаются в актуальные source IDs.
- Seed теперь только dry-run, destructive path полностью удалён. Reindex default dry-run, `--apply` атомарно обрабатывает нужные sources без общего clearing. Corpus-wide reindex не запускался.
- Vite 8.1.6 и совместимые transitive patches устранили audit findings. Scoped `@esbuild-kit/core-utils>esbuild` override не меняет современный tsx. `bun audit --json` → `{}`, frozen lockfile dry-run PASS.
- Добавлены playwright-core и artifact preview. После build `bun run preview` обслуживает Vercel artifact на `127.0.0.1:4175`; старый `vite preview` с preset не работал.

## C. Незавершённая работа — 20 задач

P0 — release blocker; P1 — необходимое доведение/проверка V1; P2 — документация/эксплуатация. Полный исходный запрос: [PRODUCTION_HARDENING_REQUEST.md](release/PRODUCTION_HARDENING_REQUEST.md). Это backlog, а не список 20 доказанных product defects.

| ID / priority | Задача, статус, файлы                                                                                                   | Следующее действие и критерий завершения                                                                                                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 / P0       | **Cloud events/workers: NOT VERIFIED.** `server/inngest/`, `routes/api.inngest.ts`, hosting settings.                   | Подтвердить target/revision, env, signing, регистрацию актуальных jobs. Новый безопасный open document и brief должны пройти реальную очередь event→claim→ready без ручного worker; доказать scheduled recovery. 401 endpoint не доказывает registration.                           |
| 02 / P0       | **External classified policy: BLOCKER.** `ai/processing-policy.ts`, `env.ts`, `.env.example`, analytics/workers.        | Получить решение владельца по classification levels; проверить deployed allowlist/reference и отказ до отправки текста. Done: подтверждённая политика либо согласованный open-only scope, отрицательные runtime checks, отсутствие classified утечки.                               |
| 03 / P0       | **Browser E2E: FAIL/incomplete.** `scripts/verify-browser.ts`, `preview.ts`, `release/BROWSER_E2E.json`.                | Build→preview→test:e2e. Locator исправлен с `az.briefs.empty` на `az.briefs.noMatches`, ещё не проверен. Пройти sources/history/citations/admin/retired routes/mobile/expiry/logout. Done: полный PASS, cleanup подтверждён.                                                        |
| 04 / P0       | **Storage security: NOT VERIFIED.** `scripts/verify-storage.ts`, storage/upload modules, attachment route, cleanup job. | Скрипт только написан. Проверить private bucket, signed PUT/GET, unsigned/public denial, size/type/ownership, discard/cleanup races. Только собственные synthetic objects с cleanup. Done: реальные signed/private и attachment-access checks PASS, corpus keys не затронуты.       |
| 05 / P0       | **Остальной security audit: PARTIAL.** auth/session/middleware, `routes/api.*`, `lib/*.functions.ts`, brief mutations.  | Завершить expiry/revocation, active/role/clearance changes, CSRF/origin, rate limiting, validation, SQL injection/XSS, logs/errors, все mutations. RLS не заменяет этот аудит. Done: нет critical FAIL/NOT VERIFIED, evidence сохранены.                                            |
| 06 / P0       | **Production config/revision: NOT VERIFIED.** Vite/Vercel config, env, `scripts/verify-runtime.ts`, hosting.            | Подтвердить настоящий project/target, DB runtime role, models/env/signing/timeouts. После отдельно разрешённого deploy сверить revision и выполнить smoke. Done: runtime соответствует проверенному commit; safe-stop не разрешал ручной deploy.                                    |
| 07 / P1       | **Полный file review: PARTIAL.** Все paths в checkpoint manifest и критические unchanged paths.                         | Завершить file-by-file audit, проверить случайные удаления, противоречия, dead code/imports, routeTree и retired runtime. Done: каждое изменение имеет понятную цель, нет потерь или незавершённой реализации.                                                                      |
| 08 / P1       | **Expanded Xülasələr gate: PARTIAL.** `verify-lexical.ts`, brief queries/normalization, lexical index.                  | Базовые live NFC/AND/i/ı PASS. Выполнить rollback-only AZ letter/case/NFC, title/body AND, month/date/order, >page-size pagination и EXPLAIN normal/forced GIN. Done: PASS на той же Supabase DB, fixtures rolled back.                                                             |
| 09 / P1       | **Gemini quota/retry/timeouts: PARTIAL.** `ai/gemini*.ts`, workers, reindex, endpoint.                                  | Проверить 429/Retry-After, quota exhaustion, timeout/malformed vectors, retry budgets и model config controlled failures. AI_BACKUP_MODEL не добавлять. Done: bounded retry/explicit failed/recovery, committed index сохранён.                                                     |
| 10 / P1       | **Index lifecycle edges: PARTIAL.** workers/recovery/index-state, brief save, document queue.                           | 17 integration cases уже PASS. Допроверить nonpublished/deleted sources, edit/delete/reindex races, exhausted retries UI и cold restart recovery. Проверить, что reindex summary не считает skipped processing как completed. Done: status/committed index/eligibility согласованы. |
| 11 / P1       | **Benchmark coverage: PARTIAL.** eval questions/metrics, eval-retrieval/eval-rerank scripts.                            | Сохранить baseline; раздельно оценить restricted access, filters, cross-document и no-answer. Rerank default false не менять ради метрик. Done: valid gold IDs, воспроизводимые metrics, access/no-answer оценены отдельно.                                                         |
| 12 / P1       | **Retrieval fallbacks: PARTIAL.** search/ranking/filters/source-access, AI providers.                                   | Проверить независимые vector/FTS/trigram failures, model/dim filters, HNSW plan, RRF/dedup, abort и lexical fallback. Done: safe lexical results при outage, inaccessible chunks не попадают в выдачу/AI.                                                                           |
| 13 / P1       | **Citation/generation endpoint: PARTIAL.** citations/endpoint/source-access/prompts, verify-generation.                 | Unit и три live generation PASS. Проверить HTTP stream malformed/retry/exhaustion/no-answer и вручную semantic support. Done: публикуется только validated result, источники открываются точно, entailment limitations честно описаны.                                              |
| 14 / P1       | **History/deadline/cancel: PARTIAL.** history/endpoint и history UI.                                                    | Последние fixes typechecked/unit-tested, отдельного runtime race нет. Проверить 105-sec deadline/disconnect, running→failed/cancelled/completed, live clearance и query-only metadata. Done: cancel не перетирает completed, timer очищается, утечки нет.                           |
| 15 / P1       | **UI/UX audit: PARTIAL.** app routes/components/i18n, docs/briefs/analytics/history/admin.                              | Дополнить E2E create/edit/loading/error/empty/denied, retry feedback, stale UI, keyboard/mobile. Son sənədlər exact UUID navigation уже локально PASS. Done: все core journeys работают, визуальный стиль сохранён.                                                                 |
| 16 / P1       | **Final DB gate: mostly PASS.** verify-release-db/db-check-drift/live-schema, drizzle.                                  | 0019–0023 не применять заново и не менять applied SQL. После будущих DB changes повторить native drift/integrity/corpus check, при необходимости разобрать redundant index/legacy/storage metadata. Done: zero drift/orphans/duplicates, corpus и hashes сохранены.                 |
| 17 / P1       | **Final quality gate: checkpoint PASS, release pending.** package/lock/config/tests/evidence.                           | После fixes уместные targeted checks, затем tests/оба tsc/lint/build/drift/frozen lock/audit/E2E. Known diff-check blank EOF applied 0020 не «чинить» изменением SQL. Done: реальные результаты/исключение документированы, assertions не ослаблены.                                |
| 18 / P2       | **Docs/runbook: PARTIAL.** README, AUTHENTICATION, DECISIONS, архивные V1/OSINT docs.                                   | README актуализирован; проверить остальные bootstrap/deploy/runbook инструкции на stale claims. Done: безопасное продолжение без reset, ложного PASS и возврата retired features.                                                                                                   |
| 19 / P2       | **Диагностика старой задержки: UNKNOWN.** progress/recovery, Inngest history/logs.                                      | Найти историю только если сохранилась; иначе не придумывать причину. Оценить минимальные timestamps/diagnostics без текстов/keys. Done: будущие stuck jobs диагностируются, историческое ограничение записано.                                                                      |
| 20 / P0       | **Independent final gate: NOT DONE.** audit/evidence/runtime.                                                           | Закрыть gates, обновить полную PASS/FAIL/NOT VERIFIED matrix и code/DB/worker/retrieval/security/runtime/release readiness. Done: GO без critical FAIL/NOT VERIFIED; pre-deploy и post-deploy readiness разделены, release push/deploy согласован отдельно.                         |

Итого: **20 задач — 7 P0, 11 P1, 2 P2**.

## D. Известные проблемы

- Browser E2E имеет четыре PASS, затем неверный test locator empty state. Locator исправлен, новый run не выполнялся. Предыдущие harness failures: HMR reload, несовместимый preset preview, неверный submit selector. Они не доказывают product regression, но полного PASS нет.
- Первый checkpoint build упал на sandbox `EPERM readlink C:\Users\AO`; повтор с одобренным filesystem доступом PASS.
- `git diff --check` на исходном checkpoint: blank EOF в уже applied metadata-only 0020. Bytes/hash сохранены. Trailing spaces временных gate logs не входят в commit.
- Storage/private flows, cloud worker delivery, deployed revision и classified policy остаются непроверенными.
- Старые delayed uploads уже ready, причина задержки неизвестна: нет transition/event history.
- Exact excerpt/numbers не доказывают смысловую поддержку claim. No-answer retrieval может вернуть кандидатов; отказ решается generation/evidence gate.
- Numeric generation case занял ~75 секунд и две попытки: HTTP latency/deadline/cancellation нужно проверить отдельно.
- RLS уже изменён live, code guards должны попасть в настоящий runtime. Git push не доказывает успешный deploy.

## E. Состояние Supabase

Использована только существующая configured DB, без отдельной TEST/DEV/evaluation DB. [Final read-only checkpoint](release/LIVE_DB_CHECKPOINT.json).

| Показатель                  | Подтверждено                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Journal/schema              | 24 migrations, 0000–0023; latest `0023_reconcile_legacy_constraint_names`           |
| Применено здесь             | 0019 lexical GIN; 0020 metadata; 0021 index; 0022 RLS/grants; 0023 constraint names |
| Migration hashes            | 0 mismatches; 0000 совпадает с CRLF-equivalent SHA256                               |
| Documents                   | 13, все ready/open                                                                  |
| Briefs                      | 10, все published/index ready                                                       |
| Chunks/embeddings           | 107/107, `gemini-embedding-2`, 768 dimensions                                       |
| Integrity                   | 0 invalid parent/offset/dimension, missing embeddings, orphans, duplicate ordinals  |
| Query history               | 0                                                                                   |
| RLS/client grants           | 15 RLS tables; 0 tables с read/write anon/authenticated                             |
| Native drift после 0023     | PASS: 15 tables, 25 indexes, 0 mismatches                                           |
| Незавершённые наши операции | Нет                                                                                 |

User corpus не удалялся/не переиндексировался. Integration/E2E использовали собственные synthetic fixtures с cleanup; integration фиксирует 0 leftovers, последний E2E — completed cleanup. Counts совпадают с исходными 13/10/107/107.

`LIVE_DB_BEFORE.json` и `LIVE_DB_AFTER_MIGRATIONS.json` — исторические timestamps; AFTER ещё до 0023 и объяснения LF/CRLF. Для свежего статуса использовать CHECKPOINT. Три newest documents имели по одному chunk/embed, create→update ~39–47 минут; причина неизвестна. Timezone была и осталась Asia/Baku. Secrets и содержимого закрытых документов в отчёте нет.

## F. Проверки

| Проверка                         | Результат/evidence                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test`                   | PASS: 43 files / 182 tests, повтор после последних history/deadline changes                                                                                                |
| Production tsc                   | PASS: `bun node_modules/typescript/bin/tsc --noEmit`                                                                                                                       |
| All-scripts tsc                  | PASS: `bun node_modules/typescript/bin/tsc --noEmit -p tsconfig.eval.json`                                                                                                 |
| `bun run lint`                   | PASS: 0 errors, 6 старых React fast-refresh warnings                                                                                                                       |
| `bun run build`                  | PASS после sandbox retry, artifact создан; deploy не запускался                                                                                                            |
| Frozen lock dry-run              | PASS: `bun --no-env-file install --frozen-lockfile --dry-run`                                                                                                              |
| Dependency audit                 | PASS: `bun audit --json` → `{}`                                                                                                                                            |
| Drizzle check                    | PASS                                                                                                                                                                       |
| `bun run db:check-drift`         | PASS после 0023: [LIVE_SCHEMA_DRIFT.json](release/LIVE_SCHEMA_DRIFT.json)                                                                                                  |
| Final DB checkpoint              | PASS: [LIVE_DB_CHECKPOINT.json](release/LIVE_DB_CHECKPOINT.json)                                                                                                           |
| Live indexing/access integration | PASS: 17 cases, zero leftovers; [INDEXING_INTEGRATION.json](release/INDEXING_INTEGRATION.json)                                                                             |
| Retrieval                        | 17 queries, 15 scored answerable, 2 no-answer, 20/20 gold labels; Recall@5/10=1/1, MRR=0.855556, nDCG=0.879315; [RETRIEVAL_BASELINE.json](release/RETRIEVAL_BASELINE.json) |
| Live Gemini generation           | PASS: numeric + two no-answer, open-only; [GENERATION_INTEGRATION.json](release/GENERATION_INTEGRATION.json)                                                               |
| Browser E2E                      | FAIL/incomplete, 4 PASS, locator fixed/not rerun; [BROWSER_E2E.json](release/BROWSER_E2E.json)                                                                             |
| Git whitespace                   | Known blank EOF applied 0020, bytes preserved                                                                                                                              |
| Narrow secret-pattern scan       | No matches в source/scripts/docs/schema/dependencies; env ignored. Не полная security certification                                                                        |

17 integration cases: оба worker lifecycle, provider failure/retry, actual transaction rollback после delete/insert failure, concurrent duplicates, expired lease stale success/failure, brief save+queue failure/stale-index exclusion, bounded lost-event recovery, AZ NFC/AND/i/ı, owner/admin clearance, exact current chunk и history metadata. Векторы local synthetic; Gemini quota/Inngest cloud этим не доказываются.

Не запускались expanded lexical/pagination/EXPLAIN, storage signed/private, полный E2E после fix, rerank benchmark, runtime deadline/cancel race, полный production security/load review, post-deploy smoke.

## G. Продолжение дома

1. Обновить/клонировать `tmamedzadeh/analitika`, checkout main, `git pull --ff-only`. Сверить remote/HEAD с финальным SHA ответа этой сессии. Прочитать handoff, audit, manifest и исходный запрос.
2. Создать новую рабочую ветку. Восстановить `.env.local` из безопасного хранилища по `.env.example`, установить Bun и `bun install --frozen-lockfile`. Использовать ту же DB; не reset/seed и не отдельная fixture DB.
3. Не повторять applied migrations. Если DB изменилась, сначала read-only verification/native drift. Counts могут меняться при работе пользователей — не восстанавливать старые counts искусственно.
4. Первый практический gate: build→preview→test:e2e с исправленным empty-state locator и fixture cleanup. Проверить browser executable нового компьютера; Edge path может отличаться. Assertions не ослаблять.
5. Закрыть storage и expanded lexical на собственных fixtures; затем реальную cloud delivery и quota/deadline edges. Отправку текста внешнему AI ограничивать разрешённой classification/policy.
6. Подтвердить policy, закончить security/file/UI и source/history TOCTOU review, расширить benchmark/fallback coverage по реальной необходимости.
7. После fixes выполнить quality gate, обновить audit с evidence и readiness matrix. Различать код, applied DB и deployed runtime.
8. Новый release push/merge/deployment согласовать отдельно; это разрешение относится к переносу checkpoint. Post-deploy smoke обязателен до production GO. Lovable history не переписывать.

Решения продукта: **Xülasələr только lexical PostgreSQL**, основная модель `gemini-3.8-flash`, лёгкая `gemini-3.5-flash-lite`, embeddings Gemini Embedding 2. **AI_BACKUP_MODEL не реализовывать**. Qwen — будущее расширение, architecture rewrite без доказанной необходимости не делать. Пользовательские данные не уничтожать.

## Delivery record

- **Source checkpoint commit:** `a1c77d40fb9ff473f21a5c60a898ace6ad13c4f0`.
- **Push выполнен:** `git push origin main`, успешный fast-forward `a2edb75..a1c77d4`, без force и переписывания истории.
- **Проверено 2026-10-21 19:37:39 +04:00:** `git ls-remote origin refs/heads/main` вернул `a1c77d40fb9ff473f21a5c60a898ace6ad13c4f0`; локальный HEAD совпал, `git status --short` был пуст.
- **Дополнительный commit:** только эта запись доставки/уточнение текущей ветки, разрешённый разделом 6 safe-stop запроса. Он включается в тот же `main`; окончательный SHA последнего commit и его совпадение с remote проверяются после отправки и сообщаются в финальном ответе. Commit не может содержать собственный SHA; source checkpoint выше остаётся точной ссылкой на сохранённый код.
- После отправки финального handoff commit дальнейшие изменения/проверки hardening не выполняются. Env и локальные backups остаются ignored. Ручной deployment не выполнялся, production NO-GO сохраняется.

## H. Готовый resume prompt

```text
Продолжи ZIRVƏ / ANALİTİKA FINAL V1 PRODUCTION HARDENING с сохранённого checkpoint.

Прочитай AGENTS.md, docs/WORK_SESSION_HANDOFF.md,
docs/V1_PROD_HARDENING_AUDIT.md, docs/release/PRODUCTION_HARDENING_REQUEST.md
и docs/release/CHECKPOINT_FILE_MANIFEST.json. Проверь branch/HEAD/origin/main,
staged/unstaged/untracked и актуальные runtime/DB условия. Не теряй изменения,
не используй reset --hard, clean, force push или rewriting Lovable history.

Прошлая сессия остановлена safe-stop запросом, не полным release gate.
Live Supabase: applied 0019–0023, native drift PASS, 24 migrations,
13 documents, 10 briefs, 107 chunks/embeddings, RLS 15 tables, client grants
отозваны. Не применяй заново и не меняй applied SQL. Используй ту же DB,
без отдельной TEST/DEV/evaluation DB. Береги corpus. Secrets бери из своего
настроенного безопасного окружения, не печатай их и не добавляй в Git.

Уже PASS: 43 files/182 tests, production+scripts tsc, lint с 6 старыми warnings,
build, frozen lock dry-run, dependency audit, 17 controlled live integration,
retrieval baseline 17 queries и 3 live open-only generation cases. Не повторяй
без изменений/конкретной причины. Читай limitations evidence. Свежая DB evidence:
LIVE_DB_CHECKPOINT.json; старый AFTER_MIGRATIONS предшествует 0023.
Semantic entailment не реализован, не выдавай structural checks за него.

Начни с browser E2E: четыре PASS, затем неправильный empty-state locator;
он уже исправлен на az.briefs.noMatches, не проверен. После build используй
bun run preview (127.0.0.1:4175) и test:e2e; проверь browser executable нового ПК
и fixture cleanup. Затем 20 задач handoff по приоритету: private storage,
expanded AZ lexical/pagination/EXPLAIN, cloud workers/recovery, Gemini quota,
timeout/cancel, full security/UI/file review, benchmark/fallback coverage,
production config/revision, final acceptance matrix.

Сохраняй V1 scope: auth/users/clearance, docs/briefs/indexing, Analitika,
citations/history/admin. Не возвращай OSINT Web, requests, tags и document ACL.
Owner/admin не обходит clearance. Xülasələr — только lexical PostgreSQL,
без LLM/vector/rerank. Модели: gemini-3.8-flash, gemini-3.5-flash-lite,
Gemini Embedding 2. AI_BACKUP_MODEL не добавлять; Qwen позже, rewrite без
доказанной необходимости не делать. Classified external processing без
подтверждённой политики не разрешать: default open-only.

Доведи доступную работу до reviewable release candidate: исправляй доказанные
дефекты и проверяй. Обнови audit с PASS/FAIL/NOT VERIFIED, evidence и отдельными
code/DB/worker/retrieval/security/runtime/release readiness. GO только без
critical FAIL/NOT VERIFIED и после проверки реального runtime. Новые release
push/merge/deployment согласуй отдельно: прежнее разрешение было на checkpoint.
```
