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
bun run db:seed:demo
bun run db:eval:retrieval
bun run stage3:verify
```

`db:migrate` использует `DATABASE_URL_MIGRATE`; приложение использует `DATABASE_URL` через Supabase Transaction pooler. При очистке удаляются только шесть фиксированных синтетических demo-документов и их фрагменты:

```sh
bun run db:seed:demo --clean
```

Схему после миграций можно проверить командой `bun run db:verify:exa`.

## Переменные окружения

`.env.example` содержит полный пустой шаблон. Секреты храните только в `.env.local` и Vercel Environment Variables.

| Переменная | Назначение |
| --- | --- |
| `DATABASE_URL` | Supabase Transaction pooler для приложения |
| `DATABASE_URL_MIGRATE` | Supabase Session pooler или direct connection только для Drizzle |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key |
| `GEMINI_CHAT_MODEL` | Gemini для аналитики и основной OSINT-сводки |
| `GEMINI_LIGHT_MODEL` | Gemini для переводов и резюме источников |
| `GEMINI_EMBED_MODEL` | Gemini embeddings; текущая схема ждёт 768 измерений |
| `SEARCH_PROVIDER` | `exa` по умолчанию или `gemini_grounding` |
| `EXA_API_KEY` | Ключ Exa для веб-поиска |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | Приватное S3-совместимое файловое хранилище |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Доставка и проверка подписей Inngest |
| `DEMO_BASIC_AUTH` | Необязательная защита демо в формате `user:password`; `/api/inngest` исключён |
| `ENABLE_RERANK` | `false` по умолчанию; экспериментальный Gemini rerank |

Значения моделей читаются из env после `trim`; в исходниках модели не задаются.

## Архитектура

- `/` — гибридный поиск по фрагментам документов (vector, full-text, trigram и RRF), источники и ответы с цитатами.
- `/osint` — Exa Search на шести локализованных запросах, безопасная загрузка публичных страниц, резюме и сводка на азербайджанском.
- `/sorgu` — информационные запросы и отдельные от документов вложения.
- `/senedler` — документы, приватные вложения и фоновая индексация.
- Drizzle/Postgres хранит документы, фрагменты, оценки достоверности, запросы, OSINT-прогоны и прогресс задач.
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

1. Откройте `/senedler`, добавьте синтетический документ, выберите İdarə, поставьте оценку `D / 5` для проверки маркировки и дождитесь статуса «Hazırdır».
2. На `/` спросите: «Parkların suvarma qrafiki dəyişəndən sonra su sərfi neçə faiz azalıb?» Проверьте источники, оценку достоверности и открытие документа. Для таблицы спросите: «Avtobus marşrutunda pik saat gözləməsi sınaq zamanı neçə dəqiqə olub?»
3. На `/sorgu` отправьте синтетический запрос с небольшим тестовым вложением, поменяйте статус, прикрепите готовый документ и проверьте удаление.
4. На `/osint` выберите все шесть языков и период 30 gün. В Supabase уже закреплены два запроса; для воспроизводимого показа введите запрос точно так же:
   - `Aktual regional danışıqlar və Qafqazda iqtisadi əməkdaşlıq barədə son məlumatlar`
   - `Qafqazda nəqliyyat dəhlizlərinin inkişafı və yük daşımalarına təsiri`

   При тех же шести языках и периоде будет показан pinned-кэш без внешних вызовов. Кнопка «Yenilə» запускает свежий поиск.
5. Покажите руководству, что источники открываются в новой вкладке, частичный результат показывает причины пропусков, а истории запросов доступны после обновления страницы.

Данные в демо-документах полностью синтетические. Результаты открытого веб-поиска являются материалом для проверки аналитиком, а не подтверждёнными фактами.
