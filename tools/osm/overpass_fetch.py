"""Fetch a small area from an Overpass API endpoint as OSM XML (Spike S3, small-area path).

Implements the client rules of docs/architecture/06-gis.md §2.3 in their Phase 0 form:
configurable endpoint, identifying User-Agent, throttling (one request at a time, minimum
interval), retry with exponential backoff and jitter on 429/502/503/504/timeouts, an area
limit, and a response cache keyed by the query hash. Only read-only Overpass queries are
made; the OSM editing API is never used.

Usage:
    python overpass_fetch.py --bbox S,W,N,E --out area.osm [--endpoint URL] [--cache-dir DIR]
"""

from __future__ import annotations

import argparse
import hashlib
import math
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter"
USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)"
MAX_AREA_KM2 = 400.0
MIN_INTERVAL_S = 5.0
RETRY_STATUS = {429, 502, 503, 504}
BACKOFF_S = (2, 4, 8, 16, 32)


def bbox_area_km2(s: float, w: float, n: float, e: float) -> float:
    """Approximate area of a lat/lon box in km² (spherical Earth)."""
    r = 6371.0
    return abs(math.radians(e - w) * (math.sin(math.radians(n)) - math.sin(math.radians(s)))) * r * r


def build_query(s: float, w: float, n: float, e: float, timeout_s: int = 120, maxsize: int = 512 * 1024 * 1024) -> str:
    """Overpass QL returning nodes, ways and multipolygon relations in the box, with their members, as XML.

    Other relations (routes, boundaries, networks) are left out: recursing into their members
    pulls in ways far outside the box, and the flex style only reads multipolygons.
    """
    b = f"{s},{w},{n},{e}"
    return (
        f"[out:xml][timeout:{timeout_s}][maxsize:{maxsize}];"
        f'(node({b});way({b});rel({b})["type"="multipolygon"];);(._;>;);out meta;'
    )


def fetch(query: str, endpoint: str, cache_dir: Path, http_timeout_s: int = 180) -> bytes:
    """Run a query with cache, throttle and retries.

    Returns:
        Response body (OSM XML). Raises RuntimeError after the last retry fails.
    """
    key = hashlib.sha256(f"{endpoint}\n{query}".encode()).hexdigest()
    cached = cache_dir / f"{key}.osm"
    if cached.exists():
        return cached.read_bytes()
    cache_dir.mkdir(parents=True, exist_ok=True)
    stamp = cache_dir / ".last_request"
    data = urllib.parse.urlencode({"data": query}).encode()
    last_error = ""
    for attempt, backoff in enumerate((0, *BACKOFF_S)):
        if backoff:
            time.sleep(backoff + random.uniform(0, backoff / 2))
        if stamp.exists():
            wait = MIN_INTERVAL_S - (time.time() - stamp.stat().st_mtime)
            if wait > 0:
                time.sleep(wait)
        stamp.touch()
        req = urllib.request.Request(endpoint, data=data, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=http_timeout_s) as resp:  # noqa: S310 (configured https endpoint)
                body = resp.read()
            cached.write_bytes(body)
            return body
        except urllib.error.HTTPError as e:
            last_error = f"HTTP {e.code}"
            if e.code not in RETRY_STATUS:
                break
        except (TimeoutError, urllib.error.URLError) as e:
            last_error = str(e)
        print(f"attempt {attempt + 1} failed: {last_error}", file=sys.stderr)
    raise RuntimeError(f"Overpass request failed: {last_error}")


def main() -> int:
    """Command-line entry point."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", required=True, help="south,west,north,east in degrees")
    ap.add_argument("--out", required=True)
    ap.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    ap.add_argument("--cache-dir", default=".overpass-cache")
    a = ap.parse_args()
    s, w, n, e = (float(x) for x in a.bbox.split(","))
    area = bbox_area_km2(s, w, n, e)
    if area > MAX_AREA_KM2:
        print(f"area {area:.0f} km² exceeds {MAX_AREA_KM2:.0f} km²: use the PBF path", file=sys.stderr)
        return 2
    if not a.endpoint.startswith("https://"):
        print("endpoint must use https", file=sys.stderr)
        return 2
    body = fetch(build_query(s, w, n, e), a.endpoint, Path(a.cache_dir))
    Path(a.out).write_bytes(body)
    print(f"{len(body)} bytes, {area:.2f} km²")
    return 0


if __name__ == "__main__":
    sys.exit(main())
