# ZIRVƏ / ANALİTİKA V1 — итоговый production report

Дата: **22 октября 2026, Asia/Baku**. Решение: **PRODUCTION NO-GO**. Проверенная локальная реализация подготовлена к review; опубликованный runtime ещё не подтверждён как эта версия. Владелец разрешил commit/push/PR/merge/deploy в [финальном задании](release/PRODUCTION_RELEASE_REQUEST.md), а затем попросил пропустить получение Vercel доступа. Это разрешение не отменяет gates. Merge и production rollout при незакрытых gates не выполняются.

## A. Executive Summary

ZIRVƏ V1 — закрытая рабочая среда аналитика: учётные записи и clearance, база документов, ежедневные бюллетени Xülasələr, поиск по внутренним источникам и ответы Analitika с цитатами, история и администрирование. Текущий код прошёл локальные production checks, live проверки той же Supabase DB и private storage. Corpus сохранён; отдельной test/dev/evaluation DB нет. SQL 0000–0023 повторно не применялся и не редактировался.

Главный оставшийся барьер находится в опубликованном окружении. Inngest всё ещё привязан к deployment от 20 октября с устаревшим набором функций. GitHub показывает blocked Vercel deployment у текущего main. Успешная локальная сборка и GET /login не устанавливают production revision, hosting env или cloud delivery. Поэтому завершение V1 Production не объявляется.

## B. Реализованные функции V1

- **Auth/users:** логин по username/password, scrypt, HttpOnly session cookie, hashed session tokens в DB, срок 8 часов, logout/revocation, active/role/clearance при новом запросе. Admin создаёт пользователей, меняет clearance/active, сбрасывает пароль; пользователь меняет свой пароль. Защищены self-deactivation и последний active admin. Прямые URL и server functions требуют auth.
- **Документы:** title/body/date/direction/classification/reliability, создание с изображениями, последние документы и точный UUID detail, chunks и исходные фрагменты, статусы indexing, retry failed, смена направления и удаление в пределах прав. Owner/admin не повышает clearance, включая mutations.
- **Xülasələr:** создание, редактирование, чтение и admin deletion, изображения, date/month navigation, cursor pagination. Поиск каталога — только PostgreSQL lexical AND с Azerbaijani normalization; порядок слов не важен, слова могут находиться в title/body. Здесь нет LLM, vector search или rerank.
- **Indexing:** document/brief events, durable queued/processing/ready/failed, leases и version fencing, атомарная замена chunks после успешных embeddings, защита от duplicate delivery и stale workers. Старый committed index сохраняется при provider/transaction failure; отредактированный brief не использует устаревший текст при retrieval. Есть bounded scheduled recovery и orphan storage/history housekeeping в коде.
- **Analitika:** внутренний hybrid retrieval (vector + FTS + trigram, RRF/dedup), фильтры, режим источников и режим ответа. Для ответа — Gemini, проверка citations/excerpts/numbers, ограниченная повторная генерация, no-answer и отказ от публикации невалидного результата. Пользователь может отменить запрос; общий deadline 105 секунд.
- **Citations/history/admin:** source → parent UUID/chunk, доступ к исходному тексту и вложениям, сохранение terminal history, текущие права при повторном чтении. Недоступные sources не открываются; query metadata history также защищена clearance.

OSINT Web, Information Requests, tags и document-user ACL удалены из активного V1. OSINT как direction внутреннего документа допустим. Qwen, AI_BACKUP_MODEL и отдельный rewrite не добавлены.

## C. Архитектура и стек

Frontend: React 19, TypeScript, TanStack Router/Start, React Query, Tailwind и существующие UI components. Server: TanStack server functions/routes, Nitro Vercel web-entry, Node 22; auth и SQL выполняются на сервере. PostgreSQL/Supabase доступен через Drizzle и transaction pooler (`prepare: false`, ограниченный pool). Vector storage — pgvector, 768 dimensions, Gemini Embedding 2. Storage — private S3-compatible Supabase bucket. Inngest принимает события и запускает индексаторы/cron. AI SDK Google adapter использует согласованные Gemini models через общий bounded gateway. LLM/vector/rerank относятся к Analitika, а не к каталогу Xülasələr.

## D. Безопасность

Clearance проверяется по live DB state; owner/admin не обходит content ceiling. Document management predicate теперь включает clearance, active state и live admin role в том же SQL. Brief save блокирует actor row на время transaction и повторно проверяет live role; admin delete требует live admin predicate. History защищена live role/clearance и повторной проверкой после чтения child sources.

