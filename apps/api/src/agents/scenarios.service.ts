import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { DATABASE, type Database } from "../db/database";
import { NetworkService } from "./network.service";
import { applyChanges, type Change, EMPTY_DOC, type ScenarioDoc } from "./scenario";

/** Who changes a scenario: a user in the web app, or a user through an agent connection. */
export interface Actor {
  userId: string;
  connectionId?: string;
  clientName?: string;
  tool?: string;
  ipHash?: string | null;
  requestId?: string | null;
}

/** A scenario could not be found, may not be changed by this actor, or the version moved on. */
export class ScenarioError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface ScenarioRow {
  id: string;
  name: string;
  description: string;
  origin: "agent" | "user";
  client_name: string | null;
  connection_id: string | null;
  parent_id: string | null;
  version: number;
  doc: ScenarioDoc;
  created_at: Date;
  updated_at: Date;
}

/** Most scenarios per user (agents can loop). */
export const MAX_SCENARIOS = 200;

/**
 * Agent scenarios in the user's workspace (ADR-0035 §3): create, change through the command model, delete.
 * Every change is audited with the agent client and tool that made it and a hash of the arguments.
 */
@Injectable()
export class ScenariosService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly network: NetworkService,
  ) {}

  /** Purpose: the user's scenarios, newest change first. */
  async list(userId: string) {
    return this.db
      .selectFrom("agent.scenario")
      .select([
        "id",
        "name",
        "description",
        "origin",
        "client_name",
        "parent_id",
        "version",
        "created_at",
        "updated_at",
      ])
      .where("owner_id", "=", userId)
      .orderBy("updated_at", "desc")
      .limit(MAX_SCENARIOS)
      .execute();
  }

  /** Purpose: one of the user's scenarios. Throws ScenarioError 404. */
  async get(userId: string, id: string): Promise<ScenarioRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ScenarioError(`no scenario ${id}`, 404);
    const r = await this.db
      .selectFrom("agent.scenario")
      .selectAll()
      .where("id", "=", id)
      .where("owner_id", "=", userId)
      .executeTakeFirst();
    if (!r) throw new ScenarioError(`no scenario ${id}`, 404);
    return { ...r, doc: r.doc as ScenarioDoc };
  }

  /** Purpose: create a scenario, empty or as a copy of a parent. Side effects: audit record. */
  async create(a: Actor, name: string, description: string, parentId?: string): Promise<ScenarioRow> {
    const count = await this.db
      .selectFrom("agent.scenario")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("owner_id", "=", a.userId)
      .executeTakeFirstOrThrow();
    if (Number(count.n) >= MAX_SCENARIOS)
      throw new ScenarioError(`at most ${MAX_SCENARIOS} scenarios; delete some first`, 409);
    const doc = parentId ? (await this.get(a.userId, parentId)).doc : EMPTY_DOC;
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .insertInto("agent.scenario")
        .values({
          owner_id: a.userId,
          connection_id: a.connectionId ?? null,
          origin: a.connectionId ? "agent" : "user",
          client_name: a.clientName ?? null,
          name,
          description,
          parent_id: parentId ?? null,
          doc: JSON.stringify(doc),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.append(
        {
          action: "agent.scenario_created",
          objectType: "agent_scenario",
          objectId: row.id,
          ...this.who(a),
          after: { ...this.via(a, { name, parentId }), name, parent_id: parentId ?? null },
        },
        tx,
      );
      return { ...row, doc: row.doc as ScenarioDoc };
    });
  }

  /**
   * Purpose: apply a batch of changes atomically, re-route the lines they touch, and save a new version.
   * Inputs: actor, scenario id, changes, and the version the caller last saw (optional optimistic check).
   * Output: the saved row. Throws ChangeError (bad change) or ScenarioError (missing, conflict).
   * Side effects: may fetch street tiles; audit record.
   */
  async apply(a: Actor, id: string, changes: Change[], expectedVersion?: number): Promise<ScenarioRow> {
    const cur = await this.get(a.userId, id);
    if (expectedVersion !== undefined && expectedVersion !== cur.version)
      throw new ScenarioError(
        `scenario is at version ${cur.version}, not ${expectedVersion}; read it again`,
        409,
      );
    const doc = await this.network.route(applyChanges(cur.doc, changes));
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .updateTable("agent.scenario")
        .set({ doc: JSON.stringify(doc), version: cur.version + 1, updated_at: new Date() })
        .where("id", "=", id)
        .where("version", "=", cur.version)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new ScenarioError("scenario changed meanwhile; read it again", 409);
      await this.audit.append(
        {
          action: "agent.scenario_changed",
          objectType: "agent_scenario",
          objectId: id,
          ...this.who(a),
          after: { ...this.via(a, changes), version: row.version, changes: changes.length },
        },
        tx,
      );
      return { ...row, doc: row.doc as ScenarioDoc };
    });
  }

  /**
   * Purpose: delete a scenario. Agents may delete only scenarios their own connection created; people may
   * delete any of theirs. Side effects: audit record.
   */
  async remove(a: Actor, id: string): Promise<void> {
    const cur = await this.get(a.userId, id);
    if (a.connectionId && cur.connection_id !== a.connectionId)
      throw new ScenarioError("an agent can only delete scenarios it created itself", 403);
    await this.db.transaction().execute(async (tx) => {
      await tx.deleteFrom("agent.scenario").where("id", "=", id).execute();
      await this.audit.append(
        {
          action: "agent.scenario_deleted",
          objectType: "agent_scenario",
          objectId: id,
          ...this.who(a),
          before: { name: cur.name, version: cur.version },
          after: this.via(a, { id }),
        },
        tx,
      );
    });
  }

  private who(a: Actor) {
    return { actorId: a.userId, actorIpHash: a.ipHash ?? null, requestId: a.requestId ?? null };
  }

  /** Purpose: the "via agent" part of an audit record: client, connection, tool and argument hash. */
  private via(a: Actor, args: unknown) {
    if (!a.connectionId) return { via: "web" };
    return {
      via: a.clientName,
      connection: a.connectionId,
      tool: a.tool,
      args_sha256: createHash("sha256").update(JSON.stringify(args)).digest("hex"),
    };
  }
}
