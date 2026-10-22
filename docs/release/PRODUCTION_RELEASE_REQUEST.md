# ZIRVƏ / ANALİTİKA — FINAL V1 PRODUCTION RELEASE & PROJECT COMPLETION

## PRIMARY OBJECTIVE

Доведи проект ZIRVƏ / ANALİTİKA V1 до полноценного, проверенного Production Release.

Это заключительный этап разработки V1.

**Не ограничивайся подготовкой нового отчёта, аудитом или очередным Release Candidate. Цель — закрыть все обязательные задачи V1, опубликовать проверенную версию через GitHub и Vercel, подтвердить работу production-системы и предоставить полный отчёт о проделанной работе.**

Владелец проекта явно разрешает в рамках этого задания:
- исправлять код и конфигурацию;
- выполнять необходимые безопасные миграции;
- создавать commits;
- push в GitHub;
- создавать Pull Request;
- merge в `main`;
- выполнять production deployment через Vercel;
- запускать безопасные production smoke tests.

Разрешение на релиз НЕ означает разрешения обходить security gates, игнорировать проваленные проверки или выполнять разрушительные операции.

**Не объявляй Production GO при незакрытых критических проблемах. Если реальный блокер нельзя устранить безопасно, сохрани результаты и явно укажи NO-GO с подтверждённой причиной.**

---

# PHASE 0 — RECOVER CURRENT STATE

Текущая рабочая ветка:

`codex/zirve-v1-rc-resume`

Последний отчёт:

- 55 staged files;
- 0 unstaged/untracked;
- 195 unit tests PASS;
- TypeScript PASS;
- lint PASS;
- build PASS;
- Browser E2E 8/8 PASS;
- Integration 18/18 PASS;
- Storage checks PASS;
- Lexical checks PASS;
- Runtime edge checks PASS;
- Supabase corpus preserved;
- Production NO-GO.

Изучи:

- `AGENTS.md`
- `docs/WORK_SESSION_HANDOFF.md`
- `docs/V1_PROD_HARDENING_AUDIT.md`
- `docs/release/PRODUCTION_HARDENING_REQUEST.md`
- Git history
- staged diff
- текущие environment и deployment configuration.

Убедись, что все 55 изменений сохранены и нет конфликтов.

Проведи независимый review staged diff.

Не выполняй destructive Git operations.

Не используй force push, `reset --hard`, `clean -fd`.

Существующую опубликованную историю Lovable/GitHub не переписывай.

---

# PHASE 1 — CLOSE ALL V1 IMPLEMENTATION GAPS

Пройди всю acceptance matrix и полный V1 scope.

Не оставляй незакрытых обязательных P0/P1 задач.

Не считай задачу завершённой только потому, что она реализована в коде. Подтверди её тестами и, где необходимо, реальной интеграционной проверкой.

Обязательные направления:

## 1. Authentication & Authorization

Проверь:
- login/logout;
- sessions;
- expiry/revocation;
- user active status;
- roles;
- clearance;
- server-side authorization;
- доступ к документам;
- доступ к истории;
- прямые URL;
- все mutations;
- отменённые/истёкшие запросы;
- отсутствие обхода ограничений через API.

Owner/admin не должны обходить content clearance.

## 2. Documents & Briefs

Проверь полный lifecycle:
- creation;
- uploads;
- editing;
- saving;
- viewing;
- indexing;
- retries;
- failure feedback;
- recovery;
- archive/delete, если предусмотрены V1;
- attachments;
- loading/error/empty states.

Убедись, что документы не теряются при сбоях jobs или AI API.

## 3. Xülasələr Search

Только PostgreSQL lexical search.

Обязательны:
- Azerbaijani normalization;
- AND semantics для нескольких слов;
- независимость от порядка слов;
- поиск в title/body;
- корректные даты;
- сортировка;
- pagination;
- отсутствие утечки закрытых данных.

Не добавляй LLM, embeddings или semantic ranking в этот раздел.

