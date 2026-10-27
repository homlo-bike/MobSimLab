# ADR-0002: Licence MobSimLab under AGPL-3.0-or-later

- Status: Accepted (product owner, 2026-10-27)
- Date: 2026-10-27
- Related: NFR-OSS-01..03, C-12, [license compliance report](../compliance/license-compliance-report.md)

## Context

The brief prefers AGPL-3.0, with Apache-2.0 as an alternative. MobSimLab is a network service. Under GPL a company could run a modified version as a hosted service without sharing changes; AGPL section 13 closes that gap. The project wants to stay "open source, free, self-hostable".

Key dependency licences: mostly MIT/BSD/Apache-2.0/ISC (all compatible with AGPLv3); PostGIS, osm2pgsql (GPL-2.0-or-later), osmium-tool and LOOM (GPL-3.0) run as separate programs; Eclipse SUMO is EPL-2.0 with GPL-2.0-or-later as a declared Secondary Licence (must be re-verified at adoption), which allows combination under GPL terms.

## Decision

- Licence the MobSimLab code under **AGPL-3.0-or-later**.
- Licence the **vehicle catalogue and assumption library data** under **CC BY 4.0** (more suitable for data and easier for agencies to reuse in reports), with source attributions kept per file.
- Licence the **documentation** under CC BY 4.0.
- Require a **Developer Certificate of Origin** (DCO sign-off) on contributions rather than a CLA, so no single party can relicense.
- Ship `LICENSE`, `NOTICE`, `ATTRIBUTION`, `THIRD_PARTY_LICENSES.md`, `SECURITY.md`, `PRIVACY.md`, generated in CI from SBOMs and the source registry.
- The UI shows a "Source" link (AGPL §13) to the exact source of the running version.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Apache-2.0 | Permits closed hosted forks; GPL-3.0 components (LOOM, osmium-tool) could still be used as separate programs, so it is viable, but it does not protect the "stays open" goal |
| GPL-3.0 | No network clause |
| MPL-2.0 | File-level copyleft only; weaker than intended |
| AGPL-3.0-only | "or-later" keeps the option to adopt future FSF fixes |

## Consequences

- Some organisations have AGPL policies that block internal use of modified versions without publishing changes. Unmodified self-hosting is unaffected.
- Incompatible dependencies: anything GPL-2.0-only linked into our code, SSPL, BSL, "Commons Clause", non-commercial licences. The CI licence gate blocks them.
- Apache-2.0 dependencies' NOTICE files must be reproduced in our NOTICE.
