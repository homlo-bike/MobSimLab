/**
 * Saved scenarios of the Tables tab: named copies of the railway design and the street lines (drawing kind
 * `scenarios`), and the key figures that compare them with the current design.
 */
import { BASE_PRICES } from "../costs/economy";
import { estimate, isConstruction, sum } from "../costs/model";
import type { LineReport, Network, RailView } from "../railways/types";
import type { StreetLinesDoc } from "../street-lines/saved";
import { lineFacts } from "./lineFacts";
import { BRIDGES, LEVELS, quantities, TUNNELS } from "./quantities";

/** One saved copy of the design. */
export interface Scenario {
  id: string;
  name: string;
  /** ISO 8601 time it was saved. */
  savedAt: string;
  railway: Network | null;
  streetLines: StreetLinesDoc | null;
}

/** The project's saved scenarios (drawing kind `scenarios`). */
export interface ScenariosDoc {
  scenarios: Scenario[];
}

/** The most scenarios a project keeps (the API accepts no more). */
export const MAX_SCENARIOS = 20;

/** Figures compared between scenarios. */
export interface Figures {
  lines: number;
  railKm: number;
  streetKm: number;
  trackKm: number;
  stations: number;
  stops: number;
  tunnelKm: number;
  bridgeKm: number;
  fleet: number;
  inService: number;
  kmPerYear: number;
  capacityPerHour: number;
  /** Medium estimates in US dollars at the library's price base (before the country conversion). */
  construction: number;
  operating: number;
}

/**
 * Purpose: the comparison figures of a design.
 * Inputs: the railway and its build (null without track), the street lines, the project's values.
 * Output: size, service and medium cost figures, summed over the project.
 */
export function figures(
  railway: Network | null,
  rail: { view: RailView; reports: Record<string, LineReport> } | null,
  streetLines: StreetLinesDoc | null,
  prefs: Record<string, number> | undefined,
): Figures {
  const view = rail?.view ?? null;
  const reports = rail?.reports ?? {};
  const street = streetLines?.lines ?? [];
  const facts = lineFacts({ railway, view, reports, streetLines: street, prefs });
  const q = quantities(railway, view, street);
  const est = estimate({ railway, view, reports, streetLines: street, prefs, prices: BASE_PRICES });
  const total = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
  return {
    lines: facts.length,
    railKm: total(q.rail, (r) => r.routeKm),
    streetKm: total(q.street, (s) => s.routeKm),
    trackKm: total(q.rail, (r) => r.trackKm),
    stations: total(q.rail, (r) => total(LEVELS, (l) => r.stations[l])),
    stops: total(q.street, (s) => s.stops),
    tunnelKm: total(q.rail, (r) => total(TUNNELS, (s) => r.byStructure[s])),
    bridgeKm: total(q.rail, (r) => total(BRIDGES, (s) => r.byStructure[s])),
    fleet: total(facts, (f) => f.fleet),
    inService: total(facts, (f) => f.inService),
    kmPerYear: total(facts, (f) => f.kmPerYear),
    capacityPerHour: total(facts, (f) => f.capacityPerHour),
    construction: sum(est.items.filter((x) => isConstruction(x.category)).map((x) => x.amount))[1],
    operating: sum(est.items.filter((x) => !isConstruction(x.category)).map((x) => x.amount))[1],
  };
}

/**
 * Purpose: add a copy of the design to the saved scenarios, newest last.
 * Inputs: the saved scenarios, a name, the design, a clock and an id source (tests inject them).
 * Output: the new document; unchanged when the name is empty or the project keeps the most scenarios.
 */
export function withScenario(
  doc: ScenariosDoc | null,
  name: string,
  railway: Network | null,
  streetLines: StreetLinesDoc | null,
  now: Date = new Date(),
  newId: () => string = () => crypto.randomUUID(),
): ScenariosDoc {
  const list = doc?.scenarios ?? [];
  const clean = name.trim().slice(0, 120);
  if (!clean || list.length >= MAX_SCENARIOS) return { scenarios: list };
  const copy = <T>(x: T): T => (x === null ? x : (JSON.parse(JSON.stringify(x)) as T));
  return {
    scenarios: [
      ...list,
      {
        id: newId(),
        name: clean,
        savedAt: now.toISOString(),
        railway: copy(railway),
        streetLines: copy(streetLines),
      },
    ],
  };
}

/** Purpose: the saved scenarios without one. */
export function withoutScenario(doc: ScenariosDoc | null, id: string): ScenariosDoc {
  return { scenarios: (doc?.scenarios ?? []).filter((s) => s.id !== id) };
}
