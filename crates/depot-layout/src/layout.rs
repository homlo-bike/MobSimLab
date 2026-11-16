//! Auto layout (07-simulation §7 step 2): fill each parking, charging, maintenance and reserve zone with
//! drive-through lanes, straight (90°) or angled (60°, 45°) to one-way aisles, using a strip-packing
//! heuristic. Lane lengths come from the vehicle the zone is sized for; aisle widths from that vehicle's
//! swept path. Lanes whose swept path fails in the final layout are dropped.

use crate::check::{drive_in, drive_out, near, AisleGeo, Around, LaneGeo};
use crate::geom::{
    bbox, boxes_near, clean_ring, contains, inside_margin, line_span, rect, ring_distance, V2,
};
use crate::model::{
    bearing_deg, heading_rad, Aisle, DepotInput, Lane, Layout, Proj, Rules, Slot, Zone, ZoneKind,
};
use crate::vehicle::{body, Body, VehicleSpec};
use serde::Serialize;

/// A message about the layout.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Issue {
    /// `error`, `warning` or `info`.
    pub severity: &'static str,
    /// What it is about: a zone, lane or gate id, or None for the whole depot.
    pub subject: Option<String>,
    /// Plain-language message.
    pub message: String,
}

impl Issue {
    pub(crate) fn new(severity: &'static str, subject: Option<&str>, message: String) -> Self {
        Self {
            severity,
            subject: subject.map(str::to_string),
            message,
        }
    }
}

/// The generated layout with what the generator found.
#[derive(Debug, Clone, Serialize)]
pub struct Generated {
    /// Lanes and aisles.
    pub layout: Layout,
    /// Zones that got no lanes, lanes dropped by the swept-path check, and the like.
    pub issues: Vec<Issue>,
}

/// The typical 12 m bus, used when the depot has no vehicles yet.
pub fn typical_bus() -> VehicleSpec {
    VehicleSpec {
        key: "mode:bus".into(),
        name: "Typical 12 m bus".into(),
        length_m: 12.0,
        width_m: 2.55,
        articulations: 0,
        axles_m: None,
        turning_circle_m: None,
    }
}

/// Purpose: the vehicle a zone's slots are sized for: the zone's choice, else the longest the depot holds.
pub fn design_vehicle(zone: Option<&Zone>, vehicles: &[VehicleSpec]) -> VehicleSpec {
    if let Some(k) = zone.and_then(|z| z.vehicle.as_deref()) {
        if let Some(v) = vehicles.iter().find(|v| v.key == k) {
            return v.clone();
        }
    }
    vehicles
        .iter()
        .max_by(|a, b| {
            a.length_m
                .total_cmp(&b.length_m)
                .then(a.width_m.total_cmp(&b.width_m))
        })
        .cloned()
        .unwrap_or_else(typical_bus)
}

/// The cross-section of a lane pattern: lanes at `theta` to the aisles.
#[derive(Debug, Clone, Copy)]
pub struct Pattern {
    /// Lane angle to the aisle, rad.
    pub theta: f64,
    /// Slots per lane.
    pub per_lane: u32,
    /// Slot length, m.
    pub slot_len: f64,
    /// Lane width, m.
    pub lane_w: f64,
    /// Lane length, m.
    pub lane_len: f64,
    /// Aisle width, m.
    pub aisle: f64,
    /// Depth of a band of lanes across the aisles, m.
    pub depth: f64,
    /// Distance between lanes along the aisle, m.
    pub pitch: f64,
    /// Extra distance along the aisle for a walkway, m.
    pub walkway: f64,
    /// A walkway after this many lanes.
    pub walk_every: u32,
}