## 4. Analitika / RAG

Проверь:
- hybrid retrieval;
- vector search;
- FTS;
- trigram;
- RRF;
- deduplication;
- ranking;
- clearance filtering;
- citations;
- exact source access;
- query history;
- generation errors;
- cancellation;
- timeout;
- lexical fallback;
- отсутствие выдачи недоступных пользователю источников.

Существующий benchmark используй как baseline, но не как замену финальной runtime validation.

## 5. Security

Заверши security review:
- API access control;
- CSRF/origin;
- request validation;
- upload limits;
- private Storage;
- signed URLs;
- rate limiting;
- SQL injection;
- XSS;
- sensitive logging;
- secrets exposure;
- clearance enforcement;
- external AI processing policy.

Не отправляй classified документы или prompts внешнему AI без подтверждённой разрешающей политики.

Если такая политика не утверждена, оставь безопасный open-only режим и проверь, что остальные classifications блокируются до передачи данных.

Это допустимая V1-политика безопасности, если она явно отражена в документации и пользовательском поведении.

---

# PHASE 2 — GEMINI PRODUCTION RELIABILITY

Последняя реальная проверка Gemini вернула:

`503 UNAVAILABLE`

Разберись с причиной и повтори проверку.

Не интерпретируй единичный 503 как окончательную неисправность, но и не называй интеграцию работоспособной без доказательства.

Проверь:
- правильность model IDs;
- фактическую доступность моделей;
- API configuration;
- 429;
- RPM/RPD;
- 503;
- Retry-After;
- exponential backoff;
- bounded retries;
- timeout budgets;
- recovery;
- отсутствие бесконечных запросов;
- сохранность истории и citations при ошибках.

Текущие модели:

`AI_CHAT_MODEL=gemini-3.8-flash`

`AI_LIGHT_MODEL=gemini-3.5-flash-lite`

Embeddings: Gemini Embedding 2.

**Не реализовывай AI_BACKUP_MODEL. Решение отложено владельцем проекта.**

Не выполняй массовую переиндексацию без необходимости.

Если Gemini временно недоступен:
- приложение должно корректно обрабатывать ошибку;
- не терять данные;
- не сохранять незавершённый ответ как успешный;
- не публиковать непроверенные citations;
- позволять безопасно повторить запрос;
- сохранять работоспособность независимых функций.

Проведи реальную успешную проверку generation с разрешёнными open-данными, включая citations и no-answer scenario.

Не отправляй конфиденциальные тексты в diagnostic logs.

---

# PHASE 3 — CLOUD WORKERS & RECOVERY

Это один из ключевых незакрытых production gates.

Проверь реальную работу Inngest или используемой системы background jobs.

Обязательно подтвердить:

1. Production endpoint доступен и правильно защищён.
2. Актуальные functions зарегистрированы.
3. Signing/configuration корректны.
4. Event действительно доставляется.
5. Worker получает event.
6. Документ проходит queued → processing → ready.
7. Brief корректно индексируется.
8. Retry не создаёт duplicate chunks.
9. Failed jobs сохраняют корректный статус.
10. Scheduled recovery реально зарегистрирован и выполняется.
11. Потерянные events могут восстанавливаться.
12. Уже committed index не уничтожается при неудачной переиндексации.

Используй только безопасные synthetic fixtures.

После проверок выполни cleanup и подтверди сохранность существующего corpus.

Локальный integration PASS не заменяет проверку реальной cloud delivery.

---

# PHASE 4 — DATABASE & DATA INTEGRITY

Используй текущую configured Supabase DB.

По предыдущему отчёту:
- 24 migrations, до `0023`;
- 13 documents;
- 10 briefs;
- 107 chunks;
- 107 embeddings;
- native drift PASS.

Это baseline, а не повод искусственно возвращать counts к прежним значениям.

Проверь актуальное состояние БД.

Не переписывай уже applied migrations и их hashes.

