# ZIRVƏ / ANALİTİKA — FINAL V1 PRODUCTION HARDENING & RELEASE CANDIDATE

## PRIMARY MISSION

Проведи полный аудит, исправление всех подтверждённых дефектов, интеграционную проверку и финальную подготовку ZIRVƏ / ANALİTİKA V1 к production.

Это заключительный этап разработки V1.

Цель — получить максимально законченный, безопасный, стабильный и проверенный release candidate, готовый к финальному review, commit, push, merge в main и последующему deployment.

Не ограничивайся ранее известными проблемами. Проверь всю текущую реализацию, обнаружь и исправь дополнительные дефекты, которые реально мешают production readiness.

В Git working tree накопилось приблизительно 200 изменённых файлов, включая Staged, Unstaged и, возможно, Untracked. Все эти изменения являются частью текущей работы и должны быть сохранены, изучены, согласованы и проверены.

Не переписывай архитектуру без доказанной необходимости. Не расширяй функциональный scope V1.

Работай самостоятельно до завершения всех доступных этапов. Не останавливайся на составлении плана или промежуточном PASS.

Принцип работы:

**Inspect → Diagnose → Fix → Test → Verify → Document → Recheck.**

---

# 0. AUTHORIZATION & OPERATING RULES

Владелец проекта явно разрешает:

- полный аудит и изменение всех файлов репозитория;
- анализ и исправление Staged, Unstaged и Untracked changes;
- использование текущей Supabase PostgreSQL database;
- выполнение SQL-запросов и необходимых data corrections;
- применение, создание и исправление миграций;
- изменение индексов, constraints, функций и других объектов БД;
- безопасное восстановление зависших или повреждённых записей;
- переиндексацию документов и бюллетеней;
- проверку и исправление фоновых задач;
- использование настроенных внешних сервисов для необходимых проверок;
- добавление, изменение и удаление тестов при сохранении или усилении их проверочной ценности;
- исправление архитектурных дефектов, если они доказаны;
- очистку устаревшего кода;
- обновление документации;
- подготовку финального release candidate.

Используй существующую настроенную Supabase DB проекта. Не создавай отдельную TEST/DEV/evaluation database.

Разрешение на изменения БД широкое, но приоритет — сохранность пользовательских данных.

Перед изменениями существующих данных:
1. Установи точный scope.
2. Проверь зависимости и возможные последствия.
3. По возможности сохрани backup/snapshot затрагиваемых записей.
4. Применяй минимально необходимые изменения.
5. Проверь результат после записи.
6. Обеспечь восстановимость при ошибке.

Разрешается удалять подтверждённо устаревшие объекты и данные в рамках актуального scope, но не уничтожать действующий пользовательский corpus.

Не запускай полный destructive reset базы, не удаляй все документы/briefs и не используй `seed-demo --reset-and-seed` на удалённой Supabase DB.

Не выполняй без отдельного подтверждения:
- `git reset --hard`;
- `git clean -fd`;
- force push;
- переписывание Git history;
- push;
- merge в main;
- production deployment.

Не раскрывай secrets, API keys, connection strings или содержимое закрытых документов в логах и отчётах.

Не ослабляй security checks и tests ради формального PASS.

---

# PHASE 1 — COMPLETE GIT AUDIT

## 1.1. Inventory

До изменений проверь:

- текущую branch и HEAD;
- отношение к main;
- `git status --short`;
- `git diff --stat`;
- `git diff --cached --stat`;
- `git diff --name-status`;
- `git diff --cached --name-status`;
- untracked files;
- partially staged files;
- случайные удаления;
- конфликты;
- изменения зависимостей и lockfile.

Сохрани исходный inventory.

Не делай reset/stash/clean для упрощения рабочего дерева.

## 1.2. Audit всех файлов

Изучи все изменения, включая staged и unstaged версии одного файла.

