import { type DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AgentsModule } from "./agents/agents.module";
import { AdminController } from "./admin/admin.controller";
import { UsersService } from "./admin/users.service";
import { AuditService } from "./audit/audit.service";
import { AuthController } from "./auth/auth.controller";
import { BasemapsController } from "./basemaps/basemaps.controller";
import { BasemapsService } from "./basemaps/basemaps.service";
import { EsriImageryClient } from "./basemaps/esri.client";
import { AuthService } from "./auth/auth.service";
import { CommentsController } from "./comments/comments.controller";
import { CommentsService } from "./comments/comments.service";
import { OidcService } from "./auth/oidc.service";
import { SessionService } from "./auth/session.service";
import { ConfigModule } from "./config/config.module";
import type { AppConfig } from "./config/env";
import { HealthController } from "./health/health.controller";
import { LoggingModule } from "./logging/logging.module";
import { StreetNetworkModule } from "./street-network/street-network.module";
import { BenefitsModule } from "./benefits/benefits.module";
import { PopulationLayersController } from "./population/layers.controller";
import { ProjectAreaController } from "./projects/area.controller";
import { ProjectAreaService } from "./projects/area.service";
import { PopulationLayersModule } from "./population/layers.module";
import { PopulationModule } from "./population/population.module";
import { EconomyModule } from "./economy/economy.module";
import { CalendarModule } from "./calendar/calendar.module";
import { PlacesModule } from "./places/places.module";
import { TerrainModule } from "./terrain/terrain.module";
import { GeodataModule } from "./geodata/geodata.module";
import { AccessGuard } from "./iam/access.guard";
import { RateLimitService } from "./iam/rate-limit.service";
import { PluginsController } from "./plugins/plugins.controller";
import { PluginsModule } from "./plugins/plugins.module";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsService } from "./projects/projects.service";
import { SetupController } from "./setup/setup.controller";
import { RunsController } from "./simulation/runs.controller";
import { MslabController } from "./mslab/mslab.controller";
import { MslabService } from "./mslab/mslab.service";
import { MslabMapService } from "./mslab/map-data";
import { SimulationModule } from "./simulation/simulation.module";
import { ToolRunner } from "./tool-runner/runner";

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
        GeodataModule,
        TerrainModule,
        PopulationModule,
        PopulationLayersModule,
        EconomyModule,
        CalendarModule,
        BenefitsModule,
        PlacesModule,
        SimulationModule,
        PluginsModule,
        AgentsModule,
      ],
      controllers: [
        HealthController,
        AuthController,
        SetupController,
        AdminController,
        ProjectsController,
        CommentsController,
        PluginsController,
        BasemapsController,
        RunsController,
        MslabController,
        PopulationLayersController,
        ProjectAreaController,
      ],
      providers: [
        AuditService,
        AuthService,
        BasemapsService,
        { provide: EsriImageryClient, useFactory: () => new EsriImageryClient() },
        CommentsService,
        OidcService,
        ProjectsService,
        RateLimitService,
        SessionService,
        UsersService,
        MslabService,
        MslabMapService,
        ProjectAreaService,
        ToolRunner,
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
    };
  }
}
