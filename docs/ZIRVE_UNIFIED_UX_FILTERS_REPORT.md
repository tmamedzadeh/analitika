# ZIRVƏ V1 — Unified UX & Filters

Дата: 24 октября 2026, Asia/Baku. Этот отчёт фиксирует первоначальный локальный этап. Последующие разрешённые production-операции и финальные UX-изменения описаны в [итоговом отчёте](release/ZIRVE_FINAL_UX_PRODUCTION_REPORT.md).

## 1. Executive summary

Реализована общая система периода, компактных фильтров и точного выбора достоверности для Bülletenlər, Məlumat bazası и Analitika. Изменения охватывают React, серверные validators, SQL predicates, Drizzle schema, историю, вложения и permissions.

Бюллетени используют системное значение open в общей модели источников; отдельного поля классификации в итоговой схеме и UI нет. Классификация документов сохранена. Оригиналы изображений остаются неизменными; новые загрузки получают WebP для отображения, когда это полезно.

Подготовлены две последовательные миграции с промежуточным совместимым состоянием. На момент первоначального локального этапа production migrations, commit, push и deployment не выполнялись; актуальный статус приведён в итоговом отчёте. Gemini calls, reindex, массовая конвертация вложений и изменение сохранённых ответов/снимков citations не выполнялись.

## 2. Исходные проблемы и причины

- В списке бюллетеней сочетались all/week/month и независимый месяц; Analitika использовала другую шкалу периода. Границы рассчитывались разными функциями.
- Старые аналитические периоды вычитали 7/30/90 дней без учёта включительности; перенос этой логики в новый UI изменил бы значение истории.
- Достоверность в Analitika означала порог, а не набор точных значений. В каталоге документов таких фильтров не было.
- Новые документы получали F/6 по умолчанию; подсказки ошибочно называли оценки необязательными.
- Гриф бюллетеня участвовал в schema, mutations, access predicates, source projections, history previews и редакторе.
- Изображения сохранялись только в исходном формате. Защищённый маршрут существовал, но метаданных производных файлов и их cleanup не было.
- Отступ перед карточками складывался из margin панели и постоянных 32 px индикатора обновления.
- Подсветка использовала общий primary token, визуально смешиваясь с navy/teal интерфейсом.

До изменений прочитаны AGENTS.md, затрагиваемые routes/components, schema, миграции, access predicates, history/retrieval/storage и существующие тесты. Предшествующие пользовательские изменения в `az.ts` и `_app.axtaris.tsx` сохранены.

## 3. Изменения по разделам

### Bülletenlər

- Son ay по умолчанию, общие presets и подтверждаемый custom range.
- Удалены прежние all/week/month controls и независимый фильтр месяца.
- Поиск: `Bülletenlərdə axtarın`; кнопка Axtar стала второстепенной.
- SQL ограничивает `brief_date`; сохранены relevance/date/UUID keyset pagination и серверный размер страницы.
- Удалены классификация из входных данных, сохранения, schema и редактора, badge на detail. В retrieval/history/source access используется постоянный open.
- Xülasə ограничена четырьмя строками, 14 px, line-height 1.6; сохраняемый текст и лимит 400 символов не менялись.
- Выразительная дата слева, компактное системное название, общий кликабельный Link, keyboard focus, мягкий hover lift 2 px при разрешённой анимации.
- Фактическое расстояние от панели до карточек — 40 px: 8 px margin плюс 32 px зарезервированного query indicator.

### Məlumat bazası

- Сохранены явный поиск и İstiqamət; добавлены общий Dövr и два MultiSelect.
- Период и оценки включены в React Query key вместе с поиском/направлением. При смене фильтра новая последовательность страниц начинается с cursor=null.
- Фильтрация выполняется в SQL до limit/cursor selection.
- Новые документы требуют A–E и 1–5, начального выбранного значения нет. Reset возвращает оценки к отсутствующему выбору.
- NULL на detail обозначается как `Qiymətləndirilməyib`.
- Сохранена классификация документов, включая live clearance checks.
- Улучшен видимый focus для rating/classification radios и доступ с клавиатуры к выбору фотографий.

### Analitika

