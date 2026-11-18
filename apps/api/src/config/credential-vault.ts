import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Stored provider credentials (API keys, passwords of map services) are encrypted at rest (ADR-0016): each value
 * gets its own random data key, which encrypts it with AES-256-GCM; the data key is itself encrypted with the
 * master key. A stored value names the master key it was made with (its key ID), so a value made with an older
 * key can still be read and is moved to the current key at start-up. The value's place (table, column, row) is
 * bound in as associated data, so a value copied to another row or column cannot be read there.
 *
 * Stored form: `msv1:<key id>:<encrypted data key>:<encrypted value>`, both parts base64url of IV | tag | data.
 */
export const VAULT_PREFIX = "msv1:";

/** Thrown when a stored value cannot be read: damaged, or made with a master key this MobSimLab does not have. */
export class VaultError extends Error {}

const IV = 12;
const TAG = 16;

/** Purpose: the master key's ID: 8 bytes of a SHA-256 of the key, so the ID never tells anything about it. */
function keyId(key: Buffer): string {
  return createHash("sha256")
    .update("mobsimlab-master-key-id\0")
    .update(key)
    .digest("base64url")
    .slice(0, 11);
}

/** Purpose: a 32-byte key from the master_key secret (base64 of 32 random bytes; anything else is hashed). */
export function masterKeyBytes(secret: string): Buffer {
  const raw = Buffer.from(secret.trim(), "base64");
  if (raw.length === 32 && raw.toString("base64") === secret.trim()) return raw;
  return createHash("sha256").update(secret.trim(), "utf8").digest();
}

function seal(key: Buffer, plain: Buffer, aad: string): string {
  const iv = randomBytes(IV);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64url");
}

function open(key: Buffer, sealed: string, aad: string): Buffer {
  const b = Buffer.from(sealed, "base64url");
  if (b.length < IV + TAG) throw new VaultError("the stored value is damaged");
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, IV));
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(b.subarray(IV, IV + TAG));
  try {
    return Buffer.concat([d.update(b.subarray(IV + TAG)), d.final()]);
  } catch {
    throw new VaultError("the stored value is damaged or was made with another master key");
  }
}

/** Encrypts and decrypts stored credentials. Values never appear in its errors. */
export class CredentialVault {
  private readonly keys = new Map<string, Buffer>();
  /** ID of the key new values are made with. */
  readonly currentKeyId: string;

  /** Inputs: the current master key first, then older keys that may still be needed to read stored values. */
  constructor(current: Buffer, older: Buffer[] = []) {
    if (current.length !== 32) throw new Error("the master key must be 32 bytes");
    this.currentKeyId = keyId(current);
    this.keys.set(this.currentKeyId, current);
    for (const k of older) if (k.length === 32 && !this.keys.has(keyId(k))) this.keys.set(keyId(k), k);
  }

  /** Purpose: whether a stored value is in the encrypted form (else it is plain text from before encryption). */
  static isSealed(stored: string): boolean {
    return stored.startsWith(VAULT_PREFIX);
  }

  /** Purpose: whether a stored value should be written again: plain text, or made with an older key. */
  needsReseal(stored: string): boolean {
    return !CredentialVault.isSealed(stored) || stored.split(":")[1] !== this.currentKeyId;
  }

  /** Purpose: encrypt a value for one place (`aad`, such as `iam.instance.esri_api_key`). */
  encrypt(plain: string, aad: string): string {
    const dataKey = randomBytes(32);
    const wrapped = seal(this.keys.get(this.currentKeyId)!, dataKey, `key:${aad}`);
    const body = seal(dataKey, Buffer.from(plain, "utf8"), aad);
    dataKey.fill(0);
    return `${VAULT_PREFIX}${this.currentKeyId}:${wrapped}:${body}`;
  }

  /**
   * Purpose: the plain value of a stored one. A value from before encryption (no prefix) is returned as it is; the
   * start-up pass encrypts those. Throws VaultError when it cannot be read.
   */
  decrypt(stored: string, aad: string): string {
    if (!CredentialVault.isSealed(stored)) return stored;
    const [, id, wrapped, body] = stored.split(":");
    const master = id ? this.keys.get(id) : undefined;
    if (!master || !wrapped || !body)
      throw new VaultError("the stored value was made with a master key this MobSimLab does not have");
    const dataKey = open(master, wrapped, `key:${aad}`);
    try {
      return open(dataKey, body, aad).toString("utf8");
    } finally {
      dataKey.fill(0);
    }
  }
}

/**
 * Purpose: the vault for this MobSimLab. The master key is the `master_key` secret when the operator provides
 * one; otherwise a key made on the first start and kept in `fallbackFile` (in the data volume, apart from the
 * database, so a database backup alone never holds readable credentials). When both exist, the provided one is
 * current and the kept one is still used to read values made with it.
 * Side effects: may create `fallbackFile` (mode 0600).
 */
export function vaultFor(masterKey: string | undefined, fallbackFile: string): CredentialVault {
  const kept = (): Buffer | undefined =>
    existsSync(fallbackFile) ? masterKeyBytes(readFileSync(fallbackFile, "utf8")) : undefined;
  if (masterKey) {
    const old = kept();
    return new CredentialVault(masterKeyBytes(masterKey), old ? [old] : []);
  }
  const have = kept();
  if (have) return new CredentialVault(have);
  mkdirSync(dirname(fallbackFile), { recursive: true, mode: 0o700 });
  const made = randomBytes(32);
  writeFileSync(fallbackFile, made.toString("base64"), { mode: 0o600, flag: "wx" });
  return new CredentialVault(made);
}
