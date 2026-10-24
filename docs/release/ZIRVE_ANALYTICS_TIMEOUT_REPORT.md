# ZIRVƏ V1: analytics deadline and timeout handling

24 октября 2026, Asia/Baku. Изменения подготовлены локально на `main`, HEAD `b78d884889daaa4e2af38a4492224a505906ecfa`. Начальное рабочее дерево было чистым. Commit, push, deployment и изменение production не выполнялись.

Общий бюджет увеличен; зависшая генерация завершается понятной timeout-ошибкой. Модели, thinking level, prompts, embeddings, retrieval/RRF/rerank/evidence selection, retries/fallback policy, citations, ACL/source revalidation, схема БД и сохранённая история не изменены. Отдельного резерва или ограничения времени primary/fallback нет.

| Слой                       | Было       | Подготовлено и проверено локально |
| -------------------------- | ---------- | --------------------------------- |
| Абсолютный server deadline | 105 000 мс | 240 000 мс от начала запроса      |
| Client deadline            | 115 000 мс | 255 000 мс                        |
| Analytics Vercel function  | 120 с      | 300 с                             |
| Inngest Vercel function    | 300 с      | 300 с, без изменения настройки    |

В бюджет сервера входят rate-limit reads, parsing, history setup, retrieval, generation, retries/fallback, validation и публикация. Перед dispatch после source revalidation, после получения генерации и перед отправкой SSE проверяется абсолютное время. Поэтому задержка выполнения callback таймера не разрешает публикацию просроченного ответа.

До открытия SSE общий timeout возвращает HTTP 504 с `code: timeout`, `az.analytics.timeout` и request ID. После открытия SSE отправляется одно терминальное событие `error` с теми же полями. Сохраняются блокировка повторных terminal events, очистка heartbeat/deadline/listeners и подавление поздних результатов. Серверный deadline определяется внутренним состоянием, а не только именем причины abort: пользовательская отмена остаётся `cancelled`, даже если причина клиентского abort названа `TimeoutError`. Timeout истории — `failed`; уже опубликованный успешный ответ сохраняет `done`.

Диагностика timeout включает request ID, актуальный stage/model, generationAttempt, elapsedMs, errorCategory, timeoutScope и outcome. При общем deadline scope — `overall`, при раннем provider timeout — `model`, outcome — `failed`. Текущая fallback-модель отслеживается по существующему уведомлению, без изменения маршрутизации. До generation модель может быть неизвестна, generationAttempt в preflight — `null`. Provider status остаётся `null`, если не получен; finish reason при отсутствии результата не добавляется. В диагностику не передаются вопросы, prompts, chunks, ответы, секреты или содержимое classified sources.

## Vercel и Nitro

