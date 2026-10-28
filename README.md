# MobSimLab
Mobility Simulator Lab

An open-source, self-hosted platform for public transport planning, GIS analysis and operations simulation.

**Status:** architecture approved; Phase 0 (foundations) in progress. Start with the [architecture documentation](docs/architecture/README.md), the [challenged assumptions](docs/architecture/00-challenged-assumptions.md) and the [Architecture Decision Records](docs/adr/README.md).

## Quick start

```bash
deploy/scripts/init-secrets          # random secrets in deploy/secrets (never committed)
cp .env.example .env                 # set MOBSIMLAB_PUBLIC_URL and the OIDC provider
docker compose up -d --build         # two containers: mobsimlab and postgres
open http://localhost:8080
```

### Sign-in and first setup

MobSimLab has no local passwords; people sign in with an OpenID Connect provider (Keycloak, Authentik, Entra ID, Google and others).

1. Register MobSimLab with your provider as a web application. Redirect URI: `<MOBSIMLAB_PUBLIC_URL>/api/auth/callback`. Post-logout redirect URI: `<MOBSIMLAB_PUBLIC_URL>/`.
2. Put the issuer URL and client ID in `.env` (`MOBSIMLAB_OIDC_ISSUER`, `MOBSIMLAB_OIDC_CLIENT_ID`). If the provider gave you a client secret, paste it into `deploy/secrets/oidc_client_secret`.
3. Start the stack. The instance starts in **setup mode**: the first person who signs in becomes **Owner**, and everyone else is refused until the Owner presses **Finish setup**. To control who that first person is, set `MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL` (a provider-verified e-mail) or `MOBSIMLAB_BOOTSTRAP_OWNER_SUBJECT`.
4. After setup, new users wait for approval (auto-registration is off by default). Owners and Admins handle this under **Administration** in the account menu: approve or reject people, change roles (Restricted suspends an account without deleting it), set sign-up rules (auto-registration, allowed e-mail domains and IdP groups) and map IdP groups to roles. Only an Owner can create Owners or Admins, and the last Owner cannot be removed.
5. Behind a TLS reverse proxy, set `MOBSIMLAB_TRUSTED_PROXIES` to the proxy's address so sign-in rate limits (10 per minute per client by default) and audit records see the real client address.

Lost the Owner account? Run `docker compose exec mobsimlab /app/bin/mobsimlab admin reset-owner`. This demotes the current Owner to Admin, signs them out, returns the instance to setup mode and records the action in the audit log.

Spike reports: [S1 co-simulation](docs/spikes/s1-cosimulation.md), [S2 rail kernel performance](docs/spikes/s2-rail-kernel-performance.md), [S3 OSM import](docs/spikes/s3-osm-import.md).
