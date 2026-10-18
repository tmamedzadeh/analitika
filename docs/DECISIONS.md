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

## 2026-10-17 — Mərhələ 2: analitik axtarış

- Axtarış vektor, PostgreSQL full-text və pg_trgm nəticələrini paralel alır, hər siyahıdan ən çox 50 fraqment götürür, RRF (k=60) ilə birləşdirir və ilk 10 fraqmenti cavaba verir. Etibarlılıq qiymətləri sıralamaya təsir etmir.
- Vektor namizədlərinə kosinus məsafəsi 0.4-dən kiçik həddi tətbiq olunur; demo korpusunda uyğun və korpusdan kənar sualları ayıran sınaq bunu seçdi. Tam mətn və trigram uyğunluğu ayrıca namizəd verə bilər.
- Dövr, teq, sənəd və etibarlılıq filtrləri hər namizəd SQL sorğusuna birləşmədən əvvəl tətbiq olunur; sorğular `accessFilter()`-dən keçir. Etibarlılıq hədləri A/E kimi seçildikdə həmin qiymətdən daha yaxşı və ya bərabər qiymətlər daxil edilir; məlumat şkalasında 1-dən seçilmiş qiymətədək olanlar daxil edilir. “Hamısı” əlavə şərt yaratmır.
- Sənədlər sxemində idarə/şöbə sütunu yoxdur. Buna görə maketdəki “İdarə” filtri əlavə edilməyib; reallaşdırılan filtrlər brief-dəki dövr, teq və sənəd, həmçinin əlavə brief-dəki iki etibarlılıq həddidir.
- Server əvvəl SSE ilə mənbələri göndərir, sonra yalnız həmin fraqmentlərlə cavabı axınla yaradır. Yekunda olmayan [n] istinadlar silinir və cavab natamam kimi işarələnir. Aşağı qiymətli mənbə cavabda istinad edilərsə Azərbaycan dilində xəbərdarlıq əlavə olunur.
- Analitik cavab Gemini 3/4 modellərində `thinkingLevel: low` ilə yaradılır: bu qısa, mənbəyə bağlı sintez üçün gecikməni azaltmağa yönəlib. Gemini 2.5 modeli seçilərsə bu parametr ötürülmür.
- Demo korpusu yalnız sintetik, Azərbaycan dilində altı sənəddən ibarətdir və `demo-synthetic` teqi ilə seçilir. `bun run db:seed:demo -- --clean` yalnız bu sabit demo sənədlərini və onların fraqmentlərini silir.

## 2026-10-17 — Mərhələ 3: məlumat sorğuları

- `info_requests` və `request_attachments` cədvəlləri mərhələ 0-da tək `0000_stage_0.sql` miqrasiyasına daxil edildiyi üçün bu mərhələdə yeni miqrasiya yaradılmır.
- Sorğu əlavələri sənəd əlavələrindən ayrı `request_attachments` cədvəlində və ayrıca `requests/{requestId}/...` Storage açarları altında saxlanılır; analitika indeksinə daxil edilmir.
- Brauzer PDF, DOCX və şəkilləri birbaşa özəl Storage-a imzalı PUT URL ilə yükləyir. Sorğu qəbul edilməzdən əvvəl server `HeadObject` ilə fayl ölçüsünü və MIME tipini yoxlayır; tələb yarımçıq qalsa, qaralama və yüklənən obyektlər təmizlənir.
- İdarə siyahısı istifadəçidən faktiki dəyərlər gələnədək `src/lib/departments.ts` daxilində `[İdarə 1…5]` müvəqqəti seçimlərindən ibarətdir.
- Cavab sənədi kimi yalnız indekslənməsi bitmiş (`ready`) sənədlər seçilə bilər. Sənəd seçildikdə sorğunun statusu avtomatik `answered` olur; cavab sənədi silindikdə, həmin status `in_progress`-ə qaytarılır.

## 2026-10-18 — Axtarışda seçmə rerank