/// Purpose: the pattern for a vehicle, angle, slots per lane and aisle width.
pub fn pattern(
    v: &VehicleSpec,
    angle_deg: f64,
    per_lane: u32,
    aisle: f64,
    rules: &Rules,
) -> Pattern {
    let theta = angle_deg.clamp(30.0, 90.0).to_radians();
    let per_lane = per_lane.max(1);
    let slot_len = v.length_m + rules.longitudinal_gap_m.max(0.0);
    let lane_w = v.width_m + rules.lateral_spacing_m.max(0.0);
    let lane_len = slot_len * per_lane as f64;
    let (s, c) = theta.sin_cos();
    Pattern {
        theta,
        per_lane,
        slot_len,
        lane_w,
        lane_len,
        aisle,
        depth: lane_len * s + lane_w * c,
        pitch: lane_w / s,
        walkway: rules.walkway_width_m.max(0.0) / s,
        walk_every: rules.walkway_every_n_lanes.round().max(0.0) as u32,
    }
}

/// Purpose: the parked vehicle in a slot as a solid rectangle (the slot less the spacing around it).
pub fn parked(center: V2, dir: V2, slot_len: f64, vehicle_len: f64, vehicle_w: f64) -> [V2; 4] {
    let _ = slot_len;
    rect(
        center.sub(dir.mul(vehicle_len / 2.0)),
        dir,
        vehicle_len,
        vehicle_w,
    )
}

/// Purpose: lanes of a pattern in a test strip: a band below the aisle, the band being entered, the
/// next aisle and the band beyond, wide enough for the whole turn; the bands below and beyond are moved
/// along the aisle by `shift` lanes. Returns the lanes, the middle lane's index and the two aisles.
fn test_strip(
    p: &Pattern,
    v: &VehicleSpec,
    shift: f64,
) -> (Vec<LaneGeo>, usize, AisleGeo, AisleGeo) {
    let dir = V2::dir(p.theta);
    let mut lanes = Vec::new();
    let mut mid = 0;
    let reach = ((p.lane_len * p.theta.cos() + 2.0 * v.length_m) / p.pitch).ceil() as i32 + 2;
    for band in -1..=1 {
        let base = band as f64 * (p.depth + p.aisle);
        let off = if band == 0 { 0.0 } else { shift };
        for j in -reach..=reach {
            let entry = V2::new(
                (j as f64 + off) * p.pitch,
                base + p.lane_w / 2.0 * p.theta.cos(),
            );
            let exit = entry.add(dir.mul(p.lane_len));
            if band == 0 && j == 0 {
                mid = lanes.len();
            }
            lanes.push(lane_geo(entry, exit, p, v));
        }
    }
    let a0 = AisleGeo {
        a: V2::new(-200.0, -p.aisle / 2.0),
        b: V2::new(200.0, -p.aisle / 2.0),
        width: p.aisle,
        two_way: false,
    };
    let a1 = AisleGeo {
        a: V2::new(-200.0, p.depth + p.aisle / 2.0),
        b: V2::new(200.0, p.depth + p.aisle / 2.0),
        width: p.aisle,
        two_way: false,
    };
    (lanes, mid, a0, a1)
}

/// Purpose: a lane in local metres with its parked vehicles.
pub fn lane_geo(entry: V2, exit: V2, p: &Pattern, v: &VehicleSpec) -> LaneGeo {
    let dir = exit.sub(entry).unit();
    let parked = (0..p.per_lane)
        .map(|k| {
            let c = exit.sub(dir.mul(p.slot_len * (k as f64 + 0.5)));
            parked(c, dir, p.slot_len, v.length_m, v.width_m)
        })
        .collect();
    LaneGeo {
        entry,
        exit,
        width: p.lane_w,
        parked,
    }
}

