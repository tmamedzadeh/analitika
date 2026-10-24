# ZIRVƏ V1 — Final UX & Production

Дата: 24 октября 2026, Asia/Baku.

## 1. Executive summary и статус

Завершены единые фильтры Bülletenlər, Məlumat bazası и Analitika во всех слоях: React, Zod, SQL, pagination/cache keys, history, Drizzle и storage. Сохранены архитектура TanStack Start, визуальная идентичность navy/teal, classification документов, authentication и citation protections.

Владелец новым запросом разрешил production migrations и обычный push в main. **Обе миграции 0027/0028 применены к production, реализация отправлена в main обычным push.** Ready для commit `ab3fcf60070d86321520d8c0cb65ea5bda55d9cf` подтверждён владельцем в разговоре, GitHub показывает Vercel success, Inngest автоматически синхронизирован. Contract применён после интервала 300 секунд и проверки отсутствия старых активных runs. Итоговая схема, контрольные суммы всех шести таблиц и неизменность RLS подтверждены.

Подробный технический разбор первоначальной реализации и её исходных причин: [ZIRVE_UNIFIED_UX_FILTERS_REPORT.md](../ZIRVE_UNIFIED_UX_FILTERS_REPORT.md). Этот файл определяет актуальный production-статус.

## 2. Реализованные изменения по разделам

**Bülletenlər:** единый Dövr вместо all/week/month и отдельного месяца; placeholder `Bülletenlərdə axtarın`; второстепенная кнопка Axtar; карточки с крупной датой слева, компактным названием, четырьмя строками Xülasə (14 px / 1.6), нейтральным цветом, мягким hover 2 px и keyboard focus. Лимит сохраняемого summary остаётся 400 символов. Spacing перед выдачей около 40 px без двойного margin. Карточка целиком кликабельна. В create/edit/detail нет грифа или служебного Open.

**Məlumat bazası:** сохранены поиск и İstiqamət, добавлены Dövr и два компактных MultiSelect. Новые документы требуют осознанного выбора A–E и 1–5; начальное значение пустое. Для недатированных документов выдача явно обозначает `Əlavə edilib`, а панель объясняет fallback на дату добавления. `doc_date` не заполняется искусственно.

**Analitika:** компактная адаптивная горизонтальная панель вместо пяти колонок с заголовками. Dövr и направления доступны сразу, точные оценки выбираются общими MultiSelect. `Bülletenlərdə də axtar` включено для новых запросов; отключение исключает brief branches. Очистка дополнительных фильтров сохраняет текст вопроса. Исторические периоды/thresholds отображаются через read-only compatibility path с явным выбором нового периода перед повторным запуском.

**Общие:** тёплая золотистая подсветка chunk; защищённый оригинал изображения и WebP preview; согласованные 40 px controls, focus states и перенос на mobile. Shared navigation и работающие пользовательские потоки сохранены.

## 3. Dövr, календарь и серверные границы

`PeriodFilter` переиспользуется во всех трёх разделах. Значения: Son ay (default), Son rüb, Son il, **Fərdi dövr**. Hamısı отсутствует.

| Значение   | Единое правило                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Son ay     | Сегодня и предыдущие 29 дат Asia/Baku, 30 дней включительно                                                                           |
| Son rüb    | Сегодня и предыдущие 89 дат, 90 дней включительно                                                                                     |
| Son il     | Последние 12 месяцев: со следующей даты после годовщины до сегодняшней даты; годовщина корректно ограничивается последним днём месяца |
| Fərdi dövr | Подтверждённые from/to включительно; одна выбранная дата означает один день                                                           |

Календарь использует существующие react-day-picker/Calendar/Popover и азербайджанскую локаль. Первый/второй клики выбирают начало/конец, диапазон подсвечен, доступны месяцы/годы. Один месяц на всех размерах позволяет сохранять компактность. Tətbiq et применяет draft, Ləğv et/Escape отменяют. Future dates и from > to запрещены и в UI, и на сервере. При выборе preset custom bounds удаляются.

