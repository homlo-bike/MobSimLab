# ADR-0016: Docker secrets for instance secrets; envelope encryption for provider credentials

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: NFR-SEC-03, 05 §3.6

## Context

No hardcoded credentials, no insecure defaults, encrypted storage for provider credentials.

## Decision

- Instance secrets (DB passwords, master key, session secret) are Docker secrets files created by `scripts/init-secrets` with random values; the app refuses to start without them or with known example values.
- Provider credentials: AES-256-GCM with a random per-credential data key, wrapped by the master key; key ID stored for rotation; decrypted only in the gateway at call time; never returned to clients.

### Implementation (after 2026.11.3-alpha)

- `apps/api/src/config/credential-vault.ts`: stored form `msv1:<key id>:<wrapped data key>:<value>`; AES-256-GCM for both layers, the value's place (table, column, row id) as associated data so a value cannot be moved to another row. The key ID is a hash of the master key.
- Stored today: the Esri ArcGIS key (`iam.instance.esri_api_key`) and WMS/WMTS/XYZ sign-in secrets (`plugin.map_layer_service.auth_secret`). Values saved before encryption are encrypted at the next start (`CredentialsAtRest`), and values made with an older master key are moved to the current one.
- `master_key` stays optional for the server: without the Docker secret the API makes a key on its first start and keeps it at `/data/secrets/master_key` (0600, the mobsimlab-data volume, not the database volume). When an operator later provides `master_key`, it becomes current and the made key is still used to read and re-encrypt older values.
- Desktop app (local mode): the master key is kept encrypted by the system's keychain (Electron safeStorage) as `master_key.keychain` and given to the API on its standard input (`MOBSIMLAB_MASTER_KEY_STDIN`), never written in plain text. Without a usable keychain (Linux without a keyring) it stays a file readable only by the user.
- Addresses of map services may not carry a key in their query: it goes in the sign-in fields. Logs mask keys in web addresses (`?token=`, `&apikey=`, `&key=`) as well as secret fields.

## Alternatives considered

| Option | Why not |
|--------|---------|
| pgcrypto in DB | Key would need to be passed to the DB; logs/queries could expose it |
| External vault (HashiCorp Vault) | Extra service; optional integration later |

## Consequences

Losing the master key loses stored provider credentials (they can be re-entered). Backup docs must say so.
