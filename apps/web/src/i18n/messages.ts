import { de } from "./de";
import { en, type MessageKey, type Messages } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { nl } from "./nl";

export type { MessageKey, Messages };

/** All shell translations by language tag. Each must have every English key (enforced by `Messages`). */
export const MESSAGES = { en, de, es, fr, nl } satisfies Record<string, Messages>;
