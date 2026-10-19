# Analitika

Веб-приложение для аналитического поиска по внутренним документам и исследования открытых источников. Интерфейс приложения — на азербайджанском. V1 рассчитана на демонстрацию с небольшим синтетическим корпусом.

## Локальный запуск

Нужен Bun. Скопируйте переменные в `.env.local`, затем выполните:

```sh
bun install
bun run dev
```

Основные команды:

```sh
bun run lint
bun run build
bun run test
bunx tsc --noEmit
bun run db:migrate
bun run db:reset-and-seed --dry-run
bun run db:verify:search
bun run stage3:verify
```

`db:migrate` использует `DATABASE_URL_MIGRATE`; приложение использует `DATABASE_URL` через Supabase Transaction pooler. Миграция `0005_allow_duplicate_brief_dates.sql` снимает уникальность даты брифа. `db:reset-and-seed` по умолчанию выполняет только read-only dry run: показывает target database, counts целевых таблиц и точные Storage keys, не обращаясь к embedding provider. Реальная очистка и импорт корпуса из `zirve_military_seed_data_2026-10-18.json` требуют явного флага:

```sh
bun run db:reset-and-seed --reset-and-seed
```

Команда остановится, если локальную конфигурацию нельзя распознать как non-production dev/demo target, если приложение и migration URL указывают на разные базы, если документ связан с `info_requests` или если миграция уникальности даты ещё не применена. `info_requests`, их вложения, `query_logs`, eval-таблицы и посторонние Storage объекты сохраняются.

Схему после миграций можно проверить командой `bun run db:verify:exa`.

## Переменные окружения

`.env.example` содержит полный пустой шаблон. Секреты храните только в `.env.local` и Vercel Environment Variables.

