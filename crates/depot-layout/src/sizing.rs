//! Dynamic sizing (07-simulation §7 step 5): the smallest area for a given fleet, and the fleet a given
//! outline can hold.

use crate::geom::{area, clean_ring, V2};
use crate::layout::{generate, min_aisle, pattern};
use crate::model::{DepotInput, Rules, Zone, ZoneKind};
use crate::vehicle::{body, VehicleSpec};
use serde::Serialize;

/// The smallest rectangular depot for a fleet with one lane angle.
#[derive(Debug, Clone, Serialize)]
pub struct Footprint {
    /// Lane angle, degrees.
    pub angle_deg: f64,
    /// Area, m².
    pub area_m2: f64,
    /// Along the aisles, m.
    pub width_m: f64,
    /// Across the aisles, m.
    pub depth_m: f64,
    /// Bands of lanes.
    pub bands: u32,
    /// Lanes per band.
    pub lanes_per_band: u32,
    /// Aisle width, m.
    pub aisle_m: f64,
}

/// What the outline holds with one lane angle if it were all parking.
#[derive(Debug, Clone, Serialize)]
pub struct Holds {
    /// Lane angle, degrees.
    pub angle_deg: f64,
    /// Vehicles.
    pub vehicles: u32,
}

/// Dynamic sizing for a depot.
#[derive(Debug, Clone, Serialize)]
pub struct Sizing {
    /// The vehicle used (the longest of the fleet).
    pub vehicle: String,
    /// Area of the outline, m².
    pub area_m2: f64,
    /// Vehicles to hold (all lines with spares).
    pub fleet: u32,
    /// Smallest rectangle for the fleet per angle, smallest first.
    pub footprints: Vec<Footprint>,
    /// Vehicles the outline holds as one parking zone, per angle, most first.
    pub holds: Vec<Holds>,
}

/// Lane angles the depot tool offers.
pub const ANGLES: [f64; 3] = [90.0, 60.0, 45.0];

/// Purpose: the smallest rectangle (with a perimeter road at both aisle ends) that holds `n` vehicles.
pub fn footprint(
    v: &VehicleSpec,
    n: u32,
    angle_deg: f64,
    per_lane: u32,
    rules: &Rules,
) -> Option<Footprint> {
    if n == 0 {
        return None;
    }
    let b = body(v, rules.turning_circle_m);
    let aisle = min_aisle(v, &b, angle_deg, per_lane, rules)?;
    let p = pattern(v, angle_deg, per_lane, aisle, rules);
    let lanes = n.div_ceil(p.per_lane);
    let road = rules.aisle_width_m.max(aisle);
    let slant = p.lane_len * p.theta.cos();
    let mut best: Option<Footprint> = None;
    for bands in 1..=lanes {
        let per_band = lanes.div_ceil(bands);
        let walkways = (per_band - 1).checked_div(p.walk_every).unwrap_or(0);
        let width = per_band as f64 * p.pitch + walkways as f64 * p.walkway + slant + 2.0 * road;
        let depth = bands as f64 * p.depth + (bands + 1) as f64 * aisle;
        let a = width * depth;
        if best.as_ref().is_none_or_gt(a) {
            best = Some(Footprint {
                angle_deg,
                area_m2: a.round(),
                width_m: (width * 10.0).round() / 10.0,
                depth_m: (depth * 10.0).round() / 10.0,
                bands,
                lanes_per_band: per_band,
                aisle_m: aisle,
            });
        }
    }
    best
}

trait Smaller {
    fn is_none_or_gt(&self, a: f64) -> bool;
}
impl Smaller for Option<&Footprint> {
    fn is_none_or_gt(&self, a: f64) -> bool {
        match self {
            None => true,
            Some(f) => f.area_m2 > a,
        }
    }
}

/// Purpose: dynamic sizing for a depot: the fleet of its lines and the longest of their vehicles.
pub fn size(input: &DepotInput) -> Sizing {
    let fleet: u32 = input.fleet.iter().map(|g| g.count).sum();
    let longest = input
        .fleet
        .iter()
        .filter_map(|g| input.vehicles.iter().find(|v| v.key == g.vehicle))
        .max_by(|a, b| a.length_m.total_cmp(&b.length_m))
        .cloned()
        .unwrap_or_else(|| crate::layout::design_vehicle(None, &input.vehicles, &input.fleet));
    let per_lane = input.rules.vehicles_per_lane.round().max(1.0) as u32;
    let mut footprints: Vec<Footprint> = ANGLES
        .iter()
        .filter_map(|a| footprint(&longest, fleet, *a, per_lane, &input.rules))
        .collect();
    footprints.sort_by(|a, b| a.area_m2.total_cmp(&b.area_m2));
    let proj = crate::model::Proj::around(&input.boundary);
    let ring: Vec<V2> = clean_ring(
        &input
            .boundary
            .iter()
            .map(|p| proj.xy(*p))
            .collect::<Vec<_>>(),
    );
    let mut holds: Vec<Holds> = Vec::new();
    if ring.len() >= 3 {
        for a in ANGLES {
            let one = DepotInput {
                boundary: input.boundary.clone(),
                gates: Vec::new(),
                zones: vec![Zone {
                    id: "all".into(),
                    kind: ZoneKind::Parking,
                    ring: input.boundary.clone(),
                    angle_deg: a,
                    vehicles_per_lane: None,
                    vehicle: Some(longest.key.clone()),
                    aisle_width_m: None,
                    heading_deg: None,
                }],
                vehicles: vec![longest.clone()],
                fleet: Vec::new(),
                rules: input.rules.clone(),
                layout: None,
            };
            let g = generate(&one);
            holds.push(Holds {
                angle_deg: a,
                vehicles: g.layout.lanes.iter().map(|l| l.slots.len() as u32).sum(),
            });
        }
        holds.sort_by_key(|h| std::cmp::Reverse(h.vehicles));
    }
    Sizing {
        vehicle: if longest.name.is_empty() {
            longest.key.clone()
        } else {
            longest.name.clone()
        },
        area_m2: area(&ring).round(),
        fleet,
        footprints,
        holds,
    }
}
