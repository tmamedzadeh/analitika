# ZIRVƏ V1 — аудит и план A–D для согласования

Дата: 24 октября 2026, Asia/Baku. Ниже сохранён исходный аудит и предложенный план. План A–D утверждён пользователем и реализован локально; позднейшее разрешение также охватывает additive-миграции основной БД разработки. Прежнее ограничение этого документа «только изолированная БД» заменено этим прямым разрешением. Результат и фактически применённая `0029` описаны в [итоговом отчёте](release/ZIRVE_V1_RELIABILITY_UX_GALLERY_REPORT.md).

## 1. Проверенная исходная точка

- Локальная ветка: `main`.
- Локальный HEAD и локальная ссылка `origin/main`: `b34ae5ac35377b89ac22d1e116be11d9c5d4c90b`.
- `git ls-remote --heads origin main` независимо подтвердил тот же актуальный SHA на GitHub.
- Рабочее дерево перед аудитом чистое, untracked-файлов нет. После аудита добавлен только этот план.
- Прочитаны `AGENTS.md`, `docs/ZIRVE_IMAGE_UPLOAD_DIAGNOSIS_AND_ASYNC_PLAN.md`, `docs/release/ZIRVE_IMAGE_UPLOAD_DIAGNOSTICS.json`, относящиеся к задаче routes, storage, schema, migrations, indexing и UI.
- История Git не переписывается. Commit, push, deployment, production migrations и изменения production documents/S3 objects не выполнялись. Новые зависимости не устанавливались. Gemini не вызывался.

Прежний диагноз содержит предложение новых Inngest photo functions. Оно **не применяется** к этой реализации: текущее требование пользователя предусматривает обычный Node.js API для всей обработки фотографий. Историческая причина `fetch error` остаётся неизвестной; Sharp виновником не объявляется.

## 2. Краткий аудит и подтверждённые проблемы

| Область            | Фактическое состояние кода                                                                                                         | Следствие                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Создание документа | `prepareDocumentUploads` генерирует новый UUID; браузер последовательно загружает файлы; `saveDocument` проверяет всю пачку до SQL | Фото блокируют сохранение текста и запуск индексации                                          |
| Идемпотентность    | Новое нажатие создаёт новый documentId; повтор старого save повторно читает уже удалённый staging                                  | Возможен дубликат после потерянного ответа; безопасного replay нет                            |
| COMMIT ambiguity   | Catch SQL transaction безусловно удаляет созданные committed objects                                                               | При потерянном подтверждении COMMIT можно удалить уже связанные оригиналы                     |
| Staging cleanup    | DELETE ожидается в `commitImageUploads.finally` и повторно после SQL в `saveDocument`                                              | Два необязательных ожидания, в том числе после успешного сохранения                           |
| Сетевые границы    | В `S3Storage` нет явных operation signals/deadlines; чтение потока ограничено bytes, но не временем                                | GET/PUT/DELETE и `reader.read()` могут удерживать HTTP-запрос                                 |
| Ошибки             | Все ошибки commit превращаются в metadata mismatch; внешний catch формы показывает `error.message`                                 | Смешаны validation, Storage, Sharp, timeout и транспорт; возможны сырые сообщения             |
| Upload UX          | Все URL выдаются заранее на 300 секунд; нет refresh, реального прогресса, отмены и recovery                                        | Поздние файлы могут начинать PUT с истёкшей подписью; частичный успех не виден                |
| Optional WebP      | Ошибка кодирования допускает оригинал; ошибка PUT derivative сейчас прерывает весь commit                                          | Необязательная копия может сорвать сохранение валидного оригинала                             |
| Статусы            | Polling документа останавливается на ready текста; persistent photo statuses отсутствуют                                           | Для независимой загрузки этого недостаточно                                                   |
| Cleanup            | Существующий cron защищает ссылки из attachments и brief_attachments, возраст кандидатов ≥24 ч                                     | После добавления sessions потребуются их защита и синхронизация cleanup/finalize              |
| Чтение фото        | Authenticated endpoint буферизует до 10 MiB внутри SQL transaction с `FOR SHARE`                                                   | Долгий S3 read удерживает connection/locks; крупный buffered response проблематичен на Vercel |
| Vercel             | В исходниках duration задан только для analytics и Inngest                                                                         | Нужна базовая настройка `__server` и проверка результата сборки                               |
| Фильтры            | Общие period defaults — `30d`; новый schema не допускает `all`; legacy analytics допускает `all` отдельно                          | Нельзя просто поменять общий default или переиспользовать legacy-ветку для новых запросов     |
| Пароли             | Login уже использует Eye/EyeOff; в Ayarlar семь password inputs без переключателей                                                 | Можно переиспользовать небольшой общий PasswordInput                                          |
| Галерея            | Документ открывает original новой вкладкой; бюллетень использует простой Radix Dialog                                              | Нет единого keyboard/swipe/zoom/loading UX                                                    |

