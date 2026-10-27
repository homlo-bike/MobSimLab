# MobSimLab threat model

- Method: STRIDE per element and trust boundary, with OWASP Top 10 (2021) mapping
- Scope: planned v1.0 architecture ([03](../architecture/03-technical-architecture.md), [05](../architecture/05-security-users.md))
- Status: Draft. To be revisited at the end of every implementation phase and before each release.

## 1. Assets

| ID | Asset | Why it matters |
|----|-------|----------------|
| A1 | Private project data (networks, proposals, costs) | Confidential pre-decision plans of agencies |
| A2 | Provider credentials (API keys, WMS passwords) | Third-party account abuse, billing |
| A3 | Instance secrets (master key, DB passwords, session secret) | Full compromise |
| A4 | User identities, sessions, roles | Account takeover, privilege escalation |
| A5 | Audit trail | Accountability; tampering hides abuse |
| A6 | Simulation and appraisal results | Integrity of public decisions |
| A7 | Host resources (CPU, RAM, disk) | Availability for all users |
| A8 | Software supply chain (image, dependencies, catalogue data) | Backdoors reach every installation |

## 2. Actors

Anonymous internet user · authenticated low-privilege user (Viewer/Restricted) · malicious project collaborator · compromised IdP account · malicious or compromised external provider · malicious uploaded file author · malicious contributor (supply chain) · operator with host access (trusted).

## 3. Data flow and trust boundaries

