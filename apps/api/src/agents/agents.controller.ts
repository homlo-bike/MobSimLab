import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { Requires } from "../iam/requires";
import { AnalysisService } from "./analysis.service";
import { NetworkError } from "./network.service";
import { type Scope, SCOPE_IDS, SCOPES } from "./oauth";
import { OAuthService } from "./oauth.service";
import { summarise, validate } from "./scenario";
import { ScenarioError, ScenariosService } from "./scenarios.service";
import { WasmMissingError } from "./wasm";

const patBody = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(SCOPE_IDS as [Scope, ...Scope[]])).min(1),
  expiresInDays: z.number().int().min(1).max(365),
});

/**
 * The web app's side of agent connections (ADR-0035): the Connected agents page (connections, recent actions,
 * revoke, personal access tokens), agent scenarios with their coverage layer, and the admin switch for client
 * registration.
 */
@Controller("api/agents")
export class AgentsController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly scenarios: ScenariosService,
    private readonly analysis: AnalysisService,
    private readonly sessions: SessionService,
  ) {}

  private meta(req: MslRequest) {
    return {
      userId: req.session!.actor.userId,
      ipHash: this.sessions.ipHash(req.ip),
      requestId: req.requestId ?? null,
    };
  }

  /** Purpose: scopes with labels and the MCP endpoint URL to paste into an AI app. */
  @Get("info")
  @Requires("agents.connect")
  info() {
    return { mcpUrl: this.oauth.resource(), scopes: SCOPE_IDS.map((id) => ({ id, label: SCOPES[id] })) };
  }

  /** Purpose: the user's connected agents and tokens, with their last actions. */
  @Get("connections")
  @Requires("agents.connect")
  async connections(@Req() req: MslRequest) {
    return { connections: await this.oauth.connections(req.session!.actor.userId) };
  }

  /** Purpose: disconnect an agent or revoke a token; takes effect on its next call. */
  @Delete("connections/:id")
  @Requires("agents.connect")
  async revoke(@Param("id") id: string, @Req() req: MslRequest) {
    if (
      !/^[0-9a-f-]{36}$/i.test(id) ||
      !(await this.oauth.revokeOwn(req.session!.actor.userId, id, this.meta(req)))
    )
      throw new NotFoundException();
    return { ok: true };
  }

  /** Purpose: create a personal access token. Body `{ name, scopes, expiresInDays }`. The token is shown once. */
  @Post("tokens")
  @Requires("agents.connect")
  async createToken(@Body() body: unknown, @Req() req: MslRequest) {
    const b = patBody.safeParse(body);
    if (!b.success)
      throw new HttpException(b.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
    return this.oauth.createPat(this.meta(req), b.data.name, b.data.scopes, b.data.expiresInDays);
  }

  /** Purpose: agent settings of the instance (Admins). */
  @Get("settings")
  @Requires("agents.manage")
  settings() {
    return this.oauth.settings();
  }

  /** Purpose: switch Dynamic Client Registration. Body `{ dynamicRegistration }`. */
  @Put("settings")
  @Requires("agents.manage")
  async setSettings(@Body() body: unknown, @Req() req: MslRequest) {
    const b = z.object({ dynamicRegistration: z.boolean() }).safeParse(body);
    if (!b.success) throw new HttpException("dynamicRegistration (boolean) is required", 400);
    await this.oauth.setRegistration(b.data.dynamicRegistration, this.meta(req));
    return this.oauth.settings();
  }

  /** Purpose: the user's scenarios (agent-made ones carry `origin: agent` and the client name). */
  @Get("scenarios")
  @Requires("agents.connect")
  async list(@Req() req: MslRequest) {
    return { scenarios: await this.scenarios.list(req.session!.actor.userId) };
  }

  /** Purpose: one scenario with its routed lines and validation findings, for the map. */
  @Get("scenarios/:id")
  @Requires("agents.connect")
  async get(@Param("id") id: string, @Req() req: MslRequest) {
    const s = await this.wrap(() => this.scenarios.get(req.session!.actor.userId, id));
    return { ...s, summary: summarise(s.doc), findings: validate(s.doc) };
  }

  /** Purpose: the 15-minute walk coverage and catchment layer of a scenario (`?minutes=`). */
  @Get("scenarios/:id/coverage")
  @Requires("agents.connect")
  async coverage(@Param("id") id: string, @Query("minutes") m: string | undefined, @Req() req: MslRequest) {
    const minutes = m && /^\d{1,2}$/.test(m) ? Math.min(30, Math.max(1, Number(m))) : undefined;
    const s = await this.wrap(() => this.scenarios.get(req.session!.actor.userId, id));
    return this.wrap(async () => {
      const { raw, ...report } = await this.analysis.coverage(s.doc, { preset: "walk_minutes", minutes });
      void raw;
      const layer = await this.analysis.catchment(s.doc, minutes ?? 15);
      return { report, layer };
    });
  }

  /** Purpose: delete one of the user's scenarios. */
  @Delete("scenarios/:id")
  @Requires("agents.connect")
  @HttpCode(200)
  async remove(@Param("id") id: string, @Req() req: MslRequest) {
    await this.wrap(() => this.scenarios.remove(this.meta(req), id));
    return { ok: true };
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ScenarioError) throw new HttpException(e.message, e.status);
      if (e instanceof NetworkError) throw new HttpException(e.message, 422);
      if (e instanceof WasmMissingError) throw new HttpException(e.message, 503);
      throw e;
    }
  }
}
