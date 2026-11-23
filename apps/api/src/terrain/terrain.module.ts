import { Module } from "@nestjs/common";
import { CopernicusDemClient } from "../gateway/copernicus-dem.client";
import { GebcoClient, gebcoSettings } from "../gateway/gebco.client";
import { OpenElevationClient, openElevationSettings } from "../gateway/open-elevation.client";
import { OverpassClient } from "../gateway/overpass.client";
import { SharedDataStore } from "../geodata/shared-data";
import { TerrainController } from "./terrain.controller";
import { TerrainService } from "./terrain.service";

/**
 * Terrain heights for alignments (06-gis §4), the OpenStreetMap buildings a line passes over, and water depths
 * (GEBCO) for the ferry route checks.
 */
@Module({
  controllers: [TerrainController],
  providers: [
    TerrainService,
    {
      // GLO-30 byte ranges are held once for the instance when the geodata module is there (it is global).
      provide: CopernicusDemClient,
      useFactory: (shared?: SharedDataStore) =>
        new CopernicusDemClient(shared ? { store: shared.glo30() } : {}),
      inject: [{ token: SharedDataStore, optional: true }],
    },
    { provide: OverpassClient, useFactory: () => new OverpassClient() },
    {
      // The fallback is off when MOBSIMLAB_ELEVATION_FALLBACK=off; TerrainService then has none.
      provide: OpenElevationClient,
      useFactory: () => {
        const s = openElevationSettings();
        return s ? new OpenElevationClient(s) : null;
      },
    },
    {
      // Water depths for the ferry route checks; none when MOBSIMLAB_GEBCO=off.
      provide: GebcoClient,
      useFactory: () => {
        const s = gebcoSettings();
        return s ? new GebcoClient(s) : null;
      },
    },
  ],
  exports: [TerrainService],
})
export class TerrainModule {}
