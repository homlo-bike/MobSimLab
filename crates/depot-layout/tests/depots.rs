//! Depot layouts for three outline shapes (12-implementation-plan Phase 4 exit: "depot generator produces
//! valid layouts for 3 polygon shapes"): every generated lane passes the swept-path check, can be reached
//! from an entrance and left to an exit, and every vehicle of the fleet gets its own slot.

use depot_layout::geom::{inside_margin, rect, ring_distance, V2};
use depot_layout::model::{
    heading_rad, DepotInput, FleetGroup, Gate, GateKind, LonLat, Proj, Rules, Zone, ZoneKind,
};
use depot_layout::vehicle::VehicleSpec;
use depot_layout::{analyse, generate};

const ORIGIN: LonLat = [8.54, 47.37];

/// Purpose: degrees for local metres about a fixed origin.
fn ll(proj: &Proj, x: f64, y: f64) -> LonLat {
    proj.ll(V2::new(x, y))
}

fn ring(proj: &Proj, pts: &[(f64, f64)]) -> Vec<LonLat> {
    pts.iter().map(|(x, y)| ll(proj, *x, *y)).collect()
}

fn vehicles() -> Vec<VehicleSpec> {
    vec![
        VehicleSpec {
            key: "e12".into(),
            name: "12 m battery bus".into(),
            length_m: 12.13,
            width_m: 2.55,
            articulations: 0,
            axles_m: Some(vec![2.805, 8.705]),
            turning_circle_m: Some(21.2),
        },
        VehicleSpec {
            key: "d18".into(),
            name: "18 m articulated bus".into(),
            length_m: 18.0,
            width_m: 2.55,
            articulations: 1,
            axles_m: None,
            turning_circle_m: None,
        },
    ]
}

fn fleet(a: u32, b: u32) -> Vec<FleetGroup> {
    vec![
        FleetGroup {
            line: "street:0".into(),
            name: "Line 1".into(),
            vehicle: "d18".into(),
            count: a,
            charging: false,
        },
        FleetGroup {
            line: "street:1".into(),
            name: "Line 2".into(),
            vehicle: "e12".into(),
            count: b,
            charging: true,
        },
    ]
}

fn zone(id: &str, kind: ZoneKind, ring: Vec<LonLat>, angle: f64, vehicle: Option<&str>) -> Zone {
    Zone {
        id: id.into(),
        kind,
        ring,
        angle_deg: angle,
        vehicles_per_lane: None,
        vehicle: vehicle.map(str::to_string),
        aisle_width_m: None,
        heading_deg: None,
    }
}

fn depot(
    outline: &[(f64, f64)],
    gates: &[(f64, f64, GateKind)],
    zones: Vec<Zone>,
    fleet: Vec<FleetGroup>,
) -> DepotInput {
    let proj = Proj::around(&[ORIGIN]);
    DepotInput {
        boundary: ring(&proj, outline),
        gates: gates
            .iter()
            .enumerate()
            .map(|(i, (x, y, k))| Gate {
                id: format!("g{i}"),
                kind: *k,
                lonlat: ll(&proj, *x, *y),
            })
            .collect(),
        zones,
        vehicles: vehicles(),
        fleet,
        rules: Rules::default(),
        layout: None,
    }
}

