# Analitika

Веб-приложение для Core RAG поиска по внутренним документам и аналитическим сводкам. Интерфейс приложения — на азербайджанском. V1 рассчитана на работу с внутренним корпусом.

Актуальный итог hardening: [V1 production report](docs/V1_FINAL_PRODUCTION_REPORT.md). **Production NO-GO** до подтверждения deployment revision, актуальных cloud workers и production smoke; passing local checks не заменяют эти gates.

## Локальный запуск

Нужен Bun. Скопируйте переменные в `.env.local`, затем выполните:

```sh
bun install --frozen-lockfile
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
```

`db:migrate` использует `DATABASE_URL_MIGRATE`; приложение использует `DATABASE_URL` через Supabase Transaction pooler. Миграция `0005_allow_duplicate_brief_dates.sql` снимает уникальность даты брифа. `db:reset-and-seed` выполняет только read-only dry run с counts: destructive reset отключён для всех targets, `--reset-and-seed` отклоняется. Пользовательский corpus нельзя очищать для проверки.

`bun run db:check-drift` сравнивает схему с последним Drizzle snapshot и с native catalog настроенной Supabase DB, включая RLS. После `bun run build` команда `bun run preview` обслуживает Vercel artifact локально на `127.0.0.1:4175`.

Текущая точка остановки, доказательства и подробный план продолжения: [WORK_SESSION_HANDOFF.md](./docs/WORK_SESSION_HANDOFF.md). Checkpoint не означает production GO.

## Переменные окружения

`.env.example` содержит полный пустой шаблон. Секреты храните только в `.env.local` и Vercel Environment Variables.

| Переменная                                                                          | Назначение                                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                                                                      | Supabase Transaction pooler для приложения                           |
| `DATABASE_URL_MIGRATE`                                                              | Supabase Session pooler или direct connection только для Drizzle     |
| `GOOGLE_GENERATIVE_AI_API_KEY`                                                      | Gemini API key                                                       |
| `AI_CHAT_MODEL`                                                                     | Основная модель для Core RAG; quota fallback использует light-модель |
| `AI_LIGHT_MODEL`                                                                    | Необязательная fallback-модель и модель для облегчённых AI-задач     |
| `GEMINI_EMBED_MODEL`                                                                | Gemini embeddings; текущая схема ждёт 768 измерений                  |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | Приватное S3-совместимое файловое хранилище                          |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`                                          | Доставка и проверка подписей Inngest                                 |
| `ENABLE_RERANK`                                                                     | `false` по умолчанию; экспериментальный Gemini rerank                |

Значения моделей читаются из env после `trim`; в исходниках модели не задаются.

Аналитические evaluation scripts (`db:verify:search`, `db:eval:rerank`) используют существующую настроенную DB и clearance активного пользователя (`EVALUATION_USER_ID` позволяет выбрать его явно). Отдельная evaluation DB запрещена; `ANALYTICS_EVAL_DATABASE_URL` отклоняется. Benchmark может вызывать настроенный embedding provider; rerank по умолчанию отключён.

Внешняя AI-обработка разрешена кодом только для `open` по умолчанию. Расширение `AI_EXTERNAL_ALLOWED_CLASSIFICATIONS` требует согласованной политики и непустого `AI_EXTERNAL_POLICY_REFERENCE`; наличие строки само по себе не подтверждает согласование. `AI_BACKUP_MODEL` не реализован. Модели проекта: основная `gemini-3.8-flash`, лёгкая `gemini-3.5-flash-lite`, embeddings Gemini Embedding 2 (768 измерений).

У вопроса V1 нет отдельного поля classification: внешние query embedding/rerank/generation консервативно используют текущий clearance пользователя, как и history. Для пользователей выше `open` без approved policy остаётся локальный lexical sources search. Новые attachments сохраняются как проверенные server-only copies; временный signed PUT/discard не может изменить committed файл.

Порядок review/release и обязательные runtime доказательства: [RELEASE_RUNBOOK.md](./docs/release/RELEASE_RUNBOOK.md). Production target: `https://analitika-one.vercel.app`; доступность login не доказывает проверенную revision или работу cloud workers.