Все 15 app tables имеют RLS; anon/authenticated/PUBLIC client grants отозваны. Trusted server DB role обходит RLS, поэтому server authorization остаётся обязательным. Это не Supabase client-session RLS модель.

External AI — **open-only**. Без подтверждённой политики classified processing не разрешён. Для вопроса V1 консервативно используется live clearance пользователя, поскольку отдельного поля classification вопроса нет. Пользователь с высоким clearance может выполнять local lexical source search, но его query не уходит на embedding/rerank/generation при open-only policy. Sources и policy проверяются перед внешними вызовами; владелец/admin не исключение.

Uploads: до 10 MiB на image, JPG/PNG/WebP, user-bound staging keys, signed PUT привязан к size/type. Save читает ограниченный поток, проверяет фактические bytes/signature и создаёт новый server-only committed object. Повторный PUT/discard staging не меняет committed image. Signed GET и authenticated attachment routes; unsigned/public requests denied. Bucket-level size/MIME limits сейчас unset; ограничения обеспечиваются подписью и server validation, bucket остаётся private.

Проверены CSRF/origin, bounded request parsing, UUID/schema validation, parameterized SQL, markdown escaping, login/upload/analytics rate limits, safe errors и отсутствие известных настроенных secret values в deliverable/static artifact. Это scoped security review, а не формальная сертификация. Raw diagnostics, env и credentials исключены из Git. Management API однажды вернул URL с credential в диагностический вывод; в committed evidence query values отсутствуют. Такой URL нельзя копировать в issue/PR/log.

## E. База данных и corpus

Используется прежняя Supabase DB. [LIVE_DB_FINAL_BEFORE.json](release/LIVE_DB_FINAL_BEFORE.json): 24 applied migrations через 0023, pending/hash mismatches 0; 13 documents, 10 briefs, 107 chunks с 107 embeddings, history 0. Invalid parents/dimensions/offsets, duplicate ordinals и orphans — 0. Три существующих document attachments сохранены. [LIVE_SCHEMA_DRIFT.json](release/LIVE_SCHEMA_DRIFT.json): 15 tables/25 indexes, mismatches 0.

Для этой финальной сессии полный corpus digest снят **до** fixtures: [CORPUS_DIGEST_FINAL_BEFORE.json](release/CORPUS_DIGEST_FINAL_BEFORE.json). После cleanup сверяется ordered complete-row SHA256, включая body/text/embedding/metadata и attachments. Это сильнее предыдущего count/metadata сравнения; до начала предыдущей resume-сессии полного digest не было, поэтому более ранняя byte equality не утверждается. Итоговая сверка: `CORPUS_DIGEST_FINAL_AFTER.json` и `FINAL_DATA_PRESERVATION.json`.

Существующие applied SQL immutable. Line-ending-equivalent migration hashes учитываются явно. Никаких reset/reseed, отдельной evaluation DB, corpus-wide reindex или искусственного восстановления counts не выполнялось.

## F. Проверки и evidence

