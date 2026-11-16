# Security review before the first alpha release

Reviewed on 16 November 2026, on `main` at `8e6a303`, before the `v2026.11.1-alpha` image, the desktop clients and
the static viewer are finalised. The review covers Homlo's release checklist, the OWASP Top 10 (2021), and the open
findings of the earlier audit (`security-and-code-audit.md` in the project files, at `e684763`). Each fix comes with
a test; how everything was checked is at the end.

**Overall:** no critical or high-severity problems. Nine problems were fixed (one medium SSRF gap found in this
review, two medium findings from the earlier audit, and lows), plus one broken page: the aerial basemap was
blocked by the app's own Content Security Policy. One medium finding (M2, database passwords) stays open as an
accepted risk, by Homlo's decision.

## Fixed in this review

| # | Finding | Severity | Fix | Test |
|---|---------|----------|-----|------|
| M1 | In setup mode the first person to sign in became Owner when no bootstrap owner was configured, including after `reset-owner`; a Restricted account could also claim Owner after a reset. | Medium | Setup mode now refuses every sign-in until `MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL` or `_SUBJECT` names the first Owner, and a Restricted account never claims it. A security warning explains the refusal; `reset-owner` reminds the operator. README, `.env.example` and the threat model updated. | `auth.int.test.ts`: "refuses every sign-in in setup mode while no first Owner is named", the reset-owner test |
| M3 | An agent sign-in code or refresh token sent twice at the same moment could be exchanged twice (check and "mark used" were separate statements). | Medium | The token is claimed with one `UPDATE … WHERE used_at IS NULL RETURNING`; losing the race counts as a replay, which revokes the connection and is logged. | `agents.int.test.ts`: "never issues tokens twice…" (8 parallel requests; fails on the old code) |
| N1 | **New.** GBFS feed URLs typed by planners were checked by name only, so a public-looking host name that resolves to an internal or cloud-metadata address (SSRF, OWASP A10) passed; the whole answer was also read before the size check. | Medium | Every address the host resolves to must be public (loopback, private, link-local/metadata, CGNAT, multicast, reserved and IPv4-mapped forms refused); the body is read with a running size cap. | `demandBikes.test.ts`: "refuses names that resolve inside the server's network, and oversized answers" |
| N2 | **New.** The aerial basemap (EOX Sentinel-2 tiles) was blocked by the API's Content Security Policy, so it could not load on a real server. | Bug | Its tile server is added to `img-src` and `connect-src`. A test checks every basemap host in the web app is allowed. | `security-headers.test.ts` |
| L1 | Dependency advisories: `@hono/node-server` (2 moderate), `quick-xml` (RUSTSEC-2026-0194, -0195), dev-only `glob` and `minimatch`. | Low | pnpm overrides to `@hono/node-server` 2.1.8, `glob` 14.0.6, `minimatch` 11.0.8; `quick-xml` 0.41 (the deprecated attribute call replaced). | `pnpm audit`, `cargo audit` and `pip-audit` report nothing; street-routing tests pass |
| L2 | One member could fill the simulation queue for everyone: runs started from the web app had no per-person limit. | Low | At most 20 runs queued or running per person (agents keep their own limit of 2). Serialised per person like the agent limit. | `projects.int.test.ts`: "holds each person to a limit of runs…" |
| L3 | Self-registered agent clients that nobody ever connected stayed forever. | Low | Each new registration deletes self-registered clients older than a day with no connection. Registration stays on by default, as the AI agent feature needs it; Admins can still switch it off. | `agents.int.test.ts`: "deletes self-registered clients nobody connected within a day" |
| L4 | Sharing a project by e-mail matched e-mails the provider had not verified. | Low | New column `iam.user.email_verified` (migration 0017), recorded at each sign-in; sharing only matches verified addresses, newest sign-in first. | `projects.int.test.ts`: "shares only with e-mail addresses the sign-in provider verified" |
| L5 | GitHub Actions pinned by tag; Docker base images by tag. A workflow input was pasted into a shell script. | Low | All 47 action references pinned to commit hashes (tag kept as a comment); the Rust, Node, Python, uv and PostGIS images pinned by digest; the OSM benchmark passes its inputs through the environment. | Pins resolved with `git ls-remote` and `docker buildx imagetools inspect`; the image build itself runs in CI |
| — | The `/mcp` sign-in hint left out the `simulation:run` scope. | Bug | The hint lists every scope. | `agents.int.test.ts` |

