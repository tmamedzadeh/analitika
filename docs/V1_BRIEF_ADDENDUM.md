## ДОПОЛНЕНИЕ К БРИФУ (заменяет противоречащие места)

### A. Шкалы достоверности

Файл src/lib/reliability.ts, единый источник для формы, бейджей и фильтров.

- Mənbənin etibarlılıq dərəcəsi (source_reliability): A Tam etibarlı, B Adətən etibarlı, C Kifayət qədər etibarlı, D Adətən etibarsız, E Etibarsız, F Qiymətləndirilmir.
- Məlumatın etibarlılıq dərəcəsi (info_credibility, 1–6): 1 Təsdiqlənib, 2 Ehtimal olunan həqiqi, 3 Ola bilər, 4 Şübhəli, 5 Ehtimal olunmayan, 6 Qiymətləndirilmir.
- Значение по умолчанию: F и 6. Поля необязательные.
- Экспортируй константы, подписи на азербайджанском (через i18n) и функцию isLowReliability(a, b): true, если источник D–E или информация 4–5.

### B. Изменения в «Sənəd əlavə et» (/senedler)

- В таблицу documents добавь source_reliability char(1) default 'F' и info_credibility smallint default 6 (с CHECK-ограничениями).
- В форму добавь две группы выбора (radio group, доступная с клавиатуры) под полем тегов, в стиле существующих pill-кнопок. Значения сохраняются вместе с документом.
- На странице документа /senedler/$id покажи обе оценки бейджами в шапке.

### C. Изменения в поиске аналитики ("/")

- Запрос поиска возвращает вместе с фрагментом source_reliability и info_credibility его документа.
- В каждой карточке источника справа покажи два бейджа: «Mənbə B» и «Məlumat 2» (с подсказкой-расшифровкой по hover и на фокус). У документов со значениями по умолчанию бейджи показывай приглушёнными («Mənbə F», «Məlumat 6»).
- Добавь фильтр «Etibarlılıq»: минимальная оценка источника (A–F) и минимальная оценка информации (1–6). По умолчанию «hamısı». Фильтр применяется в SQL до слияния RRF и проходит через accessFilter.
- В ранжирование оценки в V1 НЕ входят.
- В промпт ответа передавай оценки каждого фрагмента. Правило для модели: если вывод опирается на фрагмент с оценкой D–E или 4–5, добавь короткую оговорку на азербайджанском («bu məlumat aşağı etibarlılıq dərəcəsinə malikdir»). Не называй такие данные достоверными и не скрывай оценку.
- Проверку цитат [n] из основного брифа оставь без изменений.

### D. Новый раздел «Məlumat sorğusu» (/sorgu)

Назначение: если аналитик не нашёл нужную аналитику, он отправляет запрос на неё.
Меню: иконка (сообщение с плюсом) стоит над «Sənədlər» и под «OSINT». Названия в навигации и aria-label на азербайджанском. Маршрут /sorgu, дизайн по макету (форма слева, «Mənim sorğularım» справа).

Данные:

- info_requests: id uuid, department text, request_date date, urgency text (normal, urgent, critical), purpose text, details text, source_reliability char(1) default 'F', info_credibility smallint default 6, note text null, status text (new, in_progress, answered, rejected) default 'new', answer_document_id uuid null references documents, requester_id text default 'admin', created_at, updated_at.
- request_attachments: id, request_id (on delete cascade), storage_key, name, mime, size.

Форма (поля и подписи ровно такие):

- İdarə (выбор из списка; список в src/lib/departments.ts, пока заглушки [İdarə 1…5], реальный список даст пользователь), Tarix (по умолчанию сегодня), Təcililik dərəcəsi (Adi, Təcili, Çox təcili), Məqsəd, Məlumat, Mənbənin etibarlılıq dərəcəsi, Məlumatın etibarlılıq dərəcəsi, Xüsusi qeyd, вложения (PDF, DOCX, JPG, PNG, WebP, до 10 МБ, до 10 штук, хранятся в Storage через StorageProvider, в поиск не попадают).
- Обязательные: İdarə, Tarix, Təcililik, Məqsəd, Məlumat. Остальное необязательно. Валидация zod на клиенте и сервере, сообщения на азербайджанском. Кнопки «Sorğunu göndər» и «Ləğv et».

Список «Mənim sorğularım»:

- Карточки с темой (первые слова поля Məlumat), idarə, датой, срочностью и статусом (Gözləyir, İcradadır, Cavablandırılıb, Rədd edilib). Обновление по опросу.
- Один пользователь, поэтому в V1 админ сам может менять статус (простой выпадающий список на карточке) и привязать ответ: выбрать существующий документ, статус станет answered, на карточке появится «Sənədi aç». Это демонстрационный сценарий.
- Страница /sorgu/$id: все поля, вложения (подписанные ссылки), статус, привязанный документ.
- Удаление запроса с подтверждением (чистит вложения).

Не делаем в V1: роли исполнителя, уведомления, email, SLA и сроки, комментарии, поиск по запросам.

### E. Изменения этапов

- Этап 1 (документы): добавь поля достоверности (раздел B).
- Этап 2 (поиск): добавь бейджи, фильтр, промпт (раздел C).
- НОВЫЙ Этап 3, «Məlumat sorğusu» (раздел D). OSINT становится Этапом 4, финал Этапом 5.
- Критерии готовности нового этапа: заявка с вложением сохраняется, видна в списке, открывается на странице; смена статуса и привязка документа работают; ссылка «Sənədi aç» ведёт на документ.
- Критерий этапов 1–2: для документа с оценкой D/5 в ответе появляется оговорка о низкой достоверности, а карточка показывает «Mənbə D», «Məlumat 5».

### F. Меню

Порядок: Analitika, OSINT, Məlumat sorğusu, Sənədlər, Ayarlar.
