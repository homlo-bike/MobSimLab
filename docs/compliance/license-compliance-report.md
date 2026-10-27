# License compliance report (planning stage)

- Project licence (accepted 2026-10-27): **AGPL-3.0-or-later** for code; **CC BY 4.0** for vehicle catalogue, assumption library and documentation (ADR-0002)
- Date: 2026-10-27
- Status: Pre-implementation review of **planned** dependencies, bundled tools, data sources and services. Versions are not yet pinned. Items marked **Verify** must be confirmed against the upstream LICENSE file at adoption time; the CI licence gate will then enforce the result automatically.
- This is an engineering assessment, not legal advice.

## 1. Compatibility rules used

| Dependency licence | Linked into AGPL code | Shipped as separate program in image | Notes |
|--------------------|----------------------|--------------------------------------|-------|
| MIT, BSD-2/3, ISC, Zlib, 0BSD, Unlicense, CC0 | ✅ | ✅ | Keep notices |
| Apache-2.0 | ✅ (one-way into GPLv3/AGPLv3) | ✅ | Reproduce NOTICE files |
| MPL-2.0 | ✅ (file-level) | ✅ | Keep MPL files under MPL |
| LGPL-2.1+/3.0 | ✅ | ✅ | Allow relinking (automatic for dynamic libs/Python) |
| GPL-3.0(-or-later), GPL-2.0-or-later | ✅ (combined work under AGPLv3 via §13 / upgrade) | ✅ | |
| AGPL-3.0 | ✅ | ✅ | |
| GPL-2.0-only | ❌ | ✅ (mere aggregation) | Not linkable |
| EPL-2.0 with GPL secondary licence | ✅ via secondary licence | ✅ | Without secondary licence: ❌ for linking |
| EPL-2.0 without secondary | ❌ for linking | ✅ | |
| SSPL, BSL, Commons Clause, Elastic | ❌ | ❌ | Not open source |
| CC BY-NC / CC BY-NC-SA (data) | n/a | ❌ bundled; ⚠️ optional user-enabled with warning | Non-commercial conflicts with "free for any use" |
| Proprietary service ToS | n/a | ⚠️ optional, user-supplied key, off by default | |

## 2. Frontend (bundled into the SPA)

| Component | Licence | Status |
|-----------|---------|--------|
| React, React DOM | MIT | ✅ |
| TypeScript (build) | Apache-2.0 | ✅ |
| Vite (build) | MIT | ✅ |
| MapLibre GL JS | BSD-3-Clause | ✅ |
| deck.gl / luma.gl | MIT | ✅ |
| TanStack React Query | MIT | ✅ |
| Zustand | MIT | ✅ |
| Tailwind CSS | MIT | ✅ |
| shadcn/ui (copied components), Radix UI | MIT | ✅ Keep MIT headers in copied files |
| Turf.js | MIT | ✅ |
| d3-shape and other d3 modules | ISC | ✅ |
| react-hook-form | MIT | ✅ |
| Zod | MIT | ✅ |
| Pino (browser) | MIT | ✅ |
| i18next, react-i18next | MIT | ✅ |
| DOMPurify | MPL-2.0 OR Apache-2.0 | ✅ (choose Apache-2.0) |
| lucide-react (icons used by shadcn) | ISC | ✅ |

## 3. Backend (Node.js)

| Component | Licence | Status |
|-----------|---------|--------|
| Node.js runtime | MIT (+ bundled deps) | ✅ |
| NestJS packages | MIT | ✅ |
| Kysely | MIT | ✅ |
| node-postgres (`pg`) | MIT | ✅ |
| node-pg-migrate | MIT | ✅ |
| pg-boss | MIT | ✅ |
| openid-client | MIT | ✅ |
| Winston | MIT | ✅ |
| helmet | MIT | ✅ |
| @nestjs/throttler | MIT | ✅ |
| csrf-csrf | ISC | ✅ |
| Ajv | MIT | ✅ |
| msgpackr | MIT | ✅ |

## 4. Worker (Python) and Rust crates

| Component | Licence | Status |
|-----------|---------|--------|
| CPython | PSF-2.0 | ✅ |
| Eclipse SUMO (libsumo, netconvert, tools) | EPL-2.0 with GPL-2.0-or-later as Secondary Licence | ✅ **Verify** Exhibit A secondary-licence notice in current SUMO sources before linking libsumo. If absent, run SUMO as a separate process via TraCI (aggregation is fine). |
| AequilibraE | **Verify** (reported as permissive/GPL in different sources) | ⚠️ Adoption gate in ADR-0019: OK if permissive or GPL-3.0-compatible; if GPL-2.0-only, run as separate program |
| NumPy, SciPy, pandas | BSD-3-Clause | ✅ |
| PyArrow / Apache Arrow | Apache-2.0 | ✅ |
| pydantic | MIT | ✅ |
| structlog | MIT OR Apache-2.0 | ✅ |
| openmatrix (OMX) | Apache-2.0 | ✅ |
| h3 (Python/C) | Apache-2.0 | ✅ |
| psycopg 3 | LGPL-3.0 | ✅ |
| PyO3 | MIT OR Apache-2.0 | ✅ |
| petgraph | MIT OR Apache-2.0 | ✅ |
| pathfinding | MIT OR Apache-2.0 | ✅ |
| rayon, serde, tracing | MIT OR Apache-2.0 | ✅ |
| proptest (test) | MIT OR Apache-2.0 | ✅ |

## 5. Tools shipped in the image (separate programs)

