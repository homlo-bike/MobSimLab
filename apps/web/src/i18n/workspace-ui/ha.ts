import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (ha). */
export const workspaceUiHa = {
  "checks.menu": "Bincike",
  "checks.menuCount": "Bincike: kurakurai {errors}, gargaɗi {warnings}",
  "checks.title": "Binciken dukkan hanyoyi",
  "checks.none":
    "Babu abin da za a bincika tukuna. Zana layi, layin dogo ko tasha, binciken sa zai bayyana a nan.",
  "checks.lastOpened": "kamar yadda yake lokacin buɗewa ta ƙarshe",
  "checks.streetLine": "Layin titi · {name}",
  "checks.railway": "Layin dogo",
  "checks.depot": "Tasha · {name}",
  "undo.undo": "Soke",
  "undo.redo": "Maimaita",
  "tour.checks.title": "Bincike",
  "tour.checks.body":
    "Ƙararrawa tana jera binciken dukkan hanyoyi, kurakurai da farko: layukan titi, layin dogo, tashoshi da layukan ƙari. Zaɓi ɗaya don ganin inda yake.",
  "settings.serverTab": "Sabar",
  "settings.server.local":
    "MobSimLab yana gudana a wannan kwamfuta. Maimakon haka za ka iya haɗa wannan manhaja da sabar MobSimLab da ke gudana a bayan fage, kamar sabar Docker.",
  "settings.server.address": "Adireshin sabar",
  "settings.server.connect": "Haɗa",
  "settings.server.note":
    "Manhajar tana bincika sabar kuma tana tambaya kafin ta canza. Ayyukan da ke wannan kwamfuta suna nan: matsar da su ta hanyar ajiye su a matsayin fayilolin .mslab. Za ka iya komawa a Saitunan manhajar (⌘, ko Ctrl+,).",
} satisfies WorkspaceUiMessages;
