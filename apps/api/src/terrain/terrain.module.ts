import { Module } from "@nestjs/common";
import { CopernicusDemClient } from "../gateway/copernicus-dem.client";
import { OpenElevationClient, openElevationSettings } from "../gateway/open-elevation.client";
import { OverpassClient } from "../gateway/overpass.client";
import { TerrainController } from "./terrain.controller";
import { TerrainService } from "./terrain.service";

/** Terrain heights for alignments (06-gis §4), and the OpenStreetMap buildings a line passes over. */
@Module({
  controllers: [TerrainController],
  providers: [
    TerrainService,
    { provide: CopernicusDemClient, useFactory: () => new CopernicusDemClient() },
    { provide: OverpassClient, useFactory: () => new OverpassClient() },
    {
      // The fallback is off when MOBSIMLAB_ELEVATION_FALLBACK=off; TerrainService then has none.
      provide: OpenElevationClient,
      useFactory: () => {
        const s = openElevationSettings();
        return s ? new OpenElevationClient(s) : null;
      },
    },
  ],
  exports: [TerrainService],
})
export class TerrainModule {}