Проверь:
- корректность и завершённость реализации;
- конфликтующие изменения;
- незавершённые функции;
- временные решения;
- дублирование;
- dead code;
- устаревшие импорты;
- ошибки типов;
- проблемы API;
- неправильные database migrations;
- возможные security regressions;
- некорректные маршруты;
- hardcoded credentials;
- временные debug artifacts;
- несогласованные тесты;
- документацию;
- accidental changes.

Проверь также неизменённый код, если он участвует в критических execution paths.

Не считай staged changes уже проверенными.

Не теряй пользовательские изменения.

После завершения аудита каждый изменённый файл должен иметь понятное назначение и согласовываться с итоговой реализацией.

---

# PHASE 2 — CONFIRM V1 SCOPE

Актуальные функции:

1. Authentication / session management.
2. User administration, roles и clearance.
3. Documents.
4. Xülasələr / briefs.
5. Indexing.
6. Analitika / Core RAG.
7. Source citations.
8. Search history.
9. Необходимые административные инструменты.

Удалённые функции, которые не нужно возвращать:

- OSINT Web;
- Information Requests / Məlumat sorğusu;
- Tags / Teqlər;
- document-user ACL/sharing.

Сохраняй исторические migration files.

Значение `OSINT` как направления внутреннего документа может оставаться.

Owner/admin role не должен обходить clearance при чтении содержимого.

Проверь, что удалённые функции не сохранились в активных маршрутах, API, UI, SQL или runtime.

---

# PHASE 3 — DOCUMENT UPLOAD & INDEXING PIPELINE

Ранее пользователь сообщил, что загруженный текст примерно 30 минут находился в состоянии:

`Növbədə gözləyir`.

Позже пользователь сообщил, что ситуация, вероятно, разрешилась сама.

**Не считай это ни доказанной ошибкой, ни доказанным исправлением.**

## 3.1. Проверь фактическую историю

Найди соответствующую запись в Supabase DB.

Проверь:
- created_at / updated_at;
- текущий статус;
- timestamps переходов, если доступны;
- chunks и embeddings;
- ошибки;
- связанные события и jobs;
- фактическое завершение индексации.

Установи, была ли обработка действительно долгой, ожидала ли worker, повторялась ли после ошибки или зависала.

Если история событий не сохранялась, не придумывай причину.

## 3.2. Full lifecycle audit

Проверь:

upload → DB insert → event dispatch → queue → worker → chunking → embeddings → index persistence → ready.

Проверь:
- Inngest или фактически используемый job mechanism;
- event delivery;
- worker availability;
- environment configuration;
- provider latency;
- timeouts;
- retries;
- leases;
- concurrency;
- duplicate events;
- lost events;
- stuck processing;
- recovery;
- failure transitions;
- status updates.

Убедись, что запись не может бесконечно оставаться queued/processing без предусмотренного recovery или явной диагностики.

## 3.3. Reliability requirements

- `ready` только после подтверждённой успешной индексации;
- idempotent jobs;
- safe retries;
- recovery потерянных задач;
- корректная обработка provider failures;
- отсутствие duplicate chunks/embeddings;
- atomic index replacement;
- сохранение старого рабочего индекса при ошибке переиндексации;
- корректное отображение статуса в UI.

Если обнаружишь подтверждённый дефект — исправь и добавь regression tests.

Если запись уже ready и pipeline работает корректно, не делай искусственных изменений ради воспроизведения старой проблемы.

---

# PHASE 4 — SUPABASE DATABASE & MIGRATIONS

Проведи полный аудит текущей Supabase DB.

Ранее фиксировалось:
- применённые миграции до 0018;
- schema snapshot 0021;
- 12 documents;
- 10 briefs;
- 104 chunks;
- 104 embeddings.

Эти значения исторические. Получи актуальные.

Проверь:
- migration history;
- repository migrations;
- schema snapshot;
- tables;
- indexes;
- constraints;
- foreign keys;
- extensions;
- pgvector;
- pg_trgm;
- FTS;
- data integrity;
- orphan records;
- duplicate indexes;
- readiness consistency;
- legacy objects;
- query-history schema.

