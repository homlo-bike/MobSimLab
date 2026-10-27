# ADR-0016: Docker secrets for instance secrets; envelope encryption for provider credentials

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: NFR-SEC-03, 05 §3.6

## Context

No hardcoded credentials, no insecure defaults, encrypted storage for provider credentials.

## Decision

- Instance secrets (DB passwords, master key, session secret) are Docker secrets files created by `scripts/init-secrets` with random values; the app refuses to start without them or with known example values.
- Provider credentials: AES-256-GCM with a random per-credential data key, wrapped by the master key; key ID stored for rotation; decrypted only in the gateway at call time; never returned to clients.

## Alternatives considered

| Option | Why not |
|--------|---------|
| pgcrypto in DB | Key would need to be passed to the DB; logs/queries could expose it |
| External vault (HashiCorp Vault) | Extra service; optional integration later |

## Consequences

Losing the master key loses stored provider credentials (they can be re-entered). Backup docs must say so.