Не запускай повторно применённые миграции.

При необходимости новой schema migration создай отдельную миграцию и примени безопасно.

Проверь:
- schema integrity;
- migration journal;
- RLS;
- grants;
- FKs;
- indexes;
- duplicate chunks;
- orphan embeddings;
- vector model/dimensions;
- transaction safety;
- корректность индексации;
- отсутствие потерь пользовательских данных.

Запрещены destructive reset, DROP SCHEMA, массовое TRUNCATE и удаление corpus ради тестов.

---

# PHASE 5 — COMPLETE UI/UX ACCEPTANCE

Проверь ключевые пользовательские сценарии на desktop и mobile.

Особое внимание:
- documents;
- Xülasələr;
- Analitika;
- citations;
- history;
- admin;
- navigation;
- direct links;
- loading;
- error states;
- empty states;
- permissions;
- responsive layout;
- keyboard usability.

Сохраняй текущий премиальный минималистичный дизайн.

Исправляй реальные UX defects, не выполняй необоснованный redesign.

Проверь, что все пользовательские сообщения соответствуют поддерживаемым языкам и состояниям приложения.

---

# PHASE 6 — RELEASE QUALITY GATE

После необходимых исправлений выполни полный финальный набор проверок:

- unit tests;
- integration tests;
- TypeScript;
- lint;
- production build;
- E2E;
- lexical checks;
- storage checks;
- runtime/deadline checks;
- DB drift;
- security checks;
- dependency audit;
- retrieval benchmark;
- generation validation.

Не ослабляй тесты для получения зелёного результата.

Не выдавай mocked integrations за реальные production integrations.

Если проверка не выполнялась, указывай NOT VERIFIED.

Known semantic entailment limitation рассмотри отдельно:

- Проверь соответствие текущим утверждённым требованиям V1.
- Не объявляй structural citation validation семантической проверкой фактов.
- Если семантическая проверка обязательна по V1 contract, закрой этот gap до GO.
- Если это будущая функция, явно документируй ограничение и обеспечь безопасное поведение при недостаточных evidence/no-answer.

Не добавляй новый сложный AI verification layer исключительно ради формального закрытия audit, если это не требуется V1.

---

# PHASE 7 — GITHUB RELEASE

После прохождения доступных pre-deployment gates:

1. Проверь актуальный `origin/main`.
2. Сохрани все проверенные изменения в commit(s) текущей ветки.
3. Push ветки в GitHub.
4. Создай Pull Request в `main`.
5. Заполни PR description:
   - scope;
   - changes;
   - tests;
   - DB migrations;
   - security impact;
   - deployment notes;
   - rollback plan.
6. Проверь GitHub checks и branch protection.
7. Дождись успешного Vercel Preview deployment.
8. Проведи доступные preview smoke checks.
9. Проверь diff между PR и `main`.

После успешного review и обязательных checks разрешено выполнить merge в `main`.

Если branch protection требует отдельного approval, не обходи его.

Не используй force push.

Подтверди итоговый GitHub commit SHA.

---

# PHASE 8 — VERCEL PRODUCTION DEPLOYMENT

Найди фактически связанный с проектом Vercel project.

Не создавай параллельный production project без необходимости.

Проверь:
- project ID;
- правильный Git repository;
- production branch;
- build command;
- runtime preset;
- environment variables;
- secret configuration;
- Supabase connection;
- Gemini configuration;
- Inngest signing;
- storage configuration;
- deployment regions/timeouts;
- health/runtime diagnostics.

Не выводи значения секретов в ответ или logs.

Выполни production deployment только после pre-deploy gates.

Если auto-deploy запускается при merge в `main`, используй установленный workflow, не создавай случайно второй production deployment.

Подтверди:
- deployment status READY;
- deployment ID;
- production URL;
- deployment commit SHA;
- соответствие production revision актуальному release commit.

GitHub push сам по себе не является доказательством deployment.

---

