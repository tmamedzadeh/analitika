# ZIRVƏ V1 — итоговый отчёт A–D

24 октября 2026. Реализованы A → B → C → D в локальной рабочей копии. Исходный HEAD и проверенный origin/main: `b34ae5ac35377b89ac22d1e116be11d9c5d4c90b`. Commit, push и deployment не выполнялись. Новых зависимостей и платных Gemini-вызовов нет.

## Результат

Текст/Rich JSON сохраняются отдельной короткой SQL-транзакцией и получают стабильный ID до передачи фотографий. Существующий text indexing запускается независимо; фото получают durable slots, private signed PUT, bounded Node.js/Sharp finalize, отдельные статусы, retry/cancel/reload recovery. Потерянный ACK не создаёт второй документ и не вызывает удаление потенциально опубликованных оригиналов.

Оригинальные JPG/PNG/WebP сохраняются побайтно; WebP остаётся optional. Успешный save не ждёт S3 DELETE. Cleanup учитывает live references, sessions, protection windows и синхронизируется с finalize через object locks/generation fencing. Сохранены StorageProvider и переносимость на Node.js/Docker/PostgreSQL/S3-compatible backend; фото не используют Inngest.

Catalog и bulletins теперь открываются за весь период, analytics сохраняет Son ay и добавляет Hamısı; legacy ссылки/история сохраняют прежний смысл. Семь password-полей получили независимые доступные toggles. Общая приватная галерея документов/бюллетеней поддерживает keyboard/swipe/zoom и получение большого оригинала небольшими authenticated range-ответами.

## База данных

На основной настроенной **БД разработки** реально применена **только `0029_document_image_reliability_expand`**. Перед применением проверены актуальная схема, predecessor hash/journal и конфликты; после — три новые таблицы с RLS, ограничения/индексы и полная схема: **0 расхождений**. Runtime/migration connections проверены одной синтетической записью, затем удалённой. Существующие документы/вложения/пользователи и S3-объекты не изменялись. [DB evidence](ZIRVE_V1_DB_CHECKS.json).

Fault/race tests выполнялись на отдельном локальном PostgreSQL с жёсткой проверкой host/port/user/data_directory/database перед migrations/fixtures; тесты никогда не берут основной DATABASE_URL. Ни DROP/TRUNCATE, ни массовая очистка основной БД не выполнялись. Backup/dump не создавался согласно разрешению пользователя.

## Проверки и воспроизведение

Итоговые результаты записаны в [ZIRVE_V1_CHECKS.json](ZIRVE_V1_CHECKS.json). Проверки включают весь доступный безопасный Vitest regression suite с настоящей изолированной PostgreSQL, TypeScript, ESLint, production build, reference integrity и 7 Chrome acceptance checks.

| Проверка                                             | Итог                                |
| ---------------------------------------------------- | ----------------------------------- |
| Полный Vitest regression                             | **747 passed, 89 файлов**, 193,07 с |
| Включённые PostgreSQL lifecycle/fault/race scenarios | **20 passed**                       |
| TypeScript `tsc --noEmit`                            | PASS                                |
| ESLint                                               | **0 errors**, 1 прежний warning     |
| Production build                                     | PASS                                |
| Browser acceptance                                   | **7 passed**                        |
| Markdown links / imports                             | 0 failures                          |
| `git diff --check`                                   | PASS                                |

После финального прогона удалены 12 временных fixture-БД только из проверенного изолированного кластера; этот кластер остановлен. Системная служба PostgreSQL не останавливалась. Каталог тестового кластера и локальные логи остаются в ignored `.gate-backup`; это синтетические артефакты, не backup основной БД.

```powershell
$env:ZIRVE_ISOLATED_PG_TESTS='1'
bun --no-env-file run scripts/test.ts --maxWorkers=4 --testTimeout=15000
bun --no-env-file x --no-install tsc --noEmit
bun --no-env-file run lint
bun --no-env-file run scripts/verify-v1-ui.ts
bun --no-env-file run scripts/check-references.ts
```

