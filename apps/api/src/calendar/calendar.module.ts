import { Module } from "@nestjs/common";
import { NagerClient } from "../gateway/nager.client";
import { CalendarController } from "./calendar.controller";

/** Public holidays for the project calendar (ADR-0020). */
@Module({
  controllers: [CalendarController],
  providers: [{ provide: NagerClient, useFactory: () => new NagerClient() }],
})
export class CalendarModule {}