/// Purpose: the narrowest aisle (to 0.25 m) in which the vehicle can drive into and out of a lane between
/// full lanes, or None if 40 m is not enough.
pub fn min_aisle(
    v: &VehicleSpec,
    b: &Body,
    angle_deg: f64,
    per_lane: u32,
    rules: &Rules,
) -> Option<f64> {
    // The bands either side may sit anywhere along the aisle, so every shift must work.
    let ok = |aisle: f64| {
        let p = pattern(v, angle_deg, per_lane, aisle, rules);
        [0.0, 1.0 / 3.0, 2.0 / 3.0].iter().all(|shift| {
            let (lanes, mid, a0, a1) = test_strip(&p, v, *shift);
            let around = Around {
                obstacles: near(&lanes, mid, 60.0),
                boundary: None,
                clearance: rules.swept_clearance_m,
            };
            drive_in(b, &lanes[mid], &a0, &around).is_ok()
                && drive_out(b, &lanes[mid], &a1, &around).is_ok()
        })
    };
    let lo0 = (v.width_m + 2.0 * rules.swept_clearance_m).max(3.0);
    if !ok(40.0) {
        return None;
    }
    if ok(lo0) {
        return Some(round_up(lo0));
    }
    let (mut lo, mut hi) = (lo0, 40.0);
    while hi - lo > 0.25 {
        let m = (lo + hi) / 2.0;
        if ok(m) {
            hi = m;
        } else {
            lo = m;
        }
    }
    Some(round_up(hi))
}

/// Purpose: whether aisles between lanes at this angle are two-way (straight lanes can be turned into
/// from both sides).
pub fn two_way(angle_deg: f64) -> bool {
    angle_deg >= 89.0
}

fn round_up(x: f64) -> f64 {
    (x * 4.0).ceil() / 4.0
}

/// A lane placed in local metres, before ids are given.
#[derive(Debug, Clone)]
struct Placed {
    entry: V2,
    exit: V2,
    /// Index of the aisle strip it is entered from (the next one is its exit aisle).
    strip: i64,
}

/// Purpose: lay one pattern into a zone in a frame turned by `alpha`, with offsets.
/// Output: the lanes, and each aisle strip's centreline (as a point and the frame's x direction).
#[allow(clippy::too_many_arguments)]
fn place(
    zone: &[V2],
    boundary: &[V2],
    taken: &[[V2; 4]],
    p: &Pattern,
    alpha: f64,
    phase_u: f64,
    phase_v: f64,
    clearance: f64,
) -> Vec<Placed> {
    let to_frame = |q: V2| q.rot(-alpha);
    let from_frame = |q: V2| q.rot(alpha);
    let local: Vec<V2> = zone.iter().map(|q| to_frame(*q)).collect();
    let (lo, hi) = bbox(&local);
    let dir = V2::dir(p.theta);
    let period = p.depth + p.aisle;
    let v0 = lo.y - period + phase_v * period;
    let u0 = lo.x - p.lane_len - p.pitch + phase_u * p.pitch;
    let taken_boxes: Vec<_> = taken.iter().map(|r| bbox(r)).collect();
    let mut out = Vec::new();
    let mut strip = 0i64;
    loop {
        let aisle_lo = v0 + strip as f64 * period;
        if aisle_lo > hi.y {
            break;
        }
        let band = aisle_lo + p.aisle;
        let mouth_v = band + p.lane_w / 2.0 * p.theta.cos();
        let mut j = 0u32;
        let mut u = u0;
        while u < hi.x + p.pitch {
            let entry_l = V2::new(u, mouth_v);
            let exit_l = entry_l.add(dir.mul(p.lane_len));
            let outline_l = rect(entry_l, dir, p.lane_len, p.lane_w);
            // The aisle points in front of both ends must be inside the zone too.
            // The aisle in front of both ends, its full width, must be inside the zone too.
            let (ul, uh) = outline_l
                .iter()
                .fold((f64::INFINITY, f64::NEG_INFINITY), |a, q| {
                    (a.0.min(q.x), a.1.max(q.x))
                });
            let next = band + p.depth;
            let aprons = [
                V2::new(ul, aisle_lo),
                V2::new(uh, aisle_lo),
                V2::new(ul, band),
                V2::new(uh, band),
                V2::new(ul, next),
                V2::new(uh, next),
                V2::new(ul, next + p.aisle),
                V2::new(uh, next + p.aisle),
            ];
            if outline_l.iter().all(|q| contains(&local, *q))
                && aprons.iter().all(|q| contains(&local, *q))
            {
                let outline: Vec<V2> = outline_l.iter().map(|q| from_frame(*q)).collect();
                let ob = bbox(&outline);
                if inside_margin(&outline, boundary) >= clearance.min(0.05)
                    && !taken
                        .iter()
                        .zip(&taken_boxes)
                        .any(|(t, tb)| boxes_near(ob, *tb, 0.1) && ring_distance(&outline, t) < 0.1)
                {
                    out.push(Placed {
                        entry: from_frame(entry_l),
                        exit: from_frame(exit_l),
                        strip,
                    });
                }
            }
            j += 1;
            u += p.pitch;
            if p.walk_every > 0 && j % p.walk_every == 0 {
                u += p.walkway;
            }
        }
        strip += 1;
    }
    out
}

