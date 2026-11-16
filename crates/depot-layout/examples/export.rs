//! Writes saved depots (contracts/depot.schema.json) for the contract check in CI: a rectangle with
//! parking and charging zones, and an L-shaped depot with angled lanes, each with its auto layout.
//! Usage: cargo run -p depot-layout --example export -- DIR

use depot_layout::geom::V2;
use depot_layout::model::{DepotInput, Gate, GateKind, Proj, Rules, Zone, ZoneKind};
use depot_layout::{generate, layout::typical_bus};
use serde_json::json;

fn main() {
    let dir = std::env::args().nth(1).unwrap_or_else(|| ".".into());
    let proj = Proj::around(&[[8.54, 47.37]]);
    let ll = |x: f64, y: f64| proj.ll(V2::new(x, y));
    let ring = |pts: &[(f64, f64)]| pts.iter().map(|(x, y)| ll(*x, *y)).collect::<Vec<_>>();
    let zone = |id: &str, kind, r, angle| Zone {
        id: id.into(),
        kind,
        ring: r,
        angle_deg: angle,
        vehicles_per_lane: None,
        vehicle: None,
        aisle_width_m: None,
        heading_deg: None,
    };
    let depots = [
        (
            "rectangle",
            ring(&[(0., 0.), (180., 0.), (180., 140.), (0., 140.)]),
            vec![
                (180., 30., GateKind::Entrance),
                (180., 110., GateKind::Exit),
            ],
            vec![
                zone(
                    "park",
                    ZoneKind::Parking,
                    ring(&[(10., 10.), (150., 10.), (150., 70.), (10., 70.)]),
                    90.0,
                ),
                zone(
                    "charge",
                    ZoneKind::Charging,
                    ring(&[(10., 80.), (150., 80.), (150., 125.), (10., 125.)]),
                    60.0,
                ),
                zone(
                    "yard",
                    ZoneKind::Circulation,
                    ring(&[(152., 5.), (175., 5.), (175., 135.), (152., 135.)]),
                    90.0,
                ),
            ],
        ),
        (
            "l-shape",
            ring(&[
                (0., 0.),
                (200., 0.),
                (200., 70.),
                (90., 70.),
                (90., 160.),
                (0., 160.),
            ]),
            vec![(200., 35., GateKind::Both)],
            vec![
                zone(
                    "south",
                    ZoneKind::Parking,
                    ring(&[(5., 5.), (195., 5.), (195., 60.), (5., 60.)]),
                    45.0,
                ),
                zone(
                    "west",
                    ZoneKind::Maintenance,
                    ring(&[(5., 75.), (85., 75.), (85., 155.), (5., 155.)]),
                    90.0,
                ),
            ],
        ),
    ];
    for (name, boundary, gates, zones) in depots {
        let input = DepotInput {
            boundary: boundary.clone(),
            gates: gates
                .iter()
                .enumerate()
                .map(|(i, (x, y, k))| Gate {
                    id: format!("g{i}"),
                    kind: *k,
                    lonlat: ll(*x, *y),
                })
                .collect(),
            zones,
            vehicles: vec![typical_bus()],
            fleet: Vec::new(),
            rules: Rules::default(),
            layout: None,
        };
        let g = generate(&input);
        let saved = json!({
            "id": name,
            "name": format!("Depot {name}"),
            "modes": ["bus", "brt", "trolleybus", "intercity_bus"],
            "boundary": input.boundary,
            "gates": input.gates,
            "zones": input.zones,
            "layout": g.layout,
        });
        let path = format!("{dir}/{name}.json");
        std::fs::write(&path, serde_json::to_string_pretty(&saved).expect("json")).expect("write");
        println!("{path}");
    }
}
