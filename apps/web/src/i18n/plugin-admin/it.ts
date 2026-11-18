import type { pluginAdminEn } from "./en";

/** Italiano: messages of the Plugins tab of Administration. */
export const pluginAdminIt: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro": "Plugin di questo MobSimLab. Un plugin disattivato qui è disattivato in ogni progetto.",
  "padmin.publishers": "Editori e limiti",
  "padmin.configure": "Configura",
  "padmin.configureName": "Configura {name}",
  "padmin.useName": "Usa {name} in questo MobSimLab",
  "padmin.offEverywhere": "Disattivato in ogni progetto",
  "padmin.needsKey": "Serve una chiave API",
  "padmin.accept": "Accetta le modifiche",
  "padmin.services": "Servizi usati da questo plugin",
  "padmin.nothingToSet":
    "Questo plugin non ha nulla da configurare. Ogni progetto lo attiva o lo disattiva nelle Preferenze del progetto.",
  "padmin.versions": "Versioni installate",
  "padmin.undo": "Annulla",
  "padmin.removedOnAccept": "La chiave viene rimossa quando accetti le modifiche.",
  "padmin.changedOnAccept": "Cambia quando accetti le modifiche.",
  "padmin.keyReplace": "Scrivi una nuova chiave per sostituire quella salvata",
  "padmin.esriTermsFirst": "Accetta le condizioni d'uso di Esri per salvare la chiave.",
  "padmin.offByAdmin": "Disattivato per questo MobSimLab da un amministratore.",
};
