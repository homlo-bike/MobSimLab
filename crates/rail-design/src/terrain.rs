//! Terrain heights and the vertical profile of the tracks (ADR-0033 decision 18).
//!
//! The editor loads ground heights from the shared terrain source (Copernicus GLO-30, see
//! `apps/api/src/terrain`) in tiles of [`TILE_DEG`] degrees, each a grid of
//! ([`TILE_STEPS`] + 1)² points, and adds them with [`Terrain::add_tile`]. The build then gives
//! every track a vertical profile:
//!
//! - The ground is sampled along the centre line every [`PROFILE_STEP_M`] and smoothed over
//!   `terrain.smoothing_window_m`: a running median takes out buildings and trees (GLO-30 is a
//!   surface model), a running mean the remaining noise.
//! - The rail top is the smoothed ground plus the height of the track's level (street, elevated
//!   +1 or +2, underground −1 or −2), changing linearly along a ramp between two levels.
//! - Stations are level: the rail top along the platforms is the mean smoothed ground under them
//!   plus the station's level. A track starting or ending at a station, or at a switch on
//!   another track, ties in to that height and takes up the difference over a length set by
//!   `terrain.tie_in_gradient_share` of the mode's maximum gradient.
//! - The gradient follows from the rail top, and the build checks it against the mode's maximum
//!   gradient; street-level track that leaves the ground by more than
//!   `terrain.street_level_tolerance_m` is reported, as is a street-level station on a slope.
//!
//! Without terrain tiles nothing changes: tracks keep the flat-ground ramps of [`crate::alignment`].

use crate::alignment::TrackGeo;
use crate::design::Design;
use crate::geom::{at_s, nearest, P2};
use crate::issue::{fmt_m, Issue};
use crate::model::{Anchor, Level};
use crate::params::ModeParams;
use std::collections::BTreeMap;

/// Size of a terrain tile, degrees of longitude and latitude.
pub const TILE_DEG: f64 = 0.01;
/// Grid intervals per tile side: a tile holds (`TILE_STEPS` + 1)² heights, about 22–35 m apart in
/// mid latitudes, close to GLO-30's 30 m grid.
pub const TILE_STEPS: usize = 32;
/// Spacing of the profile samples along a track, m.
pub const PROFILE_STEP_M: f64 = 10.0;
/// Height tolerance when the profile is cut into stretches of constant gradient, m.
pub const PROFILE_SIMPLIFY_M: f64 = 0.05;
/// Gradient above the maximum that is still accepted, ‰ (rounding of the smoothed ground).
pub const GRADIENT_TOLERANCE_PERMILLE: f64 = 0.5;

/// Ground heights in tiles, metres above the EGM2008 geoid.
#[derive(Debug, Clone, Default)]
pub struct Terrain {
    tiles: BTreeMap<(i32, i32), Vec<Option<f32>>>,
}