Further hardening that answers checklist items directly:

- **Suspicious activity is now logged.** Refused cross-origin writes, missing or wrong CSRF tokens, permission
  refusals, rate-limit hits, refused sign-ins (with the reason) and agent token replays are written as WARN entries
  from the `security` module. WARN entries also go to the database for 30 days, so they show in the log viewer.
  The client address is logged as its keyed hash, never the raw IP, as in the audit log. Test:
  `security-headers.test.ts`.
- **HTTPS is enforced behind the proxy.** When `MOBSIMLAB_PUBLIC_URL` is https and `MOBSIMLAB_TRUSTED_PROXIES` is
  set, a request that nginx reports as plain http gets a 308 to the https address. The path is appended as text,
  so `//other.host` cannot turn it into an open redirect. Without trusted proxies nothing is redirected, so an
  unlisted proxy cannot cause a redirect loop. Test: `security-headers.test.ts`.
- **Headers.** Every response now also carries `Permissions-Policy` (camera, microphone, geolocation, payment and
  others off). API, OAuth and MCP answers carry `Cache-Control: no-store` unless a route sets its own caching.
- **Static viewer.** The site now ships a Cloudflare Pages `_headers` file with the server's CSP and security
  headers. Its docs say that everything in the site, including the `.mslab` files, is public.
- **Reverse proxy guide.** `docs/user/reverse-proxy.md` has an nginx example: http→https, HSTS and headers left to
  the app, no CORS headers, `X-Forwarded-For` replaced rather than appended, upload size and timeouts.
- **Unused packages removed:** `serde_json` from `energy`, `journey-planner` and `mode-kits` (never used),
  `serde` from `noise-wasm`, and `serde_json` in `depot-layout` moved to dev-dependencies (only its example uses it).

## Release checklist

