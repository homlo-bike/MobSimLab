import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (tr). */
export const pluginCodeTr = {
  "pcode.title": "Eklenti hesapları",
  "pcode.intro":
    "Kurulu eklentilerin hesapları. Tarayıcınızda, internete ve diğer projelere erişimi olmayan bir korumalı alanda çalışırlar.",
  "pcode.by": "{plugin} · {publisher}",
  "pcode.run": "Hesapla",
  "pcode.running": "Hesaplanıyor…",
  "pcode.failed": "{plugin} hesaplayamadı: {error}",
  "pcode.noRows": "Satır yok.",
  "pcode.log": "Eklenti günlüğü ({count} satır)",
  "pcode.import": "{label} içe aktar ({plugin})",
  "pcode.export": "{label} olarak indir ({plugin})",
  "pcode.importFailed": "{plugin} dosyayı okuyamadı: {error}",
  "pcode.exportFailed": "{plugin} dosyayı yazamadı: {error}",
  "pcode.frameTitle": "{tab}, {plugin} eklentisinin bir sayfası",
  "pcode.frameNote":
    "Bu sayfa {publisher} tarafından yayımlanan {plugin} eklentisinden gelir. İnternete ve hesabınıza erişemez.",
  "pcode.runsCode": "Kendi kodunu korumalı alanda çalıştırır",
  "pcode.limits": "Eklenti kodu sınırları",
  "pcode.limitsIntro":
    "Eklenti kodunun her çağrısı, tarayıcıda ve sunucuda en fazla bu kadar bellek ve süre alır.",
  "pcode.memory": "Bellek (MB)",
  "pcode.time": "Süre (saniye)",
  "pcode.saveLimits": "Sınırları kaydet",
  "pcode.saved": "Kaydedildi.",
  "pcode.installIntro":
    ".msplugin dosyası yükleyin. MobSimLab dosyayı denetler ve kurmadan önce ne eklediğini gösterir. Eklentiler ulaşım türleri, araçlar, parametreler ve kaynaklar ekleyebilir ve kendi kodlarını (hesaplar, içe ve dışa aktarmalar, sekme sayfaları) internet erişimi olmayan bir korumalı alanda çalıştırabilir.",
} satisfies PluginCodeMessages;
