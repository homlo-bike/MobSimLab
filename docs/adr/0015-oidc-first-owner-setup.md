# ADR-0015: OIDC-only authentication; first user becomes Owner in setup mode

- Status: Accepted (product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-AUTH-01..05, C-07

## Context

The brief says the first user to log in becomes Owner. The product owner confirmed MobSimLab is self-hosted and not exposed to the internet, and that the Owner must finish configuring the instance before anyone else can access it.

## Decision

- OIDC Authorization Code + PKCE only; account key is (issuer, subject).
- On first start the instance is in **setup mode**. The first user to complete an OIDC login becomes **Owner** (single transaction with a row lock).
- In setup mode, every other login is refused ("This instance is being set up").
- The Owner completes a **setup wizard** (instance name and URL, OIDC providers and group mappings, auto-registration policy and default role, external providers and credentials, basemaps, units/locale, default Project Preferences) and presses **Finish setup**. Only then can other users log in.
- Auto-registration is off by default.
- Optional `MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL`/`_SUBJECT` pins who may become Owner, for IdPs shared with other people. Off by default.
- `mobsimlab admin reset-owner` (operator command inside the container) returns the instance to setup mode for recovery; audited.

## Alternatives considered

| Option | Why not |
|--------|---------|
| One-time setup token | Extra friction; not needed for private-network deployments (product owner decision). Remains possible later as a hardening option |

## Consequences

Simple first run. Documentation must state clearly that the instance should not be reachable by others until setup is finished, and recommend the owner pin when the IdP is public (e.g. Google).
