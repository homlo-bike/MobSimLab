import { Module } from "@nestjs/common";
import { OverpassClient } from "../gateway/overpass.client";
import { WorldBankClient } from "../gateway/worldbank.client";
import { WorldPopClient } from "../gateway/worldpop.client";
import { BenefitsController } from "./benefits.controller";
import { BenefitsService } from "./benefits.service";

/** Location data for the benefit tables (ADR-0040). */
@Module({
  controllers: [BenefitsController],
  providers: [
    BenefitsService,
    { provide: WorldBankClient, useFactory: () => new WorldBankClient() },
    { provide: WorldPopClient, useFactory: () => new WorldPopClient() },
    { provide: OverpassClient, useFactory: () => new OverpassClient() },
  ],
})
export class BenefitsModule {}
