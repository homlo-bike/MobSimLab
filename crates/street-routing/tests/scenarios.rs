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
    add(&mut line, &g, 50.0, 0.0, PointKind::Via);
    let v = line.view(&g);
    assert_eq!(v.points[0].status, Status::Error);
    assert!(v.points[0]
        .message
        .as_deref()
        .unwrap()
        .contains("sidewalk cannot be served"));
    assert!(line.anchor(bad).is_none());
    // The legs touching it say which point and why, not only "not on a usable road".
    let leg = v.legs[0].message.as_deref().unwrap();
    assert!(
        leg.starts_with("Point 1:") && leg.contains("sidewalk cannot be served"),
        "{leg}"
    );
    // A BRT vehicle with doors on both sides can serve it.
    let mut brt = VehicleProfile::default_for(Mode::Brt);
    brt.doors_both_sides = true;
    line.set_profile(&g, brt);
    assert!(line.anchor(bad).is_some());
}

#[test]
fn the_planner_can_make_a_street_one_way_or_two_way() {
    let mut o = Osm::new();
    o.node(1, 0.0, 0.0, &[]);
    o.node(2, 400.0, 0.0, &[]);
    let way = o.way(&[1, 2], &[("highway", "primary"), ("oneway", "yes")]);
    let xml = format!(r#"<osm version="0.6">{}{}</osm>"#, o.nodes, o.ways);
    let graph_with = |setup: Option<bool>| {
        let mut data = parse_osm_xml(&xml).unwrap();
        let s = street_routing::StreetSetup {
            way,
            oneway: setup,
            ..Default::default()
        };
        street_routing::apply_setups(&mut data, &[s]);
        RoadGraph::from_osm(&data).unwrap()
    };
    // North side of an eastbound one-way street: no bus can serve it…
    let stop_north = |g: &RoadGraph| {
        let mut line = StreetLine::new(bus(), RoutingRules::default());
        let s = add(&mut line, g, 200.0, 6.0, PointKind::Stop);
        add(&mut line, g, 50.0, 0.0, PointKind::Via);
        line.anchor(s).is_some()
    };
    assert!(!stop_north(&graph_with(None)));
    assert!(!stop_north(&graph_with(Some(true))));
    // …until the planner makes the street two-way: westbound buses now stop there.
    assert!(stop_north(&graph_with(Some(false))));
}

#[test]
fn a_two_way_street_made_one_way_runs_the_way_it_is_drawn() {
    // High Street is drawn west to east. Westbound buses keep right: they stop on its north side.
    let north_stop = |g: &RoadGraph| {
        let mut line = StreetLine::new(bus(), RoutingRules::default());
        let s = add(&mut line, g, 300.0, 6.0, PointKind::Stop);
        add(&mut line, g, 100.0, 0.0, PointKind::Via);
        line.anchor(s).is_some()
    };
    let (g, high) = main_road_graph(&[]);
    assert!(north_stop(&g));
    let one_way = street_routing::StreetSetup {
        way: high,
        oneway: Some(true),
        ..Default::default()
    };
    let (g1, _) = main_road_graph(&[one_way]);
    assert!(!north_stop(&g1));
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

#[test]
fn loading_more_area_keeps_the_line() {
    // First the grid without Col 3 (way 1008) is loaded, then the rest arrives.
    let full = grid();
    let mut west = Osm::new();
    west.nodes = full.nodes.clone();
    let start = full.ways.find(r#"<way id="1008">"#).unwrap();
    let end = start + full.ways[start..].find("</way>").unwrap() + "</way>".len();
    west.ways = format!("{}{}", &full.ways[..start], &full.ways[end..]);
    let xml = |o: &Osm| {
        format!(
            r#"<osm version="0.6">{}{}{}</osm>"#,
            o.nodes, o.ways, o.rels
        )
    };
    let mut data = parse_osm_xml(&xml(&west)).unwrap();
    let g1 = RoadGraph::from_osm(&data).unwrap();
    let rules = RoutingRules {
        max_snap_m: 50.0,
        ..Default::default()
    };
    let mut line = StreetLine::new(bus(), rules);
    add(&mut line, &g1, 100.0, -5.0, PointKind::EndStop);
    let far = add(&mut line, &g1, 595.0, 300.0, PointKind::Stop); // Col 3 is not loaded yet
    assert_eq!(line.view(&g1).points[1].status, Status::Error);

    data.merge(parse_osm_xml(&xml(&full)).unwrap());
    let g2 = RoadGraph::from_osm_with(&data, Some(g1.proj)).unwrap();
    line.rebuild(&g2);
    let v = line.view(&g2);
    assert_eq!(v.points.len(), 2);
    assert_eq!(v.points[1].id, far);
    assert_eq!(
        v.points[1].status,
        Status::Ok,
        "the point snaps to the newly loaded street"
    );
    assert!(
        v.legs.iter().all(|l| l.status != Status::Error),
        "{:?}",
        v.legs
    );
    assert!(v.points[0].bay.is_some() && v.points[0].bearing_deg.is_some());
}

#[test]
fn level_crossings_on_the_route_add_their_expected_wait_to_running_time() {
    let g = grid().graph();
    let mut line = StreetLine::new(bus(), RoutingRules::default());
    add(&mut line, &g, 205.0, 100.0, PointKind::EndStop);
    add(&mut line, &g, 205.0, 500.0, PointKind::EndStop);
    let before = line.view(&g);
    assert!(before.level_crossings.is_empty() && before.crossing_wait_s == 0.0);
    // A railway crosses Col 1 (way 1006) between rows 1 and 2, and Col 3 (way 1008), which the
    // line does not use.
    let at = |x: f64, y: f64| {
        let (lon, lat) = ll(x, y);
        format!("[{lon},{lat}]")
    };
    let lc = |id: &str, way: i64, lonlat: String| {
        format!(
            r#"{{"id":"{id}","protection":"barriers","mode":"regional_rail","lonlat":{lonlat},
            "line_speed_kmh":100,"warning_time_s":25,"rail_zone_m":3.5,
            "road_closure":{{"train_length_m":170,"reopen_s":10,"closure_s":44.4,
              "assumed_trains_per_hour_peak":8,"assumed_trains_per_hour_off_peak":4}},
            "street":{{"way":{way},"name":"Col","keep_clear_m":9}}}}"#
        )
    };
    let topo = format!(
        r#"{{"schema":"mobsimlab.rail-topology/1","level_crossings":[{},{}]}}"#,
        lc("lc3-1006-0", 1006, at(200.0, 300.0)),
        lc("lc3-1008-0", 1008, at(600.0, 300.0))
    );
    line.level_crossings = street_routing::crossings::from_topology(&topo, "").unwrap();
    let v = line.view(&g);
    assert_eq!(v.level_crossings.len(), 1, "{:?}", v.level_crossings);
    let x = &v.level_crossings[0];
    assert_eq!(x.ids, ["lc3-1006-0"]);
    let per_pass = 8.0 * 44.4 * 44.4 / 7200.0;
    assert!((x.wait.wait_s - per_pass).abs() < 1e-9);
    assert!(x.passes >= 1);
    assert!((v.crossing_wait_s - x.passes as f64 * per_pass).abs() < 1e-9);
    assert!((v.time_s - before.time_s - v.crossing_wait_s).abs() < 1e-6);
    // Outbound up Col 1 passes it: that leg's running time carries the wait.
    let out = &v.legs[0];
    assert_eq!(out.level_crossings.len(), 1);
    assert!((out.time_s - before.legs[0].time_s - per_pass).abs() < 1e-6);
    // Directions add it up too.
    let d: f64 = v.directions.iter().map(|d| d.time_s).sum();
    assert!((d - v.time_s).abs() < 1e-6);
}

#[test]
fn level_crossings_are_read_from_the_railway_tools_topology_export() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rail-model/tests/data/regional_rail.json"
    ))
    .unwrap();
    let v = street_routing::crossings::from_topology(&json, "").unwrap();
    assert_eq!(v.len(), 1);
    let x = &v[0];
    assert_eq!((x.street.as_str(), x.way), ("Station Road", 1001));
    assert_eq!(x.protection, "barriers");
    // 8 regional trains an hour in the peak closing the street for about 39 s each.
    assert!(x.wait.wait_s > 1.0 && x.wait.wait_s < 2.5, "{:?}", x.wait);
    assert!(x.wait.off_peak_wait_s < x.wait.wait_s);
}

