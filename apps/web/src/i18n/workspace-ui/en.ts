/**
 * English messages of the project's top bar (undo, redo, the checks of every mode) and the Server and Plugins tabs
 * of Settings. Merged into each language's dictionary; every language has its own file next to this one.
 */
export const workspaceUiEn = {
  "checks.menu": "Checks",
  "checks.menuCount": "Checks: {errors} errors, {warnings} warnings",
  "checks.title": "Checks of every mode",
  "checks.none": "Nothing to check yet. Draw a line, a railway or a depot and its checks appear here.",
  "checks.lastOpened": "as when last open",
  "checks.streetLine": "Street line · {name}",
  "checks.railway": "Railway",
  "checks.depot": "Depot · {name}",
  "undo.undo": "Undo",
  "undo.redo": "Redo",
  "tour.checks.title": "Checks",
  "tour.checks.body":
    "The bell lists the checks of every mode, errors first: street lines, the railway, depots and the plugins’ lines. Pick one to see where it is.",
  "settings.serverTab": "Server",
  "settings.server.local":
    "MobSimLab runs on this computer. You can connect this app to a MobSimLab server running in the background instead, such as the Docker server.",
  "settings.server.address": "Server address",
  "settings.server.connect": "Connect",
  "settings.server.note":
    "The app checks the server and asks before it switches. Projects on this computer stay here: move them by saving them as .mslab files. You can switch back in the app’s Settings (⌘, or Ctrl+,).",
} as const;

export type WorkspaceUiMessages = Record<keyof typeof workspaceUiEn, string>;
