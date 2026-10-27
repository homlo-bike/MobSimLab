# ADR-0015: OIDC-only authentication with a one-time instance claim

- Status: Proposed
- Date: 2026-10-27
- Related: FR-AUTH-01..05, C-07

## Context

The brief says the first user to log in becomes Owner. With an open IdP this lets anyone take over a new instance.

## Decision

- OIDC Authorization Code + PKCE only; account key is (issuer, subject).
- Instance starts **unclaimed**. Claiming requires OIDC login plus a one-time setup token (printed once, stored hashed, 24 h expiry) **or** a match with `MOBSIMLAB_BOOTSTRAP_OWNER_SUBJECT`/`_EMAIL` (verified email).
- Auto-registration off by default.

## Consequences

One extra step for the operator at install. No window in which a stranger can claim the instance.
