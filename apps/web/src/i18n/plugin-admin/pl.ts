import type { pluginAdminEn } from "./en";

/** Polski: messages of the Plugins tab of Administration. */
export const pluginAdminPl: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro": "Wtyczki tego MobSimLab. Wtyczka wyłączona tutaj jest wyłączona w każdym projekcie.",
  "padmin.publishers": "Wydawcy i limity",
  "padmin.configure": "Konfiguruj",
  "padmin.configureName": "Konfiguruj {name}",
  "padmin.useName": "Używaj {name} w tym MobSimLab",
  "padmin.offEverywhere": "Wyłączona w każdym projekcie",
  "padmin.needsKey": "Wymaga klucza API",
  "padmin.accept": "Zatwierdź zmiany",
  "padmin.services": "Usługi używane przez tę wtyczkę",
  "padmin.nothingToSet":
    "Ta wtyczka nie ma nic do ustawienia. Każdy projekt włącza ją lub wyłącza w Preferencjach projektu.",
  "padmin.versions": "Zainstalowane wersje",
  "padmin.undo": "Cofnij",
  "padmin.removedOnAccept": "Klucz zostanie usunięty po zatwierdzeniu zmian.",
  "padmin.changedOnAccept": "Zmieni się po zatwierdzeniu zmian.",
  "padmin.keyReplace": "Wpisz nowy klucz, aby zastąpić zapisany",
  "padmin.esriTermsFirst": "Zaakceptuj warunki korzystania Esri, aby zapisać klucz.",
  "padmin.offByAdmin": "Wyłączona w tym MobSimLab przez administratora.",
};
