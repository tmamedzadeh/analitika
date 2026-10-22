# ZIRVƏ / ANALİTİKA — FINAL CODE COMPLETION & MERGE TO MAIN

Заверши текущую разработку ZIRVƏ V1 и отправь все необходимые проверенные изменения в GitHub `main`.

**Владелец проекта берёт на себя самостоятельную проверку Vercel, production configuration, deployment logs и production runtime.**

Не трать время на дальнейшие попытки получить Vercel management access или расследовать недоступные тебе production logs.

Однако не объявляй Production GO, пока внешние проверки не завершены.

## 1. Завершение кодовой части V1

Текущая ветка:

`codex/zirve-v1-rc-resume`

Текущий PR:

`https://github.com/tmamedzadeh/analitika/pull/1`

Последний известный SHA:

`5ce04f38afc83d9ec6843d6e08b45743ecae6d35`

Прочитай актуальные `AGENTS.md`, production audit, final report, acceptance matrix и Git diff.

Проведи заключительный review всей реализации V1.

Исправь оставшиеся доказанные проблемы кода, которые можешь устранить без доступа к Vercel management.

Особенно проверь:

- authorization и clearance;
- documents/briefs;
- uploads;
- indexing/retry/recovery;
- Analitika и RAG;
- citations;
- history;
- lexical search;
- API security;
- handling ошибок Gemini;
- timeout/cancellation;
- корректность environment validation;
- совместимость с Vercel и Inngest.

Не выполняй архитектурный rewrite.

Не добавляй новые функции, которые не входят в V1.

## 2. Разделение code и production blockers

Раздели все оставшиеся задачи на две категории.

**A. Code-level blockers**

Ошибки, которые можно исправить в текущем репозитории.

Устрани все подтверждённые обязательные code-level P0/P1 проблемы.

**B. External production verification**

Задачи, которые требуют:

- Vercel Dashboard;
- production environment settings;
- hosting/provider logs;
- проверки фактического deployment;
- регистрации облачных Inngest jobs;
- production smoke tests;
- подтверждения рабочего rollback deployment.

Их владелец выполнит самостоятельно.

Не пытайся скрывать или формально закрывать эти задачи.

Особенно сохрани статус реального Gemini Preview generation failure: он остаётся неподтверждённым до успешной проверки.

## 3. Final code quality

После необходимых исправлений выполни:

- unit tests;
- TypeScript checks;
- lint;
- build;
- integration tests;
- browser E2E;
- storage validation;
- lexical search tests;
- retrieval/citation checks;
- indexing lifecycle checks;
- runtime edge tests;
- DB drift/integrity verification.

Не ослабляй тесты.

Не изменяй applied SQL.

Не выполняй destructive database operations.

Не трогай пользовательский corpus.

Не добавляй AI_BACKUP_MODEL или Qwen.

Если всё уже проверено и код не изменился, используй актуальные результаты и evidence вместо бессмысленного повторения всех длительных проверок.

## 4. Prepare Main Merge

Владелец проекта явно разрешает:

- final commit;
- push текущей ветки;
- обновление PR #1;
- перевод PR из Draft в Ready;
- merge в `main`, если code-level gates пройдены;
- push необходимых документационных исправлений.

Перед merge:

1. Проверь актуальный `origin/main`.
2. Проверь наличие конфликтов.
3. Проверь GitHub CI.
4. Проверь отсутствие secrets.
5. Проверь изменения относительно `main`.
6. Убедись, что все необходимые исходные файлы включены.
7. Проверь, не запускает ли merge автоматический production deployment.

**Важно:** владелец понимает, что merge в `main` может запустить Vercel auto-deployment. Не заявляй, что это только Git-операция, если настроен автоматический релиз.

Если нет технической возможности предотвратить автоматический production deployment при незакрытых критических runtime gates, явно сообщи об этом и не обходи существующие защитные механизмы. Не выполняй небезопасный merge, если выявлена реальная угроза данным или безопасности.

При успешных code-level gates и отсутствии блокирующих ограничений выполни merge PR #1 в `main`.

Не используй force push и не переписывай опубликованную Git history.

## 5. Documentation

Обнови:

`docs/V1_FINAL_PRODUCTION_REPORT.md`

`docs/V1_PROD_HARDENING_AUDIT.md`

Добавь отдельный файл:

`docs/PRODUCTION_MANUAL_CHECKLIST.md`

Это должен быть конкретный список того, что владелец должен проверить в Vercel Dashboard и Inngest после обновления GitHub.

В checklist укажи:

1. Какой Vercel project открыть.
2. Какие environment variable names проверить.
3. Как подтвердить production commit SHA.
4. Где проверить deployment status.
5. Где найти Function Logs.
6. Как безопасно воспроизвести Gemini generation failure.
7. Какие сведения из logs нужны для диагностики без раскрытия секретов.
8. Как проверить успешную генерацию и citations.
9. Как подтвердить 6 актуальных Inngest functions.
10. Как проверить event delivery, indexing и recovery.
11. Как проверить production authentication, clearance и Storage.
12. Как подтвердить rollback target.
13. Какие критерии обязательны для окончательного Production GO.

Предоставь точные инструкции с учётом существующей конфигурации проекта. Не выдумывай подтверждения, если доступа нет.

## 6. Final GitHub Verification

После merge проверь:

- `git status`;
- `git log -1`;
- `git rev-parse HEAD`;
- `git ls-remote origin refs/heads/main`;
- состояние PR #1.

Подтверди, что все необходимые изменения действительно находятся в удалённом `main`.

Не оставляй незакоммиченных или неотправленных обязательных исправлений.

Если документация изменялась после merge, сохрани её дополнительным проверенным commit и push.

## 7. Final Response

Предоставь финальный отчёт на русском:

1. Что реализовано в ZIRVƏ V1.
2. Какие проблемы исправлены.
3. Какие проверки выполнены и их результаты.
4. Остались ли code-level defects.
5. GitHub PR/merge status.
6. Итоговый `main` commit SHA.
7. Состояние Supabase и сохранность данных.
8. Что владелец должен проверить в Vercel.
9. Что владелец должен проверить в Inngest.
10. Какие внешние gates ещё не подтверждены.
11. Где находится `docs/PRODUCTION_MANUAL_CHECKLIST.md`.

Раздели итоговые статусы:

**CODE READY:** YES/NO

**GITHUB MAIN UPDATED:** YES/NO

**PRODUCTION VERIFIED:** YES/NO

Не присваивай Production GO без успешной реальной проверки.

**Цель: полностью завершить кодовую часть ZIRVƏ V1, сохранить проверенный результат в GitHub main и передать владельцу понятный, короткий и исчерпывающий checklist оставшихся production-проверок.**