SQL: Bülletenlər фильтруются по `brief_date`; документы по `doc_date`. **Только для NULL doc_date** используется `created_at`: в UI это явно дата добавления, а не дата документа. То же правило действует в Analitika. Даты PostgreSQL сравниваются включительно; timestamp использует `[Baku midnight(from), Baku midnight(dayAfter(to)))`, предотвращая ошибки последней секунды. Intl учитывает исторический DST Баку; фиксированный UTC+4 не подставляется для старых дат.

Подтверждённые фильтры принадлежат URL и валидируются TanStack Router. Reload и переход на detail/Back сохраняют их; draft календаря и pagination cursors в URL не записываются. Questions/answers также не попадают в URL. Изменение фильтров меняет React Query key и сбрасывает keyset cursor. Изменения controls заменяют текущую history entry, не создавая entry на каждый checkbox.

## 4. MultiSelect, NULL и history

`ReliabilityFilters` предлагает только A–E и 1–5. Выбор внутри одного фильтра — точный SQL `IN` (OR), разные фильтры соединены AND. Пустой массив не ограничивает выдачу. Есть очистка и компактный summary; длинные списки не занимают панель. Keyboard и checkbox semantics доступны через Radix Popover.

Оценки относятся только к документам. Бюллетени при includeBriefs=true участвуют независимо от выбранных оценок. Новые validators не принимают F/6. DB defaults удалены, nullability разрешает отсутствие оценки; contract меняет только F/6 на NULL и ограничивает актуальные значения. Никакой автоматической переоценки A/1 нет. NULL не становится высокой оценкой: предупреждения и conservative prompt-grounding сохраняются.

Новые history filters имеют `filterVersion: 2` и includeBriefs=true по умолчанию. Для старых записей без includeBriefs сохраняется OFF; старые 7d/all, thresholds, query/response и citation snapshots не переписываются и не переинтерпретируются. Ререндер истории не запускает retrieval. Перед повторным запуском legacy query пользователь явно выбирает поддерживаемый новый период. Серверный validator новых запросов остаётся строгим даже при пустом draft направлений в UI.

## 5. Bülletenlər classification и security

Итоговая Drizzle schema не содержит `daily_briefs.classification`. Поле убрано из input schemas, mutations, queries, UI, search/retrieval, source previews и history mapping; в общей source model используется константа open.

Сохранены authentication, active-user checks, author/admin edit/delete checks, source existence, committed-index checks, citation validation и authorization при открытии источников/вложений. Document classification и его ACL не менялись. Удаление классификации не даёт прав на управление чужими бюллетенями.

Preflight production: 19 бюллетеней, non-open=0. У колонки только ожидаемые CHECK/default dependencies; views и RLS policies, использующих её, не обнаружены. RLS включён на всех шести проверенных таблицах и не изменяется. Проверка non-open повторяется атомарно внутри каждой фазы миграции; несоответствие вызывает exception, автоматической деклассификации нет. DROP выполняется без CASCADE.

## 6. Оригиналы изображений и WebP

Оригинальные JPEG/PNG/WebP копируются в committed storage без изменения байтов; сохраняются MIME, размер, SHA-256 и исходные размеры. Sharp работает локально в Node/Vercel runtime, без внешних image services. Для новых JPEG/PNG создаётся WebP quality 82, effort 3, максимум 1600 px, fit inside без увеличения, EXIF orientation применяется к derivative. Прозрачность сохраняется. Derivative metadata по умолчанию очищаются; оригинал сохраняет исходные EXIF/байты. Если выгода менее 5%, encode недоступен или исходник уже WebP, используется валидированный оригинал без повторной компрессии.