Безопасные механизмы для сохранения: private S3-compatible abstraction, immutable server-only copies проверенных bytes, MIME/signature/size/dimensions/animation validation, оригинал с SHA-256, optional WebP, live SQL ACL, authenticated attachment URLs, private/no-store headers, server pagination и существующий recovery текстовых индексов.

Локальный старый `.vercel/output` не является свидетельством production: сейчас он показывает Node 22, analytics maxDuration 120, Inngest 300 и отсутствие maxDuration у `__server`; исходники задают analytics 300. Это также отличается от снимка предыдущего отчёта. Нужен новый build artifact, а затем отдельно разрешённая проверка deployed transport.

## 3. Последовательность и границы этапов

Порядок после утверждения: **A1 → additive schema / A2 → B → C → D**. Каждый этап получает отдельный diff и отчёт проверок; завершённые этапы не смешиваются с unrelated refactoring. A1 можно проверить без миграции. A2 и B используют общую additive модель; переход на новый upload flow остаётся выключенным до готовности B и reference-aware cleanup.

### A. Надёжность Storage и безопасность сохранения

1. Расширить StorageProvider опциональными operation context / AbortSignal, не привязывая интерфейс к AWS или Supabase.
2. Ограничить SDK send, retries и чтение body единым бюджетом; добавить idle timeout потока, byte cap и отмену reader/socket при abort. Ограничить также HEAD, prefix read и LIST для cleanup.
3. Стартовые бюджеты для проверки: connection 3 с, stream idle 5 с, GET/PUT не более 15 с на попытку в пределах общего бюджета, DELETE 2 с, finalize одного файла до 45 с. Это проектные значения, подлежащие проверке на синтетических данных, а не измеренный production SLO. Browser PUT имеет отдельный более длинный transfer budget и idle timeout; медленную сеть нельзя ограничивать серверным временем Sharp.
4. Задать Nitro `vercel.functions.maxDuration` для catch-all, ориентир 60 с; существующие analytics/Inngest overrides сохранить. Проверить сгенерированный `__server.func/.vc-config.json`, маршрутизацию server functions и отдельного photo API. Application budget должен оставлять время на контролируемый ответ.
5. Удалить оба ожидания staging DELETE из успешного document save. Staging передать существующему reference-aware sweeper; не запускать Promise после return. Это увеличивает private staging retention до следующего безопасного sweep, обычно 24–48 ч для уже eligible объектов.
6. Ошибки и неизвестный исход COMMIT не компенсировать немедленным удалением оригиналов. Повторно читать receipt/document по creation key; при недоступной БД сохранять объекты и возвращать outcome unknown. Повторная проверка и sweeper решают судьбу объектов позднее.
7. После согласованного expand внедрить durable creation receipt: UNIQUE actor/key, canonical payload fingerprint, стабильный documentId, state и защита конкурентной обработки. Same key/same payload возвращает тот же результат; different payload даёт conflict; deleted tombstone запрещает воссоздание удалённого документа replay-запросом. Replay повторно проверяет live access.
8. До нового I/O проверять уже сохранённый результат. Published original никогда не перезаписывается; candidate keys привязаны к попытке и выделяются сервером. Проигравшая попытка оставляет только приватный orphan.
9. Не менять текущие validation limits: 10 файлов × 10 MiB, JPEG/PNG/WebP, 16 MP, сторона 16384, channels ≤4, запрет animation/multipage. Оригинальные bytes сохраняются без перекодирования. Ошибка optional WebP generation/PUT после успешной проверки не теряет оригинал; неудавшаяся metadata не публикуется.
10. Сохранить Sharp native timeouts и лимиты concurrency. Проверить весь lifecycle import/metadata/decode/encode: Promise.race сам по себе не прекращает native работу. Если текущий API не обеспечивает требуемую отмену, для жёсткого wall deadline использовать локальный request-scoped subprocess Sharp с bounded stdin/stdout и kill-and-await-exit. Это обычная операция того же Node API, без отдельного сервиса, очереди и сохранения чувствительных временных файлов. Такой helper допускается только после проверки bundling/runtime и измерения overhead; незавершённая native работа не должна «прятаться» за успешным HTTP-ответом.
11. Ввести безопасные error codes: transport, storage unavailable, URL expired, validation reason, processor busy/failure, timeout scope, creation conflict, save outcome unknown. UI показывает азербайджанское сообщение и opaque request ID. Диагностика: stage, elapsedMs, размеры, формат, attempts, timeout scope и sanitized provider status/code. Не писать текст, filenames, bytes, cookies, storage keys и signed URLs.
12. Общий image helper используется бюллетенями: его изменения обязательно проверить на brief create/edit, сохранении retained photos и неизвестном исходе transaction; существующие права редактирования не менять.

