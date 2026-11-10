import { Module } from "@nestjs/common";
import { OverpassClient } from "../gateway/overpass.client";
import { WorldPopClient } from "../gateway/worldpop.client";
import { PopulationController } from "./population.controller";
import { PopulationService } from "./population.service";

/** People per 100 m cell from WorldPop, for the noise map's population exposure (ADR-0038). */
@Module({
  controllers: [PopulationController],
  providers: [
    PopulationService,
    { provide: OverpassClient, useFactory: () => new OverpassClient() },
    { provide: WorldPopClient, useFactory: () => new WorldPopClient() },
  ],
})
export class PopulationModule {}