| Область | Статус | Результат / evidence |
| --- | --- | --- |
| Unit | PASS | 45 files / 197 tests; `FINAL_CHECKS.json` |
| TypeScript | PASS | production и scripts (`tsconfig.eval.json`) |
| Lint | PASS | 0 errors, 6 существующих fast-refresh warnings |
| Build | PASS | locked Vite 8.1.6, Node 22 Vercel artifact; analytics 120s, Inngest 300s |
| Dependency audit / frozen lock | PASS | Vitest 4.1.12; audit `{}`; frozen dry-run |
| Live integration | PASS | 19 indexing/access/history/mutation checks; [INDEXING_INTEGRATION.json](release/INDEXING_INTEGRATION.json), leftovers 0 |
| Browser | PASS | 9 cases: auth/docs/photos/brief create+edit/search/history/admin/keyboard/mobile/expiry/logout; [BROWSER_E2E.json](release/BROWSER_E2E.json), DB leftovers 0, four exact storage keys removed |
| Storage | PASS | [STORAGE_INTEGRATION.json](release/STORAGE_INTEGRATION.json); private/signed/bounds/ownership/immutable copies/cleanup |
| Lexical | PASS | [LEXICAL_INTEGRATION.json](release/LEXICAL_INTEGRATION.json); AZ/NFC/i/ı/ə, AND, dates/month/order/page boundary, normal+forced GIN; rolled back |
| Retrieval edges | PASS | [RETRIEVAL_EDGES.json](release/RETRIEVAL_EDGES.json); access/filter/model/malformed vector/no-match/abort/HNSW, external calls 0 |
| Index lifecycle | PASS | [INDEX_LIFECYCLE_EDGES.json](release/INDEX_LIFECYCLE_EDGES.json); 7 race/failure/recovery cases, leftovers 0; DB pool reconnect, не cloud restart |
| Local HTTP | PASS final 9 cases | [RUNTIME_EDGES.json](release/RUNTIME_EDGES.json); real HTTP/DB, synthetic provider transport, 105s timer/cancel/history/fallback; не external provider/cloud proof |
| Retrieval baseline / fresh run | PASS execution; metrics changed | 17 queries, 20/20 gold IDs. Historical: Recall@5/10=1/1, MRR .855556, nDCG .879315. Fresh: Recall@5 .933333, @10 1, MRR .842857, nDCG .868204; 16 embedding200/1network-timeout. [Baseline](release/RETRIEVAL_BASELINE.json), [fresh metrics](release/RETRIEVAL_FINAL.json), [comparison](release/RETRIEVAL_FINAL_COMPARISON.json) |
| Live generation | PASS scoped | [GENERATION_INTEGRATION.json](release/GENERATION_INTEGRATION.json): numeric+citation answer и два no-answer; quota fallback на согласованную light model наблюдался для всех трёх |
| Primary sample | PASS scoped | [SEMANTIC_SAMPLE.json](release/SEMANTIC_SAMPLE.json): реальный primary model, five claims вручную сопоставлены с synthetic open source |
| Native DB / integrity | PASS | drift 0, migration hashes matched, RLS/grants/integrity checks |
| Production runtime | NOT VERIFIED | Только public GET: [PRODUCTION_PUBLIC_FINAL.json](release/PRODUCTION_PUBLIC_FINAL.json). Это не authenticated smoke и не revision proof |

503 не признан permanent failure: metadata всех трёх моделей HTTP 200, минимальные chat requests HTTP 200. Реальные generation пробы также наблюдали 503 и отказ validation, затем успешный bounded quota fallback. [GEMINI_DIAGNOSTIC_FINAL.json](release/GEMINI_DIAGNOSTIC_FINAL.json). Provider root cause/capacity и project RPM/RPD/billing limits через доступные metadata не установлены; billing/ключи/модели не менялись.

## G. Значимые исправления hardening

1. RLS/client grants и schema reconciliation 0019–0023 в исходном hardening; applied migrations при финальном resume не переписывались.
2. Document mutations больше не обходят clearance через owner/admin; live role действует и после demotion.
3. Brief mutations проверяют live actor/role, а не только request snapshot; immutable/version-fenced indexing защищён при edit/delete/retry.
4. Ownership/size/MIME/upload races закрыты отдельными committed storage copies, bounded verification и подписанными Content-Length/Type.
5. Classified query path до embeddings/rerank/generation закрыт; default open-only сохранён.
6. SDK retries отключены, чтобы не умножать gateway budget; bounded 429/Retry-After и transient 408/5xx retries, общий deadline включает queue/waits/fallback.
7. При quota fallback history/final metadata теперь сообщает фактически завершившую модель, а не primary model по умолчанию.
8. Invalid generation не публикуется; ограниченная повторная validation, no-answer, failed/cancelled history и completed terminal protection.
9. History source count/links/empty state исправлены; direct UUID navigation и недоступные sources проверены.
10. Mobile long-title overflow устранён в заголовке detail и в полностью загруженных recent-document cards: minmax(0,1fr), min-width и перенос длинных слов. Brief edit/admin/keyboard journeys проверены без redesign; ожидание реальных данных в E2E больше не скрывает layout за skeleton.
11. Reindex summary сверяет реально ready/current-model state и отличает skipped от completed.
12. Prompt допускает меньше пунктов при малом числе фактов и запрещает заменять body evidence заголовком/metadata. Verifier завершается failure при непубликуемом sample.
13. Vitest обновлён адресно до 4.1.12 против [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) и [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp); production dependencies не обновлялись.
14. Cloud API принял pause для трёх retired OSINT jobs. Это не регистрация нового V1 deployment; GET API не показывает paused field, поэтому evidence фиксирует acknowledgement, а не выдуманный readback state.

## H. GitHub и production deployment

