import { ar } from "./ar";
import { de } from "./de";
import { en, type MessageKey, type Messages, type PluralKey } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { nl } from "./nl";
import { pt } from "./pt";
import { ru } from "./ru";
import { sw } from "./sw";
import { ha } from "./ha";
import { am } from "./am";
import { yo } from "./yo";
import { ig } from "./ig";
import { zu } from "./zu";
import { hi } from "./hi";
import { bn } from "./bn";
import { ur } from "./ur";
import { mr } from "./mr";
import { te } from "./te";
import { ta } from "./ta";
import { uz } from "./uz";
import { kk } from "./kk";
import { ja } from "./ja";
import { ko } from "./ko";
import { id } from "./id";
import { vi } from "./vi";
import { fa } from "./fa";
import { tr } from "./tr";
import { it } from "./it";
import { pl } from "./pl";
import { uk } from "./uk";
import { zh } from "./zh";

export type { MessageKey, Messages, PluralKey };

/** All shell translations by language tag. Each must have every English key (enforced by `Messages`). */
export const MESSAGES = {
  en,
  ar,
  de,
  es,
  fr,
  nl,
  pt,
  ru,
  zh,
  sw,
  ha,
  am,
  yo,
  ig,
  zu,
  hi,
  bn,
  ur,
  mr,
  te,
  ta,
  uz,
  kk,
  ja,
  ko,
  id,
  vi,
  fa,
  tr,
  it,
  pl,
  uk,
} satisfies Record<string, Messages>;