Проверяются MIME + реальная сигнатура + фактический decode, лимит 10 MiB, 16 MP, сторона ≤16384, до четырёх каналов, один кадр. Decode/encode ограничены по времени, Sharp cache отключён, concurrency=1 и максимум два одновременных обработчика на instance; batch последовательный. Native import ленивый: чтение существующих данных не зависит от доступности codec, новые загрузки без decoder отклоняются.

`image_metadata` JSONB хранит original dimensions/hash и optional derivative key/MIME/size/dimensions. Обычный attachment route отдаёт WebP, `?original=1` — исходный файл с **теми же** active-user/source authorization checks. Ключи не превращаются в публичные ссылки. Legacy metadata=NULL и отсутствующий derivative безопасно возвращают оригинал. Retain/delete/partial upload rollback/orphan sweep учитывают обе версии; при DB/PUT ошибках cleanup не оставляет новую пару объектов. Массовая конвертация не запускалась.

Ограничение: conversion выполняется синхронно при commit upload после проверки bytes, поэтому новые загрузки могут сохраняться дольше. Это сохраняет атомарный metadata/cleanup flow без нового worker/reindex pipeline. Параллелизм и лимиты ограничивают ресурсы. Полная native-codec недоступность отличается от encode failure: без проверки decode новый файл не принимается.

## 7. Подсветка и UI review

Единый `.chunk-highlight` использует мягкий gold background #fef0bb и небольшое усиление около 900 ms. При prefers-reduced-motion анимация отключена. UTF-16 offsets, UUID, span splitting и Rich JSON canonical storage не менялись; тест покрывает несколько абзацев, list nodes и marks. Citation deep links сохранены.

Проверены list/detail/create/edit/history, длинные заголовки и цитаты, empty/loading/error states, desktop/tablet/mobile, keyboard focus и отсутствие горизонтального overflow. Первоначальный synthetic Edge review — 27 сценариев на 1440/820/390 px; финальный ограниченный smoke — 8 сценариев на 1440/390 px, включая reload выбранного периода и оценок. Это локальная проверка реальных компонентов с synthetic services, а не утверждение о live authenticated production E2E. Нового широкого browser/security audit не выполнялось.

## 8. Миграции и фактическая сохранность production

Порядок: read-only preflight → 0027 expand → push/deploy web + Inngest → подтверждение новой версии и drain старых запросов → 0028 contract → read-only сверка.

| Фаза                  | Содержание                                                                                                         | Статус                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 0027_unified_expand   | Убирает reliability defaults/NOT NULL, добавляет image_metadata в обе attachment tables, временный open-only CHECK | **Применена; проверена 2026-10-24 04:21:55Z; journal id=28** |
| 0028_unified_contract | Удаляет исключительно brief classification и её CHECK, F/6→NULL, сужает rating CHECK                               | **Применена; проверена 2026-10-24 04:31:18Z; journal id=29** |

Фактическая production-схема, checks, RLS и journal: [BEFORE](ZIRVE_FINAL_UX_DB_BEFORE.json), [EXPAND](ZIRVE_FINAL_UX_DB_EXPAND.json), [CONTRACT](ZIRVE_FINAL_UX_DB_CONTRACT.json). Connection fingerprint совпадает. До и после миграций legacy F=0 и 6=0; существующие оценки не изменились. Итоговый столбец brief classification отсутствует, обе image_metadata добавлены, ratings nullable без defaults и с CHECK A–E/1–5.

| Таблица           | Строк до/после обеих фаз | Контрольная сумма содержимого    |
| ----------------- | ------------------------ | -------------------------------- |
| documents         | 15 / 15                  | 73fbfe88feab7b576949cd526a5058dd |
| daily_briefs      | 19 / 19                  | 20823b3735fde887c93245fee2d3ddc5 |
| chunks            | 378 / 378                | 1493102ba86d36717e56a86dcbcb8b2b |
| attachments       | 0 / 0                    | d41d8cd98f00b204e9800998ecf8427e |
| brief_attachments | 0 / 0                    | d41d8cd98f00b204e9800998ecf8427e |
| analytics_queries | 0 / 0                    | d41d8cd98f00b204e9800998ecf8427e |