impl Terrain {
    /// Purpose: no tiles; the build then uses flat ground.
    pub fn new() -> Self {
        Self::default()
    }
    /// Purpose: whether no tile is loaded.
    pub fn is_empty(&self) -> bool {
        self.tiles.is_empty()
    }
    /// Purpose: the tile holding a point.
    pub fn tile_of(lon: f64, lat: f64) -> (i32, i32) {
        (
            (lon / TILE_DEG).floor() as i32,
            (lat / TILE_DEG).floor() as i32,
        )
    }
    /// Purpose: the grid points of a tile, row by row from the south-west corner (longitude
    /// fastest), as [lon, lat]; the order [`Terrain::add_tile`] expects the heights in.
    pub fn tile_points(x: i32, y: i32) -> Vec<[f64; 2]> {
        let d = TILE_DEG / TILE_STEPS as f64;
        let mut out = Vec::with_capacity((TILE_STEPS + 1) * (TILE_STEPS + 1));
        for j in 0..=TILE_STEPS {
            for i in 0..=TILE_STEPS {
                out.push([
                    x as f64 * TILE_DEG + i as f64 * d,
                    y as f64 * TILE_DEG + j as f64 * d,
                ]);
            }
        }
        out
    }
    /// Purpose: add a tile's heights in the order of [`Terrain::tile_points`]; `None` where the
    /// source has no data. Errors when the count is wrong.
    pub fn add_tile(&mut self, x: i32, y: i32, heights: &[Option<f64>]) -> Result<(), String> {
        let n = (TILE_STEPS + 1) * (TILE_STEPS + 1);
        if heights.len() != n {
            return Err(format!(
                "terrain tile {x}/{y} has {} heights, expected {n}",
                heights.len()
            ));
        }
        self.tiles.insert(
            (x, y),
            heights.iter().map(|h| h.map(|v| v as f32)).collect(),
        );
        Ok(())
    }
    /// Purpose: whether a tile is loaded.
    pub fn has_tile(&self, x: i32, y: i32) -> bool {
        self.tiles.contains_key(&(x, y))
    }
    /// Purpose: forget all tiles.
    pub fn clear(&mut self) {
        self.tiles.clear();
    }
    /// Purpose: ground height at a point, interpolated bilinearly between the four grid points
    /// round it (corners without data are left out). `None` outside the loaded tiles or where
    /// the source has no data.
    pub fn height(&self, lon: f64, lat: f64) -> Option<f64> {
        let (x, y) = Self::tile_of(lon, lat);
        let t = self.tiles.get(&(x, y))?;
        let d = TILE_DEG / TILE_STEPS as f64;
        let fx = ((lon - x as f64 * TILE_DEG) / d).clamp(0.0, TILE_STEPS as f64);
        let fy = ((lat - y as f64 * TILE_DEG) / d).clamp(0.0, TILE_STEPS as f64);
        let (i, j) = (
            (fx.floor() as usize).min(TILE_STEPS - 1),
            (fy.floor() as usize).min(TILE_STEPS - 1),
        );
        let (u, v) = (fx - i as f64, fy - j as f64);
        let at = |i: usize, j: usize| t[j * (TILE_STEPS + 1) + i].map(f64::from);
        let mut sum = 0.0;
        let mut wsum = 0.0;
        for (h, w) in [
            (at(i, j), (1.0 - u) * (1.0 - v)),
            (at(i + 1, j), u * (1.0 - v)),
            (at(i, j + 1), (1.0 - u) * v),
            (at(i + 1, j + 1), u * v),
        ] {
            if let Some(h) = h {
                sum += h * w;
                wsum += w;
            }
        }
        (wsum > 1e-9).then(|| sum / wsum)
    }
}

/// Purpose: the terrain tiles a design needs and that are not loaded yet: those under its tracks
/// and stations, with one tile's margin round each point.
pub fn missing_tiles(dz: &Design, terrain: &Terrain) -> Vec<(i32, i32)> {
    let mut want: std::collections::BTreeSet<(i32, i32)> = Default::default();
    let mut add = |p: P2| {
        let [lon, lat] = dz.proj.to_lonlat(p);
        // Neighbours too when the point is near the tile's edge (the smoothing looks ahead).
        let m = 200.0 / 111_000.0;
        for (dx, dy) in [(-m, -m), (m, -m), (-m, m), (m, m), (0.0, 0.0)] {
            let lon2 = lon + dx / lat.to_radians().cos().max(0.1);
            want.insert(Terrain::tile_of(lon2, lat + dy));
        }
    };
    for g in &dz.tracks {
        let mut s = 0.0;
        while s <= g.length {
            add(at_s(&g.centre, s).p);
            s += 100.0;
        }
        if let Some(q) = g.centre.last() {
            add(q.p);
        }
    }
    for st in &dz.stations {
        add(st.point(-st.half_len, 0.0));
        add(st.point(st.half_len, 0.0));
    }
    want.into_iter()
        .filter(|(x, y)| !terrain.has_tile(*x, *y))
        .collect()
}

/// The vertical profile of one track.
#[derive(Debug, Clone, PartialEq)]
pub struct Profile {
    /// Chainages along the centre line, m.
    pub s: Vec<f64>,
    /// Ground height from the source at each chainage (None without data), m above the geoid.
    pub ground: Vec<Option<f64>>,
    /// Smoothed ground, m.
    pub ground_smooth: Vec<f64>,
    /// Rail top, m.
    pub rail: Vec<f64>,
    /// Gradient between consecutive samples, ‰ (positive rising with chainage); one fewer than
    /// the samples.
    pub grade_permille: Vec<f64>,
}

