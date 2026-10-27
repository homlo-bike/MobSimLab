# 12 — Implementation plan

No application code is written until this architecture set is approved. After approval, work proceeds in phases. Each phase ends with a demo, updated docs/ADRs, a threat-model review and passing quality gates. Phases are ordered by risk: the biggest unknowns are tested first.

## 1. Repository layout (planned)

```text
/
├── apps/
│   ├── web/                 React SPA
│   └── api/                 NestJS API
├── worker/                  Python sim-worker package
├── crates/                  Rust workspace (rail-*, kinematics, mobsim-py)
├── contracts/               JSON Schemas + generators (TS, Python, Rust)
├── vehicles/                Vehicle catalogue (CC BY 4.0)
├── assumptions/             Assumption library (CC BY 4.0)
├── db/                      SQL migrations, init scripts, RLS policies
├── tools/                   tool-runner scripts, osm2pgsql flex style, tag mapping
├── deploy/                  Dockerfile, compose.yaml, s6 services, scripts/init-secrets
├── docs/                    architecture, adr, security, compliance, user docs, tutorials
├── examples/                Example projects (.mslab)
└── .github/                 CI workflows, CODEOWNERS, templates
```

Monorepo with pnpm workspaces (TS), uv (Python), Cargo workspace (Rust). One CI pipeline builds everything and the single image.

## 2. Phases

### Phase 0 — Foundations and risk spikes

| Work | Exit criteria |
|------|---------------|
| Repo skeleton, CI (lint, typecheck, test, build, licence gate, SBOM, scanners), DCO, CODEOWNERS | Green pipeline on empty skeleton; licence gate blocks a test GPL-2.0-only package |
| Dockerfile + compose with s6, secrets init, hardening | `docker compose up` on clean host; no default secrets; health checks green |
| **Spike S1:** libsumo + a toy Rust kernel in one Python process; portal handover; level crossing | One tram crosses from SUMO to rail kernel and back without teleport; step overhead measured |
| **Spike S2:** rail kernel prototype: 2,000 trains on synthetic network, fixed block, route setting | ≥ 50× real time for one day on reference host, or ADR revision |
| **Spike S3:** OSM import of a 1M-inhabitant region via PBF and of a small area via Overpass | Times and DB sizes recorded; tag mapping v0 |
| Licence verifications (compliance report §8) | All "Verify" items resolved; ADR-0005/0019/0025 updated |

### Phase 1 — Platform core

Auth (OIDC, first-owner setup mode and setup wizard), IAM (roles, groups, overrides, auto-registration), audit (hash chain), logging (all sinks), projects (visibility, sharing, preferences), source registry, providers + gateway (SSRF guards, throttling, cache, health), admin UI, map shell with layers and basemaps (OpenFreeMap, EOX 2016, WMS/WMTS/XYZ via proxy), File menu skeleton, About/Licenses/Attribution pages, generated LICENSE/NOTICE/ATTRIBUTION/THIRD_PARTY_LICENSES/SECURITY/PRIVACY.

Exit: ASVS L2 controls for auth/session/access control pass; permission matrix test passes; ZAP baseline clean.

### Phase 2 — Geodata

OSM import (both paths), population (WorldPop, GHSL, uploads), DEM import and sampling, POI/land-use derived layers, vector tiles, layer controls, attribution everywhere.

Exit: reference city imported end-to-end; layers render at NFR-PERF-01; attribution visible on all OSM layers and exports.

### Phase 3 — Network design

Unified graph, road/walk/cycle graph build, rail alignment editor (line, arc, clothoid), track types, validations (radius, cant, gradient @50 m, clearance, tunnel, bridge), stations (wizard, naming, grouping, access), stops, lines/routes/patterns, GTFS import, scenarios (overlays), optimistic locking, presence, comments.

Exit: example project with tram + bus + metro lines built through the UI; all validations demonstrated; scenario diff works.

### Phase 4 — Vehicles and depots

Vehicle schema, catalogue v1 (2–3 sourced models per mode), custom vehicles, fleet, kinematics crate, platform validator, road depot layout generator, rail depot capacity check, swept-path checks.

Exit: catalogue CI validation; platform validator against TSI PRM test cases; depot generator produces valid layouts for 3 polygon shapes.

### Phase 5 — Road simulation

SUMO export, background traffic from counts/OD, transit vehicles from depots, dwell model, battery/trolleybus energy, simulation view (live + replay), Parquet results, KPIs.

Exit: NFR-PERF-04 met; no teleports; vehicles start and end in depots; reproducibility test passes.

### Phase 6 — Rail operations

