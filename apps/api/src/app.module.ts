import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";

/** Root module. Feature modules (auth, iam, projects, ...) are added in Phase 1. */
@Module({ controllers: [HealthController] })
export class AppModule {}