fn check(mut d: DepotInput, min_slots: usize) {
    let g = generate(&d);
    let slots: usize = g.layout.lanes.iter().map(|l| l.slots.len()).sum();
    assert!(slots >= min_slots, "only {slots} slots: {:?}", g.issues);
    // No two parked vehicles overlap, and every slot is inside the outline.
    let proj = Proj::around(&d.boundary);
    let outline: Vec<V2> = d.boundary.iter().map(|p| proj.xy(*p)).collect();
    let rects: Vec<[V2; 4]> = g
        .layout
        .lanes
        .iter()
        .flat_map(|l| l.slots.iter())
        .map(|s| {
            let dir = V2::dir(heading_rad(s.heading_deg));
            rect(
                proj.xy(s.center).sub(dir.mul(s.length_m / 2.0)),
                dir,
                s.length_m,
                2.55,
            )
        })
        .collect();
    for (i, a) in rects.iter().enumerate() {
        assert!(
            inside_margin(a, &outline) >= 0.0,
            "slot {i} outside the depot"
        );
        for b in &rects[i + 1..] {
            assert!(ring_distance(a, b) > 0.5, "slots overlap");
        }
    }
    d.layout = Some(g.layout);
    let r = analyse(&d);
    for l in &r.lanes {
        assert!(
            l.entry_ok && l.exit_ok,
            "lane {} fails: {:?}",
            l.lane,
            l.message
        );
    }
    for x in &r.reach {
        assert!(
            x.from_entrance && x.to_exit,
            "lane {} unreachable: {:?}",
            x.lane,
            r.issues
        );
    }
    let fleet: u32 = d.fleet.iter().map(|g| g.count).sum();
    assert_eq!(
        r.capacity.assignments.len() as u32,
        fleet,
        "{:?}",
        r.capacity.issues
    );
    let mut ids: Vec<_> = r
        .capacity
        .assignments
        .iter()
        .map(|a| a.slot.clone())
        .collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len() as u32, fleet, "one vehicle per slot");
    assert!(r.network.edges.iter().any(|e| e.kind == "drive"));
    assert!(!depot_layout::size(&d).footprints.is_empty());
}

#[test]
fn rectangle_with_parking_and_charging() {
    let p = Proj::around(&[ORIGIN]);
    let zones = vec![
        zone(
            "park",
            ZoneKind::Parking,
            ring(&p, &[(10., 10.), (150., 10.), (150., 70.), (10., 70.)]),
            90.0,
            None,
        ),
        zone(
            "charge",
            ZoneKind::Charging,
            ring(&p, &[(10., 80.), (150., 80.), (150., 125.), (10., 125.)]),
            60.0,
            Some("e12"),
        ),
    ];
    let d = depot(
        &[(0., 0.), (180., 0.), (180., 140.), (0., 140.)],
        &[
            (180., 30., GateKind::Entrance),
            (180., 110., GateKind::Exit),
        ],
        zones,
        fleet(8, 6),
    );
    check(d, 20);
}

#[test]
fn l_shaped_depot() {
    let p = Proj::around(&[ORIGIN]);
    let outline = [
        (0., 0.),
        (200., 0.),
        (200., 70.),
        (90., 70.),
        (90., 160.),
        (0., 160.),
    ];
    let zones = vec![
        zone(
            "south",
            ZoneKind::Parking,
            ring(&p, &[(5., 5.), (195., 5.), (195., 60.), (5., 60.)]),
            45.0,
            None,
        ),
        zone(
            "west",
            ZoneKind::Charging,
            ring(&p, &[(5., 75.), (85., 75.), (85., 155.), (5., 155.)]),
            90.0,
            Some("e12"),
        ),
    ];
    let d = depot(&outline, &[(200., 35., GateKind::Both)], zones, fleet(6, 4));
    check(d, 12);
}

#[test]
fn skewed_quadrilateral() {
    let p = Proj::around(&[ORIGIN]);
    let outline = [(0., 0.), (170., 30.), (190., 150.), (-10., 120.)];
    let zones = vec![zone(
        "all",
        ZoneKind::Parking,
        ring(&p, &[(10., 10.), (165., 38.), (182., 142.), (0., 112.)]),
        60.0,
        None,
    )];
    let d = depot(
        &outline,
        &[(85., 15., GateKind::Entrance), (90., 135., GateKind::Exit)],
        zones,
        fleet(10, 0),
    );
    check(d, 15);
}

#[test]
fn too_small_a_depot_reports_a_shortfall() {
    let p = Proj::around(&[ORIGIN]);
    let zones = vec![zone(
        "park",
        ZoneKind::Parking,
        ring(&p, &[(2., 2.), (68., 2.), (68., 48.), (2., 48.)]),
        90.0,
        None,
    )];
    let mut d = depot(
        &[(0., 0.), (70., 0.), (70., 50.), (0., 50.)],
        &[(70., 25., GateKind::Both)],
        zones,
        fleet(40, 0),
    );
    d.layout = Some(generate(&d).layout);
    let r = analyse(&d);
    assert!(r
        .issues
        .iter()
        .any(|i| i.severity == "error" && i.message.contains("no slot")));
    let need = &depot_layout::size(&d).footprints[0];
    assert!(need.area_m2 > 3500.0, "{need:?}");
}