impl Profile {
    /// Purpose: rail top at a chainage, interpolated.
    pub fn rail_at(&self, s: f64) -> f64 {
        interp(&self.s, &self.rail, s)
    }
    /// Purpose: steepest gradient, ‰ (signed).
    pub fn steepest(&self) -> f64 {
        self.grade_permille
            .iter()
            .copied()
            .fold(0.0, |a: f64, g| if g.abs() > a.abs() { g } else { a })
    }
}

/// Purpose: the profile's gradients as stretches of constant gradient for the track topology:
/// the rail top simplified to within [`PROFILE_SIMPLIFY_M`], each piece's gradient in ‰ to 0.1 ‰.
/// Level stretches are left out. Output: (from m, to m, ‰) along the centre line.
pub fn gradient_ranges(prof: &Profile) -> Vec<(f64, f64, f64)> {
    let pts: Vec<P2> = prof
        .s
        .iter()
        .zip(&prof.rail)
        .map(|(s, z)| P2::new(*s, *z))
        .collect();
    crate::geom::simplify(&pts, PROFILE_SIMPLIFY_M)
        .windows(2)
        .filter(|w| w[1].x - w[0].x > 1e-6)
        .map(|w| {
            let g = 1000.0 * (w[1].y - w[0].y) / (w[1].x - w[0].x);
            (w[0].x, w[1].x, (g * 10.0).round() / 10.0)
        })
        .filter(|r| r.2 != 0.0)
        .collect()
}

/// The height of a station, level along its platforms.
#[derive(Debug, Clone, PartialEq)]
pub struct StationHeight {
    /// Rail top along the station, m above the geoid.
    pub rail_m: f64,
    /// Lowest smoothed ground along the station tracks, m.
    pub ground_min_m: f64,
    /// Highest smoothed ground along the station tracks, m.
    pub ground_max_m: f64,
}

/// Heights of the whole design.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Heights {
    /// Profile per track id.
    pub tracks: BTreeMap<u32, Profile>,
    /// Height per station id.
    pub stations: BTreeMap<u32, StationHeight>,
}

fn interp(xs: &[f64], ys: &[f64], x: f64) -> f64 {
    if xs.is_empty() {
        return 0.0;
    }
    let i = xs.partition_point(|v| *v < x);
    if i == 0 {
        return ys[0];
    }
    if i >= xs.len() {
        return ys[xs.len() - 1];
    }
    let (x0, x1) = (xs[i - 1], xs[i]);
    let k = if x1 - x0 > 1e-9 {
        (x - x0) / (x1 - x0)
    } else {
        0.0
    };
    ys[i - 1] + (ys[i] - ys[i - 1]) * k
}

/// Purpose: fill gaps in a series from the nearest values either side (linear between them).
/// Output: None when every value is missing.
fn fill(s: &[f64], v: &[Option<f64>]) -> Option<Vec<f64>> {
    let known: Vec<(f64, f64)> = s
        .iter()
        .zip(v)
        .filter_map(|(s, v)| v.map(|v| (*s, v)))
        .collect();
    if known.is_empty() {
        return None;
    }
    let (ks, kv): (Vec<f64>, Vec<f64>) = known.into_iter().unzip();
    Some(s.iter().map(|x| interp(&ks, &kv, *x)).collect())
}

/// Purpose: smooth a ground series over a window: a running median over a window kept
/// symmetric (narrower near the ends), then a local straight-line fit over the window (cut at
/// the ends). Both keep a uniform slope as it is, also at the ends.
fn smooth(s: &[f64], v: &[f64], window: f64) -> Vec<f64> {
    let half = window / 2.0;
    let n = s.len();
    if n == 0 {
        return vec![];
    }
    let (first, last) = (s[0], s[n - 1]);
    let within = |i: usize, r: f64| {
        let a = s.partition_point(|x| *x < s[i] - r - 1e-9);
        let b = s.partition_point(|x| *x <= s[i] + r + 1e-9);
        a..b.max(i + 1)
    };
    let med: Vec<f64> = (0..n)
        .map(|i| {
            let r = half.min(s[i] - first).min(last - s[i]);
            let mut w: Vec<f64> = v[within(i, r)].to_vec();
            w.sort_by(f64::total_cmp);
            let k = w.len();
            if k % 2 == 1 {
                w[k / 2]
            } else {
                (w[k / 2 - 1] + w[k / 2]) / 2.0
            }
        })
        .collect();
    (0..n)
        .map(|i| {
            let idx = within(i, half);
            let k = idx.len() as f64;
            let (xs, ys) = (&s[idx.clone()], &med[idx]);
            let mx = xs.iter().sum::<f64>() / k;
            let my = ys.iter().sum::<f64>() / k;
            let sxx: f64 = xs.iter().map(|x| (x - mx).powi(2)).sum();
            let sxy: f64 = xs.iter().zip(ys).map(|(x, y)| (x - mx) * (y - my)).sum();
            let b = if sxx > 1e-9 { sxy / sxx } else { 0.0 };
            my + b * (s[i] - mx)
        })
        .collect()
}

