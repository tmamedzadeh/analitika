export type EvalQuestion = { query: string; expectedDocumentIds: string[] };

const doc = (number: number) =>
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd" + String(number).padStart(4, "0");
export const retrievalEvalQuestions: EvalQuestion[] = [
  {
    query:
      "Pilotda su verilm\u0259si g\u00fcn\u00fcn daha erk\u0259n saatlar\u0131na \u00e7\u0259kil\u0259nd\u0259 ya\u015f\u0131ll\u0131\u011f\u0131n sa\u011flaml\u0131\u011f\u0131nda n\u0259 d\u0259yi\u015fdi?",
    expectedDocumentIds: [doc(1)],
  },
  {
    query:
      "S\u0259h\u0259r n\u00f6vb\u0259sin\u0259 ke\u00e7idd\u0259n \u0259vv\u0259lki h\u0259ft\u0259 il\u0259 m\u00fcqayis\u0259d\u0259 i\u015fl\u0259dil\u0259n suyun faizi nec\u0259 oldu?",
    expectedDocumentIds: [doc(1)],
  },
  {
    query:
      "Paytaxt ya\u015f\u0131ll\u0131q sah\u0259sind\u0259 bitkil\u0259rin g\u00f6r\u00fcn\u00fc\u015f\u00fc v\u0259ziyy\u0259t\u0259 g\u00f6r\u0259 nec\u0259 d\u0259yi\u015fdi?",
    expectedDocumentIds: [doc(1)],
  },
  {
    query:
      "G\u00fcn\u00fcn ilk hiss\u0259sind\u0259 suvarma apar\u0131lmas\u0131 resurs istifad\u0259sin\u0259 n\u0259 q\u0259d\u0259r t\u0259sir g\u00f6st\u0259rdi?",
    expectedDocumentIds: [doc(1)],
  },
  {
    query:
      "Park pilotunun h\u0259ft\u0259lik m\u00fcqayis\u0259sind\u0259 qeydə al\u0131nan azalma n\u0259 il\u0259 \u00f6l\u00e7\u00fcl\u00fcrd\u00fc?",
    expectedDocumentIds: [doc(1)],
  },
  {
    query:
      "\u00dc\u00e7 ya\u015fay\u0131\u015f m\u0259nt\u0259q\u0259sind\u0259 ax\u015famlar sakinl\u0259rin qar\u015f\u0131la\u015fd\u0131\u011f\u0131 d\u0259yi\u015fiklik n\u0259 idi?",
    expectedDocumentIds: [doc(2)],
  },
  {
    query:
      "Boru x\u0259ttind\u0259 t\u0259zyiq g\u00f6st\u0259ricil\u0259rinin izl\u0259nm\u0259si hans\u0131 texniki m\u0259qs\u0259d\u0259 xidm\u0259t etdi?",
    expectedDocumentIds: [doc(2)],
  },
  {
    query:
      "\u0130ki h\u0259ft\u0259lik s\u0131naq m\u00fcdd\u0259tind\u0259 nasaz hiss\u0259l\u0259r nec\u0259 m\u00fc\u0259yy\u0259n edildi?",
    expectedDocumentIds: [doc(2)],
  },
  {
    query:
      "Ax\u015fam saatlar\u0131nda su t\u0259chizat\u0131 il\u0259 ba\u011fl\u0131 m\u00fcraci\u0259tl\u0259rin s\u0259b\u0259bi n\u0259 say\u0131l\u0131rd\u0131?",
    expectedDocumentIds: [doc(2)],
  },
  {
    query:
      "M\u0259h\u0259ll\u0259l\u0259rd\u0259 su xidm\u0259tinin keyfiyy\u0259ti bar\u0259d\u0259 s\u0131naq n\u0259yi ara\u015fd\u0131r\u0131rd\u0131?",
    expectedDocumentIds: [doc(2)],
  },
  {
    query:
      "M\u0259ktubda t\u0259s\u0259rr\u00fcfat n\u0259tic\u0259sinin ikiqat olmas\u0131 hans\u0131 \u015f\u0259kild\u0259 iddia edilirdi?",
    expectedDocumentIds: [doc(3)],
  },
  {
    query: "\u0130ddian\u0131n arxas\u0131nda duran \u015f\u0259xsin kimliyi m\u0259lum idimi?",
    expectedDocumentIds: [doc(3)],
  },
  {
    query:
      "M\u0259hsuldarl\u0131q art\u0131m\u0131n\u0131n hesablanma qaydas\u0131 s\u0259n\u0259dd\u0259 nec\u0259 t\u0259svir olunur?",
    expectedDocumentIds: [doc(3)],
  },
  {
    query:
      "Anonim m\u0259nb\u0259d\u0259n g\u0259l\u0259n r\u0259q\u0259ml\u0259ri m\u00fcst\u0259qil yoxlama il\u0259 t\u0259sdiq ed\u0259n material varm\u0131?",
    expectedDocumentIds: [doc(3)],
  },
  {
    query:
      "S\u0259n\u0259din etibarl\u0131l\u0131\u011f\u0131n\u0131 z\u0259ifl\u0259d\u0259n m\u0259lumat bo\u015fluqlar\u0131 hans\u0131lard\u0131r?",
    expectedDocumentIds: [doc(3)],
  },
  {
    query:
      "M\u0259rk\u0259z mar\u015frutunda pik vaxt\u0131 \u0259lav\u0259 n\u0259qliyyat vasit\u0259si s\u0259rn\u0131\u015fin\u0259 nec\u0259 k\u00f6m\u0259k etdi?",
    expectedDocumentIds: [doc(4)],
  },
  {
    query:
      "C\u0259dv\u0259ld\u0259 ilkin g\u00f6zl\u0259m\u0259 il\u0259 s\u0131naqdan sonrak\u0131 g\u00f6zl\u0259m\u0259 aras\u0131ndak\u0131 f\u0259rq ne\u00e7\u0259 d\u0259qiq\u0259dir?",
    expectedDocumentIds: [doc(4)],
  },
  {
    query:
      "N\u0259qliyyat s\u0131na\u011f\u0131n\u0131n m\u00fc\u015fahid\u0259si hans\u0131 zaman aral\u0131\u011f\u0131nda apar\u0131lm\u0131\u015fd\u0131?",
    expectedDocumentIds: [doc(4)],
  },
  {
    query:
      "Mar\u015frut \u00fczr\u0259 g\u00f6zl\u0259m\u0259nin azalma miqdar\u0131n\u0131 c\u0259dv\u0259ld\u0259n tap.",
    expectedDocumentIds: [doc(4)],
  },
  {
    query:
      "Yeni avtobusun qo\u015fulmas\u0131 il\u0259 s\u0259rn\u0131\u015fin\u00e7\u0259nin dayanacaqdak\u0131 vaxt\u0131 n\u0259 q\u0259d\u0259r oldu?",
    expectedDocumentIds: [doc(4)],
  },
  {
    query:
      "T\u0259s\u0259rr\u00fcfat sah\u0259sind\u0259 suyun bitkiy\u0259 \u00e7atd\u0131r\u0131lmas\u0131 \u00fc\u00e7\u00fcn hans\u0131 \u00fcsuldan yararlan\u0131l\u0131b?",
    expectedDocumentIds: [doc(5)],
  },
  {
    query:
      "Suvarma texnikas\u0131 mayeni birba\u015fa bitkinin hans\u0131 hiss\u0259sin\u0259 y\u00f6n\u0259ldirdi?",
    expectedDocumentIds: [doc(5)],
  },
  {
    query:
      "N\u00fcmun\u0259 sah\u0259sind\u0259 su istifad\u0259sind\u0259 hans\u0131 istiqam\u0259td\u0259 n\u0259tic\u0259 g\u00f6r\u00fcld\u00fc?",
    expectedDocumentIds: [doc(5)],
  },
  {
    query:
      "S\u0259n\u0259dd\u0259 \u0259kinin verimliliyinin artmas\u0131 r\u0259q\u0259ml\u0259 t\u0259sdiql\u0259nirmi?",
    expectedDocumentIds: [doc(5)],
  },
  {
    query:
      "Pilotda suya q\u0259na\u0259t olsa da hans\u0131 iqtisadi g\u00f6st\u0259rici \u00f6l\u00e7\u00fclm\u0259yib?",
    expectedDocumentIds: [doc(5)],
  },
  {
    query:
      "Rayon kitabxanas\u0131n\u0131n r\u0259q\u0259msal s\u0131na\u011f\u0131nda kataloqa baxanlarla sifari\u015f ver\u0259nl\u0259rin say\u0131 nec\u0259 idi?",
    expectedDocumentIds: [doc(6)],
  },
  {
    query:
      "Onlayn kitab xidm\u0259tinin ilk ay\u0131nda kataloq istifad\u0259si ne\u00e7\u0259 ziyar\u0259t\u00e7i c\u0259lb etdi?",
    expectedDocumentIds: [doc(6)],
  },
  {
    query:
      "Elektron forma vasit\u0259sil\u0259 ay \u0259rzind\u0259 ne\u00e7\u0259 kitab sifari\u015fi qey\u0259 al\u0131nd\u0131?",
    expectedDocumentIds: [doc(6)],
  },
  {
    query:
      "C\u0259dv\u0259ld\u0259 kitab sifari\u015fl\u0259rinin kataloq bax\u0131\u015flar\u0131na nisb\u0259ti hans\u0131 saylarla verilib?",
    expectedDocumentIds: [doc(6)],
  },
  {
    query:
      "Kitabxana eyni s\u0131naqda elektron vasit\u0259 il\u0259 hans\u0131 iki xidm\u0259ti yoxlad\u0131?",
    expectedDocumentIds: [doc(6)],
  },
  {
    query:
      "Park pilotundak\u0131 suya q\u0259na\u0259t n\u0259tic\u0259sini t\u0259s\u0259rr\u00fcfat s\u0259n\u0259dind\u0259ki su istifad\u0259si m\u00fc\u015fahid\u0259si il\u0259 m\u00fcqayis\u0259 et.",
    expectedDocumentIds: [doc(1), doc(5)],
  },
  {
    query:
      "Boru t\u0259zyiqinin izl\u0259nm\u0259si il\u0259 mar\u015frut g\u00f6zl\u0259m\u0259 c\u0259dv\u0259li hans\u0131 ayr\u0131 probleml\u0259ri \u00f6l\u00e7\u00fcr?",
    expectedDocumentIds: [doc(2), doc(4)],
  },
  {
    query:
      "Anonim art\u0131m iddias\u0131 il\u0259 t\u0259s\u0259rr\u00fcfat pilotundak\u0131 \u00f6l\u00e7\u00fclm\u0259mi\u015f m\u0259hsul n\u0259tic\u0259sini etibarl\u0131l\u0131q bax\u0131m\u0131ndan m\u00fcqayis\u0259 et.",
    expectedDocumentIds: [doc(3), doc(5)],
  },
  {
    query:
      "Kitabxanan\u0131n elektron kataloqu v\u0259 mar\u015frut c\u0259dv\u0259li hans\u0131 r\u0259q\u0259msal v\u0259 n\u0259qliyyat istifad\u0259 g\u00f6st\u0259ricil\u0259rini verir?",
    expectedDocumentIds: [doc(4), doc(6)],
  },
  {
    query:
      "Su t\u0259chizat\u0131 s\u0131na\u011f\u0131ndak\u0131 iki h\u0259ft\u0259lik m\u00fc\u015fahid\u0259ni park pilotundak\u0131 h\u0259ft\u0259lik resurs m\u00fcqayis\u0259si il\u0259 yana\u015f\u0131 qoy.",
    expectedDocumentIds: [doc(1), doc(2)],
  },
  {
    query:
      "Az\u0259rbaycan\u0131n neft ixrac\u0131n\u0131n 2025-ci il \u00fczr\u0259 illik h\u0259cmi n\u0259 q\u0259d\u0259r olub?",
    expectedDocumentIds: [],
  },
  {
    query:
      "Paytaxt x\u0259st\u0259xanalar\u0131nda qrip peyv\u0259ndi \u00fczr\u0259 r\u0259smi statistik g\u00f6st\u0259ricil\u0259r hans\u0131lard\u0131r?",
    expectedDocumentIds: [],
  },
  {
    query:
      "\u00d6lk\u0259nin d\u00f6vl\u0259t b\u00fcdc\u0259sind\u0259 bu il m\u00fcdafi\u0259 x\u0259rcl\u0259ri ne\u00e7\u0259 manat t\u0259\u015fkil edir?",
    expectedDocumentIds: [],
  },
  {
    query:
      "X\u0259z\u0259r d\u0259nizinin s\u0259viyy\u0259sinin son onillikd\u0259ki d\u0259yi\u015fm\u0259si bar\u0259d\u0259 hans\u0131 statistik s\u0131ra var?",
    expectedDocumentIds: [],
  },
  {
    query:
      "M\u0259kt\u0259bl\u0259rd\u0259 m\u00fc\u0259llim maa\u015flar\u0131n\u0131n yeni tarif c\u0259dv\u0259li nec\u0259 d\u0259yi\u015fib?",
    expectedDocumentIds: [],
  },
];
