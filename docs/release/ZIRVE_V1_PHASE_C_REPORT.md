# ZIRVƏ V1 — отчёт C: периоды и пароли

## Фильтры

`Məlumat bazası` и `Bülletenlər` по умолчанию используют `Bütün dövr` — отсутствие date predicate. В выборе доступны только Bütün dövr / Xüsusi dövr. Отдельные фильтры направления, source reliability и information credibility сохранены; серверная пагинация, lazy loading и сортировка продолжают использовать существующий query/URL-state.

На desktop поиск бюллетеней и период расположены одной строкой: поле, Axtar, Bütün dövr. На mobile строка переносится. Произвольный диапазон использует существующий календарь и Asia/Baku date semantics.

`Analitika` сохраняет default Son ay и варианты Son rüb / Son il / Xüsusi dövr; добавлен Hamısı. Новый `period=all` не ограничивает ни нижнюю, ни верхнюю дату. Retrieval/context/ranking limits, permissions, prompts, Gemini и embeddings не менялись.

Совместимость: старые catalog URL с 30d/90d/12m продолжают применять исходный диапазон и показывают disabled compatibility option. Новые пользователи не могут выбрать убранный preset. Историческая analytics-ветка `all` сохраняет прежнюю семантику с верхней датой; новый all различается существующим форматом фильтров. История не переписывалась. Custom boundaries и Back/Forward/refresh проходят прежние parser/serializer. Активный текст Fərdi dövr заменён на Xüsusi dövr; исторические документы и release evidence не редактировались.

## Поля пароля

Добавлен общий `PasswordInput`: семь полей Ayarlar — три смены собственного пароля, два создания пользователя и два административного сброса. По умолчанию password скрыт. Eye/EyeOff переключает каждое поле независимо, сохраняет value и FormData; кнопка доступна Tab/Enter/Space, имеет азербайджанские accessible labels. Auth, validation, autocomplete/required/minLength и политики не изменены. Login сохраняет существующий подход.

## Проверки

Адресные tests: `period.test.ts`, `filter-search-state.test.ts`, `UnifiedFilters.test.tsx`, `unified-filters.test.ts`, `search-routes.test.tsx`, `PasswordInput.test.tsx`. Проверены defaults, отсутствие date bounds при all, сохранение legacy preset/history, custom/Baku semantics, поисковые URL и независимость password toggles/значений. Chrome harness дополнительно проверил реальные select options/defaults и управление паролями с клавиатуры.

Существующая ESLint formatting error в `_app.senedler.tsx` исправлена. Отдельный базовый warning `src/components/ui/button.tsx:48` (`react-refresh/only-export-components`) остаётся: файл не затрагивался ради постороннего refactoring. Итоговые TypeScript/lint/build/regression checks приведены в [общем отчёте](ZIRVE_V1_RELIABILITY_UX_GALLERY_REPORT.md).

Новых зависимостей и миграций для C нет. Существующие сохранённые фильтры и реальные записи не изменялись.
