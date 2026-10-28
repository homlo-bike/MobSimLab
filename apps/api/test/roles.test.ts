import { describe, expect, it } from "vitest";
import { type GroupMapping, mappedRole, mayManage, meetsRegistrationRules } from "../src/iam/roles";

const m = (group_value: string, instance_role: GroupMapping["instance_role"], issuer: string | null = null) => ({
  group_value,
  instance_role,
  issuer,
});

describe("group mappings", () => {
  const mappings = [m("staff", "viewer"), m("planners", "user"), m("it", "admin", "https://a"), m("x", "restricted")];
  it("returns null when nothing matches", () => {
    expect(mappedRole("https://a", ["other"], mappings)).toBeNull();
  });
  it("picks the highest matching role", () => {
    expect(mappedRole("https://a", ["staff", "planners"], mappings)).toBe("user");
    expect(mappedRole("https://a", ["staff", "it"], mappings)).toBe("admin");
  });
  it("respects the issuer of a mapping", () => {
    expect(mappedRole("https://b", ["it"], mappings)).toBeNull();
  });
  it("lets restricted win", () => {
    expect(mappedRole("https://a", ["it", "x"], mappings)).toBe("restricted");
  });
});

describe("auto-registration rules", () => {
  const id = { email: "a@Example.org", emailVerified: true, groups: ["g1"] };
  it("allows everyone without rules", () => {
    expect(meetsRegistrationRules(id, { allowed_email_domains: [], allowed_groups: [] })).toBe(true);
  });
  it("matches a verified e-mail domain, case-insensitively", () => {
    expect(meetsRegistrationRules(id, { allowed_email_domains: ["example.org"], allowed_groups: [] })).toBe(true);
    expect(
      meetsRegistrationRules({ ...id, emailVerified: false }, { allowed_email_domains: ["example.org"], allowed_groups: [] }),
    ).toBe(false);
  });
  it("matches a group", () => {
    expect(meetsRegistrationRules(id, { allowed_email_domains: ["other.org"], allowed_groups: ["g1"] })).toBe(true);
    expect(meetsRegistrationRules(id, { allowed_email_domains: [], allowed_groups: ["g2"] })).toBe(false);
  });
});

describe("who may manage whom", () => {
  it("lets owners do everything", () => {
    expect(mayManage("owner", "admin", "owner")).toBe(true);
  });
  it("keeps admins away from owners and admins", () => {
    expect(mayManage("admin", "user", "restricted")).toBe(true);
    expect(mayManage("admin", "user", "admin")).toBe(false);
    expect(mayManage("admin", "admin", "user")).toBe(false);
    expect(mayManage("admin", "owner")).toBe(false);
  });
  it("refuses everyone else", () => {
    expect(mayManage("user", "viewer", "viewer")).toBe(false);
  });
});