# PHASE 9 — REAL PRODUCTION SMOKE TESTS

После deployment проверь реальную опубликованную систему.

Выполни безопасные smoke tests:

### Authentication
- login/logout;
- sessions;
- authorization;
- clearance enforcement.

### Core UI
- documents list;
- document detail;
- briefs;
- lexical search;
- Analitika;
- history;
- citations;
- mobile navigation.

### Storage
- private access;
- authorized signed access;
- unauthorized access denied.

### Background processing
- safe synthetic document upload;
- worker invocation;
- indexing completion;
- scheduled recovery registration.

### Gemini
- реальный разрешённый аналитический запрос;
- успешная генерация;
- корректные citations;
- no-answer;
- bounded failure handling.

### Data protection
- закрытые документы не доступны без clearance;
- внешнему AI не передаются неразрешённые данные;
- пользовательский corpus сохранён.

### Logs and runtime
- нет critical runtime exceptions;
- нет утечек секретов;
- нет неожиданного потока retry requests;
- нет постоянно зависших новых jobs.

Удаляй только собственные synthetic test artifacts.

Не затрагивай пользовательские документы.

---

# PHASE 10 — ROLLBACK READINESS

До production deployment подготовь rollback plan.

Зафиксируй:
- предыдущий рабочий deployment;
- предыдущий release commit SHA;
- способ возврата к предыдущей версии;
- особенности совместимости БД;
- возможные последствия миграций.

Не рассчитывай, что rollback приложения автоматически откатывает schema migrations.

Если новая migration необратима или несовместима с предыдущим deployment, реши это до релиза.

Если post-deployment smoke tests выявят критическую проблему:
- немедленно прекрати rollout;
- выполни безопасный rollback приложения при наличии подтверждённого rollback target;
- сохрани DB/corpus;
- зафиксируй NO-GO и причины.

---

# PHASE 11 — COMPLETE PROJECT DOCUMENTATION

Создай или обнови:

`docs/V1_FINAL_PRODUCTION_REPORT.md`

Это должен быть полноценный итоговый отчёт о разработке V1, а не краткий перечень тестов.

Структура:

## A. Executive Summary

Что такое ZIRVƏ / ANALİTİKA, какие бизнес-проблемы решает и в каком состоянии находится V1.

## B. Implemented Functionality

Полный обзор реализованной функциональности:
- authentication;
- users/roles/clearance;
- documents;
- briefs;
- search;
- indexing;
- Analitika;
- RAG;
- citations;
- history;
- admin;
- integrations;
- UI/UX.

Для каждого блока укажи, что работает и чем это подтверждено.

## C. Technical Architecture

Опиши реальные используемые компоненты:
- frontend;
- backend;
- database;
- storage;
- authentication;
- background processing;
- AI;
- embeddings;
- retrieval;
- deployment.

Не описывай несуществующие компоненты.

## D. Security Architecture

Отрази:
- roles;
- clearance;
- data isolation;
- RLS;
- server-side enforcement;
- external AI processing policy;
- upload protection;
- secrets management;
- logging.

## E. Database & Indexing

- migrations;
- schema state;
- corpus integrity;
- vectors;
- indexing lifecycle;
- recovery.

## F. Quality Assurance

Таблица всех итоговых проверок:
- PASS;
- FAIL;
- NOT VERIFIED;
- evidence;
- комментарий.

## G. Problems Fixed

Полный перечень значимых обнаруженных и исправленных проблем в ходе production hardening.

## H. Production Deployment

- GitHub repository;
- release branch/commit;
- PR;
- Vercel project;
- deployment ID;
- production URL;
- live runtime revision;
- deployment result.

## I. Outstanding Issues

Для финального Production GO не должно оставаться незавершённых обязательных V1 P0/P1 задач.

Если обязательная задача не закрыта, статус NO-GO — не скрывай её и не переносить искусственно в V2.

Необязательные будущие улучшения отдели от дефектов V1.

