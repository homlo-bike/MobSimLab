import { Module } from "@nestjs/common";
import { NagerClient } from "../gateway/nager.client";
import { OpenMeteoClient } from "../gateway/openmeteo.client";
import { CalendarController } from "./calendar.controller";

/** Public holidays and the climate for the project calendar (ADR-0020). */
@Module({
  controllers: [CalendarController],
  providers: [
    { provide: NagerClient, useFactory: () => new NagerClient() },
    { provide: OpenMeteoClient, useFactory: () => new OpenMeteoClient() },
  ],
})
export class CalendarModule {}
