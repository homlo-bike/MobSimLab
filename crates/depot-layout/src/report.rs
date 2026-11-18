//! All checks of one depot: swept path of every lane, the driving network from the gates, and capacity
//! against the fleet with a slot per vehicle. Dynamic sizing is separate ([`crate::sizing`]): it lays out
//! the whole outline several times.

use crate::capacity::{assign, Capacity};
use crate::check::{drive_in, drive_out, near, AisleGeo, Around, Fail, LaneGeo};
use crate::geom::{centroid, clean_ring, dist_point_segment, V2};
use crate::layout::{design_vehicle, parked, Issue};
use crate::model::{heading_rad, DepotInput, Layout, LonLat, Proj, ZoneKind};
use crate::network::{build, NetInput, Network, Reach};
use crate::sweep::Path;
use crate::vehicle::{body, Body, VehicleSpec};
use serde::Serialize;

/// The swept-path result of one lane.
#[derive(Debug, Clone, Serialize)]
pub struct LaneCheck {
    /// Lane id.
    pub lane: String,
    /// The vehicle the check drove (the zone's sizing vehicle).
    pub vehicle: String,
    /// Driving in works.
    pub entry_ok: bool,
    /// Driving out works.
    pub exit_ok: bool,
    /// Why not, when one fails.
    pub message: Option<String>,
}

/// Everything the depot tool shows about a depot.
#[derive(Debug, Clone, Serialize)]
pub struct Report {
    /// Swept path per lane.
    pub lanes: Vec<LaneCheck>,
    /// Driving network for the road simulation.
    pub network: Network,
    /// Reach of each lane from the gates.
    pub reach: Vec<Reach>,
    /// Slots against the fleet, with a slot per vehicle.
    pub capacity: Capacity,
    /// All problems, worst first.
    pub issues: Vec<Issue>,
}

/// A depot's layout in local metres, with each lane's vehicle and aisles resolved.
pub struct Prepared {
    /// Projection.
    pub proj: Proj,
    /// Outline.
    pub boundary: Vec<V2>,
    /// Lanes.
    pub lanes: Vec<LaneGeo>,
    /// Aisles.
    pub aisles: Vec<AisleGeo>,
    /// Per lane: aisle index in and out.
    pub lane_aisles: Vec<(Option<usize>, Option<usize>)>,
    /// Per lane: the vehicle checked and its body.
    pub lane_vehicle: Vec<(VehicleSpec, Body)>,
}

/// Purpose: the layout in local metres. Lanes without a saved aisle take the nearest aisle at each end.
pub fn prepare(input: &DepotInput, layout: &Layout) -> Prepared {
    let proj = Proj::around(&input.boundary);
    let boundary = clean_ring(
        &input
            .boundary
            .iter()
            .map(|p| proj.xy(*p))
            .collect::<Vec<_>>(),
    );
    let aisles: Vec<AisleGeo> = layout
        .aisles
        .iter()
        .map(|a| AisleGeo {
            a: proj.xy(a.coords[0]),
            b: proj.xy(*a.coords.last().unwrap_or(&a.coords[0])),
            width: a.width_m,
            two_way: a.two_way,
        })
        .collect();
    let mut lanes = Vec::new();
    let mut lane_aisles = Vec::new();
    let mut lane_vehicle = Vec::new();
    for l in &layout.lanes {
        let zone = input.zones.iter().find(|z| z.id == l.zone);
        let v = design_vehicle(zone, &input.vehicles, &input.fleet);
        let b = body(&v, input.rules.turning_circle_m);
        let entry = proj.xy(l.entry);
        let exit = proj.xy(l.exit);
        let parked_rects = l
            .slots
            .iter()
            .map(|s| {
                let d = V2::dir(heading_rad(s.heading_deg));
                let vl = v.length_m.min(s.length_m);
                let vw = v.width_m.min(s.width_m);
                parked(proj.xy(s.center), d, s.length_m, vl, vw)
            })
            .collect();
        let find = |id: &Option<String>, at: V2| -> Option<usize> {
            if let Some(i) = id
                .as_ref()
                .and_then(|id| layout.aisles.iter().position(|a| &a.id == id))
            {
                return Some(i);
            }
            aisles
                .iter()
                .enumerate()
                .map(|(i, a)| (i, dist_point_segment(at, a.a, a.b), a.width))
                .filter(|(_, d, w)| *d <= w / 2.0 + l.width_m + 1.0)
                .min_by(|x, y| x.1.total_cmp(&y.1))
                .map(|(i, ..)| i)
        };
        lane_aisles.push((find(&l.aisle_in, entry), find(&l.aisle_out, exit)));
        lanes.push(LaneGeo {
            entry,
            exit,
            width: l.width_m,
            parked: parked_rects,
        });
        lane_vehicle.push((v, b));
    }
    Prepared {
        proj,
        boundary,
        lanes,
        aisles,
        lane_aisles,
        lane_vehicle,
    }
}

