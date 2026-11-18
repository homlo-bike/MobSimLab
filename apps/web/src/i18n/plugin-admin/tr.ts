import type { pluginAdminEn } from "./en";

/** Türkçe: messages of the Plugins tab of Administration. */
export const pluginAdminTr: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro": "Bu MobSimLab'in eklentileri. Burada kapattığınız bir eklenti her projede kapalıdır.",
  "padmin.publishers": "Yayıncılar ve sınırlar",
  "padmin.configure": "Yapılandır",
  "padmin.configureName": "{name} yapılandır",
  "padmin.useName": "{name} bu MobSimLab'de kullanılsın",
  "padmin.offEverywhere": "Her projede kapalı",
  "padmin.needsKey": "API anahtarı gerekiyor",
  "padmin.accept": "Değişiklikleri kabul et",
  "padmin.services": "Bu eklentinin kullandığı hizmetler",
  "padmin.nothingToSet":
    "Bu eklentide ayarlanacak bir şey yok. Her proje onu Proje tercihlerinde açar veya kapatır.",
  "padmin.versions": "Yüklü sürümler",
  "padmin.undo": "Geri al",
  "padmin.removedOnAccept": "Değişiklikleri kabul ettiğinizde anahtar kaldırılır.",
  "padmin.changedOnAccept": "Değişiklikleri kabul ettiğinizde değişir.",
  "padmin.keyReplace": "Kayıtlı anahtarın yerine yeni bir anahtar yazın",
  "padmin.esriTermsFirst": "Anahtarı kaydetmek için Esri'nin kullanım koşullarını kabul edin.",
  "padmin.offByAdmin": "Bir yönetici tarafından bu MobSimLab için kapatıldı.",
};
