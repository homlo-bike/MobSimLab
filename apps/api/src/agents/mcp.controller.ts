import { All, Controller, Inject, Logger, Req, Res } from "@nestjs/common";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Response } from "express";
import type { MslRequest } from "../auth/session.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { DATABASE, type Database } from "../db/database";
import { RateLimitService } from "../iam/rate-limit.service";
import { BearerAuth, Public } from "../iam/requires";
import { AnalysisService } from "./analysis.service";
import { buildMcpServer } from "./mcp.tools";
import { OAuthService } from "./oauth.service";
import { ScenariosService } from "./scenarios.service";

/**
 * The MCP endpoint (ADR-0035 §1): Streamable HTTP transport, stateless (a new server per request, JSON
 * responses), authenticated by an OAuth access token or personal access token in the Authorization header.
 * Unauthenticated calls get 401 with `WWW-Authenticate: Bearer resource_metadata=…` so MCP clients find the
 * authorization server (RFC 9728 §5.1). Calls are rate limited per connection.
 */
@Controller("mcp")
export class McpController {
  private readonly log = new Logger(McpController.name);

  constructor(
    private readonly oauth: OAuthService,
    private readonly scenarios: ScenariosService,
    private readonly analysis: AnalysisService,
    private readonly limits: RateLimitService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Purpose: handle one MCP message (POST); GET and DELETE are answered 405 in stateless mode. */
  @All()
  @Public()
  @BearerAuth()
  async handle(@Req() req: MslRequest, @Res() res: Response): Promise<void> {
    const metadata = new URL(".well-known/oauth-protected-resource/mcp", this.oauth.issuer() + "/").href;
    const challenge = (error?: string) =>
      `Bearer resource_metadata="${metadata}"${error ? `, error="${error}"` : ""}, scope="${["project:read", "analysis:run", "scenario:write"].join(" ")}"`;
    const auth = req.header("authorization") ?? "";
    const m = /^Bearer\s+(\S+)$/i.exec(auth);
    const principal = m ? await this.oauth.resolve(m[1]!) : null;
    if (!principal) {
      res.setHeader("WWW-Authenticate", challenge(m ? "invalid_token" : undefined));
      res
        .status(401)
        .json({ error: m ? "invalid_token" : "unauthorized", error_description: "Bearer token required" });
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res
        .status(405)
        .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
      return;
    }
    if (
      !(await this.limits.take(`agent:${principal.connectionId}`, this.config.rateLimits.writesPerMinute))
    ) {
      res.setHeader("Retry-After", String(Math.ceil(60 / this.config.rateLimits.writesPerMinute)));
      res
        .status(429)
        .json({ jsonrpc: "2.0", error: { code: -32000, message: "Too many requests" }, id: null });
      return;
    }
    const inst = await this.db.selectFrom("iam.instance").select("name").executeTakeFirstOrThrow();
    const server = buildMcpServer(principal, {
      scenarios: this.scenarios,
      analysis: this.analysis,
      instanceName: inst.name,
      requestId: req.requestId,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      this.log.error(`MCP request failed: ${(e as Error).message}`);
      if (!res.headersSent)
        res
          .status(500)
          .json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
}