Repository: https://github.com/tmamedzadeh/analitika. Release branch: `codex/zirve-v1-rc-resume`, исходный HEAD/main `a45706e8c0979df1babd20851639e0c9d6a99982`. Итоговый commit/PR/checks фиксируются в `GITHUB_FINAL_DELIVERY.json`; отчёт не подставляет ещё не существующий SHA.

Vercel target владельца: **https://analitika-one.vercel.app**. GitHub status указывает project `tm-d91f/analitika`; управление project/env/region/rollback через Vercel не проверено. У main: `failure / Deployment was blocked`, target `8MKdrbUZxDEE7XRtMdCKzSHyczcD`. Новый release production deployment ID/READY/live revision — **NOT VERIFIED**. Старый successful GitHub status: SHA `a2af6269d81e57e839ecc226e7e1a8ae0014f10f`, Vercel target `2VnHomtKSpAHZ3BcLR373qUBiDp2`; это rollback candidate, а не подтверждённый current-working rollback target.

В Inngest app `analitika` найден successful sync 2026-10-20T14:07:30Z к отдельному Vercel deployment hostname, 8 functions. Есть старые `run-osint`, `close-stale-osint-runs`, `retry-osint-summary`; отсутствует `requeue-stale-document-indexes`. В recent history brief recovery/cleanups COMPLETED, obsolete OSINT cron FAILED. [CLOUD_WORKER_DISCOVERY.json](release/CLOUD_WORKER_DISCOVERY.json). Это обнаруженное runtime расхождение, не выполнение новых workers. Три retired functions получили pause HTTP 200: [RETIRED_CLOUD_JOBS_PAUSED.json](release/RETIRED_CLOUD_JOBS_PAUSED.json).

## I. Незавершённые обязательные задачи V1

| Приоритет | Задача | Статус и причина |
| --- | --- | --- |
| P0 | Подтвердить Vercel project/source main/build/env/DB/models/policy/storage/region/timeouts | NOT VERIFIED; Vercel management access отсутствует, владелец попросил его пропустить |
| P0 | Актуальная production revision и READY release | NOT VERIFIED; old main deployment blocked, проверенный код ещё не подтверждён в production |
| P0 | Актуальные шесть Inngest functions | FAIL current config; stale 8-function app, document recovery отсутствует |
| P0 | Real cloud document+brief event→ready, delivery/signing, duplicate retry | NOT VERIFIED на release revision; ручной local worker и SDK simulations не заменяют cloud |
| P1 | Scheduled document recovery и реальный cold restart | NOT VERIFIED; local DB pool reconnect не является process/cloud restart |
| P0 | Authenticated production smoke всего V1 на release SHA | NOT VERIFIED; public login/401 не заменяют проверку |
| P1 | Подтверждённый рабочий rollback target и доступ к rollback | NOT VERIFIED; найден только historical successful deployment candidate |
| P0 | Merge проверенного release в main после passing gates | Не выполняется при текущем NO-GO; GitHub branch/PR сохраняют проверенную работу |

Эти задачи не перенесены в V2 и не объявлены необязательными. Получение доступа к Vercel пропущено по последнему указанию владельца; остальные результаты сохранены.

## J. Known limitations и будущие улучшения

Автоматическое semantic entailment **не реализовано**. V1 contract требует structural citations, exact excerpts/numbers, no-answer и честного описания semantic limits, а не отдельного AI verifier. Manual spot review — ограниченное evidence, не гарантия каждого будущего claim. Клиент должен проверять вывод по источнику. Увеличивать AI pipeline ради фиктивного зелёного gate не требовалось.

Benchmark малый, 17 curated questions; Recall=1 не доказывает generalization. No-answer retrieval может возвращать нерелевантные кандидаты; правильная абстенция проверяется на generation отдельно. Forced HNSW/GIN подтверждает совместимость индекса, не latency на большом corpus. Normal HNSW на маленьком corpus выбирает seq scan. Rerank по умолчанию false; новый широкий experimental rerank quality benchmark не заявляется.

Gateway concurrency ограничена на instance, а не глобально на все serverless replicas. Project quotas контролируются provider; точные project RPM/RPD не установлены. Open-only для высоких clearance консервативен; отдельная маркировка query требует отдельного product/policy решения. Причина старой задержки 39–47 минут неизвестна без исторических transitions. Старые staging uploads после rollout могут потребовать refresh/retry, существующие committed attachments совместимы.

