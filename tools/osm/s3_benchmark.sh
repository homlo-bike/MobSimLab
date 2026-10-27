#!/usr/bin/env bash
# Spike S3: time both OSM import paths and record database sizes.
# Usage: tools/osm/s3_benchmark.sh <geofabrik-region|path/to/file.osm.pbf> [south,west,north,east]
# Needs: osm2pgsql, osmium, psql, curl; PG* environment variables pointing at a PostGIS database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
region="$1"; bbox="${2:-}"
work="${S3_WORKDIR:-$(mktemp -d)}"
db="${S3_DB:-mobsimlab_s3}"

psql -qtAc "drop database if exists $db" postgres
psql -qtAc "create database $db" postgres
psql -qd "$db" -c "create extension postgis; create schema geo; create schema geo_overpass;"

if [ -f "$region" ]; then
  pbf="$region"; dl_s=0
else
  pbf="$work/extract.osm.pbf"
  t0=$(date +%s.%N)
  curl -fsSL -A "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)" \
    -o "$pbf" "https://download.geofabrik.de/${region}-latest.osm.pbf"
  dl_s=$(echo "$(date +%s.%N) - $t0" | bc)
fi
size_mb=$(du -m "$pbf" | cut -f1)
osm_ts=$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$pbf" 2>/dev/null || echo unknown)

t0=$(date +%s.%N)
MOBSIMLAB_OSM_SCHEMA=geo osm2pgsql -O flex -S "$here/mobsimlab-flex.lua" -d "$db" "$pbf" > "$work/pbf.log" 2>&1
pbf_s=$(echo "$(date +%s.%N) - $t0" | bc)

report() {
  psql -qd "$db" -tAF ' | ' -c "select c.relname, c.reltuples::bigint, pg_size_pretty(pg_total_relation_size(c.oid))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = '$1' and c.relkind = 'r' order by 1"
  psql -qd "$db" -tAc "select 'total | | ' || pg_size_pretty(sum(pg_total_relation_size(c.oid)))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = '$1' and c.relkind = 'r'"
}

echo "## PBF path"
echo "source: $region (${size_mb} MB, replication timestamp $osm_ts)"
echo "download: ${dl_s} s, osm2pgsql flex import: ${pbf_s} s"
echo "table | rows | size"
report geo

if [ -n "$bbox" ]; then
  t0=$(date +%s.%N)
  python3 "$here/overpass_fetch.py" --bbox "$bbox" --out "$work/area.osm" --cache-dir "$work/cache"
  fetch_s=$(echo "$(date +%s.%N) - $t0" | bc)
  t0=$(date +%s.%N)
  MOBSIMLAB_OSM_SCHEMA=geo_overpass osm2pgsql -O flex -S "$here/mobsimlab-flex.lua" -d "$db" "$work/area.osm" > "$work/overpass.log" 2>&1
  ov_s=$(echo "$(date +%s.%N) - $t0" | bc)
  echo
  echo "## Overpass path"
  echo "bbox: $bbox, fetch: ${fetch_s} s, import: ${ov_s} s"
  echo "table | rows | size"
  report geo_overpass
fi
