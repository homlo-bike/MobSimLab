import { Module } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { SessionService } from "../auth/session.service";
import { RateLimitService } from "../iam/rate-limit.service";
import { StreetNetworkModule } from "../street-network/street-network.module";
import { StreetNetworkService } from "../street-network/street-network.service";
import { AgentsController } from "./agents.controller";
import { AnalysisService } from "./analysis.service";
import { McpController } from "./mcp.controller";
import { NetworkService, TILE_SOURCE } from "./network.service";
import { OAuthController } from "./oauth.controller";
import { OAuthService } from "./oauth.service";
import { ScenariosService } from "./scenarios.service";

/**
 * AI agent integration (ADR-0035): the MCP endpoint, its OAuth 2.1 authorization server, agent scenarios and
 * the analyses agents run. MobSimLab never calls a model; agents connect from outside.
 */
@Module({
  imports: [StreetNetworkModule],
  controllers: [McpController, OAuthController, AgentsController],
  providers: [
    AuditService,
    SessionService,
    RateLimitService,
    OAuthService,
    ScenariosService,
    AnalysisService,
    NetworkService,
    { provide: TILE_SOURCE, useExisting: StreetNetworkService },
  ],
})
export class AgentsModule {}
