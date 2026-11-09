//! Screening and reflections for the noise map (ADR-0038 step N2): the paths between a source
//! and a receiver past the buildings and over the terrain, and the barrier attenuation of
//! ISO 9613-2 clause 7.4 over them. Buildings are footprints with one height (OpenStreetMap)
//! standing on the ground ([`crate::ground`], flat without terrain).
//!
//! - **Over the top** ([`Obstacles::screen`]): the vertical path is the upper convex hull of the
//!   building roofs and the ground the straight line crosses, the path CNOSSOS-EU and ISO 9613-2
//!   take; several edges act as a thick barrier with the C3 term.
//! - **Round the ends** ([`Obstacles::lateral`]): the two lateral paths in plan, the shortest
//!   ways round the left and right of the buildings that block the line of sight. They are
//!   added energetically to the vertical path, with K_met = 1 and the ground term kept
//!   (ISO 9613-2 7.4). A lateral path that would itself run through another building is
//!   extended round it, up to [`LATERAL_ROUNDS`] times; beyond that, or past more than
//!   [`LATERAL_MAX_BUILDINGS`] buildings, it is dropped (the block is closed on that side).
//! - **Reflections** ([`Obstacles::walls_near`]): the facade walls near a receiver, for the
//!   first-order image sources the engine adds with the facade's reflection coefficient. A
//!   reflected path counts when both its legs are clear.

use crate::ground::{Ground, TerrainInput};
use crate::params::{BANDS_HZ, NB};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// A fast hasher for the grid keys of the indexes (no untrusted keys, so no DoS concern).
#[derive(Default)]
pub struct CellHasher(u64);

impl Hasher for CellHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0.rotate_left(5) ^ b as u64).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
        }
    }
    fn write_i64(&mut self, i: i64) {
        self.0 = (self.0.rotate_left(5) ^ i as u64).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }
}

/// Index from grid cell to items.
type CellMap = HashMap<(i64, i64), Vec<u32>, BuildHasherDefault<CellHasher>>;

/// Speed of sound for the wavelengths, m/s.
const C_SOUND: f64 = 340.0;
/// Bucket size of the building index, m.
const CELL_M: f64 = 40.0;
/// Most buildings a lateral path goes round.
pub const LATERAL_MAX_BUILDINGS: usize = 2;
/// Most times a lateral path is extended round a building it runs into.
pub const LATERAL_ROUNDS: usize = 3;
/// Shortest wall that reflects, m.
const MIN_WALL_M: f64 = 1.0;
/// Ground relief below which the terrain is treated as flat, m.
const FLAT_M: f64 = 0.5;

/// A building: footprint ring (local metres, closed or open) and what is known of its height.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BuildingInput {
    /// Outer ring.
    pub ring: Vec<[f64; 2]>,
    /// Height above ground, m (OSM `height`), when known.
    #[serde(default)]
    pub height_m: Option<f64>,
    /// Storeys above ground (OSM `building:levels`), when known.
    #[serde(default)]
    pub levels: Option<f64>,
}

/// How a building's height is taken when OSM does not give it.
#[derive(Debug, Clone, Copy)]
pub struct HeightRule {
    /// Height of one storey, m.
    pub level_m: f64,
    /// Height when neither height nor storeys are known, m.
    pub default_m: f64,
}

impl BuildingInput {
    /// Purpose: the height used: the given height, else storeys × storey height, else the
    /// default.
    pub fn height(&self, rule: HeightRule) -> f64 {
        self.height_m
            .filter(|h| h.is_finite() && *h > 0.0)
            .or_else(|| {
                self.levels
                    .filter(|l| l.is_finite() && *l > 0.0)
                    .map(|l| l * rule.level_m)
            })
            .unwrap_or(rule.default_m)
    }
}

#[derive(Debug, Clone)]
struct Footprint {
    /// Index in the input.
    src: usize,
    ring: Vec<[f64; 2]>,
    /// Roof height above the datum (ground under the building + building height), m.
    top: f64,
    bbox: [f64; 4],
}

