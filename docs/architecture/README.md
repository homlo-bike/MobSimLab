# MobSimLab architecture documentation

Status: **Approved 2026-10-27.** Implementation follows [12-implementation-plan.md](12-implementation-plan.md).

This folder holds the architecture and implementation plan for Mobility Simulator Lab (MobSimLab). Read the documents in order. Each one is written in plain language and links to the Architecture Decision Records (ADRs) that justify its choices.

| # | Document | Covers |
|---|----------|--------|
| 00 | [Challenged assumptions](00-challenged-assumptions.md) | Places where the product brief is unrealistic, contradictory, or risky, and what we propose instead. **Read this first.** |
| 01 | [Overview](01-overview.md) | Executive summary, vision, scope, glossary |
| 02 | [Requirements](02-requirements.md) | Functional and non-functional requirements, with IDs |
| 03 | [Technical architecture](03-technical-architecture.md) | Runtime components, process model, technology stack, logging, deployment |
| 04 | [Domain, data and database](04-domain-data-database.md) | Domain model, data model, database architecture, metadata, IDs, audit |
| 05 | [Security and users](05-security-users.md) | Security architecture, user management, authentication, authorization |
| 06 | [GIS architecture](06-gis.md) | OSM import, population, external providers, layers, basemaps, unified graph |
| 07 | [Simulation architecture](07-simulation.md) | Road (SUMO), rail operations kernel, co-simulation, vehicle geometry, depots, timetables, scenarios |
| 08 | [Vehicle architecture](08-vehicles.md) | Vehicle catalog, data model, provenance, geometry model |
| 09 | [Planning models](09-planning-models.md) | Assumptions engine, demand forecasting, cost estimation and appraisal |
| 10 | [Collaboration and project storage](10-collaboration-storage.md) | Sharing, concurrency, scenarios, project files, import/export |
| 11 | [Diagrams](11-diagrams.md) | UML, ERDs, event flows, sequences, service interactions, component/module/function dependency maps |
| 12 | [Implementation plan](12-implementation-plan.md) | Phases, milestones, exit criteria, spikes, testing, final review |

Related folders:

- [`../adr/`](../adr/README.md) — Architecture Decision Records
- [`../security/threat-model.md`](../security/threat-model.md) — STRIDE threat model
- [`../compliance/license-compliance-report.md`](../compliance/license-compliance-report.md) — license compliance report for all planned dependencies, data sources and services

## How to review

1. Read [00-challenged-assumptions.md](00-challenged-assumptions.md). Its decisions log shows what the product owner has decided and what is still open.
2. Skim the ADR index. All ADRs are Accepted; changes need a new superseding ADR.
3. Comment on anything that is wrong, missing, or over-scoped.

Diagrams are Mermaid inside Markdown, so they render directly on GitHub.