### B. Text-first save и независимые фотографии

1. Браузер создаёт creation key один раз на логическое сохранение. В persistent client storage допустим только минимальный opaque recovery pointer (creation key/documentId, привязанный к пользователю); текст, файлы, filenames, storage keys и подписи туда не помещаются. При logout pointer очищается. Дедупликация обеспечивается БД, а не блокировкой кнопки/BroadcastChannel.
2. Короткая SQL transaction сохраняет receipt, text projection, Rich JSON, metadata и manifest из стабильных attachment slots. Ошибочный photo manifest не должен терять текст: photo validation обрабатывается отдельно, с явным сообщением об отклонённых файлах.
3. Текстовый документ получает существующее `queued` состояние. После COMMIT — ограниченная реальным abort попытка отправить существующее `document/indexing.requested`; ошибка доставки оставляет сохранённый документ в durable queued. Не менять worker, event payload, embeddings и lease/recovery алгоритм. Установленный SDK send не принимает AbortSignal напрямую и делает до пяти попыток: нужен request-scoped publisher с abort-aware fetch и общим бюджетом, учитывающим также SDK backoff; глобальный worker client не менять. Проверить завершение всех попыток до ответа, не использовать detached send. При недоступном event API используется уже существующий recovery, поэтому немедленное начало indexing в аварийном случае не обещается. Новая text outbox и новый dispatcher в базовый план не входят.
4. После подтверждения текста форма доступна независимо от фото. File objects остаются только в памяти; upload controller живёт над route form, чтобы переход на сохранённый документ не терял активную передачу в открытой SPA.
5. Обычный authenticated Node API выдаёт URL по opaque slot ID непосредственно перед PUT. Signed upload URL необходим самому браузеру для direct upload; он не попадает в document DTO, gallery, persistent storage или логи. Клиент не задаёт storage key самостоятельно.
6. XMLHttpRequest upload progress показывает только реально переданные bytes при `lengthComputable`. После 100% передачи — отдельное `Yoxlanılır`, без фиктивного процента Sharp. Начальный лимит: до двух передач и одна finalize-операция на клиент; серверный concurrency limit остаётся обязательным.
7. `complete/finalize` обрабатывает один файл: claim generation/lease → bounded GET → signature/size/MIME/Sharp → PUT неизменённого original и optional WebP → короткая SQL finalization с live ACL и fencing. Не держать SQL lock во время S3/Sharp. Опубликованное attachment использует стабильный ID slot.
8. Статусы БД и CAS управляют retry, expiry, cancellation, двумя вкладками и stale requests. Повтор ready-finalize возвращает существующее вложение. Замена bytes создаёт новую generation/staging key, а не перезаписывает published original. Expired URL обновляется после live ACL без нового документа/slot.
9. После reload обычный GET восстанавливает slots; отдельный bounded POST reconcile проверяет ранее переданный staging и при возможности завершает обработку. Если bytes не были переданы, пользователь выбирает файл повторно. Автоматической передачи/обработки после закрытия браузера не обещается; сохранённый текст остаётся доступным.
10. Cancel сначала меняет generation/state; публикация stale результата отклоняется. Close/abort HTTP не считается rollback SQL или доказательством отсутствия S3 object. Частичный успех сохраняется пофайлово; отклонение всех изображений не затрагивает текст и indexing.
11. Два независимых блока в карточке/деталях: `Mətnin indekslənməsi` — `Növbədə`, `Emal olunur`, `Hazırdır`, `Xəta`; `Şəkillər` — `Yüklənir`, `Yoxlanılır`, `Hazırdır`, `Xəta`, `Yenidən cəhd et`. Для отсутствующих после reload bytes — понятный reselect. Polling учитывает pending photos даже после ready текста. Photo updates не меняют documents.updatedAt/progress/lease текстового индексатора.
12. Не добавлять Inngest jobs/functions/events для фотографий. Существующий orphan cleanup только удаляет подтверждённые orphan; он не становится обработчиком изображений. Не вводить Storage webhooks, hosting lifetime APIs или Supabase-specific API.

