/** A basemap the user can pick. Attribution is mandatory and always rendered. */
export interface Basemap {
  id: string;
  label: string;
  styleUrl: string;
  attribution: string;
}

/**
 * Default basemap: OpenFreeMap Positron (free, no key). Data © OpenStreetMap contributors (ODbL),
 * schema by OpenMapTiles. See docs/compliance/license-compliance-report.md §6.
 */
export const DEFAULT_BASEMAP: Basemap = {
  id: "openfreemap-positron",
  label: "OpenFreeMap Positron",
  styleUrl: "https://tiles.openfreemap.org/styles/positron",
  attribution:
    '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
    '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
    'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
};
