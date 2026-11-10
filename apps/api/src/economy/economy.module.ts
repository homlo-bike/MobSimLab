import { Module } from "@nestjs/common";
import { OverpassClient } from "../gateway/overpass.client";
import { WorldBankClient } from "../gateway/worldbank.client";
import { EconomyController } from "./economy.controller";
import { EconomyService } from "./economy.service";

/** Country price levels and exchange rates for the cost tables (ADR-0039). */
@Module({
  controllers: [EconomyController],
  providers: [
    EconomyService,
    { provide: WorldBankClient, useFactory: () => new WorldBankClient() },
    { provide: OverpassClient, useFactory: () => new OverpassClient() },
  ],
})
export class EconomyModule {}