### C. Фильтры и PasswordInput

- Вынести context-specific defaults/options: библиотека и бюллетени — `all` по умолчанию, только `Bütün dövr`/`Xüsusi dövr`; аналитика — прежний `30d` default и `30d`/`90d`/`12m`/`custom`/`all`, label `Hamısı`.
- `all` разрешается как отсутствие date predicate, без искусственных крайних дат. Сохранить ACL, лимиты выдачи, cursor pagination, сортировку и query cancellation. Existing legacy analytics `all` сохраняет прежнюю семантику, включая историческую верхнюю границу; новые фильтры полного архива не должны попадать в legacy-ветку.
- Существующие явно заданные `30d`/`90d`/`12m` ссылки библиотек продолжать читать и применять в прежнем смысле. В UI показывать контекстный compatibility label, а не молча менять их на весь архив. В новых списках эти presets не предлагаются. FilterVersion и сохранённые snapshots не переписывать.
- Обновить все callers resolvePeriod для отсутствующего диапазона: documents, briefs, analytics document/brief branches, URL parser и history parser. Сохранить Baku midnight, historic DST и текущий календарь с apply/cancel. `Fərdi dövr` заменить также в accessible labels.
- Бюллетени desktop: `[поле поиска] [Axtar] [Bütün dövr]`; на mobile — контролируемый wrap с достаточно широким input. Custom calendar не создаёт постоянно выделенную строку фильтра.
- Общий PasswordInput на базе login: независимо скрытые поля, Eye/EyeOff, type=button, aria-pressed, `Şifrəni göstər`/`Şifrəni gizlət`, keyboard support. Сохранить controlled/uncontrolled inputs, FormData names, autocomplete, min/maxLength, required и disabled. Не вкладывать интерактивную кнопку в неоднозначный label wrapper: использовать явные id/htmlFor. Покрыть 3 собственных поля, 2 create-user и 2 admin-reset; login можно перевести на тот же компонент без изменения auth.

### D. Единая PhotoGallery

- Переиспользовать установленный Radix Dialog: focus trap, Escape, scroll lock и явный возврат фокуса к нажатой thumbnail. Отдельная gallery composition не должна менять оформление прочих dialogs.
- Тёмный полупрозрачный backdrop, крупная область `object-contain`, safe-area/динамическая высота viewport, сдержанная анимация и prefers-reduced-motion. Миниатюры используют существующий display WebP и аккуратную grid.
- Состояние: выбранный attachment ID/index, loading/error, zoom и pan только в памяти. ArrowLeft/ArrowRight и две стрелки только для нескольких фото; X/Escape; счётчик; swipe при обычном масштабе. На увеличении жесты управляют pan, а не случайным переходом к соседнему фото.
- Zoom toggle/reset, double tap и pinch через Pointer Events; ограничить scale/pan, сбрасывать на смене фото/close. Сохранить клавиатурную альтернативу. Сложный inertia/gesture framework не требуется.
- Loading/error/retry, корректная смена index при удалённом изображении/изменении списка; при исчезновении parent/403/404 очищать доступное UI-состояние. Не предзагружать весь набор оригиналов.
- `Orijinalı yüklə` — отдельное действие с тем же authenticated endpoint. Default thumbnail click открывает gallery без изменения URL и вкладки. Оригинальные bytes не изменяются.
- Для файлов больше безопасного buffered response budget предусмотреть authenticated bounded Range reads, ориентир 1 MiB на ответ, и сборку выбранного изображения/скачивания в memory Blob. Для этого добавить опциональный range в StorageProvider и public DTO размеров display/original без keys. Проверять одиночный диапазон, 206/Content-Range/416, byte cap, abort и live ACL на каждом запросе. Это позволяет новой gallery не зависеть от полной buffered выдачи 10 MiB и не выдавать signed GET.
- Сохранить путь `/api/attachments/...`, `?original=1`, private/no-store, CORP и nosniff. Старые full GET должны сохранить корректное поведение для малых файлов; для крупных отдельно проверить фактический streaming Nitro/Vercel. Не объявлять большой direct GET исправленным только по локальному тесту.
- Не удерживать длительный DB lock ради сети: короткие live access checks, повторная проверка после ожидания S3 и перед отдачей bytes; bounded ranges повторно проверяют доступ. Уже полученные пользователем bytes отозвать невозможно, но новые запросы после revocation/deletion должны fail closed.
- Abort загрузок и revoke Blob URLs на close/unmount/смене прав; никакого gallery localStorage, IndexedDB, Service Worker cache или public CDN.

