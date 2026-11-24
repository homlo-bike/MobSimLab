import { Module } from "@nestjs/common";
import { OverpassClient } from "../gateway/overpass.client";
import { StreetNetworkController } from "./street-network.controller";
import { StreetNetworkService } from "./street-network.service";

/**
 * Longest a map data request waits for Overpass, ms: well under the 90 s after which a reverse proxy gives up, so
 * the tools say OpenStreetMap is slow instead of waiting for minutes (GIS showed "Loading streets…").
 */
const TILE_DEADLINE_MS = 40_000;

/** Streets for the street line editor (ADR-0031), from the project's OSM import when it has one (ADR-0046). */
@Module({
  controllers: [StreetNetworkController],
  providers: [
    StreetNetworkService,
    { provide: OverpassClient, useFactory: () => new OverpassClient({ deadlineMs: TILE_DEADLINE_MS }) },
  ],
  exports: [StreetNetworkService],
})
export class StreetNetworkModule {}