fn why(f: Fail, into: bool) -> &'static str {
    match (f, into) {
        (Fail::NoAisle, true) => "No aisle in front of the lane entry.",
        (Fail::NoAisle, false) => "No aisle in front of the lane exit.",
        (Fail::TooSharp, _) => "The lane meets its aisle at more than 100°.",
        (Fail::NoRoom, true) => {
            "The turn into the lane does not fit: the lane is too short for the turn."
        }
        (Fail::NoRoom, false) => "The turn out of the lane does not fit.",
        (Fail::Obstacle, true) => "Driving in, the vehicle would touch a parked vehicle.",
        (Fail::Obstacle, false) => "Driving out, the vehicle would touch a parked vehicle.",
        (Fail::Outside, true) => "Driving in, the vehicle would run over the depot fence.",
        (Fail::Outside, false) => "Driving out, the vehicle would run over the depot fence.",
    }
}

/// Purpose: the swept-path manoeuvres of one lane: (in, out).
pub fn manoeuvres(
    p: &Prepared,
    i: usize,
    clearance: f64,
) -> (Result<Path, Fail>, Result<Path, Fail>) {
    let around = Around {
        obstacles: near(&p.lanes, i, 60.0),
        boundary: Some(&p.boundary),
        clearance,
    };
    let b = &p.lane_vehicle[i].1;
    let (ain, aout) = p.lane_aisles[i];
    let rin = match ain {
        Some(a) => drive_in(b, &p.lanes[i], &p.aisles[a], &around),
        None => Err(Fail::NoAisle),
    };
    let rout = match aout {
        Some(a) => drive_out(b, &p.lanes[i], &p.aisles[a], &around),
        None => Err(Fail::NoAisle),
    };
    (rin, rout)
}

