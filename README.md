# MobSimLab
Mobility Simulator Lab

An open-source, self-hosted platform for public transport planning, GIS analysis and operations simulation.

**Status:** architecture approved; Phase 0 (foundations) in progress. Start with the [architecture documentation](docs/architecture/README.md), the [challenged assumptions](docs/architecture/00-challenged-assumptions.md) and the [Architecture Decision Records](docs/adr/README.md).

## Quick start (Phase 0 skeleton)

```bash
deploy/scripts/init-secrets          # random secrets in deploy/secrets (never committed)
cp .env.example .env                 # set MOBSIMLAB_PUBLIC_URL
docker compose up -d --build         # two containers: mobsimlab and postgres
open http://localhost:8080
```

Spike reports: [S1 co-simulation](docs/spikes/s1-cosimulation.md), [S2 rail kernel performance](docs/spikes/s2-rail-kernel-performance.md), [S3 OSM import](docs/spikes/s3-osm-import.md).
