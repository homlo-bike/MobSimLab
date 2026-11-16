import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { APP_CONFIG } from "../config/config.module";
import { type AppConfig, bootstrapOwnerSet } from "../config/env";
import { DATABASE, type Database, type InstanceRole } from "../db/database";
import { mappedRole, meetsRegistrationRules } from "../iam/roles";
import type { OidcIdentity } from "./oidc.service";

/** Why a sign-in was refused; shown to the user as a fixed message. */
export type LoginRefusal =
  "setup_in_progress" | "not_bootstrap_owner" | "pending_approval" | "account_deleted";

export type LoginOutcome =
  { ok: true; userId: string; claimedOwner: boolean } | { ok: false; reason: LoginRefusal };

/** The identity of the desktop app's local Owner. No provider issues it; only `POST /api/auth/local` uses it. */
export const LOCAL_IDENTITY: OidcIdentity = {
  issuer: "mobsimlab:local",
  subject: "owner",
  email: null,
  emailVerified: false,
  name: "Local user",
  groups: [],
};

/** Request context recorded in the audit log. */
export interface RequestMeta {
  ipHash: string | null;
  requestId: string | null;
}

/** Decides who may sign in, including first-owner setup mode (05 §3.1, ADR-0015). */
@Injectable()
export class AuthService {
  private readonly log = new Logger("security");

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  /**
   * Purpose: map a verified OIDC identity to a user and decide whether it may sign in.
   * Inputs: identity from the ID token; request metadata for the audit log.
   * Output: the user id, or the reason for refusal.
   * Side effects: in one transaction holding a row lock on the instance row (so two first logins cannot
   * both become Owner): creates or updates the user and identity, and writes audit records.
   */
  async signIn(id: OidcIdentity, meta: RequestMeta): Promise<LoginOutcome> {
    return this.db.transaction().execute(async (tx) => {
      const inst = await tx.selectFrom("iam.instance").selectAll().forUpdate().executeTakeFirstOrThrow();
      const existing = await tx
        .selectFrom("iam.identity as i")
        .innerJoin("iam.user as u", "u.id", "i.user_id")
        .select(["u.id", "u.instance_role", "u.status", "u.role_override"])
        .where("i.issuer", "=", id.issuer)
        .where("i.subject", "=", id.subject)
        .executeTakeFirst();
      if (existing?.status === "deleted") return { ok: false, reason: "account_deleted" } as const;
      const auditBase = { actorIpHash: meta.ipHash, requestId: meta.requestId, objectType: "user" };

      let userId = existing?.id;
      let claimedOwner = false;
      if (inst.mode === "setup") {
        if (existing?.instance_role !== "owner" || existing.status !== "active") {
          const owner = await tx
            .selectFrom("iam.user")
            .select("id")
            .where("instance_role", "=", "owner")
            .where("status", "=", "active")
            .executeTakeFirst();
          if (owner) return { ok: false, reason: "setup_in_progress" } as const;
          if (!bootstrapOwnerSet(this.config))
            this.log.warn(
              "sign-in refused in setup mode: set MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL or MOBSIMLAB_BOOTSTRAP_OWNER_SUBJECT to name the first Owner",
            );
          // Nobody may claim the instance unless the operator named the first Owner, and a suspended account
          // never may, even when it matches (security review: first sign-in must not hand out the instance).
          if (
            !bootstrapOwnerSet(this.config) ||
            existing?.instance_role === "restricted" ||
            !this.mayBecomeOwner(id)
          )
            return { ok: false, reason: "not_bootstrap_owner" } as const;
          if (existing) {
            await tx
              .updateTable("iam.user")
              .set({ instance_role: "owner", status: "active" })
              .where("id", "=", existing.id)
              .execute();
          } else {
            userId = await this.createUser(tx, id, "owner", "active");
          }
          claimedOwner = true;
          await this.audit.append(
            {
              ...auditBase,
              action: "instance.owner_claimed",
              objectId: userId,
              actorId: userId,
              before: existing ? { instance_role: existing.instance_role, status: existing.status } : null,
              after: { instance_role: "owner", status: "active", issuer: id.issuer, subject: id.subject },
            },
            tx,
          );
        }
      } else if (!existing) {
        const mappings = await tx.selectFrom("iam.group_mapping").selectAll().execute();
        const allowed = inst.auto_registration && meetsRegistrationRules(id, inst);
        const status = allowed ? "active" : "pending";
        // Pending users keep the role they would get, so the approver sees a proposal.
        const role = mappedRole(id.issuer, id.groups, mappings) ?? inst.default_role;
        userId = await this.createUser(tx, id, role, status);
        await this.audit.append(
          {
            ...auditBase,
            action: "user.registered",
            objectId: userId,
            actorId: userId,
            after: { instance_role: role, status, issuer: id.issuer, subject: id.subject },
          },
          tx,
        );
        if (status === "pending") return { ok: false, reason: "pending_approval" } as const;
      } else if (existing.status === "pending") {
        return { ok: false, reason: "pending_approval" } as const;
      } else if (existing.instance_role !== "owner" && !existing.role_override) {
        const mappings = await tx.selectFrom("iam.group_mapping").selectAll().execute();
        const role = mappedRole(id.issuer, id.groups, mappings);
        if (role && role !== existing.instance_role) {
          await this.setMappedRole(tx, existing.id, existing.instance_role, role, auditBase);
        }
      }

      if (!userId) throw new Error("unreachable: no user id");
      await tx
        .updateTable("iam.identity")
        .set({ email: id.email, groups: JSON.stringify(id.groups), last_seen_at: new Date() })
        .where("issuer", "=", id.issuer)
        .where("subject", "=", id.subject)
        .execute();
      await tx
        .updateTable("iam.user")
        .set({
          last_login_at: new Date(),
          email: id.email,
          email_verified: Boolean(id.email && id.emailVerified),
          display_name: id.name,
        })
        .where("id", "=", userId)
        .execute();
      await this.audit.append({ ...auditBase, action: "auth.login", objectId: userId, actorId: userId }, tx);
      return { ok: true, userId, claimedOwner } as const;
    });
  }