/// Purpose: all checks of a depot with its current layout.
pub fn analyse(input: &DepotInput) -> Report {
    let layout = input.layout.clone().unwrap_or_default();
    let mut issues: Vec<Issue> = Vec::new();
    if input.boundary.len() < 3 {
        issues.push(Issue::new(
            "error",
            None,
            "Draw the depot outline first.".into(),
        ));
    }
    let p = prepare(input, &layout);
    let clearance = input.rules.swept_clearance_m;
    let mut lanes = Vec::new();
    for (i, l) in layout.lanes.iter().enumerate() {
        let (rin, rout) = manoeuvres(&p, i, clearance);
        let message = match (&rin, &rout) {
            (Err(f), _) => Some(why(*f, true).to_string()),
            (_, Err(f)) => Some(why(*f, false).to_string()),
            _ => None,
        };
        if let Some(m) = &message {
            issues.push(Issue::new("error", Some(&l.id), m.clone()));
        }
        lanes.push(LaneCheck {
            lane: l.id.clone(),
            vehicle: p.lane_vehicle[i].0.key.clone(),
            entry_ok: rin.is_ok(),
            exit_ok: rout.is_ok(),
            message,
        });
    }
    // Driving network from the gates.
    let widest = input
        .vehicles
        .iter()
        .map(|v| v.width_m)
        .fold(2.55f64, f64::max);
    let gates: Vec<_> = input
        .gates
        .iter()
        .map(|g| (g.id.clone(), g.kind, p.proj.xy(g.lonlat)))
        .collect();
    let mut yard = Vec::new();
    for z in input
        .zones
        .iter()
        .filter(|z| z.kind == ZoneKind::Circulation)
    {
        let ring: Vec<V2> = clean_ring(&z.ring.iter().map(|q| p.proj.xy(*q)).collect::<Vec<_>>());
        if ring.len() < 3 {
            continue;
        }
        let c = centroid(&ring);
        yard.push(c);
        for q in &ring {
            let d = c.sub(*q);
            let step = (widest / 2.0 + clearance + 0.5).min(d.len() * 0.5);
            yard.push(q.add(d.unit().mul(step)));
        }
    }
    let net_in = NetInput {
        proj: &p.proj,
        boundary: &p.boundary,
        gates,
        aisles: layout
            .aisles
            .iter()
            .zip(&p.aisles)
            .map(|(a, g)| (a.id.clone(), g.a, g.b, a.two_way))
            .collect(),
        lanes: layout
            .lanes
            .iter()
            .zip(&p.lanes)
            .zip(&p.lane_aisles)
            .map(|((l, g), (ai, ao))| (l.id.clone(), g.entry, g.exit, *ai, *ao))
            .collect(),
        parked: p
            .lanes
            .iter()
            .flat_map(|l| l.parked.iter().copied())
            .collect(),
        yard,
        keep_off: widest / 2.0 + clearance,
        perimeter_inset: input.rules.aisle_width_m / 2.0,
    };
    let (network, reach) = build(&net_in);
    if !input.gates.iter().any(|g| g.kind.enters()) {
        issues.push(Issue::new(
            "error",
            None,
            "The depot has no entrance: add a gate.".into(),
        ));
    }
    if !input.gates.iter().any(|g| g.kind.leaves()) {
        issues.push(Issue::new(
            "error",
            None,
            "The depot has no exit: add a gate.".into(),
        ));
    }
    let has_gates =
        input.gates.iter().any(|g| g.kind.enters()) && input.gates.iter().any(|g| g.kind.leaves());
    if has_gates {
        let cut_in = reach.iter().filter(|r| !r.from_entrance).count();
        let cut_out = reach.iter().filter(|r| !r.to_exit).count();
        for r in reach.iter().filter(|r| !r.from_entrance || !r.to_exit) {
            let m = match (r.from_entrance, r.to_exit) {
                (false, false) => "No drive from an entrance to this lane, nor from it to an exit.",
                (false, true) => "No drive from an entrance to this lane.",
                _ => "No drive from this lane to an exit.",
            };
            issues.push(Issue::new("error", Some(&r.lane), m.into()));
        }
        if cut_in + cut_out > 0 {
            issues.push(Issue::new(
                "info",
                None,
                "Drives inside the depot run in straight lines through open space; draw a circulation zone or leave room along the fence where vehicles should drive.".into(),
            ));
        }
    }
    let capacity = assign(
        &layout,
        &input.vehicles,
        &input.fleet,
        input.rules.charger_power_kw,
    );
    issues.extend(capacity.issues.iter().cloned());
    if layout.lanes.is_empty() && input.boundary.len() >= 3 {
        issues.push(Issue::new(
            "warning",
            None,
            "The depot has no slots yet: draw zones and run the auto layout.".into(),
        ));
    }
    let rank = |s: &str| match s {
        "error" => 0,
        "warning" => 1,
        _ => 2,
    };
    issues.sort_by_key(|i| rank(i.severity));
    Report {
        lanes,
        network,
        reach,
        capacity,
        issues,
    }
}

/// Purpose: the outlines a vehicle sweeps driving into and out of one lane, for drawing (every ~1.2 m),
/// as rings of `[lon, lat]`.
pub fn envelope(input: &DepotInput, lane_id: &str) -> Vec<Vec<LonLat>> {
    let layout = input.layout.clone().unwrap_or_default();
    let Some(i) = layout.lanes.iter().position(|l| l.id == lane_id) else {
        return Vec::new();
    };
    let p = prepare(input, &layout);
    let (rin, rout) = manoeuvres(&p, i, input.rules.swept_clearance_m);
    let b = &p.lane_vehicle[i].1;
    let mut out = Vec::new();
    for mut path in [rin.ok(), rout.ok()].into_iter().flatten() {
        // Draw until the vehicle is straight again, not the whole run along the aisle.
        let keep = (path.arc_to + 30).min(path.pts.len());
        path.pts.truncate(keep);
        let from = path.arc_from.saturating_sub(30);
        path.pts.drain(..from);
        let scene = crate::sweep::Scene {
            obstacles: Vec::new(),
            boundary: None,
            clearance: 0.0,
        };
        let mut k = 0;
        crate::sweep::sweep_with(b, &path, &scene, (0, 0), |units| {
            if k % 3 == 0 {
                for u in units {
                    let mut ring: Vec<LonLat> = u.iter().map(|q| p.proj.ll(*q)).collect();
                    ring.push(ring[0]);
                    out.push(ring);
                }
            }
            k += 1;
        });
    }
    out
}
