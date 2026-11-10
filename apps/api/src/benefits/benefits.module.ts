import { Module } from "@nestjs/common";
import { OverpassClient } from "../gateway/overpass.client";
import { WorldBankClient } from "../gateway/worldbank.client";
import { PopulationModule } from "../population/population.module";
import { BenefitsController } from "./benefits.controller";
import { BenefitsService } from "./benefits.service";

/** Location data for the benefit tables (ADR-0040); population from the WorldPop grid (ADR-0038). */
@Module({
  imports: [PopulationModule],
  controllers: [BenefitsController],
  providers: [
    BenefitsService,
    { provide: WorldBankClient, useFactory: () => new WorldBankClient() },
    { provide: OverpassClient, useFactory: () => new OverpassClient() },
  ],
})
export class BenefitsModule {}
