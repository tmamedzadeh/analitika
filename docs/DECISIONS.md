# Qərarlar

## 2026-10-17 — Mərhələ 0 və əlavə

- documents.status, osint_runs.status və osint_sources.source_type üçün PostgreSQL enum-ları istifadə olunur. Beləliklə, icazəli dəyərləri verilənlər bazası qoruyur.
- Analitika və OSINT üçün ayrı konfiqurasiya sahələri saxlanılır; mərhələ 0-da hər ikisi GEMINI_CHAT_MODEL dəyişənindən oxunur. Yüngül tapşırıqlar və embedding ayrıca dəyişənlərdən seçilir.
- Gemini model ID-ləri rəsmi sənədlə yoxlanılıb: GEMINI_CHAT_MODEL=gemini-3.8-flash, GEMINI_LIGHT_MODEL=gemini-3.5-flash-lite, GEMINI_EMBED_MODEL=gemini-embedding-2. Embedding 2 çıxış ölçülüyünü 768-ə endirməyi dəstəkləyir və bu ölçü tövsiyə edilən ölçülər sırasındadır. Mənbə: https://ai.google.dev/gemini-api/docs/models və https://ai.google.dev/gemini-api/docs/embeddings.
- Embedding ölçüsü 768 saxlanılır. gemini-embedding-2 taskType qəbul etmir; adapter sənəddən və sorğudan embedding alarkən modelə uyğun tapşırıq təlimatını mətnə əlavə edir. GEMINI_EMBED_MODEL gemini-embedding-001 seçilərsə, adapter rəsmi RETRIEVAL_DOCUMENT və RETRIEVAL_QUERY taskType-larını ötürür.
- Dəqiqlik sahələri DB-də NULL olmur: source_reliability üçün standart F, info_credibility üçün standart 6; icazə verilən dəyərlər CHECK məhdudiyyətləri ilə qorunur. Formada bu seçimlər buraxıla bilər.
- Məlumat sorğuları info_requests və request_attachments cədvəllərində saxlanılır. Etibarlılıq göstəriciləri sənədlərlə eyni şkala və standartlardan istifadə edir.
- Tətbiq DATABASE_URL ilə Supabase Transaction pooler-ə qoşulur. Drizzle miqrasiyaları yalnız DATABASE_URL_MIGRATE istifadə edir; bu dəyişən Supabase Session pooler və ya birbaşa DB bağlantısı üçündür.
- Əlavə brif mərhələləri yenidən nömrələyir: Məlumat sorğusu — mərhələ 3, OSINT — mərhələ 4, yekun — mərhələ 5. Şöbələrin faktiki siyahısı verilməyənədək mərhələ 3-də müvəqqəti dəyərlər istifadə olunacaq.
- Vercel build üçün Nitro vercel preset-i sabit seçilir.
- Mərhələ 0 yalnız provider interfeyslərini və adapterləri yaradır; xarici xidmətlərə qoşulma açarları istifadəçi konfiqurasiyasından sonra yoxlanacaq.

## 2026-10-17 — Fon tapşırıqlarının quruluşu

- İndeksləmə və OSINT kimi fon tapşırıqlarının məntiqi Inngest-dən asılı olmayan adi funksiyalar kimi `src/server/jobs/*.ts` daxilində yazılır. Hər iş aydın addımlara bölünür və gedişat DB-də saxlanılır.
- `src/server/inngest/` yalnız nazik Inngest adapterlərini saxlayır; adapterlər işi başladan funksiyaları çağırır, tapşırıq məntiqini özündə daşımır.
- Inngest hadisələrində yalnız identifikatorlar (`documentId`, `runId`) ötürülür. Sənəd mətni, sorğu mətni və cavablar hadisə payload-ına daxil edilmir.
- Lokal kontura keçid zamanı tapşırıq məntiqinə toxunmadan Inngest-i Postgres növbəsi və ya self-hosted Inngest ilə əvəzləmək mümkün olmalıdır.

## 2026-10-17 — Sənədlərin yüklənməsi və indekslənməsi

- Sənəd emalının `step` və `progress` göstəriciləri `documents` cədvəlində saxlanılır; beləliklə siyahı yenilənəndə proses server yaddaşından asılı olmur.
- Fotoşəkillər üçün server 5 dəqiqəlik, yalnız həmin obyektə və MIME tipinə bağlı S3 PUT imzalı URL yaradır. Brauzer faylı birbaşa özəl Storage-a yükləyir; server yükləmədən sonra S3 `HeadObject` ilə ölçü və MIME tipini yoxlayır. Bu, 10 MB-a qədər faylları Vercel server funksiyasının sorğu gövdəsindən keçirmir.
- Markdown fraqmentləri təxminən 450 tokenə (1800 simvola) qədər bölünür, 12% simvol örtüşməsi ilə; cədvəllər ayrıca qalır və bölünəndə başlıq sətrləri təkrarlanır. Fraqmentin mətn diapazonu orijinal sənədin simvol indeksləri ilə saxlanılır.
- Sənəd indeksi Inngest-də `document/indexing.requested` hadisəsi ilə işə düşür. Hadisədə yalnız `documentId` olur; bir sənəd üçün paralellik bir işlə məhdudlaşdırılır.
- Vercel-də `/api/inngest` serverless funksiyasının işləmə müddəti Nitro `vercel.functionRules` vasitəsilə 300 saniyə ilə məhdudlaşdırılıb.