## Архитектура

- `/` — список «Gündəlik bülletenlər»: бриф за сегодня, фильтры по неделе/месяцу, поиск и постраничная загрузка.
- `/brifler/$id`, `/brifler/yeni`, `/brifler/$id/redakte` — просмотр, создание и редактирование брифов; опубликованные брифы индексируются в фоне и участвуют в поиске.
- `/axtaris` — гибридный поиск по фрагментам документов и опубликованных брифов (vector, full-text, trigram и RRF), источники и ответы с цитатами.
- `/senedler` — документы, приватные вложения и фоновая индексация.
- Drizzle/Postgres хранит документы и брифы, фрагменты, оценки достоверности, историю запросов и прогресс фоновых задач.
- `StorageProvider` отделяет приложение от S3-поставщика. `LLMProvider` и `EmbeddingProvider` отделяют логику Core RAG от AI-провайдера.
- Долгие операции реализованы как обычные функции в `src/server/jobs/*.ts`. Inngest-обёртки в `src/server/inngest/` передают только идентификаторы и вызывают эти функции; тексты запросов и документов в события не передаются.

## Замена сервисов

### Gemini на локальную модель

Сейчас V1 использует Gemini через `src/server/ai/gemini.ts`; прямые импорты SDK провайдера должны оставаться внутри этого слоя. Для локального контура V2 добавьте адаптер OpenAI-совместимого API (например, vLLM или Ollama), реализующий `LLMProvider` и, если модель поддерживает это, `EmbeddingProvider`. Переключение подключается в фабрике AI-провайдеров конфигурацией env. Для embeddings нужна миграция размерности и полный `bun run db:reindex`, если локальная модель не выдаёт 768 значений; до переключения запросы должны фильтровать чанки по `embedding_model`.

### Supabase Storage на MinIO

Адаптер уже использует AWS S3 API. Замените `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` и `S3_BUCKET` на значения MinIO. Бакет должен быть приватным; настройте CORS бакета для origin веб-приложения и разрешите подписанные `PUT` с заголовком `content-type`. Остальную логику файлов менять не нужно.

### Inngest на локальную очередь

Сохраните функции `src/server/jobs/*.ts` и их DB-прогресс. Замените отправку идентификаторов и worker-обёртки в `src/server/inngest/` на публикацию в очередь Postgres и воркер, который вызывает те же функции по `documentId` или `briefId`. Альтернатива — self-hosted Inngest. Логику индексации переписывать не требуется.

## Демонстрация

1. На `/` откройте сегодняшний бриф, затем один из предыдущих. Для проверки формы добавьте бриф с фото и сохраните его как черновик либо опубликуйте.
2. Откройте `/senedler`, добавьте синтетический документ, выберите İdarə, поставьте оценку `D / 5` для проверки маркировки и дождитесь статуса «Hazırdır».
3. На `/axtaris` спросите: «Parkların suvarma qrafiki dəyişəndən sonra su sərfi neçə faiz azalıb?» Проверьте источники, оценку достоверности и открытие документа. Для таблицы спросите: «Avtobus marşrutunda pik saat gözləməsi sınaq zamanı neçə dəqiqə olub?»
4. На `/axtaris` проверьте фильтры по направлению и достоверности, затем откройте сохранённую историю поиска.
5. Покажите руководству, что citations ведут к доступным исходным документам и недоступный после изменения прав текст не раскрывается через историю.

Данные в демо-документах полностью синтетические.

## Authentication rollout

Follow [the authentication deployment guide](./docs/AUTHENTICATION.md) to apply the migration and bootstrap the first administrator before deploying the account-based login.
