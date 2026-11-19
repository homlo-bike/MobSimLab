import type { MessageKey } from "../i18n/messages";

/**
 * Purpose: show the names the server gives on its own (the desktop app's instance and its one local person) in the
 * app's language. The server stores them in English; a name someone typed is shown as it is.
 */
const SERVER_DEFAULTS: Record<string, MessageKey> = {
  "This computer": "shell.thisComputer",
  "Local user": "shell.localUser",
};

export function serverName(t: (key: MessageKey) => string, name: string): string {
  const key = SERVER_DEFAULTS[name];
  return key ? t(key) : name;
}
