import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (tr). */
export const workspaceUiTr = {
  "checks.menu": "Denetimler",
  "checks.menuCount": "Denetimler: {errors} hata, {warnings} uyarı",
  "checks.title": "Tüm modların denetimleri",
  "checks.none":
    "Henüz denetlenecek bir şey yok. Bir hat, demiryolu ya da depo çizin, denetimleri burada görünür.",
  "checks.lastOpened": "son açıldığındaki haliyle",
  "checks.streetLine": "Karayolu hattı · {name}",
  "checks.railway": "Demiryolu",
  "checks.depot": "Depo · {name}",
  "undo.undo": "Geri al",
  "undo.redo": "Yinele",
  "tour.checks.title": "Denetimler",
  "tour.checks.body":
    "Zil tüm modların denetimlerini, önce hatalar olmak üzere listeler: karayolu hatları, demiryolu, depolar ve eklentilerin hatları. Nerede olduğunu görmek için birini seçin.",
  "settings.serverTab": "Sunucu",
  "settings.pluginsTab": "Eklentiler",
  "settings.server.local":
    "MobSimLab bu bilgisayarda çalışıyor. Bunun yerine bu uygulamayı arka planda çalışan bir MobSimLab sunucusuna, örneğin Docker sunucusuna bağlayabilirsiniz.",
  "settings.server.address": "Sunucu adresi",
  "settings.server.connect": "Bağlan",
  "settings.server.note":
    "Uygulama sunucuyu denetler ve geçmeden önce sorar. Bu bilgisayardaki projeler burada kalır: onları .mslab dosyası olarak kaydedip taşıyın. Uygulamanın Ayarlar'ından (⌘, veya Ctrl+,) geri dönebilirsiniz.",
  "settings.plugins.intro":
    "Bu MobSimLab için eklenti kurun. Ardından her proje bunları kendi Proje tercihlerinde açar veya kapatır.",
} satisfies WorkspaceUiMessages;