Digest использует все поля строк, кроме разрешённых изменяемых колонок: document ratings, brief classification, attachment image_metadata. Chunks включают существующие embeddings. Это контроль неизменности, не backup/export пользовательского содержимого. Для исторической совместимости и private attachments production сейчас не содержит записей; эти случаи проверены адресными synthetic tests.

`scripts/migrate.ts --through=0027_unified_expand` не применяет contract. Полный запуск требует явного `--confirm-unified-runtime`; флаг не заменяет проверку deployment. Старая версия остаётся совместимой с expand. После contract rollback только на новую совместимую версию; старый код с обращением к classification возвращать нельзя. Оригинальные SQL migrations/snapshots/journal сохранены последовательно.

## 9. Проверки

| Проверка                                                            | Результат                                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Основной набор первоначальной реализации                            | 647/647 tests, 79 файлов                                               |
| Дополнительные проверки Baku DST/encoder fallback                   | 43/43 адресных tests после последних edge-case изменений               |
| Финальный адресный набор routes/filters/history/permissions/storage | 85/85, 12 файлов                                                       |
| Финальные parser/EXIF/transparency tests                            | 12/12, 2 файла                                                         |
| TypeScript app                                                      | PASS, ошибок нет                                                       |
| TypeScript scripts                                                  | PASS, ошибок нет                                                       |
| ESLint                                                              | PASS, 0 errors; один существующий Fast Refresh warning в ui/button.tsx |
| Production build                                                    | PASS, exit=0, включая Sharp в server artifact                          |
| Финальный компактный Edge smoke                                     | 8/8, console errors=0, overflow отсутствует                            |
| git diff --check                                                    | PASS                                                                   |
| Production expand и contract data/RLS comparison                    | Все шесть digests и RLS без изменений                                  |

Дополнительно после contract: live `/login` HTTP 200, production CSS содержит новую золотистую подсветку, запрос attachment без сессии получает HTTP 401. [HTTP smoke receipt](ZIRVE_FINAL_UX_HTTP_SMOKE.json). Проверка не создавала материалы и не запускала analytics/indexing.

Тесты не вызывают реальный Gemini. Не менялись модели, 105s timeout, semantic hardening prompts, RRF/rerank, evidence selection до 20 chunks, embedding model/dimensions, SSE/progress или citation protections. Reindex, массовая image conversion, corpus benchmarks и дополнительный общий security audit не запускались.

## 10. Git, Vercel и Inngest

Исходный main и origin/main совпадали: `d1f978186fd30db1241b7cae7f16df56dff39764`. Remote: tmamedzadeh/analitika. Force push и переписывание истории не используются. Существующие пользовательские edits az.ts/axtaris сохранены.

