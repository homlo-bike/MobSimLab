import { type DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
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
import { StreetNetworkModule } from "./street-network/street-network.module";
import { AccessGuard } from "./iam/access.guard";
import { RateLimitService } from "./iam/rate-limit.service";
import { SetupController } from "./setup/setup.controller";

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
      imports: [ConfigModule.forRoot(config), StreetNetworkModule],
      controllers: [HealthController, AuthController, SetupController, AdminController],
      providers: [
        AuditService,
        AuthService,
        OidcService,
        RateLimitService,
        SessionService,
        UsersService,
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
    };
  }
}
