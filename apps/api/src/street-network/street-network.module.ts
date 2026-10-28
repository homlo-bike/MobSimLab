import { Module } from "@nestjs/common";
import { OverpassClient } from "../gateway/overpass.client";
import { StreetNetworkController } from "./street-network.controller";
import { StreetNetworkService } from "./street-network.service";

/** Streets for the street line editor (ADR-0031). */
@Module({
  controllers: [StreetNetworkController],
  providers: [StreetNetworkService, { provide: OverpassClient, useFactory: () => new OverpassClient() }],
})
export class StreetNetworkModule {}
