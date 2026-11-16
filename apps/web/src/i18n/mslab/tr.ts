import type { MslabMessages } from "./en";

/** .mslab project file messages (tr). */
export const mslabTr = {
  "menu.saveMslab": ".mslab dosyası olarak kaydet",
  "home.openMslab": ".mslab dosyası aç",
  "home.openingMslab": "Dosya açılıyor…",
  "home.openedMslab": "“{name}” yeni proje olarak açıldı.",
  "home.leftOut": "Alınmayanlar: {list}",
  "mslab.body":
    "Projenin çizimlerini, tercihlerini, senaryolarını ve eklentilerini herhangi bir MobSimLab’da yeniden açabileceğiniz tek bir dosyaya kaydeder.",
  "mslab.runs": "Kayıtlı simülasyon çalıştırmalarını ekle (dosya büyür)",
  "mslab.map":
    "Statik görüntüleyici için harita verilerini ekle: proje alanının sokakları, binaları, nüfusu ve ülke verileri (dosya büyür; birkaç dakika sürebilir)",
  "static.empty":
    "Bu sitede henüz proje yok. .mslab dosyalarını projects klasörüne koyun ve tools/add-projects.mjs dosyasını çalıştırın.",
  "mslab.save": "Dosyayı kaydet",
} satisfies MslabMessages;
