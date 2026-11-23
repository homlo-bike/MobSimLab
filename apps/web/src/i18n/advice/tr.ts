import type { AdviceMessages } from "./en";

/** Advice messages (tr). */
export const adviceTr = {
  "advice.title": "İyileştirilecekler",
  "advice.intro":
    "Bu çalıştırmanın bulduğu sorunlar, en ciddisi önce, ve her biri için neler yapabileceğiniz.",
  "advice.none": "İyileştirilecek bir şey yok: bu çalıştırma darboğaz ya da sorun bulmadı.",
  "advice.show": "Haritada göster",
  "advice.more": "{n} tane daha gösterilmiyor.",
  "advice.severity.problem": "Sorun",
  "advice.severity.warning": "Uyarı",
  "advice.crowdMap": "Araçların doluluğunu haritada göster (her hattın en yoğun saati)",
  "advice.cap.stopped": "{line}: çalıştırma durdu: {problem}",
  "advice.cap.stoppedFix": "Bunu demiryolu aracında düzeltin, sonra testi yeniden çalıştırın.",
  "advice.cap.unplaced": "{line}: raylara sığmayan seferler: {n}",
  "advice.cap.unplacedFix":
    "Bu dönemde hattı daha seyrek çalıştırın ya da trenlerine karşılaştıkları yerde daha fazla yer verin: {terminal} istasyonunda daha fazla peron hattı veya makas bağlantısı ya da tek hatta bir geçiş yeri.",
  "advice.cap.terminal":
    "{line}: {terminal} son istasyonu darboğaz, en yoğun saatin {share} kadarında dolu (sınır {limit})",
  "advice.cap.terminalFix":
    "Trenler peron hatlarını çok uzun süre işgal ediyor. Dönüşü kısaltın (daha kısa bekleme ya da her uçta bekleyen bir makinist), bir peron hattı ekleyin ya da trenlerin daha erken boşaltması için makas bağlantısını perona yaklaştırın.",
  "advice.cap.section":
    "{line}: {section} hat kesimi darboğaz, en yoğun saatin {share} kadarında dolu (sınır {limit})",
  "advice.cap.sectionFix":
    "Trenler bu kesimi diğerlerinden daha uzun işgal ediyor. Burada daha yüksek hız kesimi daha erken boşaltmalarını sağlar; aksi halde burada daha az tren çalıştırın.",
  "advice.cap.sectionPlatform":
    "Bu kesim bir peron hattı: trenler peronda durdukları sürece onu işgal eder. Orada daha kısa duruşlar ya da bu yön için ikinci bir peron hattı, sonraki treni daha erken içeri alır.",
  "advice.cap.sectionSwitches":
    "Bu kesim bir makas bölgesi: trenler makaslar üzerinden güzergâhları kurulup çözülürken onu işgal eder. Sapan kolda daha yüksek hızlı makaslar ya da iki yönün birbirini kesmeyeceği şekilde yerleştirilmiş makaslar onu daha erken boşaltır.",
  "advice.cap.signalAdd":
    "Bu açık hat kesimi {length} m uzunluğunda, ama {speed} km/sa hızda bir blok için yalnızca {block} m gerekir. {track} hattında yaklaşık {at} m noktasına bir blok sinyali ekleyin ki sonraki tren ilk yarıya daha erken girebilsin.",
  "advice.cap.signalShort":
    "Bu kesim {length} m uzunluğunda, {speed} km/sa hızda {block} m'lik iki bloktan kısa; bu yüzden bir sinyal daha durmak için çok az yer bırakır. Trenler kabin sinyalizasyonuyla (CBTC veya ETCS seviye 2) ya da burada daha düşük hızla birbirini daha yakından izleyebilir.",
  "advice.cap.sectionCab":
    "Kabin sinyalizasyonunda trenler zaten fren mesafesinde izler ({speed} km/sa hızda {block} m); aralığı sinyaller belirlemez. Kesimde daha yüksek hız ya da daha az tren onu daha erken boşaltır.",
  "advice.cap.sectionSight":
    "Tramvaylar burada görüşe göre ilerler, bu yüzden aralığı sinyaller belirlemez. Yakındaki duruşları kısaltmak ya da trafikten ayrılmış kendi yolu onu daha erken boşaltır.",
  "advice.cap.nearNote": "Hâlâ çalışıyor ama tren eklemek için çok az yer var.",
  "advice.cap.pileUp": "{line}: gecikmeler birikiyor ve dönem sonunda ortalama hâlâ {late}",
  "advice.cap.pileUpFix":
    "Son istasyonlarda telafi süresi ekleyin ya da biraz daha seyrek çalıştırın ki geciken bir tren sonrakini tutmasın.",
  "advice.cap.full": "{line}: araçlar {from} ile {to} arasında {share} dolu, {time}",
  "advice.cap.fullMore":
    "Dönem boyunca {left} kişi geride kalıyor. Hat her yönde saatte {n} trene kadar izin veriyor: daha sık çalıştırın ya da daha uzun trenler kullanın.",
  "advice.cap.fullLonger":
    "Dönem boyunca {left} kişi geride kalıyor. Hat izin veriyorsa daha sık çalıştırın ya da daha uzun araçlar kullanın.",
  "advice.cap.streetPileUp": "{line}: gecikmeler sokakta birikiyor ve sonunda hâlâ {late}",
  "advice.cap.streetPileUpFix":
    "Tur için daha fazla süre ya da son duraklarda daha uzun bekleme planlayın ki araçlar açığı kapatabilsin; en çok, trafikle karşılaştığı yerde ayrılmış bir şerit yardımcı olur.",
  "advice.road.cannotRun": "{line} çalışamadı",
  "advice.road.cannotRunFix":
    "{problem}. Hattı Oluştur → Karayolu hatları altında düzeltin, sonra yeniden çalıştırın.",
  "advice.road.late": "{line}: kalkışların yalnızca {share} kadarı zamanında ({limit} altında öneri)",
  "advice.road.mostlySignals":
    "Her sefer kırmızı ışıkta {signals} dk ve trafikte {traffic} dk kaybediyor; yani çoğu burada listelenen trafik ışıklarında.",
  "advice.road.mostlyTraffic":
    "Her sefer trafikte {traffic} dk ve kırmızı ışıkta {signals} dk kaybediyor; yani çoğu burada listelenen sokaklarda.",
  "advice.road.moreTime":
    "Tur, planlanan {planned} dk yerine {run} dk sürdü: daha fazla sefer süresi planlayın ya da bir araç ekleyin.",
  "advice.road.bunched": "{line}: kalkışların {share} kadarı yığılmış geliyor",
  "advice.road.bunchedFix":
    "Araçlar birbirine yetişiyor. Onları son duraklarda tarifeye göre bekletin, orada daha uzun bekleme verin ya da hattın zaman kaybettiği yerde ona ayrılmış bir şerit verin.",
  "advice.road.ranOut": "{line}: şarjı biten araçlar: {n}",
  "advice.road.ranOutFix":
    "Daha büyük bir batarya kullanın, son duraklarda şarj edin ya da gün içinde araçları değiştirin.",
  "advice.road.stuck": "{line}: 5 dakika veya daha uzun takılı kalan araçlar: {n}",
  "advice.road.stuckFix":
    "CBS sekmesinde bu yerdeki sokak düzenini ve trafik ışıklarını kontrol edin: bir dönüş eksik olabilir ya da trafik kavşağı tıkıyor.",
  "advice.road.notBack": "{line}: sonunda garaja dönmeyen araçlar: {n}",
  "advice.road.notBackFix":
    "Hat ile garajı arasındaki güzergâhı kontrol edin ya da son seferden sonra daha fazla süre bırakın.",
  "advice.road.unnamedStreet": "adsız bir sokak",
  "advice.road.unnamedJunction": "bir kavşak",
  "advice.road.spot.signal": "Kırmızı ışık, {place}: toplam {min} dk kayıp ({lines})",
  "advice.road.spot.signalFix":
    "Hatlar burada başka her yerden daha uzun bekliyor. Bu ışıkta onlar için öncelik ya da onlara uygun sinyal süreleri isteyin. Yol simülasyonu henüz önceliği modellemiyor, bu yüzden kazancı gösteremez.",
  "advice.road.spot.street": "Trafik, {place}: toplam {min} dk kayıp ({lines})",
  "advice.road.spot.streetFix":
    "Hatlara bu sokakta ayrılmış bir şerit verin (CBS sekmesi, sokak düzeni: otobüs şeridi) ya da onları başka bir sokaktan geçirin.",
  "advice.road.spot.junction": "Bekleme, {place}: toplam {min} dk kayıp ({lines})",
  "advice.road.spot.junctionFix":
    "Araçlar bu kavşağın içinde dönmek ya da çıkışın açılması için bekliyor. Kavşağa kadar ayrılmış bir şerit ya da ışıklarda ayrı bir dönüş fazı yardımcı olur.",
} satisfies AdviceMessages;
