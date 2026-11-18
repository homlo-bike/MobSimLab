import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CredentialVault, masterKeyBytes, VaultError, vaultFor } from "../src/config/credential-vault";

// A made-up key with little variety, so secret scanners do not take it for a real one.
const KEY = `test-${"x".repeat(26)}WXYZ`;
const PLACE = "iam.instance.esri_api_key";

describe("credential vault", () => {
  it("encrypts each value with its own data key and reads it back only in its own place", () => {
    const v = new CredentialVault(randomBytes(32));
    const a = v.encrypt(KEY, PLACE);
    const b = v.encrypt(KEY, PLACE);
    expect(a).not.toBe(b);
    expect(a.startsWith(`msv1:${v.currentKeyId}:`)).toBe(true);
    expect(a).not.toContain(KEY);
    expect(v.decrypt(a, PLACE)).toBe(KEY);
    expect(() => v.decrypt(a, "plugin.map_layer_service.auth_secret:1")).toThrow(VaultError);
    expect(v.needsReseal(a)).toBe(false);
  });

  it("refuses a changed value and one made with another master key, without naming the value", () => {
    const v = new CredentialVault(randomBytes(32));
    const sealed = v.encrypt(KEY, PLACE);
    const parts = sealed.split(":");
    const body = Buffer.from(parts[3]!, "base64url");
    body[body.length - 1]! ^= 1;
    parts[3] = body.toString("base64url");
    expect(() => v.decrypt(parts.join(":"), PLACE)).toThrow(VaultError);
    const other = new CredentialVault(randomBytes(32));
    expect(() => other.decrypt(sealed, PLACE)).toThrow(/master key/);
    try {
      other.decrypt(sealed, PLACE);
    } catch (e) {
      expect(String(e)).not.toContain(KEY);
    }
  });

  it("reads values made with an older key and marks them, and plain values, for re-encryption", () => {
    const oldKey = randomBytes(32);
    const old = new CredentialVault(oldKey).encrypt(KEY, PLACE);
    const v = new CredentialVault(randomBytes(32), [oldKey]);
    expect(v.decrypt(old, PLACE)).toBe(KEY);
    expect(v.needsReseal(old)).toBe(true);
    expect(v.needsReseal(KEY)).toBe(true);
    expect(v.decrypt(KEY, PLACE)).toBe(KEY);
  });

  it("makes a master key once when the operator provides none, and keeps it readable only by its owner", () => {
    const dir = mkdtempSync(join(tmpdir(), "msl-vault-"));
    const file = join(dir, "secrets", "master_key");
    const first = vaultFor(undefined, file);
    const sealed = first.encrypt(KEY, PLACE);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o077).toBe(0);
    expect(vaultFor(undefined, file).decrypt(sealed, PLACE)).toBe(KEY);
    // An operator who adds master_key later: it becomes current, the made key still reads older values.
    const provided = randomBytes(32).toString("base64");
    const next = vaultFor(provided, file);
    expect(next.currentKeyId).not.toBe(first.currentKeyId);
    expect(next.decrypt(sealed, PLACE)).toBe(KEY);
    expect(next.needsReseal(sealed)).toBe(true);
    expect(masterKeyBytes(readFileSync(file, "utf8"))).toHaveLength(32);
  });
});