## J. Known Limitations

Зафиксируй только реальные, подтверждённые ограничения.

## K. Operational Runbook

- deployment;
- environment configuration;
- DB migrations;
- indexing recovery;
- worker troubleshooting;
- Gemini quota troubleshooting;
- backup/rollback;
- диагностика production incidents.

## L. V1 Final Acceptance Matrix

Перечень всех обязательных требований V1 с проверками и evidence.

## M. Final Release Decision

Чётко укажи:

`PRODUCTION GO`

или

`PRODUCTION NO-GO`

Решение должно следовать из фактических результатов, а не из желания завершить проект.

---

# PHASE 12 — FINAL CLEANUP

Перед завершением:

- проверь временные файлы;
- проверь debug code;
- проверь случайные console logs;
- проверь неиспользуемые imports;
- проверь staged/untracked;
- проверь документацию;
- проверь `.env.example`;
- убедись, что секреты и пользовательские данные не добавлены в Git;
- убедись, что нет конфликтов и незавершённых безопасных изменений;
- убедись, что все изменения V1 сохранены в GitHub.

Не удаляй нужные evidence files или historical migrations.

Не проводи масштабный рефакторинг ради косметического cleanup.

---

# FINAL ACCEPTANCE CRITERIA

Проект можно считать завершённым как V1 Production только если:

1. Все обязательные V1 requirements реализованы.
2. Нет открытых P0 defects.
3. Нет незавершённых обязательных P1 requirements.
4. Unit/integration/E2E/quality gates PASS.
5. Database integrity подтверждена.
6. Clearance и security gates PASS.
7. Production Storage проверен.
8. Real cloud workers и recovery подтверждены.
9. Gemini integration работоспособна либо проходит согласованный контракт устойчивой деградации без ложных успешных ответов.
10. GitHub `main` содержит проверенный release.
11. Vercel production deployment READY.
12. Production SHA соответствует release SHA.
13. Production smoke tests PASS.
14. Rollback plan подготовлен.
15. Полный production report создан и сохранён.
16. Нет критических NOT VERIFIED в acceptance matrix.

**Нулевое количество незавершённых обязательных задач V1 — цель. Не добивайся этого переименованием, скрытием или исключением реальных проблем.**

---

# NON-GOALS

Не добавляй в V1:
- OSINT Web;
- Information Requests;
- Tags;
- individual document ACL;
- AI_BACKUP_MODEL;
- локальный Qwen;
- полную смену архитектуры;
- новые функции, не предусмотренные утверждённым scope.

Не реализовывай функциональность V2 без необходимости.

---

# REQUIRED FINAL RESPONSE

После выполнения предоставь мне развёрнутый отчёт на русском языке:

1. **Итоговый статус:** Production GO или NO-GO.
2. **Что реализовано:** полный функциональный обзор системы.
3. **Что исправлено:** основные bugs, security и reliability changes.
4. **Что проверено:** tests, integrations, E2E, live production.
5. **GitHub:** branch, PR, commit SHA, merge status.
6. **Vercel:** project, deployment ID, URL, revision, status.
7. **Supabase:** migration status и целостность corpus.
8. **AI:** Gemini models, generation, RAG, citations, quota handling.
9. **Workers:** delivery, indexing, recovery.
10. **Безопасность:** clearance, storage, external processing policy.
11. **Незавершённые обязательные задачи V1:** должны отсутствовать для GO; иначе перечисли каждую.
12. **Known limitations и возможные V2 improvements:** отдельно от дефектов V1.
13. **Расположение полного отчёта:** `docs/V1_FINAL_PRODUCTION_REPORT.md`.

Работай последовательно. Не останавливайся после очередного промежуточного аудита, если можешь безопасно устранить выявленные проблемы.

**Главная задача: реально завершить ZIRVƏ / ANALİTİKA V1, проверить production и предоставить доказательный итоговый отчёт о всей проделанной работе.**