PostgreSQL suite требует специально подготовленный workspace cluster `.gate-backup/zirve-pg-0029`, bind 127.0.0.1:55487, user zirve_test. Без opt-in он пропускается; при неверной identity — отказывается выполнять fixtures. Увеличенный host testTimeout относится к Vitest и не меняет deadlines приложения. В ходе первого полного прогона найдена и исправлена потеря timeout-кода при вложенном stream; прежний analytics fake-clock test дополнительно проверен отдельно после host timeout.

Для повторного opt-in прогона потребуется запустить этот остановленный кластер; обычный regression без переменной не обращается к нему и пропускает только эту интеграционную группу.

Production build выполнялся с NODE_ENV=production и очищенными DB/S3/Inngest/Gemini credentials; внешние сервисы не требуются. В generated artifact проверены Node.js 22, `__server` 60 с, analytics/Inngest 300 с. Build warnings: существующие большие chunks/плагины, тестовый route и платформенный Sharp. Windows native Sharp необходимо пересобрать под ОС deployment.

ESLint: исправлена существовавшая formatting error в `_app.senedler.tsx`; базовый warning `src/components/ui/button.tsx:48` (`react-refresh/only-export-components`) отражён отдельно и оставлен без постороннего refactoring.

## Отчёты и файлы

- [A — Storage, originals, COMMIT recovery, schema и cleanup](ZIRVE_V1_PHASE_A_REPORT.md).
- [B — text first, upload lifecycle, quotas и rollback](ZIRVE_V1_PHASE_B_REPORT.md).
- [C — фильтры, история и пароли](ZIRVE_V1_PHASE_C_REPORT.md).
- [D — gallery, ACL и ranges](ZIRVE_V1_PHASE_D_REPORT.md).
- [Полный список изменённых/добавленных файлов](ZIRVE_V1_CHANGED_FILES.json).
- [Browser results](ZIRVE_V1_UI_CHECKS.json), [desktop](ZIRVE_V1_GALLERY_DESKTOP.png), [mobile](ZIRVE_V1_GALLERY_MOBILE.png).

Главные группы: storage adapters/operations/sessions/cleanup; document creations/publisher/server functions; schema + 0029/journal/snapshot; upload provider/form/cards; period/parser/backend predicates; PasswordInput; PhotoGallery/private reader/attachment route; адресные unit/integration/browser scripts и отчёты. `package.json`, `bun.lock`, существующие Inngest workers/functions, AI models/prompts/embeddings и auth/ACL политики не менялись. В `.env.local` добавлен только несекретный producer flag после проверки схемы.

## Ограничения и оставшиеся проверки

- Историческая причина fetch error не установлена. Исправлены подтверждённые дефекты; исторический RCA не заменён предположением о Sharp.
- Реальный S3, CORS, deployed Vercel transport и физический mobile Safari не проверены. Browser harness синтетический; серверные ACL/SQL tests проверяют отдельные реальные реализации. Deployment запрещён, поэтому полного live end-to-end результата нет.
- Native Sharp queue не имеет гарантированного hard cancellation без process isolation. Использованы ограниченные inputs/concurrency/native timeouts и checkpoints; subprocess не вводился.
- Старый full GET оригинала >3 MiB возвращает 413; новый UI скачивает через private chunks ≤1 MiB. Выкат требует проверки прокси/host и Linux native build.
- Если браузер закрыт до завершения PUT, файл потребуется выбрать снова. Текст уже сохранён. Транспортные bytes не сохраняются в persistent client storage.
- Недоступность существующего Inngest может задержать индексацию до штатного retry/recovery. Нового text outbox и новых photo jobs не добавлено.
- Pending quotas ограничивают uploader/slots, а не общий объём bucket; orphan window и число повторов следует учитывать при эксплуатации. Расширенную schema сохранять при rollback, producer flag можно отключить.

Существующие пользовательские файлы/данные сохранены. Изменения доступны для review в рабочей копии; автоматический commit или выкат не выполнялся.