| Question | Answer |
|---|---|
| Do secrets or API keys need hashing? | Already done where it matters. Session tokens, agent access, refresh and personal tokens, OAuth codes and sign-in state are stored only as SHA-256 hashes of 256-bit random values. CSRF tokens and IP hashes are HMACs with `session_secret`. MobSimLab has no passwords of its own (sign-in is OIDC). The PKCE verifier in `iam.auth_flow` must stay readable to finish the sign-in and lives 10 minutes. |
| Do session cookies need locking down? | Already locked down: opaque random value, `HttpOnly`, `SameSite=Lax`, `Secure` and the `__Host-` prefix on https, 12 h idle and 7 day absolute expiry, rotated at sign-in, revoked server-side at sign-out. Lax (not Strict) is needed for the OIDC callback. |
| Do links such as reset links expire? | There are no password-reset or e-mail links. Everything single-use expires: sign-in state 10 min, agent consent 10 min, OAuth codes 60 s, access tokens 1 h, refresh tokens rotate, personal tokens 1–365 days. Codes and refresh tokens are now single-use even under concurrency (M3). |
| Are admin pages hidden from other users? | Yes, and enforced on the server: every route declares one permission and a global guard refuses the rest (routes with neither fail a test). Administration and audit need Owner/Admin, setup needs Owner, plugins need Admin. The web app only hides the menu; the server refuses. |
| Is user data fenced off? | Yes. Every project route goes through `ProjectsService` access checks (404 for projects you cannot read, so their existence does not leak; 403 for too low a role). Public projects are read-only, signed-in only, and their members' e-mails stay hidden. Agent scenarios and connections are per user. Sharing now only matches verified e-mails (L4). |
| Is validation on the server? | Yes: every controller parses its input with zod schemas (strict objects, length and number limits); the street-tile routes check their numbers in the service. Body size limits per route (100 kB default). |
| Are upload types and sizes limited? | Yes. Plugins: 10 MB, Admins only, signed packages, ZIP limits. `.mslab` import: 200 MB, unpacked in the sandboxed tool-runner with entry, size, ratio and path limits and checksums. Population files: GeoTIFF/GeoJSON/CSV only, up to `MOBSIMLAB_POPULATION_UPLOAD_MB` (default 200), parsed with tag, chunk and decompression limits. Vehicle, OSM and elevation files are read in the browser and saved as validated JSON (8 MB drawings limit). |
| Can users force HTTPS? | Now yes behind the proxy (308 redirect, see above), plus HSTS and secure cookies; nginx example in `docs/user/reverse-proxy.md`. The instance itself stays bound to `127.0.0.1`. |
| Is everything users type escaped? | Yes. React escapes all text and the code has no `innerHTML`/`dangerouslySetInnerHTML`; the CSP forbids inline scripts; SQL is always parameterised (Kysely and psycopg); the worker runs SUMO with fixed arguments and no shell; logs are JSON. Plugin pages run in a sandbox with an opaque origin. |
| Are CSRF tokens needed? | Already in place: every state-changing request needs a same-origin `Origin`/`Referer` and an HMAC CSRF token bound to the session. OAuth and MCP routes use no cookies and so need none. |
| Does CORS need tightening behind nginx? | There is no CORS at all, which is the tightest setting: no `Access-Control-*` headers are sent, so other sites cannot read API answers. The test checks this. Do not add CORS headers in nginx (guide section 3). |
| Are the security headers OK? | Yes: strict CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, COOP/CORP, no `X-Powered-By`, and now `Permissions-Policy` and `no-store` on the API. The aerial basemap was blocked by the CSP and is fixed (N2). |
| Are API keys kept on the server? | Yes. The only provider key (`MOBSIMLAB_OPENMETEO_APIKEY`, optional) is read on the server and never sent to the browser; the OIDC client secret is a Docker secret. Log redaction removes keys, tokens, cookies and secrets. |
| Are environment variables audited? | Yes, all 52 `MOBSIMLAB_*` variables: validated at start-up (the API refuses to start on a bad value), no secrets in the environment (they are files in `/run/secrets`, checked for length and known example values), dangerous switches off by default. Two notes: `master_key` is required but no code reads it yet (kept for the planned credential encryption; decide before beta), and `compose.yaml` still defaults the image tag to `latest`, which fails safely because no `latest` image is published. |
| Is git history scanned for leaks? | Yes: gitleaks 8.28 over all commits on `main` found no leaks, and no secret, key or `.env` file was ever committed. CI already runs gitleaks on each push. The working tree has 5 matches, all known parameter IDs listed in `.gitleaksignore`. |
| Rotate any key that leaked? | Nothing leaked, so nothing to rotate. Secrets are generated per install by `init-secrets` and never committed. |
| Are files that shouldn't be public hidden? | Yes. Secrets and `.env` are git- and docker-ignored; only the built web app is served; no source maps are built; API answers are now `no-store`; `.mslab` export needs membership. The static viewer publishes the projects you put in it, now stated in its docs. |
| Is debug mode off in production? | Yes. The image sets `NODE_ENV=production`; `MOBSIMLAB_DEVELOPMENT_MODE` (unsigned plugins) and `MOBSIMLAB_OIDC_ALLOW_INSECURE_HTTP` default to off; log level is `info`; errors reach the client as generic messages without stack traces. |
| Are vulnerable dependencies patched? | Yes: `pnpm audit`, `cargo audit` and `pip-audit` now report no known vulnerabilities (L1). |
| Are there unused packages? | Five Rust dependency entries removed or moved (above). Every npm and Python dependency is used (`pyproj` and `rtree` are used by SUMO's `sumolib`; `rxjs` is a NestJS peer). |
| Is suspicious activity logged? | Now yes (see above), on top of the audit log of sign-ins, role changes, setup, plugins, tokens and runs. |
| OWASP Top 10 review | Below. |

## OWASP Top 10 (2021)

| Category | Result |
|---|---|
| A01 Broken access control | Deny-by-default guard, per-project checks, server-side roles, no CORS, CSRF. Fixed: M1 (first Owner), L4 (sharing). |
| A02 Cryptographic failures | Hashed tokens, HMAC CSRF, TLS via proxy, secure cookies, HSTS. Now also an HTTPS redirect. No findings. |
| A03 Injection | Parameterised SQL, no shell, escaped output, strict CSP. Fixed: the shell injection pattern in the OSM benchmark workflow. |
| A04 Insecure design | Rate limits, per-agent run limits. Fixed: per-person run limit (L2), single-use tokens (M3). Open: M2 below. |
| A05 Security misconfiguration | Secure defaults, read-only container, all capabilities dropped, `no-new-privileges`, port bound to localhost. Fixed: aerial basemap CSP (N2), `Permissions-Policy`, `no-store`, static viewer headers. |
| A06 Vulnerable and outdated components | All three audits clean (L1). |
| A07 Identification and authentication failures | OIDC with PKCE, state and nonce; rate-limited sign-in; session rotation. Fixed: M1, M3. |
| A08 Software and data integrity failures | Signed plugins, checksummed `.mslab` files and s6-overlay download, DCO on commits. Fixed: actions pinned by hash, images by digest (L5). |
| A09 Security logging and monitoring failures | Hash-chained audit log; logs kept in the database. Fixed: refused requests, sign-ins and token replays are now logged. |
| A10 Server-side request forgery | Outbound providers come from operator settings, https only. Fixed: GBFS URLs now refused when they resolve to internal addresses (N1). |

## Accepted or open

- **M2. All three database passwords are in one container** (medium). The migrator password, which owns the
  database, can be read by the API and the worker, so a break-in to either could rewrite the audit log. **Homlo
  accepted this risk (16 November 2026) and chose to keep two containers.** If it is revisited, the fix is a
  one-shot migrate container that alone gets that password.
- **L6. Secret files are mode 644** inside a 700 folder. They must stay readable by the container users (uid
  10001 and 999) through Docker's bind mounts, so 600 would break start-up. The folder mode protects them; keep
  `deploy/secrets` out of backups that do not keep modes.
- **Map-data routes have no per-user rate limit** (low): street, walk, rail and building tiles, water, places and
  population are GET requests and skip the write limit. Limiting them needs a number that does not slow down map
  panning; left for a decision. Agent analyses still run on the API's main thread; a long one makes other requests
  wait.
- **Plugin code isolation** relies on Node's permission model, an empty environment and resource limits (the
  network namespace is unavailable under Docker's default seccomp profile). Node does not call its permission
  model a sandbox for hostile code, so plugin signing (unsigned plugins only in development mode) remains the main
  protection.
- **`master_key`** is required but unused (see the environment row above).
- **Duplicated and unused code** from the earlier audit (shared parse helper, gateway request loop, ZIP writers,
  11 unused exports) is not a security issue and was not changed here.
- **Pins need upkeep.** Digests and action hashes do not update themselves; bump them with each release, or ask
  for Dependabot to be set up.

## How this was checked

- Manual review of `apps/api/src` (guard, policy, auth, sessions, agents/OAuth/MCP, projects, comments, plugins
  and tool-runner, uploads and parsers, gateway clients, logging), `apps/web/src` (output escaping, links, CSP
  needs), `tools/static-site`, `worker/src`, `db/migrations`, `deploy/`, `compose.yaml` and `.github/workflows`.
- `gitleaks git` (all commits) and `gitleaks dir`; `pnpm audit`, `cargo audit` (RustSec database of 16 Nov 2026),
  `pip-audit` on the exported worker lockfile; an import scan of every npm, Rust and Python dependency.
- Tests: the API suite (unit and PostgreSQL integration tests, with the WebAssembly kernels built), `cargo clippy`
  and `cargo test` for the whole Rust workspace, `eslint`, `prettier` and the API type check. Results are in the
  pull request.
