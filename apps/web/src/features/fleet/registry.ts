/**
 * The vehicles the line tools, depots, tables and costs pick from: the catalogue's, plus the project's own.
 *
 * The open project sets its own vehicles here (Workspace) before its tools render, so code that looks a
 * vehicle up by id (`vehicleById`, `trainById`) finds own vehicles too, without passing them through every
 * layer. With no project open the lists are the catalogue's.
 */
import { TRAINS } from "../railways/trains";
import type { CatalogueTrain } from "../railways/types";
import { VEHICLES } from "../street-lines/vehicles";
import type { CatalogueVehicle } from "../street-lines/types";
import { isRailMode, isStreetMode, type OwnVehicle, toStreetVehicle, toTrain } from "./model";

let own: readonly OwnVehicle[] = [];
let street: readonly CatalogueVehicle[] = VEHICLES;
let trains: readonly CatalogueTrain[] = TRAINS;

/** Purpose: set the open project's own vehicles (an empty list when none, or no project, is open). */
export function setOwnVehicles(list: readonly OwnVehicle[]): void {
  if (list === own) return;
  own = list;
  const s = list.filter((v) => isStreetMode(v.mode)).map(toStreetVehicle);
  const r = list.filter((v) => isRailMode(v.mode)).map(toTrain);
  street = s.length ? [...VEHICLES, ...s] : VEHICLES;
  trains = r.length ? [...TRAINS, ...r] : TRAINS;
}

/** Purpose: the open project's own vehicles. */
export function ownVehicles(): readonly OwnVehicle[] {
  return own;
}

/** Purpose: the street vehicles to pick from: the catalogue's, then the project's own. */
export function streetVehicles(): readonly CatalogueVehicle[] {
  return street;
}

/** Purpose: the rail vehicles to pick from: the catalogue's, then the project's own. */
export function railVehicles(): readonly CatalogueTrain[] {
  return trains;
}

/** Purpose: whether a vehicle id is one of the project's own. */
export function isOwnVehicle(id: string | null | undefined): boolean {
  return !!id && own.some((v) => v.id === id);
}
