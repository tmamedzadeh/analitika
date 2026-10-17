export const az = {
  actions: {
    home: "Ana səhifəyə qayıt",
    retry: "Yenidən cəhd et",
  },
  notFound: {
    title: "Səhifə tapılmadı",
    description: "Axtardığınız səhifə mövcud deyil və ya başqa yerə köçürülüb.",
  },
  error: {
    title: "Səhifə yüklənmədi",
    description: "Xəta baş verdi. Səhifəni yeniləyə və ya ana səhifəyə qayıda bilərsiniz.",
    serverMessage: "Səhifə yüklənərkən xəta baş verdi. Bir az sonra yenidən cəhd edin.",
  },
  reliability: {
    source: {
      A: "Tam etibarlı",
      B: "Adətən etibarlı",
      C: "Kifayət qədər etibarlı",
      D: "Adətən etibarsız",
      E: "Etibarsız",
      F: "Qiymətləndirilmir",
    },
    information: {
      1: "Təsdiqlənib",
      2: "Ehtimal olunan həqiqi",
      3: "Ola bilər",
      4: "Şübhəli",
      5: "Ehtimal olunmayan",
      6: "Qiymətləndirilmir",
    },
    lowReliabilityWarning: "bu məlumat aşağı etibarlılıq dərəcəsinə malikdir",
  },
} as const;