| Tool | Licence | Status |
|------|---------|--------|
| PostgreSQL (separate container) | PostgreSQL License | ✅ |
| PostGIS (separate container) | GPL-2.0-or-later | ✅ Separate program |
| `postgis/postgis` image | MIT (Dockerfile) + contents | ✅ |
| GDAL/OGR | MIT (some drivers other licences) | ✅ Build without non-free drivers |
| osmium-tool | GPL-3.0 | ✅ Separate program |
| libosmium | BSL-1.0 | ✅ |
| osm2pgsql | GPL-2.0-or-later | ✅ Separate program |
| MobilityData GTFS Validator | Apache-2.0 | ✅ |
| OpenJDK runtime (jlink) | GPL-2.0 with Classpath Exception | ✅ Separate runtime |
| LOOM | GPL-3.0 (**Verify** upstream LICENSE) | ✅ Separate program |
| s6-overlay | ISC | ✅ |
| Debian base image packages | Mixed FOSS | ✅ SBOM lists all |

## 6. Data sources

| Source | Licence / terms | Default | Obligations |
|--------|-----------------|---------|-------------|
| OpenStreetMap | ODbL 1.0 | On | "© OpenStreetMap contributors" on all maps/exports; share-alike for publicly distributed **derived databases**; produced works (maps, images) need attribution only |
| OpenFreeMap (tiles/styles) | Free service; OSM data ODbL; OpenMapTiles schema BSD-3 / CC-BY for styles (**Verify** per style) | On | OpenFreeMap + OpenMapTiles + OSM attribution |
| WorldPop | CC BY 4.0 | On | Attribution |
| GHSL (JRC) | CC BY 4.0 | On | Attribution |
| Copernicus DEM GLO-30 | Copernicus DEM licence (free, attribution) — **Verify** wording | On | Attribution |
| SRTM | Public domain (USGS) | Fallback | Courtesy attribution |
| Sentinel-2 cloudless 2016 (EOX) | CC BY 4.0 | On | EOX attribution text |
| Sentinel-2 cloudless 2018+ (EOX) | CC BY-NC-SA 4.0 | **Off** | Admin must acknowledge non-commercial terms; commercial users need EOX licence |
| Esri World Imagery | Esri terms of use, account/API key | **Off** | User-supplied key; Esri attribution; no caching |
| Open-Elevation (public API) | Service; software GPL-2.0 | Optional | Respect rate limits |
| Elevation-API.eu | Service terms **Verify** | Optional | |
| Mobility Database catalog | **Verify** catalog data licence; individual feeds have own licences | Optional | Record each feed's licence in Source registry |
| GTFS feeds | Per feed | User | Per feed |
| GBFS feeds | Per feed (often CC0/ODbL/custom) | User | Per feed |
| Transit Costs Project | **Verify** (NYU Ultraviolet dataset record) | Link only | Do not bundle until confirmed |
| World Bank Open Data | CC BY 4.0 | Optional | Attribution |
| OC4IDS schema | Open Contracting schema licence **Verify** (Apache-2.0 expected) | Optional | |
| Nager.Date | Code MIT; public API free | On | Attribution recommended |
| Weather APIs | Varies; many free tiers non-commercial | Off | Per provider |
| OpenRouteService API | Service terms, key and quotas; data ODbL | Off | Comparison only |
| CAMARA Population Density API | Spec Apache-2.0; data under operator contract | Off | Per contract |
| Vehicle specifications (manufacturer documents) | Facts cited, no copying of text/images | — | Cite source; trademark notice |
| Methodology sources (EU CBA Guide, EU Handbook on External Costs, TCQSM, TSI PRM) | Cited references; values are facts with citation | — | Cite; do not reproduce documents |

## 7. Generated compliance artefacts (planned CI)

| File | Generated from |
|------|----------------|
| `LICENSE` | AGPL-3.0 text (static) |
| `LICENSES/` | SPDX texts for CC-BY-4.0 and all third-party licences (REUSE layout) |
| `NOTICE` | Project notice + concatenated NOTICE files of Apache-2.0 dependencies (from SBOM) |
| `THIRD_PARTY_LICENSES.md` | CycloneDX SBOMs of npm (`@cyclonedx/cyclonedx-npm`), Python (`cyclonedx-py`), Rust (`cargo-cyclonedx`), image (`syft`) merged and rendered |
| `ATTRIBUTION` | Source registry (data sources, methods, vehicle specs) rendered with required credit lines |
| `SECURITY.md` | Template + supported versions table |
| `PRIVACY.md` | Template from data inventory in 05 §3.10 |
| About / Licenses / Attribution pages | Same data, served by the API |

**Licence gate:** `license-policy.yaml` allowlist (MIT, BSD-*, ISC, Apache-2.0, MPL-2.0, LGPL-*, GPL-2.0-or-later, GPL-3.0*, AGPL-3.0*, PSF-2.0, BSL-1.0, Zlib, CC0-1.0, Unlicense, PostgreSQL, EPL-2.0 with documented secondary licence). Anything else fails CI until an ADR approves it. `cargo deny`, `license-checker` (npm) and `pip-licenses` feed the gate; REUSE lint keeps per-file SPDX headers.

## 8. Open items before implementation

1. Verify SUMO secondary-licence notice (decides libsumo in-process vs TraCI).
2. Verify AequilibraE licence.
3. Verify LOOM licence.
4. Verify Transit Costs Project, Mobility Database catalog and Elevation-API.eu terms.
5. Confirm OpenFreeMap style licences.
6. ~~Product owner confirms AGPL-3.0-or-later (ADR-0002)~~ Done 2026-10-27. CC BY 4.0 for catalogue and assumption data follows ADR-0002.