/// A grid whose bottom row is a main road (High Street), with the planner's street setups.
fn main_road_graph(setups: &[street_routing::StreetSetup]) -> (RoadGraph, i64) {
    main_road_graph_with(setups, &street_routing::DelayShares::default())
}

fn main_road_graph_with(
    setups: &[street_routing::StreetSetup],
    delays: &street_routing::DelayShares,
) -> (RoadGraph, i64) {
    let mut o = Osm::new();
    for r in 0..2 {
        for c in 0..4 {
            o.node(10 * r + c + 1, c as f64 * 200.0, r as f64 * 200.0, &[]);
        }
    }
    let high = o.way(
        &[1, 2, 3, 4],
        &[("highway", "primary"), ("name", "High Street")],
    );
    o.way(
        &[11, 12, 13, 14],
        &[("highway", "residential"), ("name", "Back Lane")],
    );
    for c in 0..4 {
        o.way(&[c + 1, 10 + c + 1], &[("highway", "residential")]);
    }
    let xml = format!(r#"<osm version="0.6">{}{}</osm>"#, o.nodes, o.ways);
    let mut data = parse_osm_xml(&xml).unwrap();
    street_routing::apply_setups(&mut data, setups);
    (
        RoadGraph::from_osm_with_delays(&data, None, delays).unwrap(),
        high,
    )
}

fn high_street_line(g: &RoadGraph) -> StreetLine {
    let mut line = StreetLine::new(bus(), RoutingRules::default());
    add(&mut line, g, 50.0, 3.0, PointKind::EndStop);
    add(&mut line, g, 550.0, 3.0, PointKind::EndStop);
    line
}

#[test]
fn main_road_traffic_delays_buses_until_the_street_gets_a_separated_bus_lane() {
    let (g, high) = main_road_graph(&[]);
    let v = high_street_line(&g).view(&g);
    assert!(v.mixed_traffic_m >= 400.0, "{}", v.mixed_traffic_m);
    assert!(v.traffic_delay_s > 0.0);
    assert_eq!(v.mixed_streets[0].way, high);
    assert!(
        v.issues
            .iter()
            .any(|i| i.contains("traffic of main roads (High Street)")),
        "{:?}",
        v.issues
    );

    let painted = street_routing::StreetSetup {
        way: high,
        bus_lane: Some(true),
        ..Default::default()
    };
    let (g2, _) = main_road_graph(std::slice::from_ref(&painted));
    let v2 = high_street_line(&g2).view(&g2);
    assert!(v2.bus_lane_m >= 400.0);
    assert!(v2.traffic_delay_s > 0.0 && v2.traffic_delay_s < v.traffic_delay_s);
    assert!(!v2.issues.iter().any(|i| i.contains("main roads")));

    let separated = street_routing::StreetSetup {
        separated: Some(true),
        ..painted
    };
    let (g3, _) = main_road_graph(&[separated]);
    let v3 = high_street_line(&g3).view(&g3);
    assert!(v3.traffic_delay_s.abs() < 1e-9, "{}", v3.traffic_delay_s);
    assert!(v3.time_s < v2.time_s && v2.time_s < v.time_s);
}

#[test]
fn the_project_can_change_the_delay_in_traffic() {
    let (g, _) = main_road_graph(&[]);
    let v = high_street_line(&g).view(&g);
    let doubled = street_routing::DelayShares {
        mixed_traffic: 0.5,
        ..Default::default()
    };
    let (g2, _) = main_road_graph_with(&[], &doubled);
    let v2 = high_street_line(&g2).view(&g2);
    // The library's 25 % becomes 50 %: twice the delay, the same route.
    assert!(
        (v2.traffic_delay_s - 2.0 * v.traffic_delay_s).abs() < 1.0,
        "{} {}",
        v.traffic_delay_s,
        v2.traffic_delay_s
    );
    assert!((v2.mixed_traffic_m - v.mixed_traffic_m).abs() < 1e-6);
}

#[test]
fn shared_depot_runs_use_its_exit_and_entrance_gates() {
    let g = grid().graph();
    let mut line = StreetLine::new(bus(), RoutingRules::default());
    let a = add(&mut line, &g, 100.0, -5.0, PointKind::EndStop);
    add(&mut line, &g, 600.0, 405.0, PointKind::EndStop);
    // Exit on one street, entrance on another: each depot run starts or ends at its own gate.
    let exit = ll(0.0, 500.0);
    let entrance = ll(600.0, 0.0);
    line.set_depot_gates(&g, &[exit], &[entrance]);
    let v = line.view(&g);
    let trip = |kind: &str| {
        v.depot_trips
            .iter()
            .find(|t| t.kind == kind && t.stop == a)
            .unwrap()
    };
    let out = trip("pull_out");
    let back = trip("pull_in");
    assert_eq!(out.status, Status::Ok, "{:?}", out.message);
    assert_eq!(back.status, Status::Ok, "{:?}", back.message);
    let near = |p: [f64; 2], q: (f64, f64)| (p[0] - q.0).abs() < 2e-4 && (p[1] - q.1).abs() < 2e-4;
    assert!(near(out.coords[0], exit), "pull-out leaves by the exit");
    assert!(
        near(*back.coords.last().unwrap(), entrance),
        "pull-in comes in by the entrance"
    );
    // A depot with no entrance cannot take vehicles back.
    line.set_depot_gates(&g, &[exit], &[]);
    let v = line.view(&g);
    let back = v.depot_trips.iter().find(|t| t.kind == "pull_in").unwrap();
    assert_eq!(back.status, Status::Error);
}

#[test]
fn drawing_point_by_point_gives_the_same_route_as_routing_again() {
    // Via points on two-way streets, added one by one as a planner draws them. The route must already
    // be the quickest circuit, so it does not change when the streets load again (pan or zoom).
    let g = grid().graph();
    let mut seed: u64 = 7;
    let mut rnd = || {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((seed >> 33) % 600) as f64
    };
    for _ in 0..30 {
        let mut line = StreetLine::new(bus(), RoutingRules::default());
        for _ in 0..6 {
            let (mut x, mut y) = (rnd(), rnd());
            if (x as i64) % 2 == 0 {
                x = (x / 200.0).round() * 200.0 + 3.0;
            } else {
                y = (y / 200.0).round() * 200.0 + 3.0;
            }
            add(&mut line, &g, x, y, PointKind::Via);
        }
        let drawn = line.view(&g).time_s;
        line.rebuild(&g);
        assert_eq!(
            drawn,
            line.view(&g).time_s,
            "no detour left from drawing order"
        );
    }
}

#[test]
fn a_stop_switches_sidewalk_and_says_what_its_side_costs() {
    let g = grid().graph();
    let mut line = StreetLine::new(bus(), RoutingRules::default());
    let a = add(&mut line, &g, 100.0, 192.0, PointKind::Stop); // south sidewalk of Row 1: eastbound
    add(&mut line, &g, 500.0, 405.0, PointKind::Stop);
    assert_eq!(heading_deg(&g, &line, a), 0.0);
    let cost = line
        .side_cost_m(&g, a)
        .expect("the other side can be served");
    let before: f64 = line.view(&g).legs.iter().map(|l| l.length_m).sum();
    line.switch_side(&g, a).unwrap();
    assert_eq!(
        heading_deg(&g, &line, a),
        180.0,
        "now on the north sidewalk, westbound"
    );
    let after: f64 = line.view(&g).legs.iter().map(|l| l.length_m).sum();
    assert!(
        (after - before - cost).abs() < 1.0,
        "{after} - {before} vs {cost}"
    );
    // And back again: the cost is the same the other way round.
    let back = line.side_cost_m(&g, a).unwrap();
    assert!((back + cost).abs() < 1.0, "{back} vs {cost}");
}

#[test]
fn point_on_the_far_half_of_a_divided_road_is_flagged() {
    // A divided road: eastbound half at y = 10, westbound half at y = −10, joined only at the ends.
    let mut o = Osm::new();
    o.node(1, 0.0, 10.0, &[]);
    o.node(2, 2000.0, 10.0, &[]);
    o.node(3, 2000.0, -10.0, &[]);
    o.node(4, 0.0, -10.0, &[]);
    let half = [("highway", "primary"), ("oneway", "yes")];
    o.way(&[1, 2], &half);
    o.way(&[3, 4], &half);
    o.way(&[2, 3], &[("highway", "primary")]);
    o.way(&[4, 1], &[("highway", "primary")]);
    let g = o.graph();
    let leg0 = |far: bool| {
        let mut line = StreetLine::new(bus(), RoutingRules::default());
        add(&mut line, &g, 500.0, 12.0, PointKind::Via);
        add(
            &mut line,
            &g,
            800.0,
            if far { -12.0 } else { 12.0 },
            PointKind::Via,
        );
        line.view(&g).legs[0].clone()
    };
    let wrong = leg0(true);
    assert_eq!(wrong.status, Status::Warning);
    assert!(
        wrong
            .message
            .as_deref()
            .unwrap()
            .contains("far half of a divided road"),
        "{:?}",
        wrong.message
    );
    let right = leg0(false);
    assert_eq!(right.status, Status::Ok, "{:?}", right.message);
}

/// A street laid out section by section: general traffic, a bus lane or no buses at all.
fn laid_out(way: i64, sections: Vec<street_routing::Section>) -> street_routing::StreetSetup {
    street_routing::StreetSetup {
        way,
        sections: Some(sections),
        ..Default::default()
    }
}

fn section(
    users: &[street_routing::RoadUser],
    dir: street_routing::SectionDir,
) -> street_routing::Section {
    street_routing::Section {
        kind: street_routing::SectionKind::Lane,
        users: users.to_vec(),
        dir: Some(dir),
        width: 3.1,
        style: None,
    }
}

fn strip(kind: street_routing::SectionKind) -> street_routing::Section {
    street_routing::Section {
        kind,
        users: Vec::new(),
        dir: None,
        width: 0.5,
        style: None,
    }
}

#[test]
fn a_custom_layout_sets_how_fast_buses_run_and_whether_they_can_use_the_street() {
    use street_routing::{RoadUser::*, SectionDir::*, SectionKind};
    let (g, high) = main_road_graph(&[]);
    let base = high_street_line(&g).view(&g);

    // General traffic both ways, buses in it: the same delay as OSM's street.
    let mixed = laid_out(
        high,
        vec![
            section(&[Walk], Both),
            section(&[Car, Bus, Taxi], Backward),
            section(&[Car, Bus, Taxi], Forward),
            section(&[Walk], Both),
        ],
    );
    let (g1, _) = main_road_graph(&[mixed]);
    let v1 = high_street_line(&g1).view(&g1);
    assert!((v1.traffic_delay_s - base.traffic_delay_s).abs() < 1.0);

    // Bus lanes in the middle behind kerbs: no delay from the traffic.
    let centre = laid_out(
        high,
        vec![
            section(&[Car], Backward),
            strip(SectionKind::Protection),
            section(&[Bus], Backward),
            strip(SectionKind::Island),
            section(&[Bus], Forward),
            strip(SectionKind::Protection),
            section(&[Car], Forward),
        ],
    );
    let (g2, _) = main_road_graph(&[centre]);
    let v2 = high_street_line(&g2).view(&g2);
    assert!(v2.bus_lane_m >= 400.0, "{}", v2.bus_lane_m);
    assert!(v2.traffic_delay_s.abs() < 1e-9, "{}", v2.traffic_delay_s);
    assert!(v2.time_s < base.time_s);

    // Buses only, no cars: no traffic to hold them up.
    let busway = laid_out(
        high,
        vec![section(&[Bus], Backward), section(&[Bus], Forward)],
    );
    let (g3, _) = main_road_graph(&[busway]);
    let v3 = high_street_line(&g3).view(&g3);
    assert!(v3.traffic_delay_s.abs() < 1e-9, "{}", v3.traffic_delay_s);

    // Trams and people only: buses cannot use High Street any more.
    let tram = laid_out(
        high,
        vec![
            section(&[Walk], Both),
            section(&[Tram], Backward),
            section(&[Tram], Forward),
            section(&[Walk], Both),
        ],
    );
    let (g4, _) = main_road_graph(&[tram]);
    let usable = |g: &RoadGraph| {
        g.usable_roads_geojson(&bus())
            .matches("\"Feature\"")
            .count()
    };
    assert!(usable(&g4) < usable(&g3), "{} {}", usable(&g4), usable(&g3));
}

#[test]
fn a_custom_layout_with_cars_one_way_and_buses_both_ways() {
    use street_routing::{RoadUser::*, SectionDir::*};
    // Westbound buses keep right on the north side of High Street (drawn west to east).
    let north_stop = |g: &RoadGraph| {
        let mut line = StreetLine::new(bus(), RoutingRules::default());
        let s = add(&mut line, g, 300.0, 6.0, PointKind::Stop);
        add(&mut line, g, 100.0, 0.0, PointKind::Via);
        line.anchor(s).is_some()
    };
    let (_, high) = main_road_graph(&[]);
    let cars_east = laid_out(
        high,
        vec![section(&[Car, Bus], Forward), section(&[Car, Bus], Forward)],
    );
    let (g1, _) = main_road_graph(&[cars_east]);
    assert!(!north_stop(&g1));
    let contraflow = laid_out(
        high,
        vec![section(&[Bus], Backward), section(&[Car, Bus], Forward)],
    );
    let (g2, _) = main_road_graph(&[contraflow]);
    assert!(north_stop(&g2));
}

/// Row 1 laid out for people on foot only in the GIS tab.
fn row_1_for_walking() -> street_routing::StreetSetup {
    use street_routing::{RoadUser, Section, SectionKind};
    let walk = Section {
        kind: SectionKind::Lane,
        users: vec![RoadUser::Walk],
        dir: None,
        width: 4.0,
        style: None,
    };
    street_routing::StreetSetup {
        way: 1002,
        sections: Some(vec![walk.clone(), walk]),
        ..Default::default()
    }
}

#[test]
fn a_street_closed_to_buses_by_its_layout_is_named_with_the_route_as_drawn() {
    let o = grid();
    let xml = format!(r#"<osm version="0.6">{}{}</osm>"#, o.nodes, o.ways);
    let osm_data = parse_osm_xml(&xml).unwrap();
    let free = RoadGraph::from_osm(&osm_data).unwrap();
    let setups = [row_1_for_walking()];
    let mut data = osm_data.clone();
    street_routing::apply_setups(&mut data, &setups);
    let g = RoadGraph::from_osm_with(&data, Some(free.proj)).unwrap();
    let closed = street_routing::closures::bus_closures(&osm_data, &setups);

    let mut line = StreetLine::new(bus(), RoutingRules::default());
    // A via point on Row 2 and one on Row 0, joined by a leg the planner meant along Col 1 and Row 1.
    add(&mut line, &g, 300.0, 400.0, PointKind::Via);
    add(&mut line, &g, 100.0, 195.0, PointKind::Stop);
    let mut v = line.view(&g);
    line.mark_setup_closures(&mut v, &g, &free, &closed);

    let stop = &v.points[1];
    assert_eq!(stop.status, Status::Warning, "{stop:?}");
    let m = stop.message.clone().unwrap();
    assert!(m.contains("closes Row 1 to buses"), "{m}");
    assert!(m.contains("100 m away"), "{m}");

    let detour = v
        .legs
        .iter()
        .find_map(|l| l.setup_detour.as_ref())
        .expect("a leg runs along Row 1 as drawn");
    assert_eq!(detour.ways, vec![1002]);
    assert_eq!(detour.streets, vec!["Row 1".to_string()]);
}

#[test]
fn without_closures_nothing_is_marked() {
    let g = grid().graph();
    let mut line = StreetLine::new(bus(), RoutingRules::default());
    add(&mut line, &g, 100.0, 195.0, PointKind::Stop);
    add(&mut line, &g, 500.0, 195.0, PointKind::Stop);
    let before = serde_json::to_string(&line.view(&g)).unwrap();
    let mut v = line.view(&g);
    line.mark_setup_closures(&mut v, &g, &g, &Default::default());
    assert_eq!(serde_json::to_string(&v).unwrap(), before);
}