/// Purpose: the directions to try for a zone's aisles: the zone's choice, else along and across each of
/// its two longest sides.
fn headings(zone: &Zone, ring: &[V2]) -> Vec<f64> {
    if let Some(h) = zone.heading_deg {
        return vec![heading_rad(h)];
    }
    let n = ring.len();
    let mut sides: Vec<(f64, f64)> = (0..n)
        .map(|i| {
            let d = ring[(i + 1) % n].sub(ring[i]);
            (d.len(), d.angle())
        })
        .collect();
    sides.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut out: Vec<f64> = Vec::new();
    for (_, a) in sides.iter().take(2) {
        for k in 0..4 {
            let h = a + k as f64 * std::f64::consts::FRAC_PI_2;
            if !out
                .iter()
                .any(|x| (x - h).rem_euclid(std::f64::consts::TAU) < 1e-6)
            {
                out.push(h);
            }
        }
    }
    out
}

/// Purpose: the best placement of a pattern in a zone: most lanes, then the earliest tried.
fn best_fill(
    zone: &Zone,
    ring: &[V2],
    boundary: &[V2],
    taken: &[[V2; 4]],
    p: &Pattern,
    clearance: f64,
) -> (f64, Vec<Placed>) {
    let mut best: (f64, Vec<Placed>) = (0.0, Vec::new());
    for alpha in headings(zone, ring) {
        for pv in 0..6 {
            for pu in 0..3 {
                let got = place(
                    ring,
                    boundary,
                    taken,
                    p,
                    alpha,
                    pu as f64 / 3.0,
                    pv as f64 / 6.0,
                    clearance,
                );
                if got.len() > best.1.len() {
                    best = (alpha, got);
                }
            }
        }
    }
    best
}

/// Purpose: the auto layout of a depot (all zones), with lanes that fail the swept-path check removed.
pub fn generate(input: &DepotInput) -> Generated {
    if input.boundary.len() < 3 {
        return Generated {
            layout: Layout::default(),
            issues: vec![Issue::new(
                "error",
                None,
                "Draw the depot outline first.".into(),
            )],
        };
    }
    let proj = Proj::around(&input.boundary);
    let boundary = clean_ring(
        &input
            .boundary
            .iter()
            .map(|p| proj.xy(*p))
            .collect::<Vec<_>>(),
    );
    let rules = &input.rules;
    let mut issues = Vec::new();
    let mut layout = Layout::default();
    let mut taken: Vec<[V2; 4]> = Vec::new();
    // Per lane: its pattern and vehicle, for the swept-path pass.
    let mut meta: Vec<(Pattern, VehicleSpec, Body)> = Vec::new();
    let mut aisles_xy: Vec<AisleGeo> = Vec::new();
    let mut lane_aisles: Vec<(usize, usize)> = Vec::new();
    let mut lanes_xy: Vec<LaneGeo> = Vec::new();
    for zone in input.zones.iter().filter(|z| z.kind.has_slots()) {
        let ring = clean_ring(&zone.ring.iter().map(|p| proj.xy(*p)).collect::<Vec<_>>());
        if ring.len() < 3 {
            continue;
        }
        let v = design_vehicle(Some(zone), &input.vehicles);
        let b = body(&v, rules.turning_circle_m);
        let default_per_lane = if zone.kind == ZoneKind::Maintenance {
            1
        } else {
            rules.vehicles_per_lane.round().max(1.0) as u32
        };
        // The zone's own number of vehicles per lane, else the project value or fewer, whichever holds most.
        let tries: Vec<u32> = match zone.vehicles_per_lane {
            Some(n) => vec![n.max(1)],
            None => (1..=default_per_lane).rev().collect(),
        };
        let mut chosen: Option<(Pattern, f64, Vec<Placed>)> = None;
        let mut no_turn = false;
        for per_lane in tries {
            let aisle = match zone.aisle_width_m.filter(|w| *w > 0.0) {
                Some(w) => w,
                None => match min_aisle(&v, &b, zone.angle_deg, per_lane, rules) {
                    Some(w) => w,
                    None => {
                        no_turn = true;
                        continue;
                    }
                },
            };
            let p = pattern(&v, zone.angle_deg, per_lane, aisle, rules);
            let (alpha, placed) =
                best_fill(zone, &ring, &boundary, &taken, &p, rules.swept_clearance_m);
            let slots = placed.len() as u32 * per_lane;
            if chosen
                .as_ref()
                .map_or(true, |c| slots > c.2.len() as u32 * c.0.per_lane)
            {
                chosen = Some((p, alpha, placed));
            }
        }
        let Some((p, alpha, placed)) = chosen else {
            if no_turn {
                issues.push(Issue::new(
                    "error",
                    Some(&zone.id),
                    format!(
                        "A {} cannot turn into lanes at {}° even with a 40 m aisle.",
                        v.name_or_len(),
                        zone.angle_deg
                    ),
                ));
            }
            continue;
        };
        let aisle = p.aisle;
        if placed.is_empty() {
            issues.push(Issue::new(
                "warning",
                Some(&zone.id),
                format!(
                    "No lane fits: a lane of {} m by {:.1} m with {:.1} m aisles on both ends does not fit in this zone.",
                    fmt1(p.lane_len),
                    p.lane_w,
                    aisle
                ),
            ));
            continue;
        }
        // Aisles: one per strip that has lanes, across the whole zone.
        let ax = V2::dir(alpha);
        let mut strips: Vec<i64> = placed.iter().flat_map(|l| [l.strip, l.strip + 1]).collect();
        strips.sort_unstable();
        strips.dedup();
        let mut strip_aisle = std::collections::HashMap::new();
        for s in strips {
            // A point on the strip's centreline: in front of a lane that uses it.
            let Some(at) = placed.iter().find_map(|l| {
                if l.strip == s {
                    Some(project_on_strip(l.entry, ax, &p, true))
                } else if l.strip + 1 == s {
                    Some(project_on_strip(l.exit, ax, &p, false))
                } else {
                    None
                }
            }) else {
                continue;
            };
            let (t0, t1) = line_span(&ring, at, ax, 0.0).unwrap_or((-p.pitch, p.pitch));
            let a = at.add(ax.mul(t0));
            let b = at.add(ax.mul(t1));
            let id = format!(
                "{}-a{}",
                zone.id,
                layout.aisles.iter().filter(|x| x.zone == zone.id).count() + 1
            );
            layout.aisles.push(Aisle {
                id,
                zone: zone.id.clone(),
                coords: vec![proj.ll(a), proj.ll(b)],
                width_m: aisle,
                two_way: two_way(zone.angle_deg),
            });
            aisles_xy.push(AisleGeo {
                a,
                b,
                width: aisle,
                two_way: two_way(zone.angle_deg),
            });
            strip_aisle.insert(s, aisles_xy.len() - 1);
        }
        let mut n = 0;
        for l in &placed {
            n += 1;
            let id = format!("{}-l{}", zone.id, n);
            let dir = l.exit.sub(l.entry).unit();
            let h = dir.angle();
            let slots = (0..p.per_lane)
                .map(|k| {
                    let c = l.exit.sub(dir.mul(p.slot_len * (k as f64 + 0.5)));
                    Slot {
                        id: format!("{id}-s{}", k + 1),
                        center: proj.ll(c),
                        heading_deg: bearing_deg(h),
                        length_m: round2(v.length_m),
                        width_m: round2(p.lane_w),
                        charger: zone.kind == ZoneKind::Charging,
                    }
                })
                .collect();
            let ain = strip_aisle[&l.strip];
            let aout = strip_aisle[&(l.strip + 1)];
            layout.lanes.push(Lane {
                id,
                zone: zone.id.clone(),
                kind: zone.kind,
                entry: proj.ll(l.entry),
                exit: proj.ll(l.exit),
                width_m: round2(p.lane_w),
                aisle_in: Some(layout.aisles[ain].id.clone()),
                aisle_out: Some(layout.aisles[aout].id.clone()),
                slots,
            });
            let g = lane_geo(l.entry, l.exit, &p, &v);
            taken.push(g.outline());
            lanes_xy.push(g);
            lane_aisles.push((ain, aout));
            meta.push((p, v.clone(), b.clone()));
        }
    }
    // Swept-path pass: drop lanes a vehicle cannot drive into or out of in the final layout.
    let mut keep = vec![true; lanes_xy.len()];
    for i in 0..lanes_xy.len() {
        let (_, _, b) = &meta[i];
        let around = Around {
            obstacles: near(&lanes_xy, i, 60.0),
            boundary: Some(&boundary),
            clearance: rules.swept_clearance_m,
        };
        let (ain, aout) = lane_aisles[i];
        let ri = drive_in(b, &lanes_xy[i], &aisles_xy[ain], &around);
        let ro = drive_out(b, &lanes_xy[i], &aisles_xy[aout], &around);
        if ri.is_err() || ro.is_err() {
            keep[i] = false;
        }
    }
    let dropped = keep.iter().filter(|k| !**k).count();
    if dropped > 0 {
        issues.push(Issue::new(
            "info",
            None,
            format!(
                "{dropped} lane{} left out because a vehicle could not turn into or out of {} without touching the fence or a parked vehicle.",
                if dropped == 1 { " was" } else { "s were" },
                if dropped == 1 { "it" } else { "them" }
            ),
        ));
    }
    let mut k = keep.iter();
    layout.lanes.retain(|_| *k.next().unwrap_or(&true));
    // Aisles no lane uses any more go too.
    let used: std::collections::HashSet<String> = layout
        .lanes
        .iter()
        .flat_map(|l| [l.aisle_in.clone(), l.aisle_out.clone()])
        .flatten()
        .collect();
    layout.aisles.retain(|a| used.contains(&a.id));
    if input.zones.iter().all(|z| !z.kind.has_slots()) {
        issues.push(Issue::new(
            "warning",
            None,
            "Draw a parking or charging zone for the auto layout to fill.".into(),
        ));
    }
    Generated { layout, issues }
}

/// Purpose: the point on an aisle strip's centreline in front of a lane end.
fn project_on_strip(end: V2, ax: V2, p: &Pattern, entry: bool) -> V2 {
    let n = ax.perp();
    let half_offset = p.aisle / 2.0 + p.lane_w / 2.0 * p.theta.cos();
    if entry {
        end.sub(n.mul(half_offset))
    } else {
        end.add(n.mul(half_offset))
    }
}

pub(crate) fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

fn fmt1(x: f64) -> String {
    format!("{x:.1}")
}

trait NameOrLen {
    fn name_or_len(&self) -> String;
}

impl NameOrLen for VehicleSpec {
    fn name_or_len(&self) -> String {
        if self.name.is_empty() {
            format!("{:.1} m vehicle", self.length_m)
        } else {
            self.name.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aisle_narrower_for_angled_lanes() {
        let v = typical_bus();
        let b = body(&v, 24.0);
        let r = Rules::default();
        let a90 = min_aisle(&v, &b, 90.0, 4, &r).unwrap();
        let a45 = min_aisle(&v, &b, 45.0, 1, &r).unwrap();
        assert!(a90 > 8.0 && a90 < 25.0, "{a90}");
        assert!(a45 < a90, "{a45} < {a90}");
    }
}
