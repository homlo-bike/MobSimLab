import type { OgcKind } from "./ogc";
import type { ShowAs } from "./map-layers.service";

/** A WMS, WMTS or XYZ service MobSimLab comes with. None needs a sign-in. */
export interface BuiltinService {
  /** Stable id (`plugin.map_layer_service.builtin`): the service is added once, and hidden rather than removed. */
  id: string;
  kind: OgcKind;
  url: string;
  name: string;
  attribution: string;
  showAs: ShowAs;
  /** The layers' names in the service's capabilities (XYZ: `tiles`). */
  layers: string[];
  /**
   * XYZ: the deepest zoom level the service has. WMS and WMTS: the deepest zoom to ask the service for, when it
   * draws deeper tiles that are not usable (the map enlarges the last good ones).
   */
  maxzoom?: number;
}

/**
 * The map layers MobSimLab comes with (bundled plugin `org.mobsimlab.ogc-layers`). Each was checked against the
 * live service; the API adds them at start when it can read them, and an Admin can hide them.
 */
export const BUILTIN_SERVICES: readonly BuiltinService[] = [
  {
    id: "opentopomap",
    kind: "xyz",
    url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    name: "OpenTopoMap",
    attribution: "Map data © OpenStreetMap contributors, SRTM · Map style © OpenTopoMap (CC-BY-SA)",
    showAs: "basemap",
    layers: ["tiles"],
    maxzoom: 17,
  },
  {
    id: "mundialis-osm",
    kind: "wms",
    url: "https://ows.mundialis.de/osm/service",
    name: "OpenStreetMap Europe (mundialis)",
    attribution: "Map data © OpenStreetMap contributors · Map service © mundialis",
    showAs: "basemap",
    layers: ["osm_europe"],
    // Deeper tiles carry an "API key required" mark (tested 2026-11-18): the map enlarges zoom 14 instead.
    maxzoom: 14,
  },
  {
    id: "ellipsis-natural-background",
    kind: "wms",
    url: "https://api.ellipsis-drive.com/v3/ogc/wms/801b0d7d-94f2-4425-951e-1f97deeb7ddb",
    name: "Natural background (Ellipsis Drive)",
    attribution: "Ellipsis Drive",
    showAs: "basemap",
    layers: ["fb79bbf4-80e0-4a3d-8adc-6ed155dd741f_2eeb5eb0-69b7-4fb6-807c-79654a9687dc"],
  },
  {
    id: "ellipsis-terrain",
    kind: "wmts",
    url: "https://api.ellipsis-drive.com/v3/ogc/wmts/085f5e10-63b6-4e8f-a4c6-dce9689100d3",
    name: "Altitude and hill shade (Ellipsis Drive)",
    attribution: "Ellipsis Drive",
    showAs: "overlay",
    layers: [
      "3179fa80-60ad-41c7-ae67-cdd5eeeca693_bbd4cec7-e692-46a2-86f1-f081204d57e4",
      "3179fa80-60ad-41c7-ae67-cdd5eeeca693_e4c54733-2abc-4b56-9798-043792850e2a",
    ],
  },
];