Примени все необходимые корректные миграции в установленном порядке.

Если обнаружен drift — установи первопричину и исправь.

Не редактируй уже применённые исторические миграции ради скрытого изменения их поведения. Используй новые корректирующие миграции, если требуется.

Проверь, что пользовательский corpus сохранён.

После изменений выполни реальную schema verification и `db:check-drift`.

Не ограничивайся сравнением локальных файлов.

---

# PHASE 5 — XÜLASƏLƏR SEARCH

Заверши согласованную реализацию простого и быстрого lexical search по бюллетеням.

## Requirements

- PostgreSQL Full Text Search;
- поиск по отдельным словам;
- AND semantics для многословных запросов;
- порядок слов не важен;
- слова могут находиться в разных частях текста;
- корректная нормализация азербайджанского языка;
- case-insensitive matching;
- Unicode normalization;
- поиск по title и body;
- сохранение date filters;
- сохранение pagination;
- сохранение clearance;
- сортировка по дате.

Проверь особенности:

`Ə/ə`, `İ/i`, `I/ı`, `Ş/ş`, `Ç/ç`, `Ğ/ğ`, `Ö/ö`, `Ü/ü`.

Не объединяй различные буквы без обоснованного правила.

Не добавляй:
- LLM;
- vector search;
- embeddings;
- semantic search;
- relevance ranking;
- AI reranking.

Xülasələr — каталог бюллетеней, а не аналитическая поисковая система.

Проверь запросы на реальной Supabase DB и соответствующие индексы.

Добавь regression tests.

---

# PHASE 6 — CORE RAG FULL AUDIT

Проверь весь pipeline Analitika:

question → authorization → retrieval → fusion → reranking → generation → citations → response → history.

## Retrieval

Проверь:
- vector retrieval;
- PostgreSQL FTS;
- trigram;
- embedding dimensions;
- model consistency;
- HNSW/index compatibility;
- chunking;
- chunk offsets;
- RRF;
- candidate selection;
- deduplication;
- reranking;
- document/brief retrieval;
- filters;
- fallback;
- no-answer behavior.

При сбое embedding provider или отдельной retrieval branch не допускай необоснованного полного отказа, если безопасный lexical fallback доступен.

Не делай архитектурный rewrite без доказанного дефекта.

## Access security

Проверь:

user clearance → source eligibility → chunks → LLM context → citations → history.

Обязательно проверь:
- owner/admin bypass;
- прямой доступ к недоступным документам;
- chunk access;
- source revalidation;
- history access;
- TOCTOU;
- утечки metadata;
- согласованность filters;
- отсутствие запрещённых документов в LLM context.

## Benchmark

Создай качественный benchmark по фактическому corpus.

Ориентир: 15–30 вопросов, если объём corpus позволяет.

Сценарии:
- single-source;
- multi-source;
- cross-document;
- documents;
- briefs;
- filters;
- no-answer;
- restricted-access.

Проверь gold source IDs.

Рассчитай:
- Recall@5;
- Recall@10;
- MRR;
- nDCG.

No-answer и access-restricted scenarios оцени отдельно.

Сохрани dataset, методику и результаты.

Если метрики выявляют реальные ошибки, исправь root cause и повтори benchmark.

Не подбирай тесты под желаемые показатели.

---

# PHASE 7 — INDEXING ATOMICITY & RECOVERY

Проверь document и brief indexing.

Обязательные сценарии:
1. initial indexing;
2. reindexing;
3. embedding provider failure;
4. queue failure;
5. retry;
6. duplicate event;
7. concurrent events;
8. expired lease;
9. stuck processing;
10. failed recovery;
11. stale events;
12. atomic chunk/embedding replacement.

Докажи, что при ошибке нового indexing pass старый рабочий индекс не уничтожается.

Проверь согласованность status и committed index.

Используй controlled failure injection, unit/integration tests и безопасные live checks.

Не повреждай рабочие записи ради тестирования.

---

# PHASE 8 — CITATION & ANSWER VALIDATION

Проверь цепочку:

claim → citation `[n]` → source → chunk → excerpt.

Проверь:
- valid citations;
- missing citations;
- nonexistent sources;
- invalid chunks;
- incorrect excerpts;
- incorrect numerical facts;
- multiple citations;
- no-answer;
- insufficient evidence;
- malformed generation;
- citation retry;
- source clearance.

Не заявляй полноценную semantic entailment verification, если её нет.

Разделяй:
- deterministic structural validation;
- numerical/excerpt consistency;
- semantic claim support.

Документируй реальные ограничения.

---

# PHASE 9 — COMPLETE UI/UX AUDIT

Проверь основные пользовательские сценарии:

- login/logout;
- session expiration;
- navigation;
- documents list/detail;
- document creation/editing;
- briefs list/detail;
- Xülasələr search;
- Analitika search;
- citations;
- history;
- administration;
- loading states;
- error states;
- empty states;
- access-denied states;
- mobile/responsive behavior.

Отдельно проверь ранее обсуждавшиеся проблемы:
- отсутствие loading animation во время запросов;
- открытие документов из `Son sənədlər`;
- URL с UUID, который изменяется, но не открывает содержимое;
- некорректные состояния indexing;
- stale UI после серверных изменений;
- ссылки на удалённые функции.

Исправь подтверждённые дефекты.

Сохрани текущий визуальный стиль. Не проводи масштабный redesign.

---

# PHASE 10 — SECURITY & PRODUCTION CONFIGURATION

Проверь:
- authentication;
- authorization;
- clearance;
- sessions;
- server-side validation;
- SQL injection;
- XSS;
- CSRF;
- rate limiting;
- secrets;
- logging;
- error disclosure;
- dependency vulnerabilities;
- Supabase Storage;
- environment configuration;
- Inngest/worker configuration;
- Gemini integration;
- destructive operations.

Проверь, что `seed-demo` destructive reset guard защищает удалённую Supabase DB.

Не запускай destructive reset для проверки.

Особенно важно: оцени передачу classified content внешнему Gemini provider.

Если для определённых classification levels отсутствует подтверждённая политика внешней обработки, обозначь production security blocker. Не придумывай разрешения.

---

# PHASE 11 — FULL TEST & INTEGRATION GATE

Выполни:

- `bun run test`;
- production `tsc --noEmit`;
- evaluation `tsc --noEmit -p tsconfig.eval.json`;
- `bun run lint`;
- `bun run build`;
- `bun run db:check-drift`;
- frozen-lockfile dry-run;
- `git diff --check`.

Также выполни доступные:
- integration tests;
- retrieval benchmark;
- indexing recovery tests;
- authorization tests;
- UI route smoke tests;
- browser E2E tests.

Предыдущий результат: 41 test files / 170 tests PASS.

Не ослабляй assertions, не удаляй неудобные тесты и не скрывай failures.

Проверяй реальные результаты, а не только exit codes.

---

# PHASE 12 — FINAL CLEANUP & GIT PREPARATION

После исправлений:

1. Удали подтверждённые временные artifacts.
2. Проверь dead code.
3. Проверь secrets.
4. Проверь dependencies.
5. Проверь README.
6. Проверь deployment instructions.
7. Проверь migration consistency.
8. Проверь staged и unstaged changes.
9. Убедись, что staged snapshot не содержит старую версию исправленного кода.
10. Подготовь согласованный staging set для release candidate.

Не выполняй слепой `git add -A`.

Не удаляй непонятные пользовательские изменения.

Не создавай commit и не выполняй push/merge/deployment без финального подтверждения.

---

# PHASE 13 — FINAL PRODUCTION GATE

После завершения всех исправлений проведи повторную независимую проверку фактического состояния.

Обнови:

`docs/V1_PROD_HARDENING_AUDIT.md`

Подготовь финальный release report.

## Required report

### 1. Git
- branch / HEAD;
- initial и final changed files;
- staged / unstaged / untracked;
- найденные и исправленные проблемы;
- release candidate state.