Реализация: **`ab3fcf60070d86321520d8c0cb65ea5bda55d9cf`**, commit `feat: unify Zirve filters and optimize private images`, обычный `git push origin main` выполнен. Local/remote main после этого push совпали. [Vercel deployment](https://vercel.com/tm-d91f/analitika/EweBNsXTnYhFtA95Nqw4zD3wMQAY) имеет GitHub status success (`Deployment has completed`) для этого SHA. В ответ на запрос, явно указывавший SHA и Production deployment, владелец подтвердил **Ready**. Vercel API в сессии возвращает 403 без авторизации; прямой API-read Ready не заявляется.

Inngest app analitika автоматически синхронизирован **2026-10-24T04:25:26.241415Z** с новым immutable URL `https://analitika-9cltpg0is-tm-d91f.vercel.app/api/inngest`; все шесть прежних функций сохранены. [Runtime DEPLOYED](ZIRVE_FINAL_UX_RUNTIME_DEPLOYED.json), [проверка drain](ZIRVE_FINAL_UX_RUNTIME_DRAINED.json). Для всех RUNNING/QUEUED/PAUSED за срок существования app (с 2026-10-17) API вернул 0 runs и hasMore=false. Contract запускался после 04:30:26Z, то есть спустя более 300 секунд после sync; это покрывает maxDuration Inngest worker. DB pending/running counters также 0. API list-runs параметры проверены по [официальному Inngest API reference](https://api-docs.inngest.com/api-specs/v2.json).

Результаты rollout добавляются отдельным документационным commit после contract. Web/worker код в нём не меняется относительно подтверждённого Ready SHA. Последующий документационный deployment может автоматически запускаться Vercel; Ready реализации и состояние последнего docs deployment различаются и не подменяются друг другом. Конечный SHA документационного commit сообщается в ответе и определяется через git HEAD, чтобы не создавать циклическую ссылку на собственный hash.

Deploy/sync выполнены существующей Git integration. Ручной deploy, ручной sync, force push и переписывание истории не выполнялись. В receipts нет токенов, query strings или пользовательского содержимого. [Runtime BEFORE](ZIRVE_FINAL_UX_RUNTIME_BEFORE.json) сохраняет исходную точку сравнения.

## 11. Ограничения, отклонения и приёмка

- Один месяц в календаре на desktop/mobile — разрешённый компактный вариант; два месяца не обязательны.
- Исторические 7d/all/thresholds поддерживаются только для чтения; повторный запрос требует явного нового периода.
- F/6 отсутствуют в production preflight; предусмотрена NULL миграция для безопасной совместимости. Старые source previews не объявляются оценёнными.
- Conversion выполняется синхронно с ограничениями, чтобы не вводить лишний lifecycle/worker; это может увеличивать время сохранения новых изображений.
- Локальная визуальная проверка не заменяет ручную приёмку владельцем под production credentials. Live Gemini/reindex и создание production fixture документов намеренно не выполняются.
- После contract нельзя откатить код к прежней схеме. Перед удалением колонки необходимы подтверждённые deployment Ready/SHA и worker sync; при отсутствии такого подтверждения безопасный expand остаётся в production, contract не запускается вслепую.
- Известных нерешённых ошибок в проверенном scope нет. Отдельно фиксируется любой недоступный rollout check; отсутствие доступа не считается успешным deployment.

Для владельца: ручная приёмка дат/фильтров и приватных новых upload под рабочими ролями, проверка protected original route и визуального качества на реальных материалах. Повторного разрешения на уже авторизованные migrations/push не требуется.

## 12. Изменённые файлы

Полный список формируется перед commit и приведён ниже. Логи, screenshots, локальные credentials, .env и build output исключены через .gitignore.

- `bun.lock`
- `docs/release/ZIRVE_FINAL_UX_DB_BEFORE.json`
- `docs/release/ZIRVE_FINAL_UX_DB_CONTRACT.json`
- `docs/release/ZIRVE_FINAL_UX_DB_EXPAND.json`
- `docs/release/ZIRVE_FINAL_UX_HTTP_SMOKE.json`
- `docs/release/ZIRVE_FINAL_UX_PRODUCTION_REPORT.md`
- `docs/release/ZIRVE_FINAL_UX_RUNTIME_BEFORE.json`
- `docs/release/ZIRVE_FINAL_UX_RUNTIME_DEPLOYED.json`
- `docs/release/ZIRVE_FINAL_UX_RUNTIME_DRAINED.json`
- `docs/ZIRVE_UNIFIED_UX_FILTERS_REPORT.md`
- `drizzle/0027_unified_expand.sql`
- `drizzle/0028_unified_contract.sql`
- `drizzle/meta/_journal.json`
- `drizzle/meta/0027_snapshot.json`
- `drizzle/meta/0028_snapshot.json`
- `package.json`
- `scripts/drizzle-unified.config.ts`
- `scripts/eval-retrieval.ts`
- `scripts/fixtures/unified-services.ts`
- `scripts/fixtures/unified-ui.tsx`
- `scripts/migrate.ts`
- `scripts/unified-preflight.ts`
- `scripts/unified-production-state.ts`
- `scripts/unified-runtime-status.ts`
- `scripts/verify-brief-classification-migration.ts`
- `scripts/verify-classified-briefs.ts`
- `scripts/verify-explicit-search-browser.ts`
- `scripts/verify-generation.ts`
- `scripts/verify-index-edges.ts`
- `scripts/verify-lexical.ts`
- `scripts/verify-release-integration.ts`
- `scripts/verify-stage-2.ts`
- `scripts/verify-unified-ui.ts`
- `src/components/AnalyticsSourceCard.tsx`
- `src/components/BriefCard.test.tsx`
- `src/components/BriefCard.tsx`
- `src/components/BriefEditor.tsx`
- `src/components/DirectionMultiSelect.tsx`
- `src/components/FilterBar.tsx`
- `src/components/PeriodFilter.tsx`
- `src/components/ReliabilityFilters.tsx`
- `src/components/RichTextContent.test.tsx`
- `src/components/RichTextContent.tsx`
- `src/components/UnifiedFilters.test.tsx`
- `src/lib/analytics.ts`
- `src/lib/briefs.functions.ts`
- `src/lib/briefs.ts`
- `src/lib/documents.functions.ts`
- `src/lib/documents.test.ts`
- `src/lib/filter-search-state.test.ts`
- `src/lib/filter-search-state.ts`
- `src/lib/i18n/az.ts`
- `src/lib/period.test.ts`
- `src/lib/period.ts`
- `src/lib/reliability.ts`
- `src/lib/rich-text.test.ts`
- `src/routes/_app.axtaris.tsx`
- `src/routes/_app.brifler.$id.tsx`
- `src/routes/_app.index.tsx`
- `src/routes/_app.senedler.tsx`
- `src/routes/_app.senedler_.$id.tsx`
- `src/routes/_app.senedler_.yeni.tsx`
- `src/routes/api.attachments.$kind.$parentId.$attachmentId.ts`
- `src/routes/attachments.test.ts`
- `src/server/analytics/brief-branches.test.ts`
- `src/server/analytics/brief-search.test.ts`
- `src/server/analytics/context-pipeline.test.ts`
- `src/server/analytics/endpoint.test.ts`
- `src/server/analytics/filters.test.ts`
- `src/server/analytics/filters.ts`
- `src/server/analytics/history.ts`
- `src/server/analytics/rag-policy.test.ts`
- `src/server/analytics/search.ts`
- `src/server/analytics/search-evidence.test.ts`
- `src/server/analytics/source-access.test.ts`
- `src/server/analytics/source-access.ts`
- `src/server/analytics/unified-filters.test.ts`
- `src/server/briefs/classification.test.ts`
- `src/server/briefs/mutations.ts`
- `src/server/briefs/permissions.test.ts`
- `src/server/briefs/queries.test.ts`
- `src/server/briefs/queries.ts`
- `src/server/db/access.test.ts`
- `src/server/db/access.ts`
- `src/server/db/schema.ts`
- `src/server/db/unified-migration.test.ts`
- `src/server/documents/queries.ts`
- `src/server/jobs/cleanup-storage.ts`
- `src/server/search/catalogs.test.ts`
- `src/server/storage/image-metadata.ts`
- `src/server/storage/image-uploads.test.ts`
- `src/server/storage/image-uploads.ts`
- `src/server/storage/optimize-image.test.ts`
- `src/server/storage/optimize-image.ts`
- `src/styles.css`
- `src/test/analytics-layout.test.tsx`
- `src/test/brief-editor.test.tsx`
- `src/test/search-routes.test.tsx`
