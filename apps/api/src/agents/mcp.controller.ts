import { All, Controller, Inject, Logger, Req, Res } from "@nestjs/common";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Response } from "express";
import type { MslRequest } from "../auth/session.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { DATABASE, type Database } from "../db/database";
import { RateLimitService } from "../iam/rate-limit.service";
import { BearerAuth, Public } from "../iam/requires";
import { PluginCodeService } from "../plugins/code/code.service";
import { PluginsService } from "../plugins/plugins.service";
import { ProjectsService } from "../projects/projects.service";
import { RunsService } from "../simulation/runs.service";
import { AccessService } from "./access.service";
import { AnalysisService } from "./analysis.service";
import { buildMcpServer } from "./mcp.tools";
import { SCOPE_IDS } from "./oauth";
import { OAuthService } from "./oauth.service";
import { ScenariosService } from "./scenarios.service";
import { KEEP_ALIVE_MS, keepAlive } from "./keep-alive";

/** The keep-alive interval of MCP tool calls (tests shorten it). */
export const mcpKeepAlive = { everyMs: KEEP_ALIVE_MS };

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
    private readonly access: AccessService,
    private readonly runs: RunsService,
    private readonly projects: ProjectsService,
    private readonly plugins: PluginsService,
    private readonly pluginCode: PluginCodeService,
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
      `Bearer resource_metadata="${metadata}"${error ? `, error="${error}"` : ""}, scope="${SCOPE_IDS.join(" ")}"`;
    const auth = req.header("authorization") ?? "";
    const m = /^Bearer\s+(\S+)$/i.exec(auth);
    const principal = m ? await this.oauth.resolve(m[1]!) : null;
    if (!principal) {
      res.setHeader("WWW-Authenticate", challenge(m ? "invalid_token" : undefined));
      res.status(401).json({
        error: m ? "invalid_token" : "unauthorized",
        error_description: m
          ? "The token is invalid, expired or revoked. Connect again, or create a new personal access token."
          : "Bearer token required",
      });
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
      access: this.access,
      simulation: { runs: this.runs, projects: this.projects },
      plugins: { plugins: this.plugins, code: this.pluginCode },
      instanceName: inst.name,
      listing: ([req.body] as unknown[])
        .flat()
        .some((m) => (m as { method?: unknown } | null)?.method === "tools/list"),
      instanceUrl: this.config.publicUrl.origin,
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
    // A tool call can run for minutes (coverage over a large area): keep the connection alive through proxies.
    if (
      ([req.body] as unknown[])
        .flat()
        .some((m) => (m as { method?: unknown } | null)?.method === "tools/call")
    )
      keepAlive(res, mcpKeepAlive.everyMs);
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
