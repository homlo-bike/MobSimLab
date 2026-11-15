import { createHash, createPublicKey, type KeyObject, verify } from "node:crypto";
import { PackageError } from "./zip";

/** The checksum list every package carries: `<sha256 hex>  <path>` per file, as `sha256sum` writes it. */
export const CHECKSUMS = "SHA256SUMS";
/** The publisher's signature over CHECKSUMS, base64 (as `cosign sign-blob --key` or `openssl dgst -sign` writes it). */
export const SIGNATURE = "SHA256SUMS.sig";

/** A publisher key an Admin trusts (ADR-0036 §9 trust policy). */
export interface TrustedKey {
  id: string;
  name: string;
  publicKey: string;
}

/** How a package is signed. */
export type SignatureStatus =
  | { status: "trusted"; keyId: string; keyName: string }
  | { status: "unsigned" }
  | { status: "untrusted" };

/** Purpose: SHA-256 of bytes as lower-case hex. */
export const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/**
 * Purpose: parse and check a publisher's public key (PEM, ECDSA P-256 or Ed25519, the key types cosign and
 * openssl make). Output: the key and its fingerprint (SHA-256 of the DER public key, hex).
 * Throws PackageError with a plain message when the text is not such a key.
 */
export function parsePublicKey(pem: string): { key: KeyObject; fingerprint: string } {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: pem.trim(), format: "pem" });
  } catch {
    throw new PackageError("that is not a PEM public key");
  }
  const type = key.asymmetricKeyType;
  const curve = key.asymmetricKeyDetails?.namedCurve;
  if (!(type === "ed25519" || (type === "ec" && curve === "prime256v1")))
    throw new PackageError("only ECDSA P-256 and Ed25519 public keys are accepted");
  const der = key.export({ type: "spki", format: "der" });
  return { key, fingerprint: sha256(der) };
}

/**
 * Purpose: check that the package's checksum list covers exactly its files with the right hashes, so a
 * signature over the list covers every byte of the package (ADR-0036 §9, PL4).
 * Inputs: the unpacked files. Output: path → SHA-256 of every file except the list and the signature.
 * Throws PackageError naming the first mismatch. A package without SHA256SUMS gets its hashes computed.
 */
export function checkChecksums(files: ReadonlyMap<string, Buffer>): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const [path, data] of files) if (path !== CHECKSUMS && path !== SIGNATURE) hashes[path] = sha256(data);
  const list = files.get(CHECKSUMS);
  if (!list) {
    if (files.has(SIGNATURE)) throw new PackageError(`${SIGNATURE} without ${CHECKSUMS}`);
    return hashes;
  }
  const listed = new Map<string, string>();
  for (const line of list.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64}) [ *](?:\.\/)?(.+)$/.exec(line.trimEnd());
    if (!m) throw new PackageError(`${CHECKSUMS}: cannot read the line "${line.slice(0, 80)}"`);
    listed.set(m[2]!, m[1]!);
  }
  for (const [path, hash] of Object.entries(hashes)) {
    const want = listed.get(path);
    if (!want) throw new PackageError(`${CHECKSUMS} does not list ${path}`);
    if (want !== hash) throw new PackageError(`${path} does not match its checksum`);
  }
  for (const path of listed.keys())
    if (!(path in hashes)) throw new PackageError(`${CHECKSUMS} lists ${path}, which is not in the package`);
  return hashes;
}

/**
 * Purpose: whether the package is signed by a trusted publisher key.
 * Inputs: the unpacked files (checksums already checked) and the trusted keys.
 * Output: trusted (with the key), unsigned (no signature file) or untrusted (a signature no trusted key verifies).
 */
export function checkSignature(files: ReadonlyMap<string, Buffer>, keys: readonly TrustedKey[]): SignatureStatus {
  const sig = files.get(SIGNATURE);
  const list = files.get(CHECKSUMS);
  if (!sig || !list) return { status: "unsigned" };
  const signature = Buffer.from(sig.toString("utf8").trim(), "base64");
  if (signature.length === 0) return { status: "untrusted" };
  for (const k of keys) {
    let key: KeyObject;
    try {
      key = parsePublicKey(k.publicKey).key;
    } catch {
      continue;
    }
    const algorithm = key.asymmetricKeyType === "ed25519" ? null : "sha256";
    try {
      if (verify(algorithm, list, key, signature)) return { status: "trusted", keyId: k.id, keyName: k.name };
    } catch {
      // A signature of the wrong shape for this key type: try the next key.
    }
  }
  return { status: "untrusted" };
}