- Поиск остаётся главным элементом; пять самостоятельных колонок заменены компактной переносящейся панелью.
- Новые запросы используют filterVersion=2, Son ay и includeBriefs=true.
- OFF сохраняет только документные retrieval branches; существующие branch-selection tests проверяют отсутствие лишних brief branches.
- Достоверность и направления относятся к документной ветке; включённые бюллетени участвуют независимо от документных оценок.
- Очистка дополнительных фильтров сбрасывает оценки и направления, сохраняя вопрос и период.
- Старые записи показывают legacy period/thresholds и переключатель в сохранённом состоянии. До явного выбора нового Dövr повторный запуск блокируется с объяснением.

## 4. Общие UX components

`PeriodFilter` — select и один range-calendar на существующем react-day-picker, азербайджанская локаль, навигация по месяцу/году. Первый клик задаёт начало, второй — конец; обратный порядок упорядочивается. Один день можно подтвердить после первого клика. Даты после сегодняшней Baku-даты запрещены.

Черновой диапазон хранится внутри календаря. Только `Tətbiq et` передаёт его в состояние запроса. `Ləğv et`, Escape и закрытие popover сохраняют прежний применённый период. Выбор preset создаёт состояние без custom dates. В режиме legacy виден отдельный placeholder с исходным значением и предложением выбрать новый период.

`ReliabilityFilters` использует общий компактный checkbox MultiSelect: точные значения, несколько отметок, краткая видимая сводка, очистка, native keyboard behavior и labels. Для пяти вариантов отдельный текстовый поиск не добавлен.

`FilterBar` и `.filter-control` задают общую переносящуюся композицию и высоту 40 px, согласованные border/radius/typography. Все активные фильтры остаются видимыми; раскрывающийся advanced block не понадобился.

## 5. Dövr и серверные границы

Единственная актуальная функция расчёта — `resolvePeriod` в `src/lib/period.ts`.

| Значение       | Правило включительных дат                       |
| -------------- | ----------------------------------------------- |
| Son ay / 30d   | сегодня − 29 дней … сегодня                     |
| Son rüb / 90d  | сегодня − 89 дней … сегодня                     |
| Son il / 12m   | день после годовщины 12 месяцев назад … сегодня |
| Fərdi interval | from … to после явного подтверждения            |

Годовщина ограничивается последним существующим днём месяца. Например, для 29 февраля 2024 начало годового окна — 1 марта 2023. Для 28 февраля 2025 — 29 февраля 2024. Это полные включительные 12 месяцев без дополнительного дня на нижней границе.

Пример на 24 октября 2026 в Баку: Son ay — 25 сентября … 24 октября; Son rüb — 27 июля … 24 октября; Son il — 25 октября 2025 … 24 октября 2026.

Сервер проверяет формат и существование даты, from≤to и to≤сегодня в Asia/Baku. New request не допускает all/7d. Для preset валидные, но устаревшие custom fields не влияют на расчёт.

- Бюллетень: `brief_date >= from AND brief_date <= through`.
- Документ: `doc_date` в этом диапазоне; **только при doc_date IS NULL** используется `created_at`.
- Timestamp fallback: `[from 00:00 Asia/Baku, день после through 00:00 Asia/Baku)`. Верхняя граница исключительная для timestamp и включительная для даты; микросекунды конца дня не теряются. Intl/IANA timezone conversion учитывает также исторический летний offset Баку, а не фиксирует +04 для старых custom ranges.
- Analitika применяет этот же диапазон отдельно к документам и бюллетеням до retrieval/RRF.

Старый `minimumDocDate` оставлен для явно типизированной legacy compatibility и исторических evaluation helpers. New filterVersion=2 использует `resolvePeriod`.

## 6. MultiSelect semantics и SQL

Пример выбора A,C и 1,3:

```sql
documents.source_reliability IN ('A', 'C')
AND documents.info_credibility IN (1, 3)
```

Это точные множества, а не пороги. Пустой массив не добавляет условия. NULL не совпадает с выбранными значениями; без фильтра неоценённые документы остаются доступны с обычной авторизацией. Validators исключают F/6 и повторяющиеся значения.

Ограничения находятся внутри документной части source predicate; условия оценок не распространяются на brief branch. Тесты исполняют реальные Drizzle-generated predicates в изолированном PostgreSQL, включая набор A,C без B.

