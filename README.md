# MobSimLab
Mobility Simulator Lab

An open-source, self-hosted platform for public transport planning, GIS analysis and operations simulation.

**Status:** architecture approved; Phase 0 (foundations) in progress. Start with the [architecture documentation](docs/architecture/README.md), the [challenged assumptions](docs/architecture/00-challenged-assumptions.md) and the [Architecture Decision Records](docs/adr/README.md).

## Quick start

```bash
deploy/scripts/init-secrets          # random secrets in deploy/secrets (never committed)
cp .env.example .env                 # set MOBSIMLAB_VERSION, MOBSIMLAB_PUBLIC_URL and the OIDC provider
docker compose pull                  # ready-made image from ghcr.io, nothing to build
docker compose up -d                 # two containers: mobsimlab and postgres
open http://localhost:8080
```

Each release publishes a ready-made image for Intel/AMD and ARM servers to `ghcr.io/homlo-bike/mobsimlab`, tagged with its version only (for example `2026.11.1-alpha`; there is no `latest` tag). Set that version as `MOBSIMLAB_VERSION` in `.env` before pulling; to update, change it to the newer version and run `docker compose pull && docker compose up -d`. To build the image yourself from this checkout instead, run `docker compose up -d --build`.

Releases are made by pushing a version tag (`git tag -s v2026.11.1-alpha -m "MobSimLab 2026.11.1-alpha" && git push origin v2026.11.1-alpha`); the **Release image** workflow builds, smoke-tests and publishes the image.

### Sign-in and first setup

MobSimLab has no local passwords; people sign in with an OpenID Connect provider (Keycloak, Authentik, Entra ID, Google and others).

1. Register MobSimLab with your provider as a web application. Redirect URI: `<MOBSIMLAB_PUBLIC_URL>/api/auth/callback`. Post-logout redirect URI: `<MOBSIMLAB_PUBLIC_URL>/`.
2. Put the issuer URL and client ID in `.env` (`MOBSIMLAB_OIDC_ISSUER`, `MOBSIMLAB_OIDC_CLIENT_ID`). If the provider gave you a client secret, paste it into `deploy/secrets/oidc_client_secret`.
3. Start the stack. The instance starts in **setup mode**: the first person who signs in becomes **Owner**, and everyone else is refused until the Owner presses **Finish setup**. To control who that first person is, set `MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL` (a provider-verified e-mail) or `MOBSIMLAB_BOOTSTRAP_OWNER_SUBJECT`.
4. After setup, new users wait for approval (auto-registration is off by default). Owners and Admins handle this under **Administration** in the account menu: approve or reject people, change roles (Restricted suspends an account without deleting it), set sign-up rules (auto-registration, allowed e-mail domains and IdP groups) and map IdP groups to roles. Only an Owner can create Owners or Admins, and the last Owner cannot be removed.
5. Behind a TLS reverse proxy, set `MOBSIMLAB_TRUSTED_PROXIES` to the proxy's address so sign-in rate limits (10 per minute per client by default) and audit records see the real client address.

**AI agents:** Owners, Admins and Editors can connect Claude or another MCP app at `<MOBSIMLAB_PUBLIC_URL>/mcp` to build scenarios and check them against the 15-minute walk rule. See [docs/user/ai-agents.md](docs/user/ai-agents.md). The instance must be reachable over HTTPS from the AI app, and `MOBSIMLAB_PUBLIC_URL` must be the address the app uses.

**Static viewer:** `pnpm build:static` builds a website with no server that shows saved `.mslab` projects read-only (simulator, schematic, tables and preferences), ready to upload to Cloudflare Pages. See [docs/user/static-viewer.md](docs/user/static-viewer.md).

Lost the Owner account? Run `docker compose exec mobsimlab /app/bin/mobsimlab admin reset-owner`. This demotes the current Owner to Admin, signs them out, returns the instance to setup mode and records the action in the audit log.

Spike reports: [S1 co-simulation](docs/spikes/s1-cosimulation.md), [S2 rail kernel performance](docs/spikes/s2-rail-kernel-performance.md), [S3 OSM import](docs/spikes/s3-osm-import.md).
