# ZIRVƏ V1 — отчёт D: общая Premium Photo Gallery

## Поведение и внешний вид

`PhotoGallery` используется в деталях документа и бюллетеня. Основой служит уже установленный Radix Dialog; новых зависимостей нет. Глубокий тёмный полупрозрачный фон, сдержанный fade, изображение object-contain без обрезания, компактные controls и thumbnail grid с небольшим hover effect соответствуют существующим цветам ZIRVƏ. Reduced motion учитывается.

Обычный клик открывает выбранное фото в модальном окне и не меняет URL. Есть left/right controls, ArrowLeft/ArrowRight, Escape и X, счётчик, mobile swipe, double tap/pinch zoom, pan увеличенного изображения и сброс тем же control. При одном фото стрелки скрыты. Dialog блокирует прокрутку и возвращает фокус исходной миниатюре. Loading/error/retry состояния доступны в самой галерее.

Миниатюры и основной просмотр запрашивают WebP, если он сохранён. При недоступной производной сервер может использовать оригинал. `Orijinalı yüklə` отдельно скачивает исходные bytes через тот же authenticated endpoint и временный Blob URL. Оригинал не перекодируется. На закрытие/смену фото/unmount выполняются abort и revokeObjectURL, дополнительное persistent хранилище не используется.

## Приватная доставка и крупные файлы

Сохранён `/api/attachments/...`. Сервер проверяет существование parent/attachment, active user и live clearance до чтения Storage, а затем повторно после чтения. SQL connection/locks не удерживаются на время S3 I/O. Отзыв доступа или удаление во время чтения приводит к отказу; каждый range повторяет проверки.

Ответы содержат private/no-store, nosniff и same-origin resource policy. S3 keys, signed GET/upload URLs и публичный bucket для чтения не используются. Доступные до отзыва прав bytes нельзя отозвать из уже полученной памяти клиента; это естественная граница HTTP.

Чтобы не полагаться на доставку buffered original >4.5 MB через Vercel, добавлен один строгий byte range до **1 MiB** на ответ. Gallery/download собирают файл в памяти из таких authenticated запросов; проверяются MIME, Content-Range, общий размер, длина каждого chunk и предел 10 MiB. Single full GET до 3 MiB поддерживается; больший full GET получает контролируемый **413**, malformed/multiple/oversized ranges — 416. Это изменение совместимости для старых прямых ссылок на большие оригиналы: новый интерфейс использует ranges, старый внешний full-GET потребует range-клиент. Прямой публичный Storage URL не выдаётся.

## Проверки

Unit/RTL: `PhotoGallery.test.tsx`, `private-image.test.ts`, `attachments.test.ts`, `document-detail.test.tsx`. Покрыты selected index/keyboard/focus/close/reopen, range validation, auth/private headers, missing/deleted parent и attachment, revoked clearance до/после Storage, размер оригинала 6 MiB.

Реальный headless Chrome с локальным synthetic harness проверил документ с 10 фото, документ/бюллетень с одним фото и mobile бюллетень с тремя фото; arrows, Escape, zoom/reset, swipe/pinch через CDP touch events, loading/error/retry, возврат фокуса, неизменный URL и viewport fit. Оригинал **5 410 842 bytes** скачан шестью private range-ответами; SHA-256 совпал. Крупнейший ответ — 1 048 576 bytes. Четыре denied-request сценария обработаны; внешних service requests не было.

[Машинный UI-результат](ZIRVE_V1_UI_CHECKS.json), [desktop screenshot](ZIRVE_V1_GALLERY_DESKTOP.png), [mobile screenshot](ZIRVE_V1_GALLERY_MOBILE.png). Скриншоты просмотрены после исправления mobile overflow; изображения намеренно синтетические.

Browser harness использует реальные общие UI-компоненты и имитирует API/Storage. ACL отдельно проверена на серверной реализации; deployed Vercel и физические Safari/iOS устройства не тестировались. Для будущего разрешённого deployment остаётся smoke-проверка native Sharp, proxy/range транспорта и browser-to-Storage CORS. Общий результат проверок — в [итоговом отчёте](ZIRVE_V1_RELIABILITY_UX_GALLERY_REPORT.md).