/// Purpose: chainages every [`PROFILE_STEP_M`] from 0 to `len`, the end included.
fn stations_along(len: f64) -> Vec<f64> {
    let n = (len / PROFILE_STEP_M).ceil().max(1.0) as usize;
    (0..=n).map(|i| i as f64 * len / n as f64).collect()
}

/// Purpose: height of a level above the ground at a chainage of a track: the level's height, or
/// linear between the two levels along a ramp.
fn offset(g: &TrackGeo, s: f64, p: &ModeParams) -> f64 {
    let z = g.zone_at(s);
    match (z.level, z.ramp) {
        (Some(l), _) => l.height_m(p),
        (None, Some(r)) => {
            let r = &g.ramps[r];
            let k = if r.s1 - r.s0 > 1e-9 {
                ((s - r.s0) / (r.s1 - r.s0)).clamp(0.0, 1.0)
            } else {
                1.0
            };
            r.from.height_m(p) + (r.to.height_m(p) - r.from.height_m(p)) * k
        }
        _ => 0.0,
    }
}

/// Purpose: the height a track end must meet: the station's level rail top, or the rail top of
/// the track its switch sits on; None for a free end.
fn fixed_height(dz: &Design, h: &Heights, anchor: &Anchor, at: P2) -> Option<f64> {
    match anchor {
        Anchor::Station { station, .. } => h.stations.get(station).map(|s| s.rail_m),
        Anchor::Switch { switch, .. } => {
            let sw = dz.network.switches.iter().find(|w| w.id == *switch)?;
            let parent = dz.track(sw.track)?;
            let prof = h.tracks.get(&sw.track)?;
            let n = nearest(&parent.centre, at)?;
            Some(prof.rail_at(n.s))
        }
        Anchor::Free { .. } => None,
    }
}

/// Purpose: the parent track a track's anchors depend on (switch anchors).
fn parents(dz: &Design, id: u32) -> Vec<u32> {
    let Some(t) = dz.doc_track(id) else {
        return vec![];
    };
    [Some(&t.start), t.end.as_ref()]
        .into_iter()
        .flatten()
        .filter_map(|a| match a {
            Anchor::Switch { switch, .. } => dz
                .network
                .switches
                .iter()
                .find(|w| w.id == *switch)
                .map(|w| w.track)
                .filter(|p| *p != id),
            _ => None,
        })
        .collect()
}

