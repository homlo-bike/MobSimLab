import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (zu). */
export const workspaceUiZu = {
  "checks.menu": "Ukuhlola",
  "checks.menuCount": "Ukuhlola: amaphutha angu-{errors}, izexwayiso ezingu-{warnings}",
  "checks.title": "Ukuhlola kwazo zonke izindlela",
  "checks.none":
    "Akukho okokuhlola okwamanje. Dweba ulayini, ujantshi noma idepho, ukuhlola kwakho kuzovela lapha.",
  "checks.lastOpened": "njengoba bekunjalo ekuvulweni kokugcina",
  "checks.streetLine": "Ulayini womgwaqo · {name}",
  "checks.railway": "Ujantshi",
  "checks.depot": "Idepho · {name}",
  "undo.undo": "Hlehlisa",
  "undo.redo": "Phinda",
  "tour.checks.title": "Ukuhlola",
  "tour.checks.body":
    "Insimbi ibala ukuhlola kwazo zonke izindlela, amaphutha kuqala: olayini bomgwaqo, ujantshi, amadepho nolayini bama-plugin. Khetha okukodwa ukuze ubone ukuthi kukuphi.",
  "settings.serverTab": "Iseva",
  "settings.server.local":
    "I-MobSimLab isebenza kule khompyutha. Esikhundleni salokho ungaxhuma lolu hlelo neseva ye-MobSimLab esebenza ngemuva, njengeseva ye-Docker.",
  "settings.server.address": "Ikheli leseva",
  "settings.server.connect": "Xhuma",
  "settings.server.note":
    "Uhlelo luhlola iseva futhi lubuze ngaphambi kokushintsha. Amaphrojekthi akule khompyutha ahlala lapha: wahambise ngokuwagcina njengamafayela e-.mslab. Ungabuyela kuZilungiselelo zohlelo (⌘, noma Ctrl+,).",
} satisfies WorkspaceUiMessages;
