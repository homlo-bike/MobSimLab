import { Module } from "@nestjs/common";
import { INTERACTIVE_DEADLINE_MS, OverpassClient } from "../gateway/overpass.client";
import { StreetNetworkController } from "./street-network.controller";
import { StreetNetworkService } from "./street-network.service";

/** Streets for the street line editor (ADR-0031), from the project's OSM import when it has one (ADR-0046). */
@Module({
  controllers: [StreetNetworkController],
  providers: [
    StreetNetworkService,
    {
      provide: OverpassClient,
      useFactory: () => new OverpassClient({ deadlineMs: INTERACTIVE_DEADLINE_MS }),
    },
  ],
  exports: [StreetNetworkService],
})
export class StreetNetworkModule {}