/// Purpose: give every station and track its heights from the terrain and check the gradients.
/// Side effects: sets `dz.heights` and adds findings to `dz.issues`. Does nothing without terrain.
pub fn profiles(dz: &mut Design, terrain: &Terrain) {
    if terrain.is_empty() {
        return;
    }
    let mut h = Heights::default();
    let mut issues: Vec<Issue> = Vec::new();
    let ground = |p: P2| {
        let [lon, lat] = dz.proj.to_lonlat(p);
        terrain.height(lon, lat)
    };

    // Stations: level, at the mean smoothed ground along the station tracks.
    for st in &dz.stations {
        let Some(doc) = dz.network.stations.iter().find(|s| s.id == st.id) else {
            continue;
        };
        let p = dz.params_for(dz.station_mode(doc)).clone();
        let s = stations_along(2.0 * st.half_len);
        let raw: Vec<Option<f64>> = s
            .iter()
            .map(|a| ground(st.point(a - st.half_len, 0.0)))
            .collect();
        let Some(filled) = fill(&s, &raw) else {
            continue;
        };
        let sm = smooth(&s, &filled, p.terrain_smoothing_window_m);
        let mean = sm.iter().sum::<f64>() / sm.len() as f64;
        let (lo, hi) = sm
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), v| {
                (a.min(*v), b.max(*v))
            });
        let rail = mean + st.level.height_m(&p);
        let fall = hi - lo;
        let text = format!(
            "{} is level with its rails at {:.1} m above sea level; the ground along it lies between {:.1} and {:.1} m.",
            doc.name, rail, lo, hi
        );
        if st.level == Level::Street && fall > 2.0 * p.terrain_street_level_tolerance_m {
            issues.push(Issue::warning(
                format!(
                    "{text} At street level the ground falls {:.1} m along the station, so the street round it has to be regraded by up to {:.1} m. Move the station to flatter ground or build it elevated or underground.",
                    fall,
                    fall / 2.0
                ),
                Some(st.centre),
                st.id,
            ));
        } else {
            issues.push(Issue::info(text, Some(st.centre), Some(st.id)));
        }
        h.stations.insert(
            st.id,
            StationHeight {
                rail_m: rail,
                ground_min_m: lo,
                ground_max_m: hi,
            },
        );
    }

    // Tracks, each after the tracks its switches sit on.
    let mut todo: Vec<u32> = dz.tracks.iter().map(|g| g.id).collect();
    for _ in 0..=todo.len() {
        if todo.is_empty() {
            break;
        }
        let ready: Vec<u32> = todo
            .iter()
            .copied()
            .filter(|id| {
                parents(dz, *id)
                    .iter()
                    .all(|p| !todo.contains(p) || dz.track(*p).is_none())
            })
            .collect();
        // A loop of switch anchors: take the rest as they are.
        let batch = if ready.is_empty() {
            todo.clone()
        } else {
            ready
        };
        for id in &batch {
            if let Some(prof) = track_profile(dz, &h, *id, &ground, &mut issues) {
                h.tracks.insert(*id, prof);
            }
        }
        todo.retain(|id| !batch.contains(id));
    }
    dz.issues.extend(issues);
    dz.heights = h;
}

