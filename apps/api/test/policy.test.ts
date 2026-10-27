import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { INSTANCE_ROLES } from "../src/db/database";
import { ACTIONS, type Actor, can, POLICY } from "../src/iam/policy";
import { PUBLIC_KEY, REQUIRES_KEY } from "../src/iam/requires";
import { testConfig } from "./support/app";

const actor = (role: Actor["role"], status: Actor["status"] = "active"): Actor => ({
  userId: "u",
  role,
  status,
});

describe("permission policy", () => {
  it("matches the role matrix in 05 §3.2", () => {
    const matrix = Object.fromEntries(
      ACTIONS.map((a) => [a, INSTANCE_ROLES.filter((r) => can(actor(r), a)).join(",")]),
    );
    expect(matrix).toEqual({
      "session.own": "owner,admin,user,viewer,restricted",
      "instance.read": "owner,admin,user,viewer",
      "setup.manage": "owner",
      "users.manage": "owner,admin",
      "audit.read": "owner,admin",
      "projects.create": "owner,admin,user",
    });
  });

  it("allows nothing to signed-out, pending or deleted users", () => {
    for (const a of ACTIONS) {
      expect(can(null, a)).toBe(false);
      expect(can(actor("owner", "pending"), a)).toBe(false);
      expect(can(actor("owner", "deleted"), a)).toBe(false);
    }
  });

  it("has a policy entry for every action", () => {
    expect(Object.keys(POLICY).sort()).toEqual([...ACTIONS].sort());
  });

  it("every route declares @Requires or @Public", () => {
    const controllers = AppModule.forRoot(testConfig()).controllers ?? [];
    const routes: string[] = [];
    const missing: string[] = [];
    for (const c of controllers) {
      const proto = (c as { prototype: Record<string, unknown> }).prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name];
        if (typeof fn !== "function" || Reflect.getMetadata(METHOD_METADATA, fn) === undefined) continue;
        const id = `${(c as { name: string }).name}.${name} ${String(Reflect.getMetadata(PATH_METADATA, fn))}`;
        routes.push(id);
        if (!Reflect.getMetadata(REQUIRES_KEY, fn) && !Reflect.getMetadata(PUBLIC_KEY, fn)) missing.push(id);
      }
    }
    expect(routes.length).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });
});