### 2. Database
- applied migrations;
- schema verification;
- indexes;
- data integrity;
- corpus preservation;
- drift status.

### 3. Upload / Indexing
- расследование ранее долгой загрузки;
- реальное состояние записи;
- обнаруженные проблемы;
- исправления;
- recovery evidence.

### 4. Xülasələr
- lexical search;
- Azerbaijani normalization;
- AND-search;
- date ordering;
- live DB evidence.

### 5. Analitika / RAG
- retrieval pipeline;
- benchmark results;
- Recall@5;
- Recall@10;
- MRR;
- nDCG;
- fallback;
- citation validation;
- clearance.

### 6. Frontend
- проверенные маршруты;
- loading/error states;
- исправленные UI defects.

### 7. Security
- authentication;
- authorization;
- clearance;
- secrets;
- external provider policy;
- destructive operations.

### 8. Quality
- tests;
- TypeScript;
- lint;
- build;
- migration drift;
- integration;
- E2E.

### 9. Acceptance matrix

Для каждого критерия укажи:
- PASS / FAIL / NOT VERIFIED;
- evidence;
- связанные файлы и тесты;
- remaining risks;
- blocking/non-blocking status.

### 10. Final decision

Отдельно оцени:
- Code readiness;
- Database readiness;
- Indexing/worker readiness;
- Retrieval readiness;
- Security readiness;
- Runtime readiness;
- Release readiness.

Вынеси:

**GO / NO-GO.**

GO допустим только при отсутствии критических FAIL и критических NOT VERIFIED.

Не объявляй production GO, если исправления существуют только в локальном коде, но фактический runtime остаётся непроверенным.

Если deployment ещё не выполнен по запрету владельца, отдельно обозначь pre-deployment readiness и необходимость post-deployment smoke verification. Не смешивай эти статусы.

---

# EXECUTION ORDER

1. Full Git inventory.
2. Scope confirmation.
3. Upload/indexing investigation.
4. Supabase DB/migrations.
5. Xülasələr lexical search.
6. Core RAG audit.
7. Retrieval benchmark.
8. Indexing atomicity/recovery.
9. Citation validation.
10. UI/UX audit.
11. Security/configuration audit.
12. Full tests/integration.
13. Cleanup/Git preparation.
14. Independent-style final recheck.
15. Release report and GO/NO-GO.

Работай последовательно и самостоятельно.

Если обнаружен дефект, который можно безопасно исправить в рамках разрешений, исправь его, протестируй и проверь результат.

Не оставляй исправимые проблемы в статусе NOT VERIFIED только потому, что ранее они уже были отмечены как NOT VERIFIED.

Не выполняй необоснованные массовые рефакторинги.

Не прекращай работу после первого успешного build.

---

# DEFINITION OF DONE

Финальный release candidate должен удовлетворять следующим условиям:

- все ~200 текущих Git-изменений проверены;
- пользовательские изменения сохранены;
- старые критические дефекты исправлены;
- upload/indexing pipeline проверен;
- пользовательские данные сохранены;
- Supabase migrations согласованы и применены;
- database drift отсутствует;
- Xülasələr search работает на реальной DB;
- Core RAG корректно работает и измерен;
- indexing устойчив к сбоям;
- citations имеют проверяемую evidence chain;
- clearance не обходится;
- основные UI-сценарии проверены;
- tests/typecheck/lint/build проходят;
- production configuration проверена;
- временный код очищен;
- Git подготовлен к финальному review;
- финальный audit report содержит фактические доказательства.

Если найдены новые дефекты, влияющие на production readiness, устрани их и повтори соответствующие проверки.

Если обнаружен блокер, который невозможно устранить имеющимися средствами, укажи конкретную причину и требуемое действие.

**Твоя задача — максимально довести проект до финала, а не просто перечислить проблемы.**

Начинай с полного Git inventory. После этого проверь историю долгой загрузки и переходи к остальным этапам.

Не выполняй push, merge или deployment без моего отдельного подтверждения.