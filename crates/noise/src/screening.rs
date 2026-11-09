//! Screening by buildings for the noise map (ADR-0038 step N2): the vertical path over the
//! buildings between a source and a receiver, and the barrier attenuation of ISO 9613-2 clause 7.4
//! over it. Buildings are footprints with one height (OpenStreetMap), standing on flat ground.
//!
//! Simplifications, stated on the map: diffraction over the roofs only (no lateral paths round the
//! ends of a building), no reflections from facades, one height per building. The roof path is the
//! upper convex hull of the building edges the straight line crosses, which is the path CNOSSOS-EU
//! and ISO 9613-2 take; several roofs act as a thick barrier with the C3 term.

use crate::params::{BANDS_HZ, NB};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Speed of sound for the wavelengths, m/s.
const C_SOUND: f64 = 340.0;
/// Bucket size of the building index, m.
const CELL_M: f64 = 40.0;

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
    h: f64,
    bbox: [f64; 4],
}

/// The buildings of an estimate, indexed for ray queries.
#[derive(Debug, Clone, Default)]
pub struct Obstacles {
    items: Vec<Footprint>,
    map: HashMap<(i64, i64), Vec<u32>>,
}

/// Per-query scratch: which buildings a ray has already met.
#[derive(Debug, Default)]
pub struct RayScratch {
    stamp: Vec<u32>,
    tick: u32,
    profile: Vec<[f64; 2]>,
    hull: Vec<[f64; 2]>,
}

/// The diffracted path over the roofs.
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

fn key(x: f64, y: f64) -> (i64, i64) {
    ((x / CELL_M).floor() as i64, (y / CELL_M).floor() as i64)
}

impl Obstacles {
    /// Purpose: index the buildings, with heights by `rule`. Rings with fewer than three valid
    /// points are dropped.
    pub fn new(buildings: &[BuildingInput], rule: HeightRule) -> Self {
        let mut o = Obstacles::default();
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
            let mut bbox = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
            for p in &ring {
                bbox = [
                    bbox[0].min(p[0]),
                    bbox[1].min(p[1]),
                    bbox[2].max(p[0]),
                    bbox[3].max(p[1]),
                ];
            }
            let id = o.items.len() as u32;
            let (k0, k1) = (key(bbox[0], bbox[1]), key(bbox[2], bbox[3]));
            for i in k0.0..=k1.0 {
                for j in k0.1..=k1.1 {
                    o.map.entry((i, j)).or_default().push(id);
                }
            }
            o.items.push(Footprint { src, ring, h, bbox });
        }
        o
    }

    /// Purpose: true when there are no buildings.
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Purpose: number of buildings kept.
    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// Purpose: input index of kept building `i`.
    pub fn source(&self, i: usize) -> usize {
        self.items[i].src
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

    /// Purpose: the diffracted path over the buildings between a source and a receiver.
    /// Inputs: positions (local metres), heights above ground, scratch. Output: `None` when the
    /// line of sight is clear.
    pub fn screen(
        &self,
        s: [f64; 2],
        r: [f64; 2],
        hs: f64,
        hr: f64,
        sc: &mut RayScratch,
    ) -> Option<Screen> {
        if self.items.is_empty() {
            return None;
        }
        let d = (r[0] - s[0]).hypot(r[1] - s[1]);
        if d < 1.0 {
            return None;
        }
        if sc.stamp.len() < self.items.len() {
            sc.stamp.resize(self.items.len(), 0);
        }
        sc.tick = sc.tick.wrapping_add(1);
        if sc.tick == 0 {
            sc.stamp.iter_mut().for_each(|x| *x = 0);
            sc.tick = 1;
        }
        sc.profile.clear();
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
        // Walk the index cells the segment crosses (Amanatides–Woo).
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
                        sc.profile.push([t0 * d, b.h]);
                        sc.profile.push([t1 * d, b.h]);
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
        if sc.profile.is_empty() {
            return None;
        }
        // Upper convex hull from the source to the receiver over the roof edges.
        sc.profile.push([0.0, hs]);
        sc.profile.push([d, hr]);
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
        let direct = d.hypot(hr - hs);
        let dss = seg(hull[0], hull[1]);
        let dsr = seg(hull[hull.len() - 2], hull[hull.len() - 1]);
        Some(Screen {
            z: (path - direct).max(0.0),
            e: (path - dss - dsr).max(0.0),
            dss,
            dsr,
            d,
            edges: hull.len() - 2,
        })
    }
}

/// Purpose: barrier attenuation D_z per band, ISO 9613-2 equations 14 to 18, with the limits of
/// 20 dB for one edge and 25 dB for several. Output: dB per band.
pub fn barrier_db(sc: &Screen) -> [f64; NB] {
    let k_met = if sc.z > 0.0 {
        (-(1.0 / 2000.0) * (sc.dss * sc.dsr * sc.d / (2.0 * sc.z)).sqrt()).exp()
    } else {
        1.0
    };
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
