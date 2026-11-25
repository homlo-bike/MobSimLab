import { Module } from "@nestjs/common";
import { INTERACTIVE_DEADLINE_MS, OverpassClient } from "../gateway/overpass.client";
import { WorldPopClient } from "../gateway/worldpop.client";
import { PopulationController } from "./population.controller";
import { PopulationService } from "./population.service";

/** People per 100 m cell from WorldPop, for the noise map's population exposure (ADR-0038). */
@Module({
  controllers: [PopulationController],
  providers: [
    PopulationService,
    {
      provide: OverpassClient,
      useFactory: () => new OverpassClient({ deadlineMs: INTERACTIVE_DEADLINE_MS }),
    },
    { provide: WorldPopClient, useFactory: () => new WorldPopClient() },
  ],
  exports: [PopulationService, WorldPopClient],
})
export class PopulationModule {}