Qwen/backup model, глобальный distributed quota scheduler, расширенный semantic verifier, corpus-scale performance eval и утверждённая classified processing policy — отдельные будущие решения; они не закрывают перечисленные выше V1 blockers автоматически.

## K. Эксплуатация, релиз и rollback

1. Восстановить secrets только через настроенное безопасное окружение, `bun install --frozen-lockfile`. Не копировать env, raw diagnostics или signed/bypass URLs в Git/PR.
2. Для local check: tests, обе tsc, lint/build; затем **`bun run preview`** на 127.0.0.1:4175 и `test:e2e`. Edge executable на этом ПК найден. Проверять evidence и exact DB/storage cleanup. Applied SQL не запускать повторно.
3. Перед разрешённым rollout проверить свежий main, CI/PR checks, project linkage и deployment revision. Использовать существующий Vercel Git workflow без дублирующего manual deployment. Не обходить branch approvals/protection или failed checks.
4. Подтвердить env names/flags/models, DB и private bucket, open-only/reference, подписанный Inngest endpoint. Sync должен дать ровно шесть текущих jobs, включая оба `*/15 * * * *` recovery, без OSINT jobs.
5. Запустить только новые open synthetic document/brief через настоящий runtime; записать event/run IDs, переходы и final chunk uniqueness. Для lost event/restart проверять scoped fixture; не запускать global recovery/reindex ради зелёной проверки. После smoke удалить только собственные exact fixtures и сверить corpus.
6. Gemini incident: сначала sanitized status/quotaKey/limitKind, Retry-After и model IDs, затем bounded synthetic probe; 503 не доказывает invalid model. Проверять quota в provider console. Не менять billing/keys/models предположительно. [Google troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting).
7. Index incident: смотреть status, timestamps, lease/recovery attempts и Inngest event/run trace. Failed retry должен сохранять committed chunks; исправление upload lag нельзя выдумывать без evidence. Использовать документированный retry, не destructive reindex.
8. Перед production rollout зафиксировать **проверенный** previous READY deployment ID/SHA и доступный rollback механизм. При критическом smoke failure вернуть приложение на этот deployment через Vercel; если rollback target/access не подтверждён, не имитировать rollback. Автоматического schema downgrade нет. Corpus/DB сохраняются, migrations rollback отдельно проектируется только при необходимости.
9. Local hashed evidence не заменяет резервную копию DB. Supabase backup/PITR retention и restore rehearsal требуют отдельного подтверждения; restore в существующую DB без решения владельца не выполнять.

Подробный порядок: [RELEASE_RUNBOOK.md](release/RELEASE_RUNBOOK.md). Политика Lovable: не force push, не rebase/amend/squash опубликованной истории; ветку сохранять reviewable.

## L. V1 Final Acceptance Matrix

| Требование | Статус | Комментарий |
| --- | --- | --- |
| Auth/users/clearance/server mutations | PASS scoped local | Unit/live SQL/browser; owner/admin ceiling сохранён |
| Documents/briefs/indexing реализация | PASS local | Local worker и failure/race tests; cloud отдельно ниже |
| Xülasələr lexical-only | PASS | AZ/AND/month/pagination/EXPLAIN |
| Analitika retrieval/citations/history | PASS scoped local | Baseline/edges/generation, terminal states; semantic limits явные |
| Private storage | PASS live storage | Те же private service/bucket, fixtures cleaned; deployed env linkage ещё не проверена |
| Tests/types/lint/build/dependencies | PASS | Final checks evidence; warnings 6 |
| Migration/integrity/corpus | PASS | 24 migrations, zero drift/integrity, before/after digests |
| Current cloud functions/recovery | FAIL / NOT VERIFIED | Stale registration; новые document/brief/restart runs не проверены |
| GitHub review branch/PR | Delivery record | `GITHUB_FINAL_DELIVERY.json`; main merge заблокирован release gates |
| Vercel READY / live release SHA | NOT VERIFIED | Management gate пропущен по указанию владельца |
| Real production smoke | NOT VERIFIED | Public GET only |
| Rollback readiness | NOT VERIFIED | Historical candidate найден, usable target/access не подтверждены |
| Full report и сохранение работы | PASS | Этот файл, audit/handoff/evidence/manifest |

## M. Final Decision

**PRODUCTION NO-GO.** Локальные исправления и проверки не устраняют отсутствие подтверждённого production rollout и актуальных cloud workers. Признать V1 Production завершённым можно после прохождения всех оставшихся обязательных gates, а не на основании commit/push, старого deployment или одного login GET.