| Переменная                                                                          | Назначение                                                                    |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                      | Supabase Transaction pooler для приложения                                    |
| `DATABASE_URL_MIGRATE`                                                              | Supabase Session pooler или direct connection только для Drizzle              |
| `GOOGLE_GENERATIVE_AI_API_KEY`                                                      | Gemini API key                                                                |
| `AI_CHAT_MODEL`                                                                     | Основная AI-модель для аналитики и OSINT; quota fallback использует light-модель |
| `AI_LIGHT_MODEL`                                                                    | Необязательная fallback-модель и модель для облегчённых AI-задач                |
| `GEMINI_EMBED_MODEL`                                                                | Gemini embeddings; текущая схема ждёт 768 измерений                           |
| `SEARCH_PROVIDER`                                                                   | `exa` по умолчанию или `gemini_grounding`                                     |
| `EXA_API_KEY`                                                                       | Ключ Exa для веб-поиска                                                       |
| `TAVILY_API_KEY`                                                                    | Optional Tavily fallback for OSINT web search                                 |
| `HASDATA_API_KEY`, `HASDATA_MODE`                                                   | Evaluation-only HasData SERP provider; mode is `light` by default             |
| `OSINT_MAX_SEARCH_REQUESTS`                                                         | Per-run search request ceiling; defaults to 24                                |
| `OSINT_MMR_LAMBDA`, `OSINT_RELEVANCE_THRESHOLD`                                     | OSINT source-selection relevance and diversity settings                       |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | Приватное S3-совместимое файловое хранилище                                   |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`                                          | Доставка и проверка подписей Inngest                                          |
| `DEMO_BASIC_AUTH`                                                                   | Необязательная защита демо в формате `user:password`; `/api/inngest` исключён |
| `ENABLE_RERANK`                                                                     | `false` по умолчанию; экспериментальный Gemini rerank                         |

Значения моделей читаются из env после `trim`; в исходниках модели не задаются.

## Архитектура

- `/` — список «Xülasələr»: бриф за сегодня, фильтры по неделе/месяцу, поиск и постраничная загрузка.
- `/brifler/$id`, `/brifler/yeni`, `/brifler/$id/redakte` — просмотр, создание и редактирование брифов; опубликованные брифы индексируются в фоне и участвуют в поиске.
- `/axtaris` — гибридный поиск по фрагментам документов и опубликованных брифов (vector, full-text, trigram и RRF), источники и ответы с цитатами.
- `/osint` — Exa Search на шести локализованных запросах, безопасная загрузка публичных страниц, резюме и сводка на азербайджанском.
- `/sorgu` — информационные запросы и отдельные от документов вложения.
- `/senedler` — документы, приватные вложения и фоновая индексация.
- Drizzle/Postgres хранит документы и брифы, фрагменты, оценки достоверности, запросы, OSINT-прогоны и прогресс фоновых задач.
- `StorageProvider` отделяет приложение от S3-поставщика. `LLMProvider`, `EmbeddingProvider` и `SearchProvider` отделяют логику приложения от AI и поиска.
- Долгие операции реализованы как обычные функции в `src/server/jobs/*.ts`. Inngest-обёртки в `src/server/inngest/` передают только идентификаторы и вызывают эти функции; тексты запросов и документов в события не передаются.

## Замена сервисов

### Gemini на локальную модель

Сейчас V1 использует Gemini через `src/server/ai/gemini.ts`; прямые импорты SDK провайдера должны оставаться внутри этого слоя. Для локального контура V2 добавьте адаптер OpenAI-совместимого API (например, vLLM или Ollama), реализующий `LLMProvider` и, если модель поддерживает это, `EmbeddingProvider`. Переключение подключается в фабрике AI-провайдеров конфигурацией env. Для embeddings нужна миграция размерности и полный `bun run db:reindex`, если локальная модель не выдаёт 768 значений; до переключения запросы должны фильтровать чанки по `embedding_model`.

### Supabase Storage на MinIO

Адаптер уже использует AWS S3 API. Замените `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` и `S3_BUCKET` на значения MinIO. Бакет должен быть приватным; настройте CORS бакета для origin веб-приложения и разрешите подписанные `PUT` с заголовком `content-type`. Остальную логику файлов менять не нужно.

### Inngest на локальную очередь

Сохраните функции `src/server/jobs/*.ts` и их DB-прогресс. Замените отправку идентификаторов и worker-обёртки в `src/server/inngest/` на публикацию в очередь Postgres и воркер, который вызывает те же функции по `documentId` или `runId`. Альтернатива — self-hosted Inngest. Логику индексации и OSINT переписывать не требуется.

## Демонстрация

1. На `/` откройте сегодняшний бриф, затем один из предыдущих. Для проверки формы добавьте бриф с фото и сохраните его как черновик либо опубликуйте.
2. Откройте `/senedler`, добавьте синтетический документ, выберите İdarə, поставьте оценку `D / 5` для проверки маркировки и дождитесь статуса «Hazırdır».
3. На `/axtaris` спросите: «Parkların suvarma qrafiki dəyişəndən sonra su sərfi neçə faiz azalıb?» Проверьте источники, оценку достоверности и открытие документа. Для таблицы спросите: «Avtobus marşrutunda pik saat gözləməsi sınaq zamanı neçə dəqiqə olub?»
4. На `/sorgu` отправьте синтетический запрос с небольшим тестовым вложением, поменяйте статус, прикрепите готовый документ и проверьте удаление.
5. На `/osint` выберите все шесть языков и период 30 gün. В Supabase уже закреплены два запроса; для воспроизводимого показа введите запрос точно так же:
   - `Aktual regional danışıqlar və Qafqazda iqtisadi əməkdaşlıq barədə son məlumatlar`
   - `Qafqazda nəqliyyat dəhlizlərinin inkişafı və yük daşımalarına təsiri`

   При тех же шести языках и периоде будет показан pinned-кэш без внешних вызовов. Кнопка «Yenilə» запускает свежий поиск.

6. Покажите руководству, что источники открываются в новой вкладке, частичный результат показывает причины пропусков, а истории запросов доступны после обновления страницы.

Данные в демо-документах полностью синтетические. Результаты открытого веб-поиска являются материалом для проверки аналитиком, а не подтверждёнными фактами.
