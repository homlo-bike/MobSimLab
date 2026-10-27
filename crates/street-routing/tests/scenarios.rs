//! Scenario tests for the route-point tool on small synthetic street networks.

use street_routing::line::{PointKind, Status, StreetLine};
use street_routing::osm::parse_osm_xml;
use street_routing::profile::{Mode, RoutingRules, VehicleProfile};
use street_routing::RoadGraph;

const LON0: f64 = 7.0;
const LAT0: f64 = 50.0;
/// Degrees per metre at 50° N.
const DLAT: f64 = 1.0 / 111_195.0;
const DLON: f64 = 1.0 / (111_195.0 * 0.642_787_6);

/// Degrees for a point `x` m east and `y` m north of the origin.
fn ll(x: f64, y: f64) -> (f64, f64) {
    (LON0 + x * DLON, LAT0 + y * DLAT)
}

/// A street network written as OSM XML.
struct Osm {
    nodes: String,
    ways: String,
    rels: String,
    next_way: i64,
}

impl Osm {
    fn new() -> Self {
        Osm {
            nodes: String::new(),
            ways: String::new(),
            rels: String::new(),
            next_way: 1000,
        }
    }
    fn node(&mut self, id: i64, x: f64, y: f64, tags: &[(&str, &str)]) {
        let (lon, lat) = ll(x, y);
        self.nodes.push_str(&format!(
            r#"<node id="{id}" lat="{lat}" lon="{lon}">{}</node>"#,
            tag_xml(tags)
        ));
    }
    fn way(&mut self, nodes: &[i64], tags: &[(&str, &str)]) -> i64 {
        self.next_way += 1;
        let nd: String = nodes
            .iter()
            .map(|n| format!(r#"<nd ref="{n}"/>"#))
            .collect();
        self.ways.push_str(&format!(
            r#"<way id="{}">{nd}{}</way>"#,
            self.next_way,
            tag_xml(tags)
        ));
        self.next_way
    }
    fn ban(&mut self, from: i64, via: i64, to: i64) {
        self.rels.push_str(&format!(
            r#"<relation id="{}"><member type="way" ref="{from}" role="from"/><member type="node" ref="{via}" role="via"/><member type="way" ref="{to}" role="to"/><tag k="type" v="restriction"/><tag k="restriction" v="no_left_turn"/></relation>"#,
            from * 1000 + to
        ));
    }
    fn graph(&self) -> RoadGraph {
        let xml = format!(
            r#"<osm version="0.6">{}{}{}</osm>"#,
            self.nodes, self.ways, self.rels
        );
        RoadGraph::from_osm(&parse_osm_xml(&xml).unwrap()).unwrap()
    }
}

fn tag_xml(tags: &[(&str, &str)]) -> String {
    tags.iter()
        .map(|(k, v)| format!(r#"<tag k="{k}" v="{v}"/>"#))
        .collect()
}

/// 4 × 4 grid of two-way residential streets, 200 m blocks. Node id = 10 * row + col + 1.
fn grid() -> Osm {
    let mut o = Osm::new();
    for r in 0..4 {
        for c in 0..4 {
            o.node(10 * r + c + 1, c as f64 * 200.0, r as f64 * 200.0, &[]);
        }
    }
    for r in 0..4 {
        let ids: Vec<i64> = (0..4).map(|c| 10 * r + c + 1).collect();
        let name = format!("Row {r}");
        o.way(&ids, &[("highway", "residential"), ("name", &name)]);
    }
    for c in 0..4 {
        let ids: Vec<i64> = (0..4).map(|r| 10 * r + c + 1).collect();
        let name = format!("Col {c}");
        o.way(&ids, &[("highway", "residential"), ("name", &name)]);
    }
    o
}

fn bus() -> VehicleProfile {
    VehicleProfile::default_for(Mode::Bus)
}

fn add(line: &mut StreetLine, g: &RoadGraph, x: f64, y: f64, kind: PointKind) -> u32 {
    let (lon, lat) = ll(x, y);
    line.add_point(g, lon, lat, kind)
}

/// Heading of a point's arc in degrees (0 = east, 90 = north).
fn heading_deg(g: &RoadGraph, line: &StreetLine, id: u32) -> f64 {
    let a = line.anchor(id).expect("point is on a road");
    g.arcs[a.arc as usize].heading.to_degrees().round()
}

/// No leg may drive straight back along the segment it just used.
fn assert_no_u_turns(g: &RoadGraph, line: &StreetLine) {
    let v = line.view(g);
    for l in &v.legs {
        for w in l.coords.windows(3) {
            let back = (w[0][0] - w[2][0]).abs() < 1e-9 && (w[0][1] - w[2][1]).abs() < 1e-9;
            assert!(!back, "leg {} makes a U-turn at {:?}", l.index, w[1]);
        }
    }
}

#[test]
fn circuit_closes_and_never_u_turns() {
    let g = grid().graph();
    let mut line = StreetLine::new(bus(), RoutingRules::default());
    add(&mut line, &g, 100.0, 5.0, PointKind::Stop);
    add(&mut line, &g, 500.0, 5.0, PointKind::Stop);
    let v = line.view(&g);
    assert_eq!(
        v.legs.len(),
        2,
        "two points give two legs: there and back to the first"
    );
    assert!(
        v.legs.iter().all(|l| l.status != Status::Error),
        "{:?}",
        v.legs
    );
    // The last leg ends where the first leg starts.
    let first = v.legs[0].coords[0];
    let last = *v.legs[1].coords.last().unwrap();
    assert!((first[0] - last[0]).abs() < 1e-9 && (first[1] - last[1]).abs() < 1e-9);
    assert_no_u_turns(&g, &line);
}

#[test]
fn stop_is_served_from_the_door_side() {
    let g = grid().graph();
    let mut line = StreetLine::new(bus(), RoutingRules::default());
    // Row 1 runs east-west at y = 200. North sidewalk → westbound in right-hand traffic.
    let north = add(&mut line, &g, 300.0, 208.0, PointKind::Stop);
    let south = add(&mut line, &g, 300.0, 192.0, PointKind::Stop);
    assert_eq!(heading_deg(&g, &line, north), 180.0);
    assert_eq!(heading_deg(&g, &line, south), 0.0);
    // Stops are drawn on the sidewalk, not on the centreline.
    let v = line.view(&g);
    let lat_c = LAT0 + 200.0 * DLAT;
    assert!(v.points[0].lonlat[1] > lat_c + 3.0 * DLAT);
    assert!(v.points[1].lonlat[1] < lat_c - 3.0 * DLAT);
    // Both stops are one station for passengers, named after the street and the nearest cross street.
    assert_eq!(v.station_groups.len(), 1);
    assert_eq!(v.station_groups[0].stops.len(), 2);
    assert_eq!(v.station_groups[0].name, "Row 1");

    let mut lht = StreetLine::new(
        bus(),
        RoutingRules {
            traffic_side: street_routing::TrafficSide::Left,
            ..Default::default()
        },
    );
    let n = add(&mut lht, &g, 300.0, 208.0, PointKind::Stop);
    assert_eq!(
        heading_deg(&g, &lht, n),
        0.0,
        "left-hand traffic serves the north sidewalk eastbound"
    );
}

#[test]
fn via_point_direction_follows_the_circuit() {
    let g = grid().graph();
    let mut line = StreetLine::new(bus(), RoutingRules::default());
    add(&mut line, &g, 100.0, 195.0, PointKind::Stop); // eastbound on Row 1
    let via = add(&mut line, &g, 500.0, 200.0, PointKind::Via);
    add(&mut line, &g, 500.0, 405.0, PointKind::Stop); // westbound on Row 2
    line.reroute_all(&g);
    assert_eq!(
        heading_deg(&g, &line, via),
        0.0,
        "the via point keeps the eastbound run instead of turning round"
    );
    assert_no_u_turns(&g, &line);
}

#[test]
fn stop_on_the_wrong_side_of_a_one_way_street_is_an_error() {
    let mut o = Osm::new();
    o.node(1, 0.0, 0.0, &[]);
    o.node(2, 400.0, 0.0, &[]);
    o.way(&[1, 2], &[("highway", "primary"), ("oneway", "yes")]);
    let g = o.graph();
    let mut line = StreetLine::new(bus(), RoutingRules::default());
    let bad = add(&mut line, &g, 200.0, 6.0, PointKind::Stop); // north side of an eastbound one-way
    let v = line.view(&g);
    assert_eq!(v.points[0].status, Status::Error);
    assert!(line.anchor(bad).is_none());
    // A BRT vehicle with doors on both sides can serve it.
    let mut brt = VehicleProfile::default_for(Mode::Brt);
    brt.doors_both_sides = true;
    line.set_profile(&g, brt);
    assert!(line.anchor(bad).is_some());
}

#[test]
fn dead_end_needs_a_turning_circle() {
    let build = |turning: bool| {
        let mut o = grid();
        let tags: &[(&str, &str)] = if turning {
            &[("highway", "turning_circle")]
        } else {
            &[]
        };
        o.node(100, 600.0, 900.0, tags); // dead-end spur north from node 34 at (600, 600)
        o.way(&[34, 100], &[("highway", "residential"), ("name", "Spur")]);
        o.graph()
    };
    for turning in [false, true] {
        let g = build(turning);
        let mut line = StreetLine::new(bus(), RoutingRules::default());
        add(&mut line, &g, 100.0, 5.0, PointKind::Stop);
        add(&mut line, &g, 605.0, 850.0, PointKind::Stop); // northbound, towards the dead end
        let v = line.view(&g);
        let failed = v.legs.iter().any(|l| l.status == Status::Error);
        assert_eq!(
            failed,
            !turning,
            "turning circle = {turning}: {:?}",
            v.legs.iter().map(|l| &l.message).collect::<Vec<_>>()
        );
        if turning {
            assert_no_u_turns_except_at(&g, &line, ll(600.0, 900.0));
        }
    }
}

fn assert_no_u_turns_except_at(g: &RoadGraph, line: &StreetLine, allowed: (f64, f64)) {
    for l in &line.view(g).legs {
        for w in l.coords.windows(3) {
            let back = (w[0][0] - w[2][0]).abs() < 1e-9 && (w[0][1] - w[2][1]).abs() < 1e-9;
            let at_circle =
                (w[1][0] - allowed.0).abs() < 1e-7 && (w[1][1] - allowed.1).abs() < 1e-7;
            assert!(!back || at_circle, "U-turn at {:?}", w[1]);
        }
    }
}

#[test]
fn turn_bans_are_respected() {
    let route_ways = |ban: bool| {
        let mut o = grid();
        if ban {
            // Row 0 is way 1001, Col 1 is way 1006; ban turning from Row 0 into Col 1 at node 2.
            o.ban(1001, 2, 1006);
        }
        let g = o.graph();
        let mut line = StreetLine::new(bus(), RoutingRules::default());
        add(&mut line, &g, 100.0, -5.0, PointKind::Stop); // eastbound on Row 0 (south side)
        add(&mut line, &g, 205.0, 100.0, PointKind::Stop); // northbound on Col 1 (east sidewalk)
        line.view(&g).legs[0].ways.clone()
    };
    let free = route_ways(false);
    let banned = route_ways(true);
    assert_eq!(
        free,
        vec![1001, 1006],
        "without the ban the bus turns left from Row 0 into Col 1"
    );
    assert_ne!(banned, free, "with the ban the bus takes another way");
    assert!(!banned.windows(2).any(|w| w == [1001, 1006]));
}

#[test]
fn editing_reroutes_only_adjacent_legs() {
    let g = grid().graph();
    let mut line = StreetLine::new(bus(), RoutingRules::default());
    let pts: Vec<u32> = [
        (100.0, -5.0),
        (600.0, 100.0),
        (500.0, 605.0),
        (0.0, 300.0),
        (300.0, 195.0),
    ]
    .iter()
    .map(|&(x, y)| add(&mut line, &g, x, y, PointKind::Stop))
    .collect();
    line.legs_routed = 0;
    let (lon, lat) = ll(400.0, 590.0);
    line.move_point(&g, pts[2], lon, lat).unwrap();
    assert_eq!(
        line.legs_routed, 2,
        "moving a point re-routes the leg into it and the leg out of it"
    );
    line.legs_routed = 0;
    line.delete_point(&g, pts[3]).unwrap();
    assert_eq!(
        line.legs_routed, 1,
        "deleting a point re-routes the leg that now joins its neighbours"
    );
    line.legs_routed = 0;
    let (lon, lat) = ll(200.0, 300.0);
    line.insert_point(&g, 1, lon, lat, PointKind::Via);
    assert_eq!(line.legs_routed, 2);
    line.legs_routed = 0;
    line.set_kind(&g, pts[1], PointKind::EndStop).unwrap();
    assert_eq!(line.legs_routed, 0, "stop → end stop keeps the path");
    assert_eq!(line.len(), 5);
    assert!(line.view(&g).legs.iter().all(|l| l.status != Status::Error));
}

#[test]
fn end_stops_split_directions_and_depot_trips_are_routed() {
    let g = grid().graph();
    let mut line = StreetLine::new(bus(), RoutingRules::default());
    let a = add(&mut line, &g, 100.0, -5.0, PointKind::EndStop);
    let b = add(&mut line, &g, 300.0, -5.0, PointKind::Stop);
    let c = add(&mut line, &g, 600.0, 405.0, PointKind::EndStop);
    let d = add(&mut line, &g, 300.0, 5.0, PointKind::Stop);
    let (lon, lat) = ll(0.0, 500.0);
    line.set_depot(&g, Some((lon, lat)));
    let v = line.view(&g);
    assert_eq!(v.directions.len(), 2);
    assert_eq!(v.directions[0].stops, vec![a, b, c]);
    assert_eq!(v.directions[1].stops, vec![c, d, a]);
    let total: f64 = v.directions.iter().map(|d| d.length_m).sum();
    assert!(
        (total - v.length_m).abs() < 1e-6,
        "the two directions cover the whole circuit"
    );
    // Pull-out and pull-in for each terminal.
    assert_eq!(v.depot_trips.len(), 4);
    assert!(
        v.depot_trips
            .iter()
            .all(|t| t.status == Status::Ok && t.length_m > 0.0),
        "{:?}",
        v.depot_trips
    );
    assert_eq!(v.depot_trips[0].kind, "pull_out");
    assert_eq!(v.depot_trips[0].stop, a);
    // The pull-out ends exactly at the first stop's position on the road.
    let end = *v.depot_trips[0].coords.last().unwrap();
    let start = v.legs[0].coords[0];
    assert!((end[0] - start[0]).abs() < 1e-9 && (end[1] - start[1]).abs() < 1e-9);
}

#[test]
fn long_turn_round_detour_is_a_warning() {
    // A 3 km street whose only place to turn round is a turning circle at its east end.
    let mut o = Osm::new();
    o.node(1, 0.0, 0.0, &[]);
    o.node(2, 1500.0, 0.0, &[]);
    o.node(3, 3000.0, 0.0, &[("highway", "turning_circle")]);
    o.way(
        &[1, 2, 3],
        &[("highway", "secondary"), ("name", "Long Street")],
    );
    let g = o.graph();
    let mut line = StreetLine::new(bus(), RoutingRules::default());
    add(&mut line, &g, 1000.0, -5.0, PointKind::Stop); // eastbound
    add(&mut line, &g, 1200.0, 5.0, PointKind::Stop); // westbound, opposite sidewalk
    let v = line.view(&g);
    assert_eq!(v.legs[0].status, Status::Warning, "{:?}", v.legs[0]);
    assert!(v.legs[0]
        .message
        .as_deref()
        .unwrap()
        .contains("Turning round"));
    assert!(v.legs[0].length_m > 3000.0);
    assert!(
        (v.legs[0].direct_m.unwrap() - 200.0).abs() < 1.0,
        "direct distance if U-turns were allowed"
    );
}

#[test]
fn motorways_only_for_intercity_and_wire_for_trolleybus() {
    let mut o = Osm::new();
    o.node(1, 0.0, 0.0, &[]);
    o.node(2, 2000.0, 0.0, &[]);
    o.way(&[1, 2], &[("highway", "motorway")]);
    o.node(3, 0.0, 500.0, &[]);
    o.node(4, 2000.0, 500.0, &[]);
    o.way(&[3, 4], &[("highway", "primary")]);
    let g = o.graph();
    let mut line = StreetLine::new(
        bus(),
        RoutingRules {
            max_snap_m: 50.0,
            ..Default::default()
        },
    );
    add(&mut line, &g, 1000.0, -5.0, PointKind::Stop);
    assert_eq!(
        line.view(&g).points[0].status,
        Status::Error,
        "a city bus may not use the motorway"
    );
    line.set_profile(&g, VehicleProfile::default_for(Mode::IntercityBus));
    assert_eq!(line.view(&g).points[0].status, Status::Ok);

    // No wire on the primary road: a trolleybus without battery cannot use it.
    let mut t = StreetLine::new(
        VehicleProfile::default_for(Mode::Trolleybus),
        RoutingRules::default(),
    );
    add(&mut t, &g, 1000.0, 495.0, PointKind::Stop);
    assert_eq!(t.view(&g).points[0].status, Status::Error);
}

#[test]
fn low_bridge_blocks_tall_vehicles() {
    // A 3.0 m clearance on Row 0 between columns 1 and 2.
    let o = grid();
    let o = {
        let mut o2 = Osm::new();
        o2.nodes = o.nodes.clone();
        o2.rels = o.rels.clone();
        // Rebuild Row 0 as three ways so only the middle block has the limit.
        o2.way(&[1, 2], &[("highway", "residential"), ("name", "Row 0")]);
        o2.way(
            &[2, 3],
            &[
                ("highway", "residential"),
                ("name", "Row 0"),
                ("maxheight", "3.0"),
            ],
        );
        o2.way(&[3, 4], &[("highway", "residential"), ("name", "Row 0")]);
        for r in 1..4 {
            let ids: Vec<i64> = (0..4).map(|c| 10 * r + c + 1).collect();
            o2.way(&ids, &[("highway", "residential")]);
        }
        for c in 0..4 {
            let ids: Vec<i64> = (0..4).map(|r| 10 * r + c + 1).collect();
            o2.way(&ids, &[("highway", "residential")]);
        }
        o2
    };
    let g = o.graph();
    let mut line = StreetLine::new(
        VehicleProfile::default_for(Mode::IntercityBus),
        RoutingRules::default(),
    );
    add(&mut line, &g, 100.0, -5.0, PointKind::Stop);
    add(&mut line, &g, 500.0, -5.0, PointKind::Stop);
    let v = line.view(&g);
    assert!(v.legs[0].status != Status::Error);
    assert!(
        !v.legs[0].ways.contains(&1002),
        "the 3.8 m coach avoids the 3.0 m bridge: {:?}",
        v.legs[0].ways
    );
    assert!(v.legs[0].length_m > 400.0 + 300.0);
}