See the diagram in [05 §2](../architecture/05-security-users.md#2-trust-boundaries). Boundaries: TB1 browser→API, TB2 API↔IdP, TB3 API→external providers, TB4 API↔DB, TB5 API→workers (jobs with user-controlled inputs), TB6 tool-runner parsing untrusted files.

## 4. Threats and mitigations

Risk = likelihood × impact (H/M/L) **after** planned mitigations; anything still Medium or above needs a test in the security test suite.

### Spoofing

| ID | Threat | Mitigation | Residual |
|----|--------|------------|----------|
| S1 | Someone else logs in first and becomes Owner of a fresh instance | Deployment on a private network (product decision); setup mode refuses all other logins until the Owner finishes setup; first-owner creation shown in the wizard and audited; optional `MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL` pin; `reset-owner` operator command (ADR-0015) | M (if exposed or IdP shared) / L (private network) |
| S2 | Account linking by email across IdPs leads to takeover | Match on (issuer, subject) only | L |
| S3 | ID token replay / forged token | PKCE, nonce, state, signature/iss/aud/exp validation with certified library | L |
| S4 | Session hijack via XSS | HttpOnly `__Host-` cookies, strict CSP, no inline scripts, sanitised Markdown | L |
| S5 | CSRF on state-changing endpoints | Double-submit token + SameSite + Origin check | L |
| S6 | Worker impersonation on job queue | Workers use dedicated DB role; jobs signed with run ID bound to DB row; UDS socket file permissions 0600 | L |

### Tampering

| ID | Threat | Mitigation | Residual |
|----|--------|------------|----------|
| T1 | Modify another project's data via IDOR | Central `PermissionService`, `@Requires` on every route (CI-enforced), RLS as second layer | L |
| T2 | Audit log tampering | Append-only grants, hash chain, nightly verification, CRITICAL alert | L |
| T3 | Malicious `.mslab`/GTFS/GeoTIFF overwrites files (path traversal, symlinks) | Sandboxed tool-runner, path normalisation, reject symlinks/absolute paths, write only to scratch | L |
| T4 | Malicious vehicle JSON or assumption YAML in a PR changes results | Schema validation, required sources, CODEOWNERS review on `vehicles/` and `assumptions/`, signed releases | M |
| T5 | Provider returns poisoned data (e.g. altered population) | Source records with retrieval time and checksum, range sanity checks, provider allowlist | M |
| T6 | Concurrent edits silently overwrite | Optimistic locking (ADR-0027) | L |

### Repudiation

| ID | Threat | Mitigation | Residual |
|----|--------|------------|----------|
| R1 | User denies making a change | Audit with actor, request ID, IP hash, before/after | L |
| R2 | Admin removes audit evidence | No delete grant; purge procedure audited at instance chain | L |

### Information disclosure

| ID | Threat | Mitigation | Residual |
|----|--------|------------|----------|
| I1 | Private project visible via vector tiles or search | Tile endpoints and search go through the same permission + RLS path; tile cache keyed by project and permission scope | L |
| I2 | Provider credentials leak to browser | Credentials write-only; tile proxy injects server-side | L |
| I3 | Secrets in logs or error messages | Redaction in all sinks, tests; generic error responses | L |
| I4 | SSRF to cloud metadata or internal services via configurable endpoints | Gateway: allowlist, HTTPS, post-resolution IP checks, redirect checks (ADR-0017) | L |
| I5 | Public project exposes data with restrictive licence | Licence check on "make public"; non-shareable sources block publication | M |
| I6 | Personal data over-collection | Minimal claims stored; PRIVACY.md; export/erase | L |
| I7 | Run outputs readable across projects on the volume | Per-project folders, files served only via API with permission check; no static serving of `/data` | L |

### Denial of service

| ID | Threat | Mitigation | Residual |
|----|--------|------------|----------|
| D1 | Huge OSM import area exhausts DB/disk | Area quotas, PBF path limits, disk usage checks before import | M |
| D2 | Simulation runs starve the API | Separate processes, CPU/memory limits, concurrency caps, per-user run quotas | L |
| D3 | Zip bombs / decompression bombs / huge rasters | Entry count, uncompressed size and ratio limits; raster dimension limits (GDAL config) | L |
| D4 | ReDoS in input validation | No user-supplied regex; vetted patterns; linear-time regex engine where possible | L |
| D5 | Login/API flooding | Rate limiting per IP and per user; reverse proxy limits documented | M |
| D6 | Large WebSocket subscriptions | Viewport filtering, per-connection frame budget, max connections per user | L |

### Elevation of privilege

| ID | Threat | Mitigation | Residual |
|----|--------|------------|----------|
| E1 | Viewer escalates via mass assignment (e.g. `role` in body) | Zod schemas reject unknown fields; role changes only via admin endpoints | L |
| E2 | IdP group claim manipulation | Groups only from validated ID token/userinfo of an allowlisted issuer; manual override pins | L |
| E3 | Code execution via native tool parsing (osmium, GDAL, SUMO netconvert, JRE) | Sandboxed child processes: no network, seccomp, rlimits, read-only FS, non-root; patched versions tracked | M |
| E4 | Container escape | Non-root, cap_drop ALL, no-new-privileges, no Docker socket, read-only root | L |
| E5 | SQL injection in spatial queries | Parameterised Kysely; identifiers from allowlists; Semgrep rules | L |

### Supply chain

| ID | Threat | Mitigation | Residual |
|----|--------|------------|----------|
| SC1 | Malicious or typosquatted npm/PyPI/crates package | Lockfiles with hashes, Renovate with review, `cargo deny`, provenance checks, minimal dependencies | M |
| SC2 | Compromised base image | Digest pinning, Trivy, weekly rebuilds | L |
| SC3 | Tampered release image | cosign signatures, SBOM, SLSA provenance | L |

## 5. OWASP Top 10 (2021) mapping

| Category | Covered by |
|----------|-----------|
| A01 Broken Access Control | T1, I1, I7, E1 |
| A02 Cryptographic Failures | ADR-0016, TLS requirement (C-16) |
| A03 Injection | E5, CSV injection escaping, sanitised Markdown |
| A04 Insecure Design | This threat model, ADRs, setup mode |
| A05 Security Misconfiguration | No defaults, startup checks, hardened compose |
| A06 Vulnerable Components | SC1, SC2, CI scanners |
| A07 Identification and Authentication Failures | S1–S4 |
| A08 Software and Data Integrity Failures | T4, SC3, signed releases |
| A09 Security Logging and Monitoring Failures | ADR-0012, ADR-0022, CRITICAL alerts |
| A10 SSRF | I4, ADR-0017 |

## 6. Security testing plan

- Unit and integration tests for every mitigation marked M or higher.
- Permission matrix test: every route × every role, generated from the policy table.
- DAST: OWASP ZAP baseline in CI against the dev compose stack.
- Fuzzing: file importers (GTFS, GeoJSON, `.mslab`, vehicle JSON) with `cargo fuzz`/Jazzer.js/Atheris.
- Pre-1.0 external penetration test (recommended).
- `SECURITY.md`: private vulnerability reporting via GitHub Security Advisories, 90-day disclosure.
