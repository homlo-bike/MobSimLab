import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (it). */
export const workspaceUiIt = {
  "checks.menu": "Controlli",
  "checks.menuCount": "Controlli: {errors} errori, {warnings} avvisi",
  "checks.title": "Controlli di tutte le modalità",
  "checks.none":
    "Ancora niente da controllare. Disegna una linea, una ferrovia o un deposito e i suoi controlli appariranno qui.",
  "checks.lastOpened": "come all’ultima apertura",
  "checks.streetLine": "Linea stradale · {name}",
  "checks.railway": "Ferrovia",
  "checks.depot": "Deposito · {name}",
  "undo.undo": "Annulla",
  "undo.redo": "Ripeti",
  "tour.checks.title": "Controlli",
  "tour.checks.body":
    "La campanella elenca i controlli di tutte le modalità, prima gli errori: linee stradali, ferrovia, depositi e linee dei plugin. Scegline uno per vedere dove si trova.",
  "settings.serverTab": "Server",
  "settings.server.local":
    "MobSimLab è in esecuzione su questo computer. In alternativa puoi collegare questa app a un server MobSimLab in esecuzione in background, come il server Docker.",
  "settings.server.address": "Indirizzo del server",
  "settings.server.connect": "Connetti",
  "settings.server.note":
    "L’app controlla il server e chiede conferma prima di passare. I progetti su questo computer restano qui: spostali salvandoli come file .mslab. Puoi tornare indietro nelle Impostazioni dell’app (⌘, o Ctrl+,).",
} satisfies WorkspaceUiMessages;
