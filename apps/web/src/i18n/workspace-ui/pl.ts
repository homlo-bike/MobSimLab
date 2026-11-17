import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (pl). */
export const workspaceUiPl = {
  "checks.menu": "Kontrole",
  "checks.menuCount": "Kontrole: błędy {errors}, ostrzeżenia {warnings}",
  "checks.title": "Kontrole wszystkich trybów",
  "checks.none":
    "Na razie nie ma czego sprawdzać. Narysuj linię, kolej lub zajezdnię, a jej kontrole pojawią się tutaj.",
  "checks.lastOpened": "stan z ostatniego otwarcia",
  "checks.streetLine": "Linia uliczna · {name}",
  "checks.railway": "Kolej",
  "checks.depot": "Zajezdnia · {name}",
  "undo.undo": "Cofnij",
  "undo.redo": "Ponów",
  "tour.checks.title": "Kontrole",
  "tour.checks.body":
    "Dzwonek pokazuje kontrole wszystkich trybów, najpierw błędy: linie uliczne, kolej, zajezdnie i linie wtyczek. Wybierz jedną, aby zobaczyć, gdzie jest.",
  "settings.serverTab": "Serwer",
  "settings.pluginsTab": "Wtyczki",
  "settings.server.local":
    "MobSimLab działa na tym komputerze. Zamiast tego możesz połączyć tę aplikację z serwerem MobSimLab działającym w tle, na przykład z serwerem Docker.",
  "settings.server.address": "Adres serwera",
  "settings.server.connect": "Połącz",
  "settings.server.note":
    "Aplikacja sprawdzi serwer i zapyta przed przełączeniem. Projekty na tym komputerze zostaną tutaj: przenieś je, zapisując jako pliki .mslab. Wrócić możesz w Ustawieniach aplikacji (⌘, lub Ctrl+,).",
  "settings.plugins.intro":
    "Instaluj wtyczki dla tego MobSimLab. Następnie każdy projekt włącza je lub wyłącza w swoich Preferencjach projektu.",
} satisfies WorkspaceUiMessages;
