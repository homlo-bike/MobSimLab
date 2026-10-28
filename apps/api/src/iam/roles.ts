import type { InstanceRole, MappableRole } from "../db/database";
import { roleRank } from "../db/database";

/** One group mapping as stored in iam.group_mapping. */
export interface GroupMapping {
  issuer: string | null;
  group_value: string;
  instance_role: MappableRole;
}

/**
 * Purpose: the instance role that the IdP groups of a sign-in map to (05 §3.2 group mapping).
 * Inputs: the identity's issuer and group claim values; all mappings.
 * Output: the mapped role, or null when no mapping matches. A matching "restricted" mapping wins, so a
 * suspension group cannot be overridden by another group; otherwise the highest matching role wins.
 */
export function mappedRole(
  issuer: string,
  groups: readonly string[],
  mappings: readonly GroupMapping[],
): MappableRole | null {
  const matched = mappings
    .filter((m) => (m.issuer === null || m.issuer === issuer) && groups.includes(m.group_value))
    .map((m) => m.instance_role);
  if (matched.length === 0) return null;
  if (matched.includes("restricted")) return "restricted";
  return matched.reduce((best, r) => (roleRank(r) < roleRank(best) ? r : best));
}

/** Auto-registration rules from iam.instance. Empty lists mean "anyone". */
export interface RegistrationRules {
  allowed_email_domains: readonly string[];
  allowed_groups: readonly string[];
}

/**
 * Purpose: whether a new identity may be activated by auto-registration (05 §3.2).
 * Inputs: e-mail (and whether the provider verified it), group claim values, the rules.
 * Output: true when no rule is set, or when the verified e-mail domain or one group is allowed.
 */
export function meetsRegistrationRules(
  id: { email: string | null; emailVerified: boolean; groups: readonly string[] },
  rules: RegistrationRules,
): boolean {
  const { allowed_email_domains: domains, allowed_groups: groups } = rules;
  if (domains.length === 0 && groups.length === 0) return true;
  const domain = id.emailVerified && id.email ? id.email.slice(id.email.lastIndexOf("@") + 1) : null;
  if (domain && domains.includes(domain.toLowerCase())) return true;
  return id.groups.some((g) => groups.includes(g));
}

/**
 * Purpose: whether `actor` may give `target` the role `next`, or act on `target` at all (05 §3.2).
 * Inputs: actor role; target's current role; the new role (omit for delete/approve checks).
 * Output: true if allowed. Only an Owner may touch Owners and Admins or create them.
 */
export function mayManage(actor: InstanceRole, current: InstanceRole, next?: InstanceRole): boolean {
  const privileged = (r: InstanceRole) => r === "owner" || r === "admin";
  if (actor === "owner") return true;
  if (actor !== "admin") return false;
  return !privileged(current) && (next === undefined || !privileged(next));
}
