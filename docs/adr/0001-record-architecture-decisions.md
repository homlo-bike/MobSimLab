# ADR-0001: Record architecture decisions

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: all

## Context

MobSimLab is meant to be a long-lived open-source product with many contributors. Decisions made now (languages, engines, data formats, licence) will be questioned later. Without a record, the reasoning is lost and decisions get relitigated or silently reversed.

## Decision

We record every significant architecture decision as a Markdown ADR in `docs/adr/`, numbered, using [0000-template.md](0000-template.md) (a light version of Michael Nygard's format). ADRs are immutable once accepted; changes are made by a new ADR that supersedes the old one. Pull requests that change architecture must add or update an ADR.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Wiki pages | Not versioned with the code; not reviewed in PRs |
| Design docs only | Mix of decision and description; hard to see what was decided when |

## Consequences

Small ongoing cost per decision. Reviewers can trace any design choice to its reasons.
