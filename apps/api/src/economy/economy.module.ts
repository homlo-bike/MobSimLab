import { Module } from "@nestjs/common";
import { INTERACTIVE_DEADLINE_MS, OverpassClient } from "../gateway/overpass.client";
import { WorldBankClient } from "../gateway/worldbank.client";
import { EconomyController } from "./economy.controller";
import { EconomyService } from "./economy.service";

/** Country price levels and exchange rates for the cost tables (ADR-0039). */
@Module({
  controllers: [EconomyController],
  providers: [
    EconomyService,
    { provide: WorldBankClient, useFactory: () => new WorldBankClient() },
    {
      provide: OverpassClient,
      useFactory: () => new OverpassClient({ deadlineMs: INTERACTIVE_DEADLINE_MS }),
    },
  ],
  exports: [EconomyService],
})
export class EconomyModule {}