/// A facade wall: one edge of a footprint, with its outward normal.
#[derive(Debug, Clone, Copy)]
pub struct Wall {
    /// Start, local metres.
    pub a: [f64; 2],
    /// End.
    pub b: [f64; 2],
    /// Unit normal pointing out of the building.
    pub n: [f64; 2],
    /// Roof height above the datum, m.
    pub top: f64,
    /// Kept building it belongs to.
    pub building: usize,
}

/// The buildings and the ground of an estimate, indexed for ray queries.
#[derive(Debug, Clone, Default)]
pub struct Obstacles {
    items: Vec<Footprint>,
    map: CellMap,
    walls: Vec<Wall>,
    wall_map: CellMap,
    ground: Option<Ground>,
}

/// Per-query scratch.
#[derive(Debug, Default)]
pub struct RayScratch {
    stamp: Vec<u32>,
    tick: u32,
    wall_stamp: Vec<u32>,
    wall_tick: u32,
    profile: Vec<[f64; 2]>,
    hull: Vec<[f64; 2]>,
    /// Buildings the last [`Obstacles::screen`] crossed: (kept index, first t, last t).
    crossed: Vec<(usize, f64, f64)>,
    set: Vec<usize>,
    blocking: Vec<usize>,
    all: Vec<[f64; 2]>,
    chull: Vec<[f64; 2]>,
    chain: Vec<[f64; 2]>,
    lens: Vec<f64>,
    pts: Vec<[f64; 2]>,
    found: Vec<usize>,
}

/// A diffracted path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Screen {
    /// Path difference, m.
    pub z: f64,
    /// Distance between the first and last diffraction edges along the path, m (0 for one).
    pub e: f64,
    /// Source to first edge, m.
    pub dss: f64,
    /// Last edge to receiver, m.
    pub dsr: f64,
    /// Horizontal source–receiver distance, m.
    pub d: f64,
    /// Number of diffraction edges.
    pub edges: usize,
}

/// A lateral path in plan.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lateral {
    /// Length of the path round the buildings in plan, m.
    pub plan: f64,
    /// Plan distance between the first and last edges, m.
    pub e: f64,
    /// Source to first edge, m.
    pub dss: f64,
    /// Last edge to receiver, m.
    pub dsr: f64,
    /// Horizontal source–receiver distance, m.
    pub d: f64,
    /// Number of edges (building corners) on the path.
    pub edges: usize,
}

impl Lateral {
    /// Purpose: the path for a source and receiver `dz` metres apart in height.
    pub fn screen(&self, dz: f64) -> Screen {
        Screen {
            z: (self.plan.hypot(dz) - self.d.hypot(dz)).max(0.0),
            e: self.e,
            dss: self.dss,
            dsr: self.dsr,
            d: self.d,
            edges: self.edges,
        }
    }
}

/// The vertical path, and whether buildings (not only the ground) block the line of sight.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vertical {
    /// The path over the top.
    pub screen: Screen,
    /// True when a building stands above the line of sight (lateral paths can then exist).
    pub buildings: bool,
}

fn key(x: f64, y: f64) -> (i64, i64) {
    ((x / CELL_M).floor() as i64, (y / CELL_M).floor() as i64)
}

fn bbox_of(ring: &[[f64; 2]]) -> [f64; 4] {
    let mut b = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
    for p in ring {
        b = [
            b[0].min(p[0]),
            b[1].min(p[1]),
            b[2].max(p[0]),
            b[3].max(p[1]),
        ];
    }
    b
}

/// Purpose: register `id` in every index cell a box covers.
fn index(map: &mut CellMap, bbox: [f64; 4], id: u32) {
    let (k0, k1) = (key(bbox[0], bbox[1]), key(bbox[2], bbox[3]));
    for i in k0.0..=k1.0 {
        for j in k0.1..=k1.1 {
            map.entry((i, j)).or_default().push(id);
        }
    }
}

