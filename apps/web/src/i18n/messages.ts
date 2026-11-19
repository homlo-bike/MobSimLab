import { loadPluginTexts } from "../plugins/texts";
import { loadParamTexts } from "./params";
import { en, type MessageKey, type Messages, type PluralKey } from "./en";

export type { MessageKey, Messages, PluralKey };

/** English, always in the first download: the fallback for every missing message and the list of keys. */
export const MESSAGES_EN = en;

/**
 * The other languages, each its own download, fetched only when it is shown. Each must have every English key
 * (enforced by `Messages`).
 */
const LOADERS = {
  ar: () => import("./ar").then((m) => m.ar),
  de: () => import("./de").then((m) => m.de),
  es: () => import("./es").then((m) => m.es),
  fr: () => import("./fr").then((m) => m.fr),
  nl: () => import("./nl").then((m) => m.nl),
  pt: () => import("./pt").then((m) => m.pt),
  ru: () => import("./ru").then((m) => m.ru),
  zh: () => import("./zh").then((m) => m.zh),
  sw: () => import("./sw").then((m) => m.sw),
  ha: () => import("./ha").then((m) => m.ha),
  am: () => import("./am").then((m) => m.am),
  yo: () => import("./yo").then((m) => m.yo),
  ig: () => import("./ig").then((m) => m.ig),
  zu: () => import("./zu").then((m) => m.zu),
  hi: () => import("./hi").then((m) => m.hi),
  bn: () => import("./bn").then((m) => m.bn),
  ur: () => import("./ur").then((m) => m.ur),
  mr: () => import("./mr").then((m) => m.mr),
  te: () => import("./te").then((m) => m.te),
  ta: () => import("./ta").then((m) => m.ta),
  uz: () => import("./uz").then((m) => m.uz),
  kk: () => import("./kk").then((m) => m.kk),
  ja: () => import("./ja").then((m) => m.ja),
  ko: () => import("./ko").then((m) => m.ko),
  id: () => import("./id").then((m) => m.id),
  vi: () => import("./vi").then((m) => m.vi),
  fa: () => import("./fa").then((m) => m.fa),
  tr: () => import("./tr").then((m) => m.tr),
  it: () => import("./it").then((m) => m.it),
  pl: () => import("./pl").then((m) => m.pl),
  uk: () => import("./uk").then((m) => m.uk),
} satisfies Record<string, () => Promise<Messages>>;

/** Tags of the languages that have messages: English and every language in `LOADERS`. */
export const MESSAGE_LANGUAGES = ["en", ...Object.keys(LOADERS)] as const;

const loaded: Record<string, Messages | undefined> = { en };
const pending: Record<string, Promise<Messages> | undefined> = {};

/** Purpose: a language's messages if they are already downloaded, else undefined. */
export function messagesOf(tag: string): Messages | undefined {
  return loaded[tag];
}

/**
 * Purpose: download a language's messages once and keep them, with the bundled plugins' translations and the
 * parameter names.
 * Output: the messages; English for a tag without its own file. A failed download can be tried again.
 */
export function loadMessages(tag: string): Promise<Messages> {
  const have = loaded[tag];
  if (have) return Promise.resolve(have);
  const load = (LOADERS as Record<string, (() => Promise<Messages>) | undefined>)[tag];
  if (!load) return Promise.resolve(en);
  pending[tag] ??= Promise.all([load(), loadPluginTexts(tag), loadParamTexts(tag)]).then(
    ([m]) => (loaded[tag] = m),
    (e: unknown) => {
      pending[tag] = undefined;
      throw e;
    },
  );
  return pending[tag];
}