- Rerank `RerankProvider` interfeysi ilə ayrıca saxlanılır; Gemini LIGHT implementasiyası RRF-dən sonrakı ən çox 30 fraqmentin hər birindən yalnız 500 simvoladək çıxarış alır və schema ilə məhdudlaşdırılmış JSON ID siyahısı qaytarır. Nəticədə ilk 10 fraqment istifadə olunur.
- `ENABLE_RERANK` standart olaraq `false` qalır. Aktiv rerank bir axtarışda ən çox bir Gemini çağırışı edir, ümumi Gemini limitterindən keçir, 4 saniyədə dayandırılır və xətada/429-da ilkin RRF sırasına qayıdır. Sorğuların, cavabların və sənəd mətnlərinin axtarış loguna yazılması deaktivdir.
- `db:eval:rerank` üzrə 20 sintetik azərbaycandilli sual (2 cədvəl fraqmenti daxil olmaqla): həm RRF, həm də LIGHT rerank üçün hit@3/hit@5/hit@10 100%, MRR 1.000; orta axtarış gecikməsi 1.564 s və 2.627 s; əlavə LLM çağırışı 20/20 sual, orta əlavə gecikmə 1.063 s.
- Gemini LIGHT structured-JSON provider üçün ayrıca sintetik yoxlama uğurla keçib; modeldən gələn JSON cavabları prompt və çıxış mətnini göstərmədən təsdiqlənib.
- Top-5 artımı 0 faiz-bəndidir, yəni aktivləşdirmə üçün tələb olunan ən az 10 faiz-bənd şərti ödənmir. Buna görə production konfiqurasiyasında flag söndürülmüş qalır. Demo korpusu cəmi altı sintetik sənəddən ibarət olduğuna görə ölçmələr orientirdir; aktivləşdirmə üzrə yekun qərar istifadəçinindir.

## 2026-10-18 — İdarə bölmələri

- `src/lib/departments.ts` idarələrin ID və görünən adları üçün yeganə mənbədir. Sənəd və məlumat sorğusu formaları DB-də yalnız `d1`–`d5` saxlayır; `info_requests.department` üçün əvvəlki görünən adlar `0002_idare_departments.sql` miqrasiyasında ID-lərə çevrilir.
- `0000_stage_0.sql` və mövcud `0001_stage_1_document_progress.sql` dəyişdirilmir. Mövcud `0001` artıq miqrasiya tarixçəsində olduğuna görə yeni dəyişiklik `0002_idare_departments.sql` kimi əlavə edilir. Mövcud sənədlərin və əvvəlki demo sənədlərinin `department` dəyəri `NULL` qalır; demo seed yenidən qurulduqda altı sintetik sənəd dörd idarə arasında bölüşdürülür.
- Axtarışda idarə seçimi bir və ya bir neçə ID ilə məhdudlaşır və şərt vektor, full-text və trigram namizədlərinin hər SQL sorğusuna, `accessFilter()` ilə birlikdə, RRF birləşməsindən əvvəl tətbiq edilir. Bütün idarələr seçildikdə idarə şərti əlavə edilmir ki, `NULL` bölməli köhnə sənədlər də axtarıla bilsin.
- Axtarış UI-sində sənəd üzrə ayrıca filtr çıxarılır; istifadəçi `Dövr`, `Teqlər`, `İdarə` və birləşdirilmiş `Etibarlılıq` nəzarətlərindən istifadə edir.

## 2026-10-18 — Exa OSINT və provayderdən asılı olmayan tapşırıqlar