Владелец подтвердил в этой сессии: «Fluid Compute включен — продолжай». Прямого авторизованного чтения Vercel management API не было. Согласно [официальным лимитам Vercel](https://vercel.com/docs/functions/configuring-functions/duration), Fluid Compute поддерживает 300 секунд на всех тарифах. Это подтверждение поддержки лимита, а не свидетельство уже выполненного deployment.

Production build выполнен с настоящим `vite.config.ts`, preset `vercel`, Vite 8.1.6 и Nitro `3.0.260603-beta`. Проверен свежий артефакт сборки от `2026-10-24T05:14:10.503Z`:

- `.vercel/output/functions/api/analytics/search.func/.vc-config.json`: `maxDuration: 300`, `supportsResponseStreaming: true`, `runtime: nodejs24.x`.
- `.vercel/output/functions/api/inngest.func/.vc-config.json`: прежние `maxDuration: 300`, streaming и runtime сохранены.
- `.vercel/output/config.json`: один точный маршрут `/api/analytics/search` → `/api/analytics/search` и один `/api/inngest` → `/api/inngest`; analytics не попадает в catch-all `__server`.
- `.vercel/output/nitro.json`: preset `vercel`, две прежние `functionRules`; analytics изменён на 300, Inngest остаётся 300. Дублирующие `vercel.json`/route exports не добавлялись.

Отдельные assertions проверили обе function-конфигурации, preset и уникальность маршрутов. Локальные безопасные evidence и логи сохранены в игнорируемом каталоге `.release-backup.local/analytics-timeout/` (`artifact.json`, `build.log`, `tests.log`, `safe-build.mjs`). Сборка скрывала dotenv, удаляла credentials из своего окружения и запрещала сеть. Первоначальная sandbox-сборка остановилась на Nitro dependency tracing (`readlink C:\Users\AO`); повтор той же сборки с расширенным файловым доступом прошёл. Код приложения и production-конфигурация для обхода ограничения не менялись.

## Проверки

| Проверка                                                                       | Результат                                                                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Адресные unit/component/provider tests                                         | PASS: 140 тестов, 7 файлов, 13.45 с                                                       |
| `bun --no-env-file run tsc --noEmit --incremental false`                       | PASS                                                                                      |
| `bun --no-env-file run tsc --noEmit --incremental false -p tsconfig.eval.json` | PASS                                                                                      |
| `bun --no-env-file run lint`                                                   | PASS: 0 ошибок, 1 прежнее предупреждение Fast Refresh в `src/components/ui/button.tsx:48` |
| Production client/SSR/Nitro build                                              | PASS, generated Vercel config проверен                                                    |
| `git diff --check`                                                             | PASS                                                                                      |

Адресный запуск включал `endpoint.test.ts`, `context-pipeline.test.ts`, `gemini.test.ts`, `gemini-gateway.test.ts`, `fallback.test.ts`, `diagnostics.test.ts` и `analytics-layout.test.tsx`.

Проверены fake timers/mocked providers: успешный ответ через 138 019 мс (18 019 мс retrieval + 120 000 мс generation), общий timeout ровно на 240 000 мс, client timeout на 255 000 мс, оба порядка provider/server timer на одной границе, ранний provider timeout, зависший provider без реакции на abort, поздний ответ, просроченный ответ до выполнения callback таймера, клиентская отмена, preflight DB/body timeout, отсутствие двойного terminal event, актуальная fallback-модель/вторая validation attempt в безопасных логах и статусы истории. Provider HTTP 429/503/504/400 сохраняют собственные категории; HTTP 504 провайдера сам по себе не становится общим deadline. Сохранены проверки validation/source access failures и `done` после final при зависшем history write.

В UI-тестах остаются прежние React warnings о пустом href и тестовой вложенности html. Build сообщает предупреждения о крупном client chunk и `src/routes/attachments.test.ts` без Route export; сборка завершается успешно. Реальные Gemini-вызовы и проверки с записью в production DB/storage не запускались. Runtime integration tooling обновлён под новые константы и timeout assertion, но сам сценарий с реальными DB/storage в этой работе не выполнялся.

## Изменённые файлы

| Файл                                             | Изменение                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `src/lib/analytics.ts`                           | Общие server/client бюджеты 240/255 с                                        |
| `vite.config.ts`                                 | Существующая analytics functionRule: 300 с                                   |
| `src/server/analytics/endpoint.ts`               | Классификация timeout, HTTP/SSE, абсолютные проверки, безопасная диагностика |
| `src/server/ai/diagnostics.ts`                   | Явные generationAttempt и outcome                                            |
| `src/server/analytics/endpoint.test.ts`          | Deadline, races, cancellation, history, diagnostics, provider categories     |
| `src/server/ai/diagnostics.test.ts`              | Безопасные timeout metadata без выдуманного provider результата              |
| `src/server/analytics/context-pipeline.test.ts`  | Использование актуальной общей константы                                     |
| `src/test/analytics-layout.test.tsx`             | 255-секундная граница клиента, HTTP/SSE timeout, поздний terminal            |
| `scripts/verify-runtime-edges.ts`                | Актуальные бюджеты и timeout assertions для отдельной integration-проверки   |
| `scripts/controlled-ai-preload.ts`               | Синтетический hanging provider дольше нового бюджета                         |
| `docs/analytics-v1.md`                           | Текущий контракт бюджетов и ошибок                                           |
| `docs/PRODUCTION_MANUAL_CHECKLIST.md`            | Проверка analytics 300 с и поддерживаемого Node.js runtime                   |
| `docs/release/RELEASE_RUNBOOK.md`                | Обновление текущих проверок бюджета                                          |
| `docs/release/ZIRVE_ANALYTICS_TIMEOUT_REPORT.md` | Этот отчёт                                                                   |

Больший бюджет позволяет завершаться запросам, которым не хватало 105 секунд, но не гарантирует завершение Gemini за 240 секунд. Первичная модель по-прежнему может использовать весь остаток; отдельного резерва fallback нет. Фактическое применение нового артефакта production-платформой нужно проверить после отдельно разрешённого deployment. История сохраняется best-effort: её запись нельзя гарантировать при остановке процесса или недоступной БД. Причина задержки Gemini для исторического Request ID этим изменением не устанавливается.