#[allow(clippy::type_complexity)]
fn track_profile(
    dz: &Design,
    h: &Heights,
    id: u32,
    ground: &dyn Fn(P2) -> Option<f64>,
    issues: &mut Vec<Issue>,
) -> Option<Profile> {
    let g = dz.track(id)?;
    let t = dz.doc_track(id)?;
    let p = dz.track_params(id);
    let s = stations_along(g.length);
    let raw: Vec<Option<f64>> = s.iter().map(|x| ground(at_s(&g.centre, *x).p)).collect();
    let filled = fill(&s, &raw)?;
    let sm = smooth(&s, &filled, p.terrain_smoothing_window_m);
    let mut rail: Vec<f64> = s
        .iter()
        .zip(&sm)
        .map(|(x, gz)| gz + offset(g, *x, p))
        .collect();

    // Tie in to the stations and switches at the ends.
    let at0 = g.centre.first().map(|q| q.p)?;
    let at1 = g.centre.last().map(|q| q.p)?;
    let z0 = fixed_height(dz, h, &t.start, at0);
    let z1 = t.end.as_ref().and_then(|e| fixed_height(dz, h, e, at1));
    let gt = (p.max_gradient() * p.terrain_tie_in_gradient_share).max(1e-4);
    let d0 = z0.map(|z| z - rail[0]).unwrap_or(0.0);
    let d1 = z1.map(|z| z - rail[rail.len() - 1]).unwrap_or(0.0);
    let (mut l0, mut l1) = (d0.abs() / gt, d1.abs() / gt);
    if l0 + l1 > g.length && l0 + l1 > 0.0 {
        let k = g.length / (l0 + l1);
        l0 *= k;
        l1 *= k;
    }
    for (x, r) in s.iter().zip(rail.iter_mut()) {
        if l0 > 1e-9 && *x < l0 {
            *r += d0 * (1.0 - x / l0);
        } else if l0 <= 1e-9 && *x <= 1e-9 {
            *r += d0;
        }
        let back = g.length - x;
        if l1 > 1e-9 && back < l1 {
            *r += d1 * (1.0 - back / l1);
        } else if l1 <= 1e-9 && back <= 1e-9 {
            *r += d1;
        }
    }
    let grade: Vec<f64> = s
        .windows(2)
        .zip(rail.windows(2))
        .map(|(a, b)| 1000.0 * (b[1] - b[0]) / (a[1] - a[0]).max(1e-9))
        .collect();

    // Too steep: one finding per stretch.
    let limit = p.max_gradient_permille + GRADIENT_TOLERANCE_PERMILLE;
    let mut i = 0;
    while i < grade.len() {
        if grade[i].abs() <= limit {
            i += 1;
            continue;
        }
        let a = i;
        while i < grade.len() && grade[i].abs() > limit {
            i += 1;
        }
        let worst = (a..i)
            .max_by(|x, y| grade[*x].abs().total_cmp(&grade[*y].abs()))
            .unwrap_or(a);
        let tie = (l0 > 0.0 && s[a] < l0) || (l1 > 0.0 && s[i] > g.length - l1);
        let why = if tie {
            "Part of it comes from meeting the level station or the switch at the end of the track; give the track more length there or move the station."
        } else {
            "The ground is this steep here. Change the level (elevated or underground) or route the track along the slope. Heights come from a surface model, so buildings and trees can still show through."
        };
        issues.push(Issue::warning(
            format!(
                "The track {} at up to {:.1} ‰ over {} (km {:.2}–{:.2}); the maximum is {:.1} ‰. {why}",
                if grade[worst] > 0.0 { "climbs" } else { "falls" },
                grade[worst].abs(),
                fmt_m(s[i] - s[a]),
                s[a] / 1000.0,
                s[i] / 1000.0,
                p.max_gradient_permille
            ),
            Some(at_s(&g.centre, (s[worst] + s[worst + 1]) / 2.0).p),
            id,
        ));
    }

    // Street-level track lifted off or sunk into the ground by the tie-ins.
    let tol = p.terrain_street_level_tolerance_m;
    let mut i = 0;
    while i < s.len() {
        let off = rail[i] - sm[i];
        let street = g.level_at(s[i]) == Some(Level::Street);
        if !street || off.abs() <= tol {
            i += 1;
            continue;
        }
        let a = i;
        let mut worst = i;
        while i < s.len()
            && g.level_at(s[i]) == Some(Level::Street)
            && (rail[i] - sm[i]).abs() > tol
        {
            if (rail[i] - sm[i]).abs() > (rail[worst] - sm[worst]).abs() {
                worst = i;
            }
            i += 1;
        }
        let d = rail[worst] - sm[worst];
        issues.push(Issue::warning(
            format!(
                "Street-level track runs up to {:.1} m {} the ground over {} to meet the level station or switch at its end (tolerance {:.1} m). The street has to be regraded here; move the station or change the level.",
                d.abs(),
                if d > 0.0 { "above" } else { "below" },
                fmt_m(s[i - 1] - s[a]),
                tol
            ),
            Some(at_s(&g.centre, s[worst]).p),
            id,
        ));
    }

    Some(Profile {
        s,
        ground: raw,
        ground_smooth: sm,
        rail,
        grade_permille: grade,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tile sloping east at `k` m per degree of longitude, `base` m at its west edge.
    fn slope(t: &mut Terrain, x: i32, y: i32, base: f64, k: f64) {
        let h: Vec<Option<f64>> = Terrain::tile_points(x, y)
            .iter()
            .map(|[lon, _]| Some(base + k * (lon - x as f64 * TILE_DEG)))
            .collect();
        t.add_tile(x, y, &h).unwrap();
    }

    #[test]
    fn heights_interpolate_inside_a_tile() {
        let mut t = Terrain::new();
        slope(&mut t, 100, 500, 10.0, 1000.0);
        let h = t.height(1.005, 5.003).unwrap();
        assert!((h - 15.0).abs() < 1e-3, "{h}");
        assert!(t.height(2.0, 5.0).is_none());
        assert!(t.add_tile(0, 0, &[Some(1.0)]).is_err());
    }

    #[test]
    fn smoothing_takes_out_a_building() {
        let s: Vec<f64> = (0..41).map(|i| i as f64 * 10.0).collect();
        let mut v = vec![20.0; 41];
        for x in v.iter_mut().take(23).skip(19) {
            *x = 45.0; // a 30 m wide building
        }
        let sm = smooth(&s, &v, 100.0);
        assert!(sm.iter().all(|z| (z - 20.0).abs() < 1e-9), "{sm:?}");
        // A uniform slope stays as it is, also at the ends.
        let v: Vec<f64> = s.iter().map(|x| 5.0 + 0.03 * x).collect();
        let sm = smooth(&s, &v, 100.0);
        assert!(
            sm.iter().zip(&v).all(|(a, b)| (a - b).abs() < 1e-9),
            "{sm:?}"
        );
    }

    /// Builds the sample network on ground rising east at `per_mille`, loading the tiles the
    /// build asks for.
    fn on_slope(mode: crate::params::RailMode, per_mille: f64) -> Design {
        let net = crate::sample::sample(mode, 13.4, 52.5);
        let none = BTreeMap::new();
        let mut t = Terrain::new();
        let mut dz = crate::design::build_with_terrain(&net, None, &[], &[], &none, &t);
        for _ in 0..3 {
            let want = missing_tiles(&dz, &t);
            if want.is_empty() {
                break;
            }
            for (x, y) in want {
                let h: Vec<Option<f64>> = Terrain::tile_points(x, y)
                    .iter()
                    .map(|[lon, lat]| {
                        Some(100.0 + per_mille / 1000.0 * dz.proj.to_xy(*lon, *lat).x)
                    })
                    .collect();
                t.add_tile(x, y, &h).unwrap();
            }
            dz = crate::design::build_with_terrain(&net, None, &[], &[], &none, &t);
        }
        assert!(missing_tiles(&dz, &t).is_empty());
        dz
    }

    #[test]
    fn stations_are_level_and_tracks_tie_in_to_them() {
        let dz = on_slope(crate::params::RailMode::RegionalRail, 4.0);
        assert_eq!(dz.heights.stations.len(), dz.stations.len());
        for st in &dz.stations {
            let h = &dz.heights.stations[&st.id];
            // Level at the ground under the station's middle (street level, uniform slope).
            let want = 100.0 + 0.004 * st.centre.x;
            assert!((h.rail_m - want).abs() < 0.05, "{} vs {want}", h.rail_m);
            assert!(h.ground_max_m - h.ground_min_m > 0.5);
        }
        let g = dz.track(3).unwrap();
        let prof = &dz.heights.tracks[&3];
        let t = dz.doc_track(3).unwrap();
        let st = |a: &Anchor| match a {
            Anchor::Station { station, .. } => dz.heights.stations[station].rail_m,
            _ => panic!("station anchor"),
        };
        assert!((prof.rail[0] - st(&t.start)).abs() < 0.01);
        assert!((prof.rail.last().unwrap() - st(t.end.as_ref().unwrap())).abs() < 0.01);
        assert!((prof.s.last().unwrap() - g.length).abs() < 1e-6);
        // Gentle ground: within the maximum gradient, no warnings about it.
        let p = dz.track_params(3);
        assert!(prof.steepest().abs() <= p.max_gradient_permille + GRADIENT_TOLERANCE_PERMILLE);
        assert!(
            !dz.issues.iter().any(|i| i.text.contains("‰ over")),
            "{:?}",
            dz.issues
        );
        assert!(dz
            .issues
            .iter()
            .any(|i| i.text.contains("is level with its rails at")));
        // The topology carries the gradients.
        let topo = crate::topology::topology(&dz);
        let json = serde_json::to_value(&topo).unwrap();
        let graded = json["sections"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| !s["gradient_permille"].as_array().unwrap().is_empty())
            .count();
        assert!(graded > 0);
        // The view shows the profile and the station heights.
        let v = crate::view::view(&dz);
        let tr = v["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == 3)
            .unwrap();
        assert!(tr["elevation"]["profile"].as_array().unwrap().len() > 10);
        assert!(v["stations"][0]["height"]["rail_m"].is_number());
    }

    #[test]
    fn steep_ground_is_reported() {
        let dz = on_slope(crate::params::RailMode::RegionalRail, 40.0);
        let steep: Vec<_> = dz
            .issues
            .iter()
            .filter(|i| i.text.contains("‰ over") && i.ref_id == Some(3))
            .collect();
        assert!(!steep.is_empty(), "{:?}", dz.issues);
        // Street-level stations on such a slope are flagged too.
        assert!(dz
            .issues
            .iter()
            .any(|i| i.text.contains("has to be regraded")));
    }

    #[test]
    fn without_terrain_nothing_changes() {
        let net = crate::sample::sample(crate::params::RailMode::Metro, 13.4, 52.5);
        let a = crate::design::build(&net, None);
        assert!(a.heights.tracks.is_empty());
        assert!(!a
            .issues
            .iter()
            .any(|i| i.text.contains("is level with its rails")));
    }
}