Rail kernel (dynamics, interlocking, dispatching, platform assignment, rerouting), co-simulation with SUMO, disruptions and failures, OSRD comparison suite.

Exit: NFR-PERF-03 and NFR-ACC-01 met; safety property tests pass; deadlock detection demonstrated.

### Phase 7 — Timetables

Warm-up → running times → timetables → blocks → validation → simulation; holding at timing points; calendars with Nager.Date; GTFS/CSV/PDF export validated with GTFS Validator.

Exit: generated GTFS passes validator with zero errors on example projects.

### Phase 8 — Demand

Zoning, generation, distribution, mode choice, assignment, feedback, catchments (walk + cycle + GBFS), pedestrian zone effects, calibration, passenger engine integration.

Exit: NFR-PERF-05; calibration demo with sample counts; uncalibrated flag shown when no data.

### Phase 9 — Cost and appraisal

Cost library, CAPEX/OPEX/lifecycle/maintenance, FNPV/FIRR/ENPV/ERR/BCR/MCA, externalities, sensitivity (tornado, Monte Carlo, switching values), multi-year simulation and calendar expansion, reports.

Exit: appraisal of example project reproduces a hand-calculated spreadsheet within rounding; assumptions report complete.

### Phase 10 — Schematics, import/export, help

LOOM integration, schematic editor, `.mslab` import/export with migrations, all export formats, Help menu (documentation, tutorial, demo, example projects, GitHub URL, demo URL).

Exit: round-trip export/import of example projects is lossless.

### Phase 11 — Final review (from the brief)

1. Scan entire repository. 2. Remove unused code (`knip`, `ts-prune`, `vulture`, `cargo-udeps`). 3. Remove duplicate logic (`jscpd`). 4. Remove duplicate components. 5. Remove unused DB tables (query-usage scan + `pg_stat_user_tables`). 6. Remove abandoned features (feature flag inventory). 7. Validate security (ASVS checklist, ZAP full scan, external pentest recommended). 8. Validate permissions (matrix test). 9. Validate documentation (link check, doc coverage lint). 10. Validate tests (coverage, mutation score on calculation modules). 11. Generate architecture documentation. 12. Generate dependency graph (`dependency-cruiser`, `pydeps`, `cargo-modules`). 13. Generate function map. 14. Generate code quality report (Sonar-style metrics via open tools: ESLint, Ruff, Clippy, complexity, duplication).

Exit: all checks pass; report published in `docs/reports/`; release candidate tagged.

## 3. Cross-cutting engineering rules

- **Docs in code:** every exported/public function has a doc comment with purpose, inputs, outputs, dependencies, side effects (TSDoc / Google-style docstrings / rustdoc), lint-enforced (`eslint-plugin-jsdoc`, `pydocstyle` via Ruff, `missing_docs` in Rust).
- **Generated maps** (module, function, dependency) produced in CI on every merge to main and published in docs.
- **Testing pyramid:** unit (Vitest, pytest, cargo test), property-based (fast-check, Hypothesis, proptest) for geometry, interlocking, finance; integration with Testcontainers PostgreSQL; contract tests between API, worker and kernel; Playwright E2E; performance benchmarks in a nightly job with regression alerts.
- **Reproducibility tests:** golden runs with fixed seeds compared bit-for-bit across commits (intentional changes update the goldens in the same PR with an explanation).
- **Accessibility:** axe checks in Playwright; keyboard navigation tests.
- **Definition of done:** code + tests + docs + audit coverage + permission annotation + i18n strings + changelog entry.

## 4. Main risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Rail kernel performance or correctness below target | M | H | Spike S2 first; OSRD oracle; property tests |
| Co-simulation overhead too high | M | M | Spike S1; run-ahead windows; libsumo subscriptions |
| Scope too large for available contributors | H | H | Phase gates; each phase delivers usable value; defer "could" items |
| Data licensing surprises | M | M | Verification items in Phase 0; licence gate; Source registry |
| Vehicle data gaps | H | M | Assumption ranges; contributor guide; start small |
| Image size / install complexity | M | M | Multi-stage build; configurable number of worker processes; documented host requirements |
| Demand model credibility without local data | H | M | Explicit "uncalibrated" labelling; calibration tools; sensitivity |

## 5. Decisions

Decided on 2026-10-27: exactly two containers (C-01), any compatible language (C-02), first user becomes Owner with setup mode (C-07), and no built-in AI with all variables editable in Project Preferences (C-10). Still open before Phase 0: the licence (ADR-0002). See the [decisions log](00-challenged-assumptions.md#decisions-log).