  /**
   * Purpose: sign in the desktop app's single local Owner (local mode, no provider). The first time, it creates
   * the Owner and finishes setup, since nobody else can ever sign in to a local instance.
   * Inputs: request metadata for the audit log. Output: the Owner's user id.
   * Side effects: in one transaction holding the instance row lock: creates the user and identity once, opens the
   * instance, and writes audit records.
   */
  async signInLocalOwner(meta: RequestMeta): Promise<string> {
    return this.db.transaction().execute(async (tx) => {
      const inst = await tx.selectFrom("iam.instance").selectAll().forUpdate().executeTakeFirstOrThrow();
      const auditBase = { actorIpHash: meta.ipHash, requestId: meta.requestId, objectType: "user" };
      const existing = await tx
        .selectFrom("iam.identity")
        .select("user_id")
        .where("issuer", "=", LOCAL_IDENTITY.issuer)
        .where("subject", "=", LOCAL_IDENTITY.subject)
        .executeTakeFirst();
      let userId = existing?.user_id;
      if (!userId) {
        userId = await this.createUser(tx, LOCAL_IDENTITY, "owner", "active");
        await this.audit.append(
          {
            ...auditBase,
            action: "instance.owner_claimed",
            objectId: userId,
            actorId: userId,
            after: { instance_role: "owner", status: "active", issuer: LOCAL_IDENTITY.issuer },
          },
          tx,
        );
      } else {
        // The local Owner is the only person on this computer: keep the account usable whatever happened to it.
        await tx
          .updateTable("iam.user")
          .set({ instance_role: "owner", status: "active" })
          .where("id", "=", userId)
          .execute();
      }
      if (inst.mode === "setup") {
        await tx
          .updateTable("iam.instance")
          .set({ mode: "open", name: "This computer", setup_finished_at: new Date(), updated_at: new Date() })
          .execute();
        await this.audit.append(
          {
            ...auditBase,
            action: "instance.setup_finished",
            objectType: "instance",
            actorId: userId,
            before: { mode: "setup" },
            after: { mode: "open", local: true },
          },
          tx,
        );
      }
      await tx.updateTable("iam.user").set({ last_login_at: new Date() }).where("id", "=", userId).execute();
      await this.audit.append({ ...auditBase, action: "auth.login", objectId: userId, actorId: userId }, tx);
      return userId;
    });
  }

  /** Purpose: apply a role recomputed from group mappings at sign-in, with an audit record. */
  private async setMappedRole(
    tx: Database,
    userId: string,
    before: InstanceRole,
    after: InstanceRole,
    auditBase: { actorIpHash: string | null; requestId: string | null; objectType: string },
  ): Promise<void> {
    await tx.updateTable("iam.user").set({ instance_role: after }).where("id", "=", userId).execute();
    await this.audit.append(
      {
        ...auditBase,
        action: "user.role_mapped",
        objectId: userId,
        actorId: userId,
        before: { instance_role: before },
        after: { instance_role: after },
      },
      tx,
    );
  }

  /** Purpose: apply the MOBSIMLAB_BOOTSTRAP_OWNER_* restrictions (at least one is set, see signIn). */
  private mayBecomeOwner(id: OidcIdentity): boolean {
    const { bootstrapOwnerEmail: email, bootstrapOwnerSubject: subject } = this.config;
    if (email && !(id.emailVerified && id.email === email.toLowerCase())) return false;
    if (subject && id.subject !== subject) return false;
    return true;
  }

  private async createUser(
    tx: Database,
    id: OidcIdentity,
    role: InstanceRole,
    status: "active" | "pending",
  ): Promise<string> {
    const u = await tx
      .insertInto("iam.user")
      .values({
        email: id.email,
        email_verified: Boolean(id.email && id.emailVerified),
        display_name: id.name,
        instance_role: role,
        status,
        last_login_at: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("iam.identity")
      .values({
        issuer: id.issuer,
        subject: id.subject,
        user_id: u.id,
        email: id.email,
        groups: JSON.stringify(id.groups),
      })
      .execute();
    return u.id;
  }
}