## 7. F/6, nullable данные и история

В итоговой schema обе оценки nullable, без defaults. Constraints допускают NULL либо A–E / 1–5. Миграция меняет только F→NULL и 6→NULL; существующие A–E/1–5 остаются без изменений. Автоматического повышения достоверности нет.

Read-only legacy types/labels F/6 сохранены для чтения исторических данных и периода совместимого rollout. Они отсутствуют в актуальных selectable arrays, новых validators и итоговых DB constraints.

Low-reliability policy для D/E и 4/5 не изменена. NULL остаётся отсутствием оценки; evidence metadata не превращает его в A/1. Semantic hardening prompts не редактировались.

История выбирает parser по filterVersion. Отсутствующее поле includeBriefs в старой записи получает **legacy OFF**, а не новый ON. Legacy thresholds читаются с прежним смыслом и показываются в отдельном read-only notice. Значения 7d/all также сохраняются в отображаемом контексте.

Stored filters, queries, answers и citation/context snapshots не обновляются миграцией или открытием истории. Regenerate старого запроса не отправляет его молча с изменённым периодом. Пользователь выбирает новый Dövr и при необходимости новые точные оценки; это новый запуск. Проверки существования/доступности citation sources и fail-closed history behavior сохранены.

## 8. Bülletenlər classification и security

Колонка удалена из итогового Drizzle schema. Все рабочие чтения/записи бюллетеней больше не ссылаются на неё. Общая модель AnalyticsSource получает постоянный open, включая повторную проверку source access и доступные history previews.

Сохранены:

- Authentication middleware и SQL-проверка активного пользователя.
- Live role для author/admin управления и admin-only удаления.
- Author ownership, optimistic version check и короткие transaction row locks.
- Source existence, parent/chunk identity, committed-index checks.
- Доступ к history query по автору/admin и собственному max_classification.
- RLS и запрет доступа Supabase client roles; права документов не менялись.

**Read-only preflight, 24.10.2026 07:00 Baku:** 19 бюллетеней, non-open=0; source F=0, info 6=0. Для daily_briefs/brief_attachments/chunks список pg_policies пуст. Никаких изменений БД этой проверкой не выполнялось.

Обе миграции повторяют guard `classification IS DISTINCT FROM 'open'` и останавливаются при несоответствии. Expand добавляет open-only CHECK, чтобы прежняя версия не создала закрытый бюллетень во время overlap. Contract не использует CASCADE: неожиданная внешняя зависимость должна остановить миграцию, а не удалить защиту автоматически.

Устаревшие live scripts, создававшие classified briefs, заменены безопасными entry points к read-only preflight / синтетическому browser smoke. Старые опубликованные миграции и архивные отчёты не переписывались.

## 9. Оригиналы и WebP

Используется Sharp внутри Node runtime, без внешних сервисов. Зависимость и lockfile добавлены. Native codec загружается лениво: его отсутствие не мешает чтению старых материалов; новая загрузка без возможности проверки декодирования отклоняется.

Поток новой загрузки:

1. Signed PUT в пользовательский staging key с прежними ownership/size constraints.
2. Сервер читает ограниченный поток, проверяет declared MIME, размер и сигнатуру JPEG/PNG/WebP.
3. Sharp проверяет format, dimensions, frames и реальное декодирование. Лимиты: 10 MiB, 16 млн пикселей, сторона ≤16384, один статичный кадр. Декодирование ограничено 5 секундами; обработка последовательна в batch, одновременно до двух decoder tasks на Node instance, cache выключен и concurrency=1.
4. Оригинал копируется в новый server-only committed key **без изменения байтов**. Сохраняются исходные MIME/size и метаданные width/height/SHA-256.
5. JPEG/PNG получают WebP quality 82, effort 3, максимум 1600×1600, fit=inside, без увеличения. Derivative сохраняется только при экономии более 5%. У него собственные key/MIME/size/dimensions; метаданные оригинала в derivative не копируются.
6. Уже загруженный WebP повторно не кодируется. Неудача WebP encoder после успешной проверки оригинала или отсутствие экономии даёт безопасный original fallback.
7. Только серверные метаданные попадают в DB transaction вместе с attachment. Клиент не может назначить derivative key.

