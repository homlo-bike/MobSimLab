import type { AreaMessages } from "./en";

/** Project area messages (tr). */
export const areaTr = {
  "aw.title": "Proje alanı",
  "aw.editing": "{name} alanı düzenleniyor",
  "aw.search": "Haritayı taşımak için bir yer arayın, örneğin Humus",
  "aw.tools": "Çizim araçları",
  "aw.draw": "Çokgen çiz",
  "aw.edit": "Noktaları düzenle",
  "aw.pan": "Kaydır",
  "aw.hint.draw":
    "Köşe eklemek için tıklayın. Çokgeni kapatmak için ilk köşeye tıklayın veya Enter'a basın. Geri tuşu son köşeyi kaldırır.",
  "aw.hint.edit":
    "Seçmek için bir çokgene tıklayın. Taşımak için bir köşeyi sürükleyin, köşe eklemek için bir orta noktayı sürükleyin, kaldırmak için bir köşeye çift tıklayın.",
  "aw.hint.pan": "Haritayı taşımak için sürükleyin. Seçmek için bir çokgene tıklayın.",
  "aw.statArea": "Alan",
  "aw.statDownload": "Tahmini indirme",
  "aw.mb": "{mb} MB",
  "aw.limit": "Sınır {mb} MB",
  "aw.overLimit":
    "Alan, bir projenin tutabileceği {mb} MB'tan fazla harita verisi içeriyor. Küçültün ya da güzergâhlar boyunca çokgenleri yalnızca ana yollar ve demiryolları yapın.",
  "aw.polygons": "Çokgenler",
  "aw.empty":
    "Henüz çokgen yok. Projenin kapsadığı her yerin çevresine bir tane, her şehirlerarası güzergâh boyunca da dar bir tane çizin.",
  "aw.detail.full": "Tam",
  "aw.detail.main": "Yalnızca ana yollar ve demiryolları",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "Ad",
  "aw.detail": "Ayrıntı",
  "aw.fullHelp": "Sokaklar, yollar, binalar, okullar ve hastaneler, 100 m'de nüfus, arazi.",
  "aw.mainHelp":
    "Otoyollar, ana ve birincil yollar, demiryolları, arazi, 1 km'de nüfus. Bina yok: gürültü haritası ve yürüme erişimi için güzergâh üzerindeki yerleşimleri Tam olarak çizin.",
  "aw.delete": "Çokgeni sil",
  "aw.newName": "Alan {n}",
  "aw.save": "Alanı kaydet",
  "aw.confirm.title": "Yeni kısımlar için harita verisi indirilsin mi?",
  "aw.confirm.body":
    "Yeni veya değişen: {list}. Yaklaşık {mb} MB gerekiyor. Kaldırılan kısımlar artık kullanılmaz. Siz onaylayana kadar hiçbir şey indirilmez.",
  "aw.confirm.item": "{name} ({detail}, {area} km²)",
  "aw.confirm.back": "Haritaya dön",
  "aw.confirm.save": "Kaydet ve {mb} MB indir",
  "aw.select": "Alan seç",
  "aw.selectHint": "Projenin sınırlarını haritada çizin. Harita verisi yalnızca bunların içinde indirilir.",
  "aw.change": "Alanı değiştir",
  "aw.download": "yaklaşık {mb} MB harita verisi",
  "aw.outline": "Proje alanının ana hatları",
  "aw.prefsIntro":
    "Projenin çevresine çizilen çokgenler. Harita verisi yalnızca bunların içinde, her çokgenin ayrıntısında indirilir.",
  "aw.dataFrom": "{date} tarihli harita verisi",
  "aw.noData": "Harita verisi henüz indirilmedi",
  "aw.editArea": "Alanı düzenle",
  "aw.drawArea": "Alan çiz",
  "aw.refresh": "Harita verisini yenile",
  "aw.refreshHelp":
    "Yenile, aynı alan için güncel OpenStreetMap verisini indirir; o zamana kadar plan veri tarihini korur.",
  "aw.none": "Henüz proje alanı yok. Araçların harita verisi olması için bir tane çizin.",
  "aw.saved": "Alan kaydedildi.",
  "aw.data.noArea": "Önce Proje tercihleri'nde proje alanını çizin: içe aktarmalar onu kapsar.",
  "aw.data.area": "Proje alanı: {names}. İçe aktarmalar çevresindeki dikdörtgeni kapsar, {area} km².",
  "aw.pop.none": "Henüz proje alanı yok. Proje tercihleri'nde çizin.",
  "aw.pop.box": "Proje alanının çevresindeki dikdörtgen: {km2} km².",
  "aw.tiles.other": "{count} harita karosu",
  "aw.count.other": "{count} çokgen",
} satisfies AreaMessages;
