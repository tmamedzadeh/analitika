# ZIRVƏ V1 — отчёт B: независимое сохранение текста и фото

## Реализованная последовательность

1. Форма получает стабильный creation key и client file IDs; повтор отправляет тот же manifest.
2. Короткая PostgreSQL-транзакция сохраняет текст, Rich JSON, метаданные, document ID, receipt и slots. S3 и Sharp в этой транзакции не вызываются.
3. После COMMIT отправляется существующее событие `document/indexing.requested`. Публикация ограничена по времени и завершается внутри запроса; текст остаётся сохранённым при недоступности Inngest.
4. Пользователь получает документ и может работать с ним. React provider продолжает передачу фото при SPA-навигации.
5. Первичная браузерная очередь передаёт по два файла параллельно через XHR и временные private Storage PUT URLs. Прогресс отображается только из реальных byte events.
6. Обычная Node.js server function последовательно финализирует файлы: bounded GET, проверка, Sharp, immutable PUT оригинала, optional WebP, короткая публикация attachment в SQL.

Новых Inngest functions/jobs для фотографий нет. Существующие text workers, embeddings и recovery не изменены. Подтверждение текста не зависит от результата фото; отклонение всех фото сохраняет документ. Отказ publisher возвращает `queueFailed`; существующая очередь/retry/recovery остаются источником последующего запуска, мгновенная доставка при недоступном Inngest не обещается.

## Идемпотентность и состояния

- Уникальная пара actor/creationKey и canonical SHA-256 payload предотвращают дубликат после lost HTTP ACK. Другой payload с тем же ключом отклоняется. Actor lock сериализует конкурирующие создания и проверку квот.
- Receipt хранится отдельно от parent FK: удалённый документ не появляется заново при replay. При delete новый путь отмечает receipt как deleted; отсутствие parent также блокирует replay.
- Slot стабилен; attachment ID равен slot ID. Новые signed URLs используют новую generation и staging key. Expiry подписи — 300 с, максимум 20 generations; повтор готового finalize возвращает ready без записи/перекодирования.
- Prepare/cancel передают ожидаемую generation; устаревшее действие второй вкладки получает conflict. Lease защищает активный finalize, проверяются live active/clearance/management права.
- После неизвестного COMMIT recovery читает БД. Даже при недоступном recovery оригиналы не удаляются; повтор позже обнаруживает ready.
- Cancel прекращает браузерную передачу и инвалидирует generation/lease. При гонке с уже завершившимся COMMIT серверное ready имеет приоритет: сохранённый оригинал не удаляется.
- Ошибочный файл можно заново выбрать в том же slot, включая другое допустимое имя/MIME/размер; квота пересчитывается, generation меняется. Для ready replacement не выполняется.
- Состояния сохраняются в PostgreSQL; просроченные signatures/leases корректно отображаются и допускают retry. Перезагрузка страницы восстанавливает slots и пробует завершить уже переданный файл. Если bytes отсутствуют, требуется повторный выбор файла. Закрытие браузера не продолжает PUT.

В localStorage сохраняется только непрозрачный actor-scoped creation recovery pointer; текст, Rich JSON, файлы, имена, keys и URLs туда не пишутся. Logout очищает pointers. Файлы находятся в памяти provider и очищаются при отмене/готовности/unmount.

## Отображение

Карточка/детали разделяют `Mətnin indekslənməsi` (Növbədə / Emal olunur / Hazırdır / Xəta) и `Şəkillər`. У каждого файла показаны Yüklənir / Yoxlanılır / Hazırdır / Xəta, retry, выбор файла и отмена. Проценты не имитируются. Переход ready инвалидирует карточку/детали, включая публикацию из другой вкладки; обновление фото не меняет версию текста и не перезапускает индексацию.

## Конфигурация и переносимость

| Переменная                       | По умолчанию | Допустимое значение       |
| -------------------------------- | ------------ | ------------------------- |
| `DOCUMENT_IMAGE_UPLOADS_ENABLED` | false        | true / false              |
| `IMAGE_UPLOAD_RETENTION_HOURS`   | 168          | 1–720 часов               |
| `IMAGE_UPLOAD_MAX_PENDING_FILES` | 100          | 10–1000 на uploader       |
| `IMAGE_UPLOAD_MAX_PENDING_BYTES` | 524288000    | 10 MiB–10 GiB на uploader |

Квоты ограничивают логические незавершённые slots. При превышении текст сохраняется, slots получают quota error; retry возможен после освобождения квоты. В ready/cancelled/expired квота освобождается; объекты удаляются безопасным sweep с прежним минимальным orphan-age. Защитное окно session ограничивает удаление незавершённых объектов. Ограничение generations ограничивает накопление повторных staging на slot; это не общий лимит размера всего bucket.

В локальный `.env.local` добавлен только несекретный producer flag `DOCUMENT_IMAGE_UPLOADS_ENABLED=true` после применения схемы. Остальные настройки/секреты не переписывались. `StorageProvider` сохранён: никаких Supabase-specific API, публичного bucket или Vercel-only механизма обработки фото. Node.js/Sharp/PostgreSQL/S3-compatible схема переносима на Docker/MinIO.

## Rollback и recovery

Безопасный rollback — отключить producer flag, сохранив `0029`. Новые создания идут прежним путём; чтение/финализация существующих slots продолжают работать при наличии схемы. Порядок расширения: применить additive schema, проверить её, затем включить producer. Удалять новые таблицы для rollback нельзя: receipts и незавершённые sessions содержат recovery-состояние.

При зависшем checking дождаться истечения lease и повторить finalize; при истёкшей подписи запросить новый prepare. При неизвестном сохранении восстанавливать по прежнему creationKey, не генерировать новый документ до определения результата. При недоступной БД/Storage сохранять объекты до восстановления и reference-aware cleanup.

## Проверки B

Реальный изолированный PostgreSQL: одновременный same-key create, конфликт payload, lost HTTP ACK, фактический COMMIT с потерянным ACK, потеря recovery connection после COMMIT, повтор/конкурентный finalize, staging overwrite, 0 и 10 фото, partial validation failure, timeout/retry, cancel/delete во время PUT, revoked clearance, expiry/cleanup fencing, квота/retention, повтор с исправленным файлом, SQL row-lock timeout без частичного документа.

RTL проверяет text-first форму и повтор с тем же manifest после потери ответа. Publisher-тесты проверяют прежнее событие и bounded transport. Browser harness показывает готовый текст при реальном XHR PUT синтетического файла 5 410 842 bytes и отдельной проверке фото. [UI evidence](ZIRVE_V1_UI_CHECKS.json), [общий результат](ZIRVE_V1_RELIABILITY_UX_GALLERY_REPORT.md).

Реальные DB/S3/AI/Inngest не импортируются browser harness; настоящая ACL и SQL-семантика проверяются отдельными серверными тестами. Полный deployed end-to-end сценарий не заявляется.