Обычный `/api/attachments/{kind}/{parentId}/{attachmentId}` выбирает derivative. `?original=1` возвращает оригинал через тот же защищённый маршрут. В document preview ссылка ведёт к оригиналу; в brief gallery есть `Orijinalı aç`. Storage keys и публичные ссылки UI не выдаются. Старые вложения без metadata и отсутствующий derivative используют оригинал.

Удаление attachment/parent и rollback используют общий `attachmentKeys`: очищаются оригинал и derivative. Retained brief attachments сохраняют metadata при перестроении списка. Частичный PUT учитывается до отправки; batch failure и DB failure очищают созданные объекты. Staging очищается best effort, а существующий 24-часовой orphan sweep учитывает оба DB references и подбирает остатки после аварий/повторного staging PUT.

Справочные первичные источники: [Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/), [resize without enlargement](https://sharp.pixelplumbing.com/api-resize/). Production build с Nitro/Vercel Node 22 успешно упакован, Sharp присутствует в server artifact.

## 10. Подсветка citations/chunks

Общая `.chunk-highlight` использует мягкий золотистый #fef0bb и наследуемый читаемый цвет текста. Короткое усиление 900 ms применяется только при `prefers-reduced-motion: no-preference`; ключ по границам диапазона позволяет повторно выделить новый фрагмент при переходе.

Rich JSON, canonical projection, offsets, UUID и алгоритм точного пересечения text spans не менялись. Существующие partial highlights через bold/italic/underline, hard breaks и списки сохранены; добавлен тест пересечения нескольких абзацев и форматированных nodes. Citation validation, deep-link format и protection checks сохранены.

## 11. Desktop/mobile review

Реальный Edge с production components, synthetic services и блокировкой внешней сети проверен на 1440, 820 и 390 px. Охвачены оба каталога, Analitika, legacy history, создание/просмотр/редактирование бюллетеня и создание/просмотр документа — **27 проверок**.

Проверены отсутствие page overflow, wrapping controls, длинный заголовок, четыре строки Xülasə, empty states, отсутствие classification controls у brief, отсутствие выбранных оценок у нового документа, range cancel/confirm, MultiSelect и reduced-motion highlight. Screenshots осмотрены локально. Loading/error/cancellation/history/citation behaviors дополнительно проверяются component/server tests.

Shared layout и навигация сохранены; общий редизайн не выполнялся. Визуальные доказательства: `.release-backup.local/unified-ui/`, результаты — `results.json`. Этот каталог локальный и исключён из git.

## 12. Файлы

Полный перечень изменений приведён в конце раздела; он включает сохранённые исходные правки пользователя. Новые основные файлы: period utility/tests, PeriodFilter, ReliabilityFilters, FilterBar, image metadata/optimizer/tests, SQL integration tests, migration tests, preflight и browser harness. Физически удалённых файлов нет; устаревшие live verifiers заменены небольшими безопасными entry points.

```text
bun.lock
docs/ZIRVE_UNIFIED_UX_FILTERS_REPORT.md
drizzle/0027_unified_expand.sql
drizzle/0028_unified_contract.sql
drizzle/meta/0027_snapshot.json
drizzle/meta/0028_snapshot.json
drizzle/meta/_journal.json
package.json
scripts/drizzle-unified.config.ts
scripts/eval-retrieval.ts
scripts/fixtures/unified-services.ts
scripts/fixtures/unified-ui.tsx
scripts/migrate.ts
scripts/unified-preflight.ts
scripts/verify-brief-classification-migration.ts
scripts/verify-classified-briefs.ts
scripts/verify-explicit-search-browser.ts
scripts/verify-generation.ts
scripts/verify-index-edges.ts
scripts/verify-lexical.ts
scripts/verify-release-integration.ts
scripts/verify-stage-2.ts
scripts/verify-unified-ui.ts
src/components/AnalyticsSourceCard.tsx
src/components/BriefCard.test.tsx
src/components/BriefCard.tsx
src/components/BriefEditor.tsx
src/components/DirectionMultiSelect.tsx
src/components/FilterBar.tsx
src/components/PeriodFilter.tsx
src/components/ReliabilityFilters.tsx
src/components/RichTextContent.test.tsx
src/components/RichTextContent.tsx
src/components/UnifiedFilters.test.tsx
src/lib/analytics.ts
src/lib/briefs.functions.ts
src/lib/briefs.ts
src/lib/documents.functions.ts
src/lib/documents.test.ts
src/lib/i18n/az.ts
src/lib/period.test.ts
src/lib/period.ts
src/lib/reliability.ts
src/lib/rich-text.test.ts
src/routes/_app.axtaris.tsx
src/routes/_app.brifler.$id.tsx
src/routes/_app.index.tsx
src/routes/_app.senedler.tsx
src/routes/_app.senedler_.$id.tsx
src/routes/_app.senedler_.yeni.tsx
src/routes/api.attachments.$kind.$parentId.$attachmentId.ts
src/routes/attachments.test.ts
src/server/analytics/brief-branches.test.ts
src/server/analytics/brief-search.test.ts
src/server/analytics/context-pipeline.test.ts
src/server/analytics/endpoint.test.ts
src/server/analytics/filters.test.ts
src/server/analytics/filters.ts
src/server/analytics/history.ts
src/server/analytics/rag-policy.test.ts
src/server/analytics/search-evidence.test.ts
src/server/analytics/search.ts
src/server/analytics/source-access.test.ts
src/server/analytics/source-access.ts
src/server/analytics/unified-filters.test.ts
src/server/briefs/classification.test.ts
src/server/briefs/mutations.ts
src/server/briefs/permissions.test.ts
src/server/briefs/queries.test.ts
src/server/briefs/queries.ts
src/server/db/access.test.ts
src/server/db/access.ts
src/server/db/schema.ts
src/server/db/unified-migration.test.ts
src/server/documents/queries.ts
src/server/jobs/cleanup-storage.ts
src/server/search/catalogs.test.ts
src/server/storage/image-metadata.ts
src/server/storage/image-uploads.test.ts
src/server/storage/image-uploads.ts
src/server/storage/optimize-image.test.ts
src/server/storage/optimize-image.ts
src/styles.css
src/test/analytics-layout.test.tsx
src/test/brief-editor.test.tsx
src/test/search-routes.test.tsx
```

## 13. Миграции и безопасный rollout

`0027_unified_expand.sql`: nullable/no-default reliability, nullable image_metadata для двух attachment tables, read-only guard и open-only CHECK. Сохраняет classification column и прежние F/6 constraints на время работы старой версии.

`0028_unified_contract.sql`: повторный guard, удаление brief classification/checks, F/6→NULL и новые grade constraints. Drizzle snapshots и journal подготовлены для обоих состояний.

**Не запускать обычное применение всех миграций перед обновлением приложения.** Runner теперь поддерживает `--through` и блокирует contract без `--confirm-unified-runtime`.

Порядок после ревью и отдельного решения владельца:

1. Зафиксировать backup/restore point у оператора БД и повторить `bun run scripts/unified-preflight.ts`. При non-open>0 остановиться.
2. Применить только expand: `bun run scripts/migrate.ts --through=0027_unified_expand`.
3. Развернуть согласованную новую версию web/server и Inngest workers. Она совместима с expand и contract: колонку грифа не читает/не пишет, старый DB default open ещё существует.
4. Дождаться завершения старых requests/workers/retries, исключить возврат старой версии и обновить старые браузерные вкладки. Проверить login, author/admin mutations, document clearance, upload original/derivative и историю в preview.
5. Затем: `bun run scripts/migrate.ts --through=0028_unified_contract --confirm-unified-runtime`.
6. Проверить итоговую schema и отсутствие старых runtime references. Reindex и массовая конвертация не нужны.

До contract откат к прежней версии возможен с учётом open-only ограничения. После contract прежнюю версию запускать нельзя: её schema обращается к удалённой колонке. Предпочтителен fix-forward; восстановление БД/колонки — отдельное решение владельца, не автоматическое действие данного изменения.

## 14. Проверки

| Проверка                                                   | Результат                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Полный Vitest regression suite                             | **647/647 PASS**, 79 файлов; exit 0                               |
| Финальные targeted tests после timezone/encoder edge cases | **43/43 PASS**, включая 3 новых edge-case tests                   |
| TypeScript, основной проект                                | PASS, без diagnostics                                             |
| TypeScript, scripts / tsconfig.eval.json                   | PASS, без diagnostics                                             |
| ESLint                                                     | 0 errors; 1 прежний warning в src/components/ui/button.tsx        |
| Production build                                           | PASS, Nitro/Vercel Node 22; без deployment                        |
| Real Edge responsive smoke                                 | **27 PASS**, 1440/820/390 px, console errors отсутствуют          |
| Repository references                                      | PASS: 223 relative Markdown links, 882 local imports, failures=[] |
| git diff --check                                           | PASS                                                              |

Новые/обновлённые проверки охватывают все запрошенные группы: presets/custom/confirm-cancel; включительность Baku и исторический DST; document/brief SQL и keyset pagination; аналитические branches; точные noncontiguous IN-наборы; NULL и обязательные оценки; legacy history и OFF/ON defaults; отсутствие brief classification; active/author/admin/source/index permissions; безопасные migration guards; immutable original/WebP, encoder/no-saving fallback, validation и cleanup; highlight через paragraphs/lists/marks; четыре строки Xülasə и responsive controls.

Локальные машинные результаты: .release-backup.local/unified-verified-tests.json, unified-final-additional-tests.json, unified-ui/results.json. Full suite выполнен до добавления трёх последних edge-case tests; финальный targeted прогон выполнил эти новые тесты и затронутые SQL/UI/image checks.

Тестовая среда удаляет production credentials и запрещает unmocked fetch. SQL/migration tests используют PGlite memory://; реальные Gemini calls не выполняются. Live DB использовалась только для короткого read-only preflight.

Первый sandboxed production build остановился на Windows EPERM при readlink родительского каталога в Nitro externals tracer. Повторная локальная сборка с необходимым разрешением завершилась успешно; deployment не запускался.

## 15. Ограничения, риски и отклонения

- Используется один месяц календаря на всех размерах экрана; двухмесячный desktop вариант необязателен и не добавлялся. Навигация по году/месяцу доступна; начало списка годов — 1900.
- Отдельный поиск внутри пяти оценок и раскрывающийся advanced block не добавлялись: все controls компактны и видны.
- Legacy F/6 types/labels и прежние threshold/date helpers остаются только для совместимого чтения/исторических evaluation scripts. Актуальные UI, validators и итоговая DB schema их не выбирают.
- Ограничения 16 MP/16384 px и запрет анимации — сознательные меры против чрезмерного декодирования. Они показаны в upload notes. Старые вложения не перепроверяются/не конвертируются массово и продолжают открываться.
- При переполнении локального лимита decoder tasks загрузка отклоняется с возможностью повторить. Если native decoder недоступен, новые картинки отклоняются; неподтверждённые байты не принимаются ради fallback.
- Best-effort cleanup не гарантирует мгновенного удаления при недоступном S3; прежний 24-часовой sweep остаётся страховкой. Hard termination между S3 и DB также может оставить временный orphan до sweep.
- Browser review использует реальные компоненты и синтетические службы. Production migration, live S3 upload/delete и Linux Vercel runtime не испытывались этим изменением. Их проверка должна пройти на согласованном preview после expand. Нужно подтвердить установку native Sharp Linux dependency, память и лимит времени server functions для batch uploads; локальная сборка не заменяет этот шаг.
- Сохранённые ответы не пересчитывались. Их прежние protections могут по-прежнему скрыть ответ при недоступной citation/context source — это сохранённая защита.
- Один существующий ESLint warning в shared button Fast Refresh не относится к изменению; ошибок lint быть не должно.

Других намеренных отступлений от требований нет. Prompts, Gemini models, deadline 105 секунд, RRF/rerank, evidence selection до 20 chunks, embedding dimensions/model, Rich JSON storage и SSE progress не менялись.

## 16. Что требуется от владельца

Проверить локальный diff, UI screenshots и этот отчёт; подтвердить staged rollout, backup/restore point и доступность Sharp в preview. Проверить отдельно права реальных author/admin accounts и закрытый документ с original/derivative. После этого отдельно разрешить commit/push/deployment и последующее применение contract после вывода старых runtime из обращения.

На момент завершения работы таких действий не выполнялось. Рабочая копия оставлена для ревью; опубликованная git history не переписывалась.