impl Obstacles {
    /// Purpose: index the buildings, with heights by `rule`, standing on the ground of
    /// `terrain` (flat at 0 m without). Rings with fewer than three valid points are dropped.
    /// Inputs: buildings, height rule, terrain grid in local metres and the opening window of
    /// the surface-model filter, m.
    pub fn new(
        buildings: &[BuildingInput],
        rule: HeightRule,
        terrain: Option<&TerrainInput>,
        terrain_window_m: f64,
    ) -> Self {
        let mut o = Obstacles::default();
        let mut kept: Vec<(usize, Vec<[f64; 2]>, f64)> = Vec::new();
        for (src, b) in buildings.iter().enumerate() {
            let mut ring: Vec<[f64; 2]> = b
                .ring
                .iter()
                .copied()
                .filter(|p| p[0].is_finite() && p[1].is_finite())
                .collect();
            if ring.len() >= 2 && ring.first() == ring.last() {
                ring.pop();
            }
            let h = b.height(rule);
            if ring.len() < 3 || h.is_nan() || h <= 0.0 {
                continue;
            }
            kept.push((src, ring, h));
        }
        o.ground = terrain
            .and_then(|t| {
                let rings: Vec<&[[f64; 2]]> = kept.iter().map(|k| k.1.as_slice()).collect();
                Ground::new(t, &rings, terrain_window_m)
            })
            .filter(|g| !g.is_flat(FLAT_M));
        for (src, ring, h) in kept {
            let bbox = bbox_of(&ring);
            let base = o.ground_at([(bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0]);
            let id = o.items.len() as u32;
            index(&mut o.map, bbox, id);
            // Walls with outward normals: a counter-clockwise ring has the outside on the right.
            let area2: f64 = (0..ring.len())
                .map(|k| {
                    let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
                    a[0] * b[1] - b[0] * a[1]
                })
                .sum();
            let sign = if area2 >= 0.0 { 1.0 } else { -1.0 };
            for k in 0..ring.len() {
                let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
                let len = (b[0] - a[0]).hypot(b[1] - a[1]);
                if len < MIN_WALL_M {
                    continue;
                }
                let n = [sign * (b[1] - a[1]) / len, -sign * (b[0] - a[0]) / len];
                let wid = o.walls.len() as u32;
                index(&mut o.wall_map, bbox_of(&[a, b]), wid);
                o.walls.push(Wall {
                    a,
                    b,
                    n,
                    top: base + h,
                    building: id as usize,
                });
            }
            o.items.push(Footprint {
                src,
                ring,
                top: base + h,
                bbox,
            });
        }
        o
    }

    /// Purpose: true when there are neither buildings nor terrain (free field).
    pub fn is_empty(&self) -> bool {
        self.items.is_empty() && self.ground.is_none()
    }

    /// Purpose: true when terrain heights are used.
    pub fn has_ground(&self) -> bool {
        self.ground.is_some()
    }

    /// Purpose: number of buildings kept.
    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// Purpose: input index of kept building `i`.
    pub fn source(&self, i: usize) -> usize {
        self.items[i].src
    }

    /// Purpose: ground height at a point, m (0 without terrain).
    pub fn ground_at(&self, p: [f64; 2]) -> f64 {
        self.ground.as_ref().map_or(0.0, |g| g.at(p))
    }

    /// Purpose: the building `p` stands in, if any.
    pub fn inside(&self, p: [f64; 2]) -> Option<usize> {
        let ids = self.map.get(&key(p[0], p[1]))?;
        ids.iter().map(|&i| i as usize).find(|&i| {
            let b = &self.items[i];
            p[0] >= b.bbox[0]
                && p[0] <= b.bbox[2]
                && p[1] >= b.bbox[1]
                && p[1] <= b.bbox[3]
                && point_in_ring(p, &b.ring)
        })
    }

    /// Purpose: wall `i`.
    pub fn wall(&self, i: usize) -> &Wall {
        &self.walls[i]
    }

    /// Purpose: the walls within `radius` of `p` that face it, once each, into `out`.
    pub fn walls_near(&self, p: [f64; 2], radius: f64, sc: &mut RayScratch, out: &mut Vec<usize>) {
        out.clear();
        if self.walls.is_empty() || radius <= 0.0 {
            return;
        }
        if sc.wall_stamp.len() < self.walls.len() {
            sc.wall_stamp.resize(self.walls.len(), 0);
        }
        sc.wall_tick = sc.wall_tick.wrapping_add(1);
        if sc.wall_tick == 0 {
            sc.wall_stamp.iter_mut().for_each(|x| *x = 0);
            sc.wall_tick = 1;
        }
        let (k0, k1) = (
            key(p[0] - radius, p[1] - radius),
            key(p[0] + radius, p[1] + radius),
        );
        for i in k0.0..=k1.0 {
            for j in k0.1..=k1.1 {
                let Some(ids) = self.wall_map.get(&(i, j)) else {
                    continue;
                };
                for &id in ids {
                    let k = id as usize;
                    if sc.wall_stamp[k] == sc.wall_tick {
                        continue;
                    }
                    sc.wall_stamp[k] = sc.wall_tick;
                    let w = &self.walls[k];
                    let front = (p[0] - w.a[0]) * w.n[0] + (p[1] - w.a[1]) * w.n[1];
                    if front > 0.0 && dist_to_segment(p, w.a, w.b) <= radius {
                        out.push(k);
                    }
                }
            }
        }
    }

    /// Purpose: walk the index cells the segment `s → r` crosses (Amanatides–Woo) and call `f`
    /// once for each building whose footprint the segment touches, with the first and last `t`
    /// (0–1) inside it. `f` returns false to stop the walk.
    fn walk(
        &self,
        s: [f64; 2],
        r: [f64; 2],
        sc: &mut RayScratch,
        mut f: impl FnMut(usize, f64, f64) -> bool,
    ) {
        if self.items.is_empty() {
            return;
        }
        if sc.stamp.len() < self.items.len() {
            sc.stamp.resize(self.items.len(), 0);
        }
        sc.tick = sc.tick.wrapping_add(1);
        if sc.tick == 0 {
            sc.stamp.iter_mut().for_each(|x| *x = 0);
            sc.tick = 1;
        }
        let tick = sc.tick;
        let (sbox, dir) = (
            [
                s[0].min(r[0]),
                s[1].min(r[1]),
                s[0].max(r[0]),
                s[1].max(r[1]),
            ],
            [r[0] - s[0], r[1] - s[1]],
        );
        let (mut i, mut j) = key(s[0], s[1]);
        let end = key(r[0], r[1]);
        let step_i: i64 = if dir[0] > 0.0 { 1 } else { -1 };
        let step_j: i64 = if dir[1] > 0.0 { 1 } else { -1 };
        let next = |c: i64, step: i64| (c + if step > 0 { 1 } else { 0 }) as f64 * CELL_M;
        let mut t_max_x = if dir[0] != 0.0 {
            (next(i, step_i) - s[0]) / dir[0]
        } else {
            f64::INFINITY
        };
        let mut t_max_y = if dir[1] != 0.0 {
            (next(j, step_j) - s[1]) / dir[1]
        } else {
            f64::INFINITY
        };
        let t_dx = if dir[0] != 0.0 {
            CELL_M / dir[0].abs()
        } else {
            f64::INFINITY
        };
        let t_dy = if dir[1] != 0.0 {
            CELL_M / dir[1].abs()
        } else {
            f64::INFINITY
        };
        loop {
            if let Some(ids) = self.map.get(&(i, j)) {
                for &id in ids {
                    let k = id as usize;
                    if sc.stamp[k] == tick {
                        continue;
                    }
                    sc.stamp[k] = tick;
                    let b = &self.items[k];
                    if b.bbox[0] > sbox[2]
                        || b.bbox[2] < sbox[0]
                        || b.bbox[1] > sbox[3]
                        || b.bbox[3] < sbox[1]
                    {
                        continue;
                    }
                    if let Some((t0, t1)) = crossing(s, dir, &b.ring) {
                        if !f(k, t0, t1) {
                            return;
                        }
                    }
                }
            }
            if (i, j) == end || (t_max_x > 1.0 && t_max_y > 1.0) {
                break;
            }
            if t_max_x < t_max_y {
                t_max_x += t_dx;
                i += step_i;
            } else {
                t_max_y += t_dy;
                j += step_j;
            }
        }
    }

    /// Purpose: ground heights along `s → r` at the terrain spacing, as `(distance, height)`
    /// into `out`, without the ends; nothing when the ground cannot reach the line of sight.
    fn ground_profile(&self, s: [f64; 2], r: [f64; 2], zs: f64, zr: f64, out: &mut Vec<[f64; 2]>) {
        let Some(g) = &self.ground else {
            return;
        };
        if g.max <= zs.min(zr) {
            return;
        }
        let d = (r[0] - s[0]).hypot(r[1] - s[1]);
        let n = (d / g.step()).ceil() as usize;
        for k in 1..n {
            let t = k as f64 / n as f64;
            out.push([
                t * d,
                g.at([s[0] + (r[0] - s[0]) * t, s[1] + (r[1] - s[1]) * t]),
            ]);
        }
    }

    /// Purpose: whether a building or the ground stands above the straight line from `(s, zs)`
    /// to `(r, zr)` (heights above the datum). Stops at the first one.
    pub fn blocked(&self, s: [f64; 2], r: [f64; 2], zs: f64, zr: f64, sc: &mut RayScratch) -> bool {
        let mut hit = false;
        self.walk(s, r, sc, |k, t0, t1| {
            let sight = zs + (zr - zs) * (t0 + t1) / 2.0;
            hit = self.items[k].top > sight;
            !hit
        });
        if hit {
            return true;
        }
        sc.profile.clear();
        self.ground_profile(s, r, zs, zr, &mut sc.profile);
        let d = (r[0] - s[0]).hypot(r[1] - s[1]).max(1e-9);
        sc.profile.iter().any(|p| p[1] > zs + (zr - zs) * p[0] / d)
    }

    /// Purpose: the diffracted path over the buildings and the ground between a source and a
    /// receiver. Inputs: positions (local metres), heights above the datum (ground + height
    /// above ground), scratch. Output: `None` when the line of sight is clear. Side effects: the
    /// scratch keeps the buildings crossed for [`Obstacles::lateral`].
    pub fn screen(
        &self,
        s: [f64; 2],
        r: [f64; 2],
        zs: f64,
        zr: f64,
        sc: &mut RayScratch,
    ) -> Option<Vertical> {
        sc.crossed.clear();
        if self.is_empty() {
            return None;
        }
        let d = (r[0] - s[0]).hypot(r[1] - s[1]);
        if d < 1.0 {
            return None;
        }
        sc.profile.clear();
        let mut crossed = std::mem::take(&mut sc.crossed);
        self.walk(s, r, sc, |k, t0, t1| {
            crossed.push((k, t0, t1));
            true
        });
        for &(k, t0, t1) in &crossed {
            let top = self.items[k].top;
            sc.profile.push([t0 * d, top]);
            sc.profile.push([t1 * d, top]);
        }
        sc.crossed = crossed;
        self.ground_profile(s, r, zs, zr, &mut sc.profile);
        if sc.profile.is_empty() {
            return None;
        }
        // Upper convex hull from the source to the receiver over the roof edges and the ground.
        sc.profile.push([0.0, zs]);
        sc.profile.push([d, zr]);
        sc.profile.sort_by(|a, b| a[0].total_cmp(&b[0]));
        sc.hull.clear();
        for &p in &sc.profile {
            while sc.hull.len() >= 2 {
                let (a, b) = (sc.hull[sc.hull.len() - 2], sc.hull[sc.hull.len() - 1]);
                // Remove b when it lies on or below the line from a to p.
                if (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0.0 {
                    sc.hull.pop();
                } else {
                    break;
                }
            }
            sc.hull.push(p);
        }
        let hull = &sc.hull;
        if hull.len() < 3 {
            return None;
        }
        let seg = |a: [f64; 2], b: [f64; 2]| (b[0] - a[0]).hypot(b[1] - a[1]);
        let path: f64 = hull.windows(2).map(|w| seg(w[0], w[1])).sum();
        let direct = d.hypot(zr - zs);
        let dss = seg(hull[0], hull[1]);
        let dsr = seg(hull[hull.len() - 2], hull[hull.len() - 1]);
        let buildings = sc
            .crossed
            .iter()
            .any(|&(k, t0, t1)| self.items[k].top > zs + (zr - zs) * (t0 + t1) / 2.0);
        Some(Vertical {
            screen: Screen {
                z: (path - direct).max(0.0),
                e: (path - dss - dsr).max(0.0),
                dss,
                dsr,
                d,
                edges: hull.len() - 2,
            },
            buildings,
        })
    }

    /// Purpose: the buildings above the line of sight that the last [`Obstacles::screen`]
    /// crossed, into `out`. Output: how many, or `None` when there are more than `out` holds.
    pub fn blocking(&self, zs: f64, zr: f64, sc: &RayScratch, out: &mut [u32]) -> Option<usize> {
        let mut n = 0;
        for &(k, t0, t1) in &sc.crossed {
            if self.items[k].top > zs + (zr - zs) * (t0 + t1) / 2.0 {
                *out.get_mut(n)? = k as u32;
                n += 1;
            }
        }
        Some(n)
    }

    /// Purpose: lower bounds of the lateral path differences on the left and right, m, after
    /// [`Obstacles::screen`] (same `s`, `r`, heights and scratch), without looking for other
    /// buildings in the way: the path through the farthest corner on each side. `None` for a
    /// side without a lateral path (no blocking building, too many, or no corner on that side).
    pub fn lateral_bounds(
        &self,
        s: [f64; 2],
        r: [f64; 2],
        zs: f64,
        zr: f64,
        sc: &RayScratch,
    ) -> [Option<f64>; 2] {
        let d = (r[0] - s[0]).hypot(r[1] - s[1]);
        let mut n = 0;
        let mut best = [f64::NEG_INFINITY; 2];
        if d < 1.0 {
            return [None, None];
        }
        let u = [(r[0] - s[0]) / d, (r[1] - s[1]) / d];
        for &(k, t0, t1) in &sc.crossed {
            let b = &self.items[k];
            if b.top <= zs + (zr - zs) * (t0 + t1) / 2.0 {
                continue;
            }
            n += 1;
            if n > LATERAL_MAX_BUILDINGS {
                return [None, None];
            }
            for p in &b.ring {
                let v = [p[0] - s[0], p[1] - s[1]];
                let a = v[0] * u[0] + v[1] * u[1];
                let w = v[1] * u[0] - v[0] * u[1];
                let detour = a.hypot(w) + (d - a).hypot(w) - d;
                let side = if w > 0.0 { 0 } else { 1 };
                if w != 0.0 && detour > best[side] {
                    best[side] = detour;
                }
            }
        }
        let dz = zr - zs;
        let direct = d.hypot(dz);
        best.map(|b| (b.is_finite() && n > 0).then(|| ((d + b).hypot(dz) - direct).max(0.0)))
    }

    /// Purpose: the lateral paths round the left and right ends of the buildings that block the
    /// line of sight, after [`Obstacles::screen`] found them (same `s`, `r`, heights and
    /// scratch), or round the `given` buildings. A side is `None` when the source or the
    /// receiver is enclosed, or when the path stays blocked. Without `check` the path round the
    /// blocking buildings is returned without looking for others in its way: a lower bound of the
    /// path difference, found without walking the index.
    pub fn lateral(
        &self,
        s: [f64; 2],
        r: [f64; 2],
        [zs, zr]: [f64; 2],
        given: Option<&[u32]>,
        check: bool,
        sc: &mut RayScratch,
    ) -> [Option<Lateral>; 2] {
        let d = (r[0] - s[0]).hypot(r[1] - s[1]);
        let mut out = [None, None];
        let mut blocking = std::mem::take(&mut sc.blocking);
        blocking.clear();
        match given {
            Some(g) => blocking.extend(g.iter().map(|&k| k as usize)),
            None => blocking.extend(
                sc.crossed
                    .iter()
                    .filter(|&&(k, t0, t1)| self.items[k].top > zs + (zr - zs) * (t0 + t1) / 2.0)
                    .map(|&(k, _, _)| k),
            ),
        }
        if blocking.is_empty() || blocking.len() > LATERAL_MAX_BUILDINGS || d < 1.0 {
            sc.blocking = blocking;
            return out;
        }
        let (mut all, mut hull, mut chain, mut lens) = (
            std::mem::take(&mut sc.all),
            std::mem::take(&mut sc.chull),
            std::mem::take(&mut sc.chain),
            std::mem::take(&mut sc.lens),
        );
        let u = [(r[0] - s[0]) / d, (r[1] - s[1]) / d];
        for (o, side) in out.iter_mut().zip([1.0, -1.0]) {
            sc.set.clear();
            sc.set.extend_from_slice(&blocking);
            for _ in 0..=LATERAL_ROUNDS {
                // Plan coordinates: along the line, and across it towards this side.
                sc.pts.clear();
                for &k in &sc.set {
                    for p in &self.items[k].ring {
                        let v = [p[0] - s[0], p[1] - s[1]];
                        sc.pts.push([
                            v[0] * u[0] + v[1] * u[1],
                            side * (v[1] * u[0] - v[0] * u[1]),
                        ]);
                    }
                }
                if !upper_chain(&sc.pts, d, &mut all, &mut hull, &mut chain) {
                    break;
                }
                lens.clear();
                lens.extend(
                    chain
                        .windows(2)
                        .map(|w| (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1])),
                );
                let plan: f64 = lens.iter().sum();
                let screen = Lateral {
                    plan,
                    e: (plan - lens[0] - lens[lens.len() - 1]).max(0.0),
                    dss: lens[0],
                    dsr: lens[lens.len() - 1],
                    d,
                    edges: chain.len() - 2,
                };
                if !check {
                    *o = Some(screen);
                    break;
                }
                // Back to local metres, and look for buildings the chain runs into.
                let to_xy = |q: [f64; 2]| {
                    [
                        s[0] + q[0] * u[0] - side * q[1] * u[1],
                        s[1] + q[0] * u[1] + side * q[1] * u[0],
                    ]
                };
                sc.found.clear();
                let mut along = 0.0;
                for (w, len) in chain.windows(2).zip(&lens) {
                    let (a, b) = (to_xy(w[0]), to_xy(w[1]));
                    let set = std::mem::take(&mut sc.set);
                    let mut found = std::mem::take(&mut sc.found);
                    let a0 = along;
                    self.walk(a, b, sc, |k, t0, t1| {
                        let at = (a0 + len * (t0 + t1) / 2.0) / plan.max(1e-9);
                        if !set.contains(&k) && self.items[k].top > zs + (zr - zs) * at {
                            found.push(k);
                        }
                        true
                    });
                    sc.set = set;
                    sc.found = found;
                    along += len;
                }
                if sc.found.is_empty() {
                    *o = Some(screen);
                    break;
                }
                if sc.set.len() + sc.found.len() > LATERAL_MAX_BUILDINGS {
                    break;
                }
                let found = std::mem::take(&mut sc.found);
                sc.set.extend(found.iter().copied());
                sc.found = found;
            }
        }
        (sc.blocking, sc.all, sc.chull, sc.chain, sc.lens) = (blocking, all, hull, chain, lens);
        out
    }
}

/// Purpose: the upper convex chain from `(0, 0)` to `(d, 0)` over `pts` (plan coordinates along
/// and across the line). Output: the chain with its two ends, or `None` when no point lies
/// above the line or an end is enclosed (it is not on the convex hull).
fn upper_chain(
    pts: &[[f64; 2]],
    d: f64,
    all: &mut Vec<[f64; 2]>,
    hull: &mut Vec<[f64; 2]>,
    chain: &mut Vec<[f64; 2]>,
) -> bool {
    all.clear();
    all.push([0.0, 0.0]);
    all.push([d, 0.0]);
    all.extend_from_slice(pts);
    all.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    let cross = |o: [f64; 2], a: [f64; 2], b: [f64; 2]| {
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    };
    // Andrew's monotone chain: lower then upper hull, counter-clockwise, no collinear points.
    hull.clear();
    for &p in all.iter() {
        while hull.len() >= 2 && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(p);
    }
    let lower = hull.len() + 1;
    for &p in all.iter().rev().skip(1) {
        while hull.len() >= lower && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(p);
    }
    hull.pop();
    let is = |p: &[f64; 2], q: [f64; 2]| p[0] == q[0] && p[1] == q[1];
    let (Some(si), Some(ri)) = (
        hull.iter().position(|p| is(p, [0.0, 0.0])),
        hull.iter().position(|p| is(p, [d, 0.0])),
    ) else {
        return false;
    };
    // Counter-clockwise, the way from the receiver back to the source is the upper side.
    let n = hull.len();
    chain.clear();
    let mut k = ri;
    loop {
        chain.push(hull[k]);
        if k == si {
            break;
        }
        k = (k + 1) % n;
    }
    chain.reverse();
    chain.len() >= 3 && chain[1..chain.len() - 1].iter().all(|p| p[1] > 0.0)
}

fn dz(sc: &Screen, k_met: f64) -> [f64; NB] {
    let cap = if sc.edges > 1 { 25.0 } else { 20.0 };
    BANDS_HZ.map(|f| {
        let lambda = C_SOUND / f;
        let c3 = if sc.edges > 1 && sc.e > 0.0 {
            let q = (5.0 * lambda / sc.e).powi(2);
            (1.0 + q) / (1.0 / 3.0 + q)
        } else {
            1.0
        };
        (10.0 * (3.0 + 20.0 / lambda * c3 * sc.z * k_met).log10()).clamp(0.0, cap)
    })
}

/// Purpose: barrier attenuation D_z per band over the top, ISO 9613-2 equations 14 to 18, with
/// the limits of 20 dB for one edge and 25 dB for several. Output: dB per band.
pub fn barrier_db(sc: &Screen) -> [f64; NB] {
    let k_met = if sc.z > 0.0 {
        (-(1.0 / 2000.0) * (sc.dss * sc.dsr * sc.d / (2.0 * sc.z)).sqrt()).exp()
    } else {
        1.0
    };
    dz(sc, k_met)
}

/// Purpose: D_z at 63 Hz of a single-edge path with path difference `z` and K_met = 1, the
/// smallest of the bands: a bound for any lateral path at least this long. Output: dB.
pub fn lateral_db_63(z: f64) -> f64 {
    let lambda = C_SOUND / BANDS_HZ[0];
    (10.0 * (3.0 + 20.0 / lambda * z).log10()).clamp(0.0, 20.0)
}

/// Purpose: attenuation D_z of a lateral path, ISO 9613-2 7.4 with K_met = 1 (the ground term
/// stays with the path). Output: dB per band.
pub fn lateral_db(sc: &Screen) -> [f64; NB] {
    dz(sc, 1.0)
}

/// Purpose: where the segment `s + t·dir`, t in 0–1, is inside the ring: the first and last
/// crossing, or the segment end inside. Output: `None` when it does not touch the ring.
fn crossing(s: [f64; 2], dir: [f64; 2], ring: &[[f64; 2]]) -> Option<(f64, f64)> {
    let (mut t0, mut t1) = (f64::INFINITY, f64::NEG_INFINITY);
    let n = ring.len();
    for k in 0..n {
        let a = ring[k];
        let b = ring[(k + 1) % n];
        let e = [b[0] - a[0], b[1] - a[1]];
        let den = dir[0] * e[1] - dir[1] * e[0];
        if den.abs() < 1e-12 {
            continue;
        }
        let w = [a[0] - s[0], a[1] - s[1]];
        let t = (w[0] * e[1] - w[1] * e[0]) / den;
        let u = (w[0] * dir[1] - w[1] * dir[0]) / den;
        if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) {
            t0 = t0.min(t);
            t1 = t1.max(t);
        }
    }
    let end = [s[0] + dir[0], s[1] + dir[1]];
    if point_in_ring(s, ring) {
        t0 = 0.0;
    }
    if point_in_ring(end, ring) {
        t1 = 1.0;
    }
    (t0 <= t1).then_some((t0.max(0.0), t1.min(1.0)))
}

/// Purpose: distance from `p` to the segment `a–b`, m.
fn dist_to_segment(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let e = [b[0] - a[0], b[1] - a[1]];
    let l2 = e[0] * e[0] + e[1] * e[1];
    let t = if l2 > 0.0 {
        (((p[0] - a[0]) * e[0] + (p[1] - a[1]) * e[1]) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (p[0] - a[0] - t * e[0]).hypot(p[1] - a[1] - t * e[1])
}

/// Purpose: even–odd point in polygon test.
pub fn point_in_ring(p: [f64; 2], ring: &[[f64; 2]]) -> bool {
    let mut inside = false;
    let n = ring.len();
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (ring[i], ring[j]);
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}
