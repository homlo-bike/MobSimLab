/** A small made-up network for the schematic tests: two metro lines, a regional line and a bus line. */
import { offset } from "../../src/features/journey-planner/network";
import type { Network, Station } from "../../src/features/railways/types";
import type { SavedStreetLine, StreetLinesDoc } from "../../src/features/street-lines/saved";

const ORIGIN: [number, number] = [4.9, 52.37];

const station = (id: number, name: string, x: number, y: number): Station => ({
  id,
  name,
  x,
  y,
  rotation_deg: 0,
  level: "underground",
  side_platforms: 0,
  island_platforms: 1,
  platform_length_m: 120,
});

const line = (id: string, color: string, stations: number[]) => ({
  id,
  name: id,
  color,
  stations,
  vehicle: "",
  units: 1,
  first_min: 300,
  last_min: 1440,
  peak_headway_min: 5,
  offpeak_headway_min: 10,
});

export const RAILWAY: Network = {
  origin: ORIGIN,
  mode: "metro",
  stations: [
    station(1, "Westpark", -3000, 0),
    station(2, "Museumplein", -1500, 200),
    station(3, "Centraal", 0, 0),
    station(4, "Oosterdok", 1400, -300),
    station(5, "Amstel Oost", 3000, -200),
    station(6, "Noorderhaven", 200, 2500),
    station(7, "Buikslot", -100, 1200),
    station(8, "De Pijp", 300, -1300),
    station(9, "Zuidas", 800, -2800),
    { ...station(10, "Lelystraat", 4200, -3900), mode: "regional_rail" },
    { ...station(11, "Westpark", -3010, 20), mode: "regional_rail" },
  ],
  tracks: [],
  switches: [],
  lines: [
    line("M1", "#1d4ed8", [1, 2, 3, 4, 5]),
    line("M2", "#b91c1c", [6, 7, 3, 8, 9]),
    line("R5", "#15803d", [11, 9, 10]),
  ],
};

const pt = (seq: number, name: string, x: number, y: number) => ({
  id: seq,
  seq,
  kind: "stop" as const,
  name,
  lonlat: offset(ORIGIN, x, y),
});

export const STREET_LINES: StreetLinesDoc = {
  lines: [
    {
      name: "Bus 22",
      profile: { mode: "bus" },
      points: [],
      view: {
        points: [
          pt(0, "Museumplein", -1480, 210),
          pt(1, "Vondelpark", -1800, -900),
          pt(2, "De Pijp", 310, -1290),
          pt(3, "Oosterdok", 1410, -290),
        ],
      },
    } as unknown as SavedStreetLine,
  ],
};
