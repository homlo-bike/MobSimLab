import { Module } from "@nestjs/common";
import { OverpassClient } from "../gateway/overpass.client";
import { StreetNetworkController } from "./street-network.controller";
import { StreetNetworkService } from "./street-network.service";

/** Streets for the street line editor (ADR-0031), from the project's OSM import when it has one (ADR-0045). */
@Module({
  controllers: [StreetNetworkController],
  providers: [StreetNetworkService, { provide: OverpassClient, useFactory: () => new OverpassClient() }],
  exports: [StreetNetworkService],
})
export class StreetNetworkModule {}
