# ADR-0017: All outbound HTTP through one gateway module

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-GIS-02, FR-GIS-09, C-18

## Context

Users and admins can configure endpoints (Overpass, WMS, XYZ, APIs). That is a classic SSRF vector. Providers also need throttling, retries, caching and health.

## Decision

A `gateway` module is the only code allowed to make outbound requests (lint rule bans other HTTP clients). It enforces allowlists, HTTPS, post-DNS-resolution private-range blocking (re-checked on redirects), timeouts, size limits, per-provider rate limits, retries with backoff and jitter, circuit breakers, caching and health status. It also hosts the tile proxy that injects credentials server-side.

## Consequences

Single place to audit and test outbound behaviour. Workers have no outbound network.