- Exa üçün rəsmi sənədlər yoxlanıldı: [`POST https://api.exa.ai/search`](https://docs.exa.ai/reference/search), sorğu növü `auto` — sürət və nəticə keyfiyyəti üçün ümumi tövsiyədir. OSINT hər dil üçün maksimum 5 nəticə istəyir. Tarix aralığı `startPublishedDate` / `endPublishedDate` ISO-8601 sahələri ilə ötürülür. Səhifə mətni cavabdakı `results[].text`, seçilmiş hissələr isə `results[].highlights` sahələrində gəlir; cavabda `url`, `title`, `publishedDate` də var. Exa API indeks vermir, tətbiq nəticə sırasından 1-dən başlayan mənbə indeksini özü yaradır.
- Search API-də `language` parametri yoxdur. Sorğu əvvəlcə hər seçilmiş dilə ayrıca çevrilir; `userLocation` həmin dil üçün ölkəni (fa→IR, hy→AM, ru→RU, zh→CN, en→US, fr→FR) göstərərək nəticəni lokallaşdırır. Ölkə lokalizasiyası dili zəmanətlə filtrləmir; kartdakı dil axtarış sorğusunun dilidir, nəticənin səhifə dili ayrıca təsdiqlənmir.
- Qiymətlər Exa-nın [rəsmi pricing səhifəsindən](https://exa.ai/pricing) götürülüb: Search `auto` $7/1000 sorğuya qədər 10 nəticə üçün; məzmun çıxarışı $1/1000 səhifə/hər məzmun növü. Pulsuz plan ayda $10 kredit və yeni hesab üçün əlavə $10 bonus, Search API və 10 QPS verir. Qiymət/plan dəyişə bildiyinə görə canlı tarif həmin səhifədən yenidən yoxlanmalıdır.
- Gemini Search Grounding adapteri alternativ olaraq saxlanılır (`SEARCH_PROVIDER=gemini_grounding`); standart `exa`-dır. Gemini modelləri yalnız `GEMINI_*_MODEL` env dəyişənlərindən oxunur. Ümumi LLM limitləyicisi eyni anda maksimum 3 Gemini sorğusunu saxlayır, 429 cavabını `Retry-After` və eksponensial fasilə ilə yenidən yoxlayır; OSINT sorğusuna maksimum 8 axtarış və 10 Gemini çağırışı ayrılır.
- OSINT məntiqi `src/server/jobs/run-osint.ts` daxilində Inngest-dən asılı olmayan funksiya olaraq qalır; `src/server/inngest/` yalnız `runId` qəbul edən nazik wrapper-ları saxlayır. Lokal kontura keçəndə Inngest-i Postgres növbəsi və ya self-hosted Inngest ilə dəyişmək üçün iş məntiqini yenidən yazmaq tələb olunmur. Hadisələrdə mətn ötürülmür, irəliləyiş və yükləmə statusları DB-də saxlanır.
- `osint_runs.pinned` demo axtarışını müddətsiz saxlayır. Eyni sorğu parametrləri ilə təkrar axtarış pinned nəticəni xarici çağırış olmadan verir; «Yenilə» kəşfiyyat təzələməsi üçün keşi ötürür. `bun run osint:pin "<sorğu>"` tamamlanmış nəticəni demo üçün sabitləyir.
- Qwen inteqrasiyası V1 kodundan çıxarılır. Onun açıq çəkili lokal versiyası V2-də OpenAI-uyğun adapter (vLLM və ya Ollama) ilə qayıda bilər; Gemini və Exa adapter interfeysləri bunun üçün provayder müstəqildir.

### Qwen müqayisəsinin tarixi nəticələri (koddan çıxarılmış əvvəlki sınaq)

- Altı sintetik demo sənədi üzərində 40 sual: Gemini Hit@3/5/10 = 87.5% / 87.5% / 87.5%, MRR 0.850, retrieval orta 1496 ms, ümumi orta 1549 ms, 3 embedding API çağırışı; provayder token istifadəsini verməyib. Qwen `qwen3.7-text-embedding`: Hit@3/5/10 = 60% / 60% / 60%, MRR 0.600, retrieval orta 1216 ms, ümumi orta 1248 ms, 3 embedding API çağırışı və 2897 giriş tokeni.
- Əvvəlki Qwen OSINT sürət sınağında «regional danışıqlar» sorğusu 270.4 saniyə çəkib və qismən bitib; «nəqliyyat dəhlizləri» sınağı 144.6 saniyədə dayandırılıb. Birinci nəticə daha yavaş olub; bu tarixi ölçmələr Exa və cari Gemini iş axınının göstəricisi deyil. Həmin sınaq kiçik sintetik olmayan canlı veb nümunəsindən ibarət idi.
- Bu rəqəmlər kiçik demo korpusunda aparılmış orientir sınağındandır və model seçimi üçün ümumiləşdirilməməlidir. Cari, Qwen-siz qiymətləndirmə dəsti `src/server/analytics/retrieval-eval-questions.ts`-də 40 sual və 5 korpusdan kənar sual saxlayır; `bun run db:eval:retrieval` yalnız Gemini ilə retrieval-i ölçür.

### Exa canlı yoxlaması

- İki neytral OSINT sorğusu canlı Exa və Gemini ilə yoxlanıldı; hər biri üçün Exa 6 axtarış, Gemini 8 LLM çağırışı etdi. Sorğu başına müddət 47.1 s və 46.1 s oldu. Hər iki nəticə pinned cache-ə yazıldı və eyni sorğunun təkrarı cache hit olaraq, 0 xarici çağırışla tamamlandı.
- Regional danışıqlar mövzusunda mənbələr: fa 5, hy 3, ru 4, zh 2, en 5, fr 2. Nəqliyyat dəhlizləri mövzusunda: fa 5, hy 4, ru 4, zh 1, en 3, fr 2. Beləliklə, hər iki sorğuda altı dilin hamısında nəticə gəldi; Çin dilində nəticə sayı ən zəif oldu.
- Exa 21 və 19 səhifənin mətnini axtarış cavabında verdi; özümüzün tam səhifə yükləməsi 0, yalnız snippet-ə düşmə 0 oldu. Regional sorğuda bir fransız URL-i təhlükəsizlik yoxlamasında `invalid_url` kimi rədd edildi və həmin tək mənbəyə təsir etdi; digər addımlar uğurla tamamlandı. Nəqliyyat sorğusunda uğursuz addım olmadı.
- Regional sorğuda Gemini 18,283 giriş / 4,564 çıxış tokeni; nəqliyyat sorğusunda 16,981 giriş / 5,378 çıxış tokeni bildirdi. Token sayları provayderin usage metadatasından götürülüb.
- Canlı qiymətləndirmə kiçik nümunədir. API qiymətləri dəyişə bilər; büdcə üçün Exa-nın cari rəsmi tarif səhifəsini yoxlamaq lazımdır. Nəticələr qəbul meyarlarına (ən az 4/6 dildə mənbə, 60 saniyədən az, işlənməmiş xəta yoxdur) uyğundur.

## 2026-10-18 — Gündəlik xülasələr

- Lovable maketləri və onların dizayn sinifləri saxlanıldı. Fayl marşrutlarının mövcud adları istifadə olunur: siyahı `/`, analitika axtarışı `/axtaris`, açıq brif `/brifler/$id`, əlavə etmə `/brifler/yeni`, redaktə `/brifler/$id/redakte`. Beləliklə, istəkdəki `/brif/$id` adından fərqli olaraq layihənin cəm şəkilli `/brifler/` marşrutları qorunur.
- Briflərdə ACL və təsnifat yoxdur. Bu, yalnız sintetik demo məlumatları ilə V1 üçün qəbul ediləndir; real məlumatdan əvvəl V1.1-də briflərə giriş nəzarəti və məxfilik qrifi əlavə olunmalıdır.
- `0004_daily_briefs.sql` əvvəlki `0000`–`0003` miqrasiyalarına toxunmadan `daily_briefs` və `brief_attachments` cədvəllərini yaradır. `chunks.document_id` nullable olur, `brief_id` əlavə edilir və CHECK məhz birinin dolu olmasını tələb edir. Bir cədvəldə ümumi fraqment sırası və embedding axtarışı saxlamaq üçün iki ayrı mənbə FK-sı seçildi; hər brif silindikdə onun fraqmentləri cascade ilə silinir.
- Brif şəkilləri yalnız JPEG, PNG və WebP-dir, maksimum 10 MB və 10 obyekt. Brauzer obyektləri özəl S3-uyğun Storage-a qısaömürlü, MIME ilə məhdudlaşdırılmış PUT URL ilə yükləyir. Server `HeadObject` metadatasını və ilk 12 baytı yoxlayaraq MIME-i fayl imzasından təsdiqləyir; görüntüləmə linki bir saatlıq imzalı URL-dir.
- Yeni briflərdə `brief_date` Asia/Baku təqvimi ilə “bu gün” hesablanır və DB-də unikal olduğundan qaralama da eyni tarixdə ikinci brifə mane olur. Siyahı 12 nəticəni tarixə görə azalan istiqamətdə cursor ilə verir; axtarış başlıq/mətn üçün ILIKE və trigram istifadə edir.
- Yalnız `published` və `ready` indeksli brif fraqmentləri analitika axtarışına qoşulur. Dövr filtri brifin `brief_date` dəyərinə tətbiq olunur; İdarə və Etibarlılıq filtri aktiv olanda həmin sahələri olmayan briflər nəticədən çıxarılır. Teqlər brifləri məhdudlaşdırmır. Sənəd və brif namizədləri RRF-dən əvvəl SQL-də filtrlənir və bütün sorğular `accessFilter()`-dən keçir.
- Brif indeksləməsi `src/server/jobs/index-brief.ts` daxilində adi funksiya, DB-də saxlanan addım/progress və Gemini embedding-lərdən ibarətdir. Inngest wrapper-i yalnız `briefId` olan hadisəni qəbul edir və işi çağırır. `draft` keçidi və silmə brif fraqmentlərini təmizləyir; yayımlama və redaktə yenidən indeksləmə yaradır.
- Brif mətnləri və imzalı Storage URL-ləri tətbiq loglarına yazılmır. Route xətası üçün ümumi error boundary yalnız sabit, payload-siz mesaj yazır; DB parametrli xəta obyektlərini loglamır.
- `bun run db:seed:demo` altı sintetik brif yaradır (son altı Bakı tarixi, bir qaralama, süni fotoşəkillər də daxil). `bun run db:seed:demo --clean` həmin demo brifləri, şəkilləri, sənədləri və fraqmentlərini silir.

## 2026-10-18 — UI adları və görünən statuslar

- Naviqasiyadakı `Sənədlər` bölməsinin görünən adı `Analitik məlumatlar` olur. Mövcud `/senedler` marşrutları, sənəd modeli və sənədlə bağlı əməliyyat adları dəyişmir.
- Tətbiq yalnız açıq rəng sxemindən istifadə edir; tema dəyişdiricisi, seçim yaddaşı və qaranlıq tema sinifləri yoxdur.
- Briflərin `draft` və `published` statusları DB, API və indeksləmə iş axınında qalır, UI-də status nişanları və mətnləri göstərilmir. Qaralama saxlama əməliyyatı neytral `Yadda saxla` etiketi ilə işləyir.
- Gündəlik briflər siyahısında `Bu gün` etiketi göstərilmir; cari tarixli brif varsa, siyahıda birinci qalır.
- Gündəlik briflərdə ay filtri yalnız ay və ili seçən 12 aylıq seçim şəbəkəsidir; düymədə `Okt 2026` formatı göstərilir, sorğu dəyəri `YYYY-MM` olaraq saxlanır.
- Sənəd və məlumat sorğusu formalarında gün seçimi tətbiqin `az` lokallı təqvimindən istifadə edir; seçilmiş tarix sabit `28 Okt 2026` formatında göstərilir.
- Gündəlik brif və sənəd mətnləri alətlər paneli ilə minimal Markdown formatlamasını (qalın, kursiv, markerli və nömrəli siyahı, sitat) dəstəkləyir. Markdown verilənlərdə saxlanır və material səhifələrində formatlanmış şəkildə göstərilir.
- OSINT xülasələri, mənbə xülasələri və analitika sintezi Markdown kimi render olunur; analitika sintezindəki `[n]` istinadları mənbələrə keçid olaraq qalır.
- Analitika axtarışından seçilmiş fraqment UID-si sənəd və brif səhifəsində müvafiq mətn hissəsini vurğulayır və ona avtomatik sürüşdürür. Sənəd səhifəsində fraqment sayı axtarış indeksi üçün mətn hissələrinin sayını göstərir.
- OSINT nəticələrinin saxlanması backend-də dəyişməz qalır, UI isə demo/sabitləmə göstəricisini göstərmir; keşlənmiş nəticə üçün ümumi bildiriş istifadə olunur.

## 2026-10-18 — V1 kod auditi

- V1 tək `admin` istifadəçisi ilə işləyir: `getCurrentUser()` sabit identifikator qaytarır, `accessFilter()` hazırda əlavə SQL məhdudiyyəti yaratmır. `DEMO_BASIC_AUTH` sayt səviyyəsində giriş qapısıdır, fərdi istifadəçi kimliyi və ACL deyil. Bu model yalnız sintetik demo üçün uyğundur; real və ya məxfi məlumatdan əvvəl autentifikasiya, sətir səviyyəli giriş qaydaları və təsnifat tətbiq olunmalıdır.
- Analitika rate limiter-i proses yaddaşındakı `Map`-də IP üzrə 60 saniyəlik pəncərədə 20 sorğu saxlayır. Vercel instansiyaları arasında paylaşılmadığı üçün bunu qlobal büdcə zəmanəti saymaq olmaz; daha böyük istifadə və ya real məlumatdan əvvəl paylaşılan Postgres/Redis limitinə keçirilməlidir.
- Server və sənəd yükləmə xətalarının loglaması mesaj, stack, səbəb zənciri və obyekt məzmununu çıxarmır; yalnız xəta sinfi və varsa HTTP statusu saxlanılır. Bu, provayder xətalarına açar və göndərilmiş mətnin əlavə olunması riskini azaldır.
- Yoxlamalar: `bun run lint` 0 xəta ilə keçdi (6 mövcud Fast Refresh xəbərdarlığı UI primitivlərindədir), `bun run test` 16 fayl/66 test keçdi, `bunx tsc --noEmit --pretty false` və `bun run build` uğurlu oldu.
