import type { MslabMessages } from "./en";

/** .mslab project file messages (it). */
export const mslabIt = {
  "menu.saveMslab": "Salva come file .mslab",
  "home.openMslab": "Apri file .mslab",
  "home.openingMslab": "Apertura del file…",
  "home.openedMslab": "«{name}» aperto come nuovo progetto.",
  "home.leftOut": "Escluso: {list}",
  "mslab.body":
    "Salva disegni, preferenze, scenari e plugin del progetto in un unico file che puoi riaprire in qualsiasi MobSimLab.",
  "mslab.runs": "Includi le simulazioni salvate (il file sarà più grande)",
  "mslab.map":
    "Includi i dati della mappa per il visualizzatore statico: strade, edifici, popolazione e dati del paese dell’area del progetto (file più grande; può richiedere alcuni minuti)",
  "static.empty":
    "Questo sito non ha ancora progetti. Metti i file .mslab nella sua cartella projects ed esegui tools/add-projects.mjs.",
  "mslab.save": "Salva file",
} satisfies MslabMessages;
