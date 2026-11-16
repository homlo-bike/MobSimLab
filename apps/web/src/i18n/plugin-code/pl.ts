import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (pl). */
export const pluginCodePl = {
  "pcode.title": "Obliczenia wtyczek",
  "pcode.intro":
    "Obliczenia zainstalowanych wtyczek. Działają w piaskownicy w przeglądarce, bez dostępu do internetu ani innych projektów.",
  "pcode.by": "{plugin} · od {publisher}",
  "pcode.run": "Oblicz",
  "pcode.running": "Obliczanie…",
  "pcode.failed": "{plugin} nie mógł obliczyć: {error}",
  "pcode.noRows": "Brak wierszy.",
  "pcode.log": "Dziennik wtyczki ({count} wierszy)",
  "pcode.import": "Importuj {label} ({plugin})",
  "pcode.export": "Pobierz jako {label} ({plugin})",
  "pcode.importFailed": "{plugin} nie mógł odczytać pliku: {error}",
  "pcode.exportFailed": "{plugin} nie mógł zapisać pliku: {error}",
  "pcode.frameTitle": "{tab}, strona wtyczki {plugin}",
  "pcode.frameNote":
    "Ta strona pochodzi z wtyczki {plugin} od {publisher}. Nie ma dostępu do internetu ani do Twojego konta.",
  "pcode.runsCode": "Uruchamia własny kod w piaskownicy",
  "pcode.limits": "Limity kodu wtyczek",
  "pcode.limitsIntro":
    "Każde wywołanie kodu wtyczki dostaje najwyżej tyle pamięci i czasu, w przeglądarce i na serwerze.",
  "pcode.memory": "Pamięć (MB)",
  "pcode.time": "Czas (sekundy)",
  "pcode.saveLimits": "Zapisz limity",
  "pcode.saved": "Zapisano.",
  "pcode.installIntro":
    "Prześlij plik .msplugin. MobSimLab sprawdza go i pokazuje, co dodaje, przed instalacją. Wtyczki mogą dodawać środki transportu, narzędzia, parametry i źródła oraz uruchamiać własny kod (obliczenia, importy, eksporty i strony kart) w piaskownicy bez dostępu do internetu.",
} satisfies PluginCodeMessages;
