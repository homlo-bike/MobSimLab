//! Walk coverage and stop spacing on small synthetic networks (ADR-0035 §5, §6).

use street_routing::osm::parse_osm_xml;
use street_routing::walk::{
    stop_spacing, CoverageGroup, CoverageRequest, DemandPoint, Metric, SpacingRequest, StopPoint,
    WalkGraph, WalkSettings,
};

const LON0: f64 = 7.0;
const LAT0: f64 = 50.0;
const DLAT: f64 = 1.0 / 111_195.0;
const DLON: f64 = 1.0 / (111_195.0 * 0.642_787_6);

fn ll(x: f64, y: f64) -> (f64, f64) {
    (LON0 + x * DLON, LAT0 + y * DLAT)
}

struct Osm {
    xml: String,
    next_way: i64,
}

impl Osm {
    fn new() -> Self {
        Osm {
            xml: String::new(),
            next_way: 1,
        }
    }
    fn node(&mut self, id: i64, x: f64, y: f64, tags: &[(&str, &str)]) {
        let (lon, lat) = ll(x, y);
        let t: String = tags
            .iter()
            .map(|(k, v)| format!(r#"<tag k="{k}" v="{v}"/>"#))
            .collect();
        self.xml.push_str(&format!(
            r#"<node id="{id}" lat="{lat}" lon="{lon}">{t}</node>"#
        ));
    }
    fn way(&mut self, nodes: &[i64], tags: &[(&str, &str)]) {
        self.next_way += 1;
        let nd: String = nodes
            .iter()
            .map(|n| format!(r#"<nd ref="{n}"/>"#))
            .collect();
        let t: String = tags
            .iter()
            .map(|(k, v)| format!(r#"<tag k="{k}" v="{v}"/>"#))
            .collect();
        self.xml
            .push_str(&format!(r#"<way id="{}">{nd}{t}</way>"#, self.next_way));
    }
    fn graph(&self) -> WalkGraph {
        let d = parse_osm_xml(&format!("<osm>{}</osm>", self.xml)).unwrap();
        WalkGraph::from_osm(&d, None).unwrap()
    }
}

/// A grid of residential streets every 100 m from -1000 to 1000 m in both directions.
fn grid() -> Osm {
    let mut o = Osm::new();
    let id = |i: i64, j: i64| 1 + (i + 10) * 100 + (j + 10);
    for i in -10..=10 {
        for j in -10..=10 {
            o.node(id(i, j), i as f64 * 100.0, j as f64 * 100.0, &[]);
        }
    }
    for i in -10..=10 {
        let row: Vec<i64> = (-10..=10).map(|j| id(j, i)).collect();
        let col: Vec<i64> = (-10..=10).map(|j| id(i, j)).collect();
        o.way(&row, &[("highway", "residential")]);
        o.way(&col, &[("highway", "residential")]);
    }
    o
}

fn stop(id: &str, x: f64, y: f64) -> StopPoint {
    let (lon, lat) = ll(x, y);
    StopPoint {
        id: id.into(),
        lon,
        lat,
    }
}

fn demand(x: f64, y: f64) -> DemandPoint {
    let (lon, lat) = ll(x, y);
    DemandPoint {
        lon,
        lat,
        weight: 1.0,
    }
}

fn fifteen_minutes(stops: Vec<StopPoint>, points: Vec<DemandPoint>) -> CoverageRequest {
    CoverageRequest {
        groups: vec![CoverageGroup {
            label: "15 min".into(),
            stops: (0..stops.len()).collect(),
            metric: Metric::Time,
            limit: 900.0,
        }],
        stops,
        demand: Some(points),
        study_area: None,
        settings: WalkSettings::default(),
        list_uncovered: 10,
        street_cells_m: None,
    }
}

#[test]
fn walk_time_follows_streets_not_circles() {
    let g = grid().graph();
    // 15 min at 4.5 km/h is 1125 m. (0, 1000) is 1000 m along one street: covered.
    // (700, 700) is 990 m as the crow flies but 1400 m on the grid: inside the circle, not covered.
    let r = g.coverage(&fifteen_minutes(
        vec![stop("S", 0.0, 0.0)],
        vec![demand(0.0, 1000.0), demand(700.0, 700.0)],
    ));
    assert_eq!(r.demand_kind, "points");
    assert_eq!(r.total, 2.0);
    assert_eq!(r.covered, 1.0);
    assert_eq!(
        r.buffer_share, 1.0,
        "both points are inside the 1125 m circle"
    );
    assert_eq!(r.uncovered.len(), 1);
    let walk_s = r.uncovered[0].nearest.unwrap();
    assert!(
        (walk_s - 1400.0 / 1.25).abs() < 2.0,
        "1400 m at 1.25 m/s, got {walk_s}"
    );
    // Bands: one point at 13.3 min (10–15), one at 18.7 min (15–20).
    assert_eq!(r.minutes_bands[2].demand, 1.0);
    assert_eq!(r.minutes_bands[3].demand, 1.0);
}

#[test]
fn nearest_of_several_stops_counts() {
    let g = grid().graph();
    let r = g.coverage(&fifteen_minutes(
        vec![stop("A", -800.0, 0.0), stop("B", 800.0, 800.0)],
        vec![
            demand(700.0, 700.0),
            demand(-800.0, 900.0),
            demand(0.0, -1000.0),
        ],
    ));
    // (700,700) is 200 m from B; (-800,900) is 900 m from A; (0,-1000) is 1800 m from A.
    assert_eq!(r.covered, 2.0);
}

#[test]
fn signals_add_delay_and_steps_can_be_excluded() {
    let mut o = Osm::new();
    o.node(1, 0.0, 0.0, &[]);
    o.node(2, 500.0, 0.0, &[("highway", "traffic_signals")]);
    o.node(3, 1000.0, 0.0, &[]);
    o.node(4, 1000.0, 50.0, &[]);
    o.way(&[1, 2, 3], &[("highway", "footway")]);
    o.way(&[3, 4], &[("highway", "steps")]);
    let g = o.graph();
    let mut req = fifteen_minutes(vec![stop("S", 0.0, 0.0)], vec![demand(1000.0, 50.0)]);
    req.groups[0].limit = 1050.0 / 1.25 + 10.0; // enough without the signal delay
    assert_eq!(
        g.coverage(&req).covered,
        0.0,
        "20 s signal delay pushes it over"
    );
    req.groups[0].limit += 20.0;
    assert_eq!(g.coverage(&req).covered, 1.0);
    req.settings.step_free = true;
    req.settings.max_snap_m = 20.0;
    // Without the steps the point is 50 m from the footway end: off the network.
    let r = g.coverage(&req);
    assert_eq!(r.covered, 0.0);
    assert_eq!(r.demand_off_network, 1);
}

#[test]
fn motorways_and_foot_no_are_not_walkable() {
    let mut o = Osm::new();
    o.node(1, 0.0, 0.0, &[]);
    o.node(2, 300.0, 0.0, &[]);
    o.node(3, 0.0, 300.0, &[]);
    o.way(&[1, 2], &[("highway", "motorway")]);
    o.way(&[1, 3], &[("highway", "primary"), ("foot", "no")]);
    let d = parse_osm_xml(&format!("<osm>{}</osm>", o.xml)).unwrap();
    assert!(WalkGraph::from_osm(&d, None).is_err());
}

#[test]
fn a_river_makes_the_walk_long() {
    // Two parallel streets 100 m apart joined only by a bridge 1 km away.
    let mut o = Osm::new();
    o.node(1, 0.0, 0.0, &[]);
    o.node(2, 1000.0, 0.0, &[]);
    o.node(3, 0.0, 100.0, &[]);
    o.node(4, 1000.0, 100.0, &[]);
    o.way(&[1, 2], &[("highway", "residential")]);
    o.way(&[3, 4], &[("highway", "residential")]);
    o.way(&[2, 4], &[("highway", "footway"), ("bridge", "yes")]);
    let g = o.graph();
    let r = g.coverage(&CoverageRequest {
        groups: vec![CoverageGroup {
            label: "SDG 11.2.1 low capacity".into(),
            stops: vec![0],
            metric: Metric::Distance,
            limit: 500.0,
        }],
        ..fifteen_minutes(vec![stop("S", 0.0, 0.0)], vec![demand(0.0, 100.0)])
    });
    assert_eq!(r.covered, 0.0, "2100 m on foot");
    assert_eq!(r.buffer_share, 1.0, "100 m as the crow flies");
}

#[test]
fn street_length_is_the_proxy_without_demand_points() {
    let mut o = Osm::new();
    o.node(1, 0.0, 0.0, &[]);
    o.node(2, 1000.0, 0.0, &[]);
    o.node(3, 2000.0, 0.0, &[]);
    o.way(&[1, 2, 3], &[("highway", "residential")]);
    let g = o.graph();
    let mut req = fifteen_minutes(vec![stop("S", 0.0, 0.0)], vec![]);
    req.demand = None;
    req.groups[0].metric = Metric::Distance;
    req.groups[0].limit = 500.0;
    let r = g.coverage(&req);
    assert_eq!(r.demand_kind, "street_length_m");
    assert!((r.total - 2000.0).abs() < 1.0);
    assert!((r.covered - 500.0).abs() < 1.0, "covered {}", r.covered);
}

#[test]
fn catchment_lists_edges_with_minutes() {
    let g = grid().graph();
    let gj: serde_json::Value = serde_json::from_str(&g.catchment_geojson(
        &[stop("S", 0.0, 0.0)],
        5.0,
        &WalkSettings::default(),
    ))
    .unwrap();
    let feats = gj["features"].as_array().unwrap();
    assert!(!feats.is_empty());
    for f in feats {
        let m = f["properties"]["minutes"].as_f64().unwrap();
        assert!(m <= 5.0);
        assert_eq!(f["properties"]["stop"], "S");
    }
}

#[test]
fn spacing_along_route_and_on_foot() {
    let g = grid().graph();
    let stops = vec![
        stop("A", -1000.0, 0.0),
        stop("B", -700.0, 0.0),
        stop("C", 0.0, 0.0),
        stop("D", 0.0, 500.0),
    ];
    let route: Vec<[f64; 2]> = [(-1000.0, 0.0), (0.0, 0.0), (0.0, 500.0)]
        .iter()
        .map(|&(x, y)| {
            let (lon, lat) = ll(x, y);
            [lon, lat]
        })
        .collect();
    let r = stop_spacing(
        &SpacingRequest {
            stops,
            route: Some(route),
            guidance_m: Some([350.0, 600.0]),
            settings: WalkSettings::default(),
        },
        Some(&g),
    );
    assert_eq!(r.geometry, "route");
    let along: Vec<f64> = r.segments.iter().map(|s| s.along_m).collect();
    assert_eq!(along, vec![300.0, 700.0, 500.0]);
    assert_eq!(r.short, 1);
    assert_eq!(r.long, 1);
    assert_eq!(r.segments[1].walk_m, Some(700.0));
    assert_eq!(r.along.count, 3);
    assert_eq!(r.along.median, 500.0);
    assert_eq!(r.along.min, 300.0);
    assert_eq!(r.histogram.iter().map(|b| b.count).sum::<usize>(), 3);
}

#[test]
fn spacing_without_geometry_uses_straight_lines() {
    let r = stop_spacing(
        &SpacingRequest {
            stops: vec![stop("A", 0.0, 0.0), stop("B", 300.0, 400.0)],
            route: None,
            guidance_m: None,
            settings: WalkSettings::default(),
        },
        None,
    );
    assert_eq!(r.geometry, "straight");
    assert_eq!(r.segments[0].along_m, 500.0);
    assert_eq!(r.segments[0].walk_m, None);
}

#[test]
fn street_cells_gather_length_and_gaps_are_listed() {
    let g = grid().graph();
    let mut req = fifteen_minutes(vec![stop("S", -1000.0, -1000.0)], vec![]);
    req.demand = None;
    req.street_cells_m = Some(200.0);
    let r = g.coverage(&req);
    assert_eq!(r.demand_kind, "street_cells");
    // The whole grid has 2 × 21 streets of 2000 m.
    assert!((r.total - 84_000.0).abs() < 50.0, "total {}", r.total);
    assert!(r.share > 0.0 && r.share < 0.5);
    assert_eq!(r.uncovered.len(), 10);
}

#[test]
fn suggested_stop_covers_the_far_corner() {
    use street_routing::walk::SuggestRequest;
    let g = grid().graph();
    let candidates: Vec<StopPoint> = (-10..=10)
        .map(|i| stop(&format!("c{i}"), i as f64 * 100.0, i as f64 * 100.0))
        .collect();
    let r = g.suggest_stops(&SuggestRequest {
        existing: vec![stop("S", -1000.0, -1000.0)],
        candidates,
        demand: None,
        street_cells_m: Some(200.0),
        study_area: None,
        limit_s: 600.0,
        k: 2,
        min_spacing_m: 500.0,
        settings: WalkSettings::default(),
    });
    assert_eq!(r.suggestions.len(), 2);
    assert!(r.covered_after > r.covered_before);
    let gains: Vec<f64> = r.suggestions.iter().map(|s| s.gain).collect();
    assert!(
        gains[0] >= gains[1],
        "greedy picks the biggest gain first: {gains:?}"
    );
    // The first pick is away from the existing corner stop.
    let first = &r.suggestions[0];
    let (fx, _) = (first.lon - LON0, first.lat - LAT0);
    assert!(
        fx > -0.006,
        "first suggestion should not sit next to S: {first:?}"
    );
}
