import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { StreetNetworkModule } from "./street-network/street-network.module";

/** Root module. Feature modules (auth, iam, projects, ...) are added in Phase 1. */
@Module({ imports: [StreetNetworkModule], controllers: [HealthController] })
export class AppModule {}
