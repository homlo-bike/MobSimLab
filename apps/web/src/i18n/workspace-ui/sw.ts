import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (sw). */
export const workspaceUiSw = {
  "checks.menu": "Ukaguzi",
  "checks.menuCount": "Ukaguzi: makosa {errors}, maonyo {warnings}",
  "checks.title": "Ukaguzi wa njia zote",
  "checks.none": "Bado hakuna cha kukagua. Chora laini, reli au bohari na ukaguzi wake utaonekana hapa.",
  "checks.lastOpened": "kama ilivyokuwa ilipofunguliwa mwisho",
  "checks.streetLine": "Laini ya barabarani · {name}",
  "checks.railway": "Reli",
  "checks.depot": "Bohari · {name}",
  "undo.undo": "Tendua",
  "undo.redo": "Rudia",
  "tour.checks.title": "Ukaguzi",
  "tour.checks.body":
    "Kengele inaorodhesha ukaguzi wa njia zote, makosa kwanza: laini za barabarani, reli, bohari na laini za programu-jalizi. Chagua mmoja kuona ulipo.",
  "settings.serverTab": "Seva",
  "settings.server.local":
    "MobSimLab inaendeshwa kwenye kompyuta hii. Badala yake unaweza kuunganisha programu hii na seva ya MobSimLab inayoendeshwa chinichini, kama seva ya Docker.",
  "settings.server.address": "Anwani ya seva",
  "settings.server.connect": "Unganisha",
  "settings.server.note":
    "Programu hukagua seva na kuuliza kabla ya kubadilisha. Miradi iliyo kwenye kompyuta hii inabaki hapa: ihamishe kwa kuihifadhi kama faili za .mslab. Unaweza kurudi katika Mipangilio ya programu (⌘, au Ctrl+,).",
} satisfies WorkspaceUiMessages;
