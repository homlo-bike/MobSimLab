import type { pluginAdminEn } from "./en";

/** Nederlands: messages of the Plugins tab of Administration. */
export const pluginAdminNl: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro": "Plug-ins van dit MobSimLab. Een plug-in die u hier uitzet, staat in elk project uit.",
  "padmin.publishers": "Uitgevers en limieten",
  "padmin.configure": "Instellen",
  "padmin.configureName": "{name} instellen",
  "padmin.useName": "{name} gebruiken in dit MobSimLab",
  "padmin.offEverywhere": "Uit in elk project",
  "padmin.needsKey": "Heeft een API-sleutel nodig",
  "padmin.accept": "Wijzigingen accepteren",
  "padmin.services": "Diensten die deze plug-in gebruikt",
  "padmin.nothingToSet":
    "Deze plug-in heeft niets in te stellen. Elk project zet hem aan of uit in Projectvoorkeuren.",
  "padmin.versions": "Geïnstalleerde versies",
  "padmin.undo": "Ongedaan maken",
  "padmin.removedOnAccept": "De sleutel wordt verwijderd wanneer u de wijzigingen accepteert.",
  "padmin.changedOnAccept": "Gewijzigd wanneer u de wijzigingen accepteert.",
  "padmin.keyReplace": "Typ een nieuwe sleutel om de opgeslagen te vervangen",
  "padmin.esriTermsFirst": "Accepteer de gebruiksvoorwaarden van Esri om de sleutel op te slaan.",
  "padmin.offByAdmin": "Uitgezet voor dit MobSimLab door een beheerder.",
};