## 4. Additive migration plan для A2/B

Предлагается **одна expand-миграция** после согласования, условное имя `drizzle/0029_document_image_reliability_expand.sql`; окончательный номер повторно сверяется с актуальным HEAD. Сейчас SQL-файл и journal не создавались и миграции не запускались.

| Новая таблица            | Назначение и минимальные инварианты                                                                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document_creations`     | actor_id + creation_key UNIQUE, стабильный document_id UNIQUE, canonical payload hash, state/result, lease для legacy path, timestamps. document_id допускает reservation до insert документа и deleted tombstone после удаления; доступ к receipt всегда через live parent/actor policy. Payload text не дублируется  |
| `document_image_uploads` | Стабильный attachment/slot ID, document FK, client_file_id, ordinal, declared mime/size, current generation, state, error code, signed_until/expires_at, lease token/until. UNIQUE document/client_file_id и document/ordinal. До 10 slots вместе с существующими attachments — под parent lock в короткой transaction |
| `image_upload_objects`   | Серверные staging/candidate keys, upload ID/generation, object kind, protection deadline и cleanup claim state. Ключ выделяется в БД до PUT; claim/finalization используют общий fencing, чтобы cleanup не удалял публикуемый объект. Сохранить сведения о candidates после parent deletion до безопасного cleanup     |

Проверки совместимости и rollout:

1. Только новые таблицы/indexes/checks/RLS/grants; не менять данные существующих documents, attachments, chunks и analytics history. Старые фотографии с отсутствующим session и nullable image_metadata остаются verified/readable.
2. Следовать действующему запрету прямого client-доступа к server tables; неизвестные пользователи/роли fail closed. Никаких public policies ради uploads.
3. Подготовить preflight schema/journal check и проверки старого/нового runtime на изолированном PostgreSQL. PGlite использовать там, где он поддерживает нужные конструкции; реальные COMMIT/lock/concurrency сценарии требуют disposable PostgreSQL.
4. До включения producer B обновить cleanup: ссылки original/derivative из обеих attachment tables + незавершённые upload sessions + protected candidates. Перед DELETE атомарно claim-ить объект; finalization не может сослаться на delete-claimed key. Проверка ссылок с последующим несвязанным DELETE недостаточна.
5. Pending session защищается до согласованного срока retry, стартовый вариант 7 суток, не только до signed URL TTL. Active lease защищается до завершения/expiry. Eligibility затем требует отсутствия действующих ссылок и безопасного возраста. Creation receipts/tombstones автоматически по TTL не удаляются: иначе поздний replay сможет создать дубликат.
6. Expand не включает backfill старых attachments или переписывание S3 объектов. Не вводить contract/drop в эту поставку. Feature gate для нового flow — server-side конфигурация с безопасным default; допустим on-premise без hosting API.

Rollback / recovery:

- Отключить новые creation/upload операции feature gate, сохранить чтение уже созданных документов и управление существующими sessions. Дождаться bounded запросов/истечения leases. Не включать старый небезопасный cleanup.
- Откатывать UI/producer только к совместимой версии A с session-aware cleanup и чтением обоих форматов; rollback на произвольный старый binary небезопасен.
- Additive tables и receipts оставить; не выполнять DROP/массовые DELETE. Pending uploads могут потребовать повторного выбора файла, текст сохраняется.
- При неизвестном COMMIT читать durable receipt/current generation повторно; при недоступной БД не удалять потенциально связанные objects. Опубликованный original не заменяется результатом stale attempt.
- Любые production preflight, backup, migration, rollout или rollback выполняются только по отдельному прямому разрешению пользователя.

## 5. Предполагаемые файлы

Имена новых модулей ниже проектные; существующие бизнес-границы сохраняются.

| Этап        | Основные существующие файлы                                                                                                                                                                                                                                                                       | Предполагаемые новые файлы                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A           | `src/server/storage/{types,s3,image-uploads,optimize-image,orphans,delete-objects}.ts`, `src/lib/documents.functions.ts`, `src/server/briefs/mutations.ts`, `src/server/jobs/cleanup-storage.ts`, `vite.config.ts`                                                                                | storage deadlines/errors/diagnostics helpers; creation receipt service; при необходимости request-scoped Sharp helper; focused fault tests                                                                           |
| A2/B schema | `src/server/db/schema.ts`, `drizzle/meta/_journal.json`                                                                                                                                                                                                                                           | `drizzle/0029_document_image_reliability_expand.sql`, matching snapshot, isolated migration compatibility tests                                                                                                      |
| B           | `src/lib/documents.functions.ts`, `src/routes/_app.senedler_.yeni.tsx`, `src/routes/_app.senedler_.$id.tsx`, `src/routes/_app.senedler.tsx`, `src/server/documents/queries.ts`, `src/lib/i18n/az.ts`, при необходимости app provider                                                              | `src/server/documents/creations.ts`, `src/server/storage/document-image-sessions.ts`, обычный Node upload route/server-function facade, `src/lib/image-upload-client.ts`, upload controller/status component и tests |
| C           | `src/lib/{period,filter-search-state,analytics,briefs.functions}.ts`, `src/components/PeriodFilter.tsx`, `src/server/{analytics/filters,analytics/search,documents/queries,briefs/queries}.ts`, `src/routes/{_app.index,_app.senedler,_app.axtaris,_app.ayarlar,login}.tsx`, `src/lib/i18n/az.ts` | `src/components/PasswordInput.tsx` и component/URL/history/backend tests                                                                                                                                             |
| D           | `src/routes/_app.senedler_.$id.tsx`, `src/routes/_app.brifler.$id.tsx`, `src/routes/api.attachments.$kind.$parentId.$attachmentId.ts`, document/brief DTO, storage range types/S3 implementation, локальные gallery styles                                                                        | `src/components/PhotoGallery.tsx`, thumbnail grid / private-image loader по необходимости, component/browser/attachment range tests                                                                                  |
| E           | Соответствующие существующие тесты; диагностика без production credentials                                                                                                                                                                                                                        | Поэтапные отчёты и итоговый `docs/release/ZIRVE_V1_RELIABILITY_UX_GALLERY_REPORT.md`                                                                                                                                 |

Новые зависимости: **не предполагаются**. Достаточны существующие Radix, lucide-react, React, Sharp, AWS SDK, Drizzle, Vitest, Testing Library и Playwright. Установка любого нового пакета потребует отдельного согласования. SDK transport options передаются через уже установленный S3Client, без добавления прямого Smithy dependency.

## 6. Проверки и критерии сдачи

Для каждого этапа: адресные unit/integration/component tests, `tsc --noEmit`, ESLint, production build и UI scenarios; после завершения — полный доступный regression suite. Сетевые и storage failures только через synthetic transports/fixtures. Не запускать существующие live release/eval scripts без отдельной проверки их side effects и отдельного разрешения на внешние ресурсы.

| Этап | Обязательные проверки                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Hung GET/PUT/DELETE/stream, idle/whole deadline, реальная abort propagation, retry budget, maxDuration artifact, sanitized diagnostics; lost COMMIT ACK/HTTP response; same/different payload replay; concurrent create; derivative encode/PUT failure; оригинальные bytes/hash неизменны; brief retained photos не повреждаются                                                                                                 |
| B    | 0/1/10 фото, включая 10 MiB; text save без S3 и при отказе всех фото; existing indexing event запускается независимо; Inngest unavailable без потери текста; queue recovery unchanged; double submit/две вкладки; URL expiry/refresh; reload до/после PUT/finalize; missing File reselect; partial success/cancel; expired lease/stale generation; delete/revoke/cleanup races; синтетические PostgreSQL COMMIT/lock/pool faults |
| C    | Отсутствие date predicate для новых all; отсутствие изменения legacy history; старые preset URLs; Baku midnight/DST/leap day; refresh/Back/Forward; page cursor reset и pagination; desktop/mobile строка поиска; все password inputs независимо toggle, keyboard, неизменное value/FormData/validation                                                                                                                          |
| D    | Документ 1/10, бюллетень 1/несколько; выбранный index, arrows/Escape/swipe; zoom/pinch/reset/pan; loading/error/retry; focus return/scroll lock; reopen; image/parent deletion; revoked active/clearance/role; direct unauthenticated access; no raw storage URL; большие оригиналы и byte equality через bounded ranges; abort/revoke Blob URLs                                                                                 |

Browser acceptance после реализации выполняется на локальном synthetic harness с mocked API/Storage и без настоящего Gemini. Реальное S3/CORS/private bucket и Vercel delivery >4.5 MB требуют отдельно разрешённого изолированного preview/synthetic environment; локальные тесты не подменяют такой результат.

Базовая проверка **до изменений**:

- 12 файлов / 79 тестов PASS, 61.60 с: image uploads, image optimizer, orphan detection, documents validation, document indexing, Inngest registration, authenticated attachments, search routes, periods, URL filter state, filter components и analytics schema.
- `bun --no-env-file x tsc --noEmit`: PASS.
- `bun --no-env-file x eslint .`: FAIL на существующем `src/routes/_app.senedler.tsx:156` (лишняя пустая строка, prettier); существующее warning `src/components/ui/button.tsx:48` (react-refresh export). Автоисправления не выполнялись.
- `bun --no-env-file run scripts/check-references.ts`: PASS, 463 файла, 240 relative Markdown links, 899 local imports, failures нет.
- Production build, новые fault scenarios и browser acceptance ещё не запускались: реализации нет. Результаты прежней диагностики не объявляются результатами нового кода.

## 7. Риски и решение для согласования

- Самый высокий риск — потеря фотографий из-за COMMIT ambiguity и гонки cleanup/finalize; необходимые меры — receipts, immutable candidates, reference checks и fencing. Перенос текста перед фото без них недостаточен.
- Expired signed PUT остаётся bearer capability до expiry; приложение запрещает publication и новые URL после revocation. URL не даёт права записи published original. Проверку provider/CORS нельзя вывести только из source code.
- Additive DDL требует отдельной проверки ролей, применённых migrations, lock budget и резервного восстановления перед production; эти действия сейчас не выполняются.
- Нельзя глобально заменить defaultPeriod: это изменит аналитику и старые ссылки. Контекстные defaults и отдельная legacy branch обязательны.
- Новая session retention увеличит временный private storage. Срок 7 суток — предлагаемая retry policy, подлежащая утверждению вместе с планом.
- Sharp timeout не учитывает ожидание libuv thread; hard native cancellation требует проверки и, если нужно, request-scoped process isolation. Это техническая граница, не диагноз исторического сбоя.
- Крупные оригиналы: Vercel документирует 4.5 MB для buffered function payload. Новая gallery использует bounded authenticated responses; legacy full GET/streaming проверяется отдельно на разрешённом deployment. Нельзя заменить его долгоживущим signed GET и считать live ACL сохранённым.
- Existing indexing recovery не означает мгновенную доставку при недоступном Inngest. Сохраняются существующие retry/stale сроки; если потребуется более строгий delivery SLO, text outbox обсуждается отдельным изменением.

Требуется утвердить этот план, подготовку additive expand и её проверки **только в изолированной локальной тестовой БД**, затем реализацию A → B → C → D. Такое утверждение не разрешает commit, push, deployment, production migration, новые зависимости или платные Gemini-вызовы.

Официальные технические источники, проверенные при подготовке:

- [Vercel function limits](https://vercel.com/docs/functions/limitations): buffered request/response limit и связь duration с фактической функцией.
- [Vercel: body size and streaming](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions): различие buffered delivery и streaming; адаптер проекта требует собственной проверки.
- [Sharp timeout](https://sharp.pixelplumbing.com/api-output/#timeout): таймер не включает ожидание свободного libuv thread.
- [AWS presigned URL semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html): повторное использование до expiry и замена объекта при PUT на тот же key. S3-compatible provider необходимо проверять отдельно.
