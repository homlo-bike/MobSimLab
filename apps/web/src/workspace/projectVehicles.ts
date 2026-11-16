import { createContext, useContext } from "react";

/** Catalogue vehicles the project does not use (Project preferences → Vehicles), for the line tools. */
export const VehiclesOffContext = createContext<ReadonlySet<string>>(new Set());

/** Purpose: the catalogue vehicles the project does not use. */
export function useVehiclesOff(): ReadonlySet<string> {
  return useContext(VehiclesOffContext);
}
