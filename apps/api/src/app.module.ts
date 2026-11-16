import { type DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AgentsModule } from "./agents/agents.module";
import { AdminController } from "./admin/admin.controller";
import { UsersService } from "./admin/users.service";
import { AuditService } from "./audit/audit.service";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { OidcService } from "./auth/oidc.service";
import { SessionService } from "./auth/session.service";
import { ConfigModule } from "./config/config.module";
import type { AppConfig } from "./config/env";
import { HealthController } from "./health/health.controller";
import { LoggingModule } from "./logging/logging.module";
import { StreetNetworkModule } from "./street-network/street-network.module";
import { BenefitsModule } from "./benefits/benefits.module";
import { PopulationLayersController } from "./population/layers.controller";
import { PopulationLayersModule } from "./population/layers.module";
import { PopulationModule } from "./population/population.module";
import { EconomyModule } from "./economy/economy.module";
import { CalendarModule } from "./calendar/calendar.module";
import { PlacesModule } from "./places/places.module";
import { TerrainModule } from "./terrain/terrain.module";
import { AccessGuard } from "./iam/access.guard";
import { RateLimitService } from "./iam/rate-limit.service";
import { PluginsController } from "./plugins/plugins.controller";
import { PluginsService } from "./plugins/plugins.service";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsService } from "./projects/projects.service";
import { SetupController } from "./setup/setup.controller";
import { RunsController } from "./simulation/runs.controller";
import { SimulationModule } from "./simulation/simulation.module";

/** Root module. Every route passes the global AccessGuard. */
@Module({})
export class AppModule {
  /**
   * Purpose: assemble the application for a validated configuration.
   * Inputs: config. Output: the root dynamic module.
   */
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggingModule,
        StreetNetworkModule,
        TerrainModule,
        PopulationModule,
        PopulationLayersModule,
        EconomyModule,
        CalendarModule,
        BenefitsModule,
        PlacesModule,
        SimulationModule,
        AgentsModule,
      ],
      controllers: [
        HealthController,
        AuthController,
        SetupController,
        AdminController,
        ProjectsController,
        PluginsController,
        RunsController,
        PopulationLayersController,
      ],
      providers: [
        AuditService,
        AuthService,
        OidcService,
        PluginsService,
        ProjectsService,
        RateLimitService,
        SessionService,
        UsersService,
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
    };
  }
}
