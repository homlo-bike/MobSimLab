import { Module } from "@nestjs/common";
import { CopernicusDemClient } from "../gateway/copernicus-dem.client";
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
  ],
  exports: [TerrainService],
})
export class TerrainModule {}
