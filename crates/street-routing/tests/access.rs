//! PTAL, destination counts and the sparse matrix on small synthetic networks (ADR-0035 §6).

use street_routing::access::{
    access_index, ptal_band, Destination, MatrixRequest, Place, PtalRequest, PtalRoute,
    ReachCountRequest,
};
use street_routing::osm::parse_osm_xml;
use street_routing::walk::{
    cycle_way, DemandPoint, Metric, NetworkProfile, StopPoint, WalkGraph, WalkSettings,
};

const LON0: f64 = 7.0;
const LAT0: f64 = 50.0;
const DLAT: f64 = 1.0 / 111_195.0;
const DLON: f64 = 1.0 / (111_195.0 * 0.642_787_6);

fn ll(x: f64, y: f64) -> (f64, f64) {
    (LON0 + x * DLON, LAT0 + y * DLAT)
}

/// Residential streets every 100 m along x from -2000 to 2000 m (one long street), plus `extra`.
fn street(extra: &str) -> String {
    let mut xml = String::new();
    for i in -20..=20 {
        let (lon, lat) = ll(i as f64 * 100.0, 0.0);
        xml.push_str(&format!(
            r#"<node id="{}" lat="{lat}" lon="{lon}"/>"#,
            100 + i
        ));
    }
    let nd: String = (-20..=20)
        .map(|i| format!(r#"<nd ref="{}"/>"#, 100 + i))
        .collect();
    xml.push_str(&format!(
        r#"<way id="1">{nd}<tag k="highway" v="residential"/></way>"#
    ));
    format!("<osm>{xml}{extra}</osm>")
}

fn graph(xml: &str, profile: NetworkProfile) -> WalkGraph {
    WalkGraph::from_osm_profile(&parse_osm_xml(xml).unwrap(), None, profile).unwrap()
}

fn stop(id: &str, x: f64) -> StopPoint {
    let (lon, lat) = ll(x, 0.0);
    StopPoint {
        id: id.into(),
        lon,
        lat,
    }
}

fn point(x: f64) -> DemandPoint {
    let (lon, lat) = ll(x, 0.0);
    DemandPoint {
        lon,
        lat,
        weight: 1.0,
    }
}

fn route(id: &str, mode: &str, per_hour: f64, rail: bool) -> PtalRoute {
    PtalRoute {
        id: id.into(),
        mode: mode.into(),
        stops: vec![0],
        frequency_per_hour: per_hour,
        max_walk_m: if rail { 960.0 } else { 640.0 },
        reliability_min: if rail { 0.75 } else { 2.0 },
    }
}

#[test]
fn ptal_bands_follow_tfl() {
    assert_eq!(ptal_band(0.0), 0);
    assert_eq!(ptal_band(2.0), 1); // 1a
    assert_eq!(ptal_band(5.0), 2); // 1b
    assert_eq!(ptal_band(5.01), 3); // 2
    assert_eq!(ptal_band(30.0), 7); // 6a
    assert_eq!(ptal_band(41.0), 8); // 6b
}

#[test]
fn access_index_counts_the_best_route_per_mode_in_full() {
    let bus = route("b1", "bus", 6.0, false);
    let bus2 = route("b2", "bus", 6.0, false);
    let rail = route("r1", "rail", 12.0, true);
    // 300 m at 80 m/min = 3.75 min; wait 0.5 × 10 + 2 = 7; TAT 10.75; EDF = 30 / 10.75.
    let one = access_index(&[(&bus, 300.0)], 80.0);
    assert!((one - 30.0 / 10.75).abs() < 1e-9);
    // A second bus route counts at half weight.
    let two = access_index(&[(&bus, 300.0), (&bus2, 300.0)], 80.0);
    assert!((two - 1.5 * one).abs() < 1e-9);
    // Rail is another mode: its best route counts in full. TAT 3.75 + 2.5 + 0.75 = 7.
    let mixed = access_index(&[(&bus, 300.0), (&rail, 300.0)], 80.0);
    assert!((mixed - (one + 30.0 / 7.0)).abs() < 1e-9);
}

#[test]
fn ptal_walks_the_network_and_stops_at_the_mode_limit() {
    let g = graph(&street(""), NetworkProfile::Walk);
    let r = g.ptal(&PtalRequest {
        stops: vec![stop("S", 0.0)],
        routes: vec![
            route("b1", "bus", 6.0, false),
            route("r1", "rail", 12.0, true),
        ],
        demand: Some(vec![point(300.0), point(800.0), point(1500.0)]),
        cell_m: 100.0,
        study_area: None,
        walk_m_per_min: 80.0,
        max_snap_m: 250.0,
        list_points: 10,
    });
    assert_eq!(r.total, 3.0);
    let ai = |x: f64| {
        let (lon, _) = ll(x, 0.0);
        r.points
            .iter()
            .find(|p| (p.lon - lon).abs() < 1e-9)
            .unwrap()
            .ai
    };
    // 300 m: bus and rail.
    assert!((ai(300.0) - 7.07).abs() < 0.01, "{}", ai(300.0));
    // 800 m: rail only (bus limit 640 m). Walk 10 min + 3.25 → EDF 2.26.
    assert!((ai(800.0) - 2.26).abs() < 0.01, "{}", ai(800.0));
    // 1500 m: nothing.
    assert_eq!(ai(1500.0), 0.0);
    let band = |b: &str| r.bands.iter().find(|x| x.band == b).unwrap().demand;
    assert_eq!(band("2"), 1.0);
    assert_eq!(band("1a"), 1.0);
    assert_eq!(band("0"), 1.0);
}

#[test]
fn reach_counts_destinations_by_category_within_the_limit() {
    let g = graph(&street(""), NetworkProfile::Walk);
    let d = |c: usize, x: f64| {
        let (lon, lat) = ll(x, 0.0);
        Destination {
            category: c,
            lon,
            lat,
        }
    };
    let r = g.reach_counts(&ReachCountRequest {
        destinations: vec![d(0, 500.0), d(0, -400.0), d(1, 1900.0)],
        categories: 2,
        origins: Some(vec![point(0.0)]),
        cell_m: 200.0,
        study_area: None,
        limit_s: 900.0,
        settings: WalkSettings::default(),
    });
    let o = &r.origins[0];
    // 15 min at 4.5 km/h is 1125 m: both shops, not the one at 1900 m.
    assert_eq!(o.counts, vec![2, 0]);
    assert!((o.nearest_s[0].unwrap() - 320.0).abs() < 1.0); // 400 m at 1.25 m/s
    assert_eq!(o.nearest_s[1], None);
    // By bicycle at 15 km/h the far destination is in reach.
    let gc = graph(&street(""), NetworkProfile::Cycle);
    let rc = gc.reach_counts(&ReachCountRequest {
        destinations: vec![d(1, 1900.0)],
        categories: 2,
        origins: Some(vec![point(0.0)]),
        cell_m: 200.0,
        study_area: None,
        limit_s: 900.0,
        settings: WalkSettings {
            walk_speed_kmh: 15.0,
            ..WalkSettings::default()
        },
    });
    assert_eq!(rc.origins[0].counts, vec![0, 1]);
}

#[test]
fn cycle_graph_leaves_out_footways_and_steps() {
    let tags = |kv: &[(&str, &str)]| {
        kv.iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    };
    assert_eq!(cycle_way(&tags(&[("highway", "footway")])), None);
    assert_eq!(
        cycle_way(&tags(&[("highway", "footway"), ("bicycle", "yes")])),
        Some(false)
    );
    assert_eq!(cycle_way(&tags(&[("highway", "steps")])), None);
    assert_eq!(cycle_way(&tags(&[("highway", "motorway")])), None);
    assert_eq!(
        cycle_way(&tags(&[("highway", "primary"), ("bicycle", "no")])),
        None
    );
    assert_eq!(cycle_way(&tags(&[("highway", "cycleway")])), Some(false));
    // Only a footway: no cycle network.
    let (a, b) = (ll(0.0, 0.0), ll(100.0, 0.0));
    let xml = format!(
        r#"<osm><node id="1" lat="{}" lon="{}"/><node id="2" lat="{}" lon="{}"/><way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/></way></osm>"#,
        a.1, a.0, b.1, b.0
    );
    assert!(WalkGraph::from_osm_profile(
        &parse_osm_xml(&xml).unwrap(),
        None,
        NetworkProfile::Cycle
    )
    .is_err());
}

#[test]
fn matrix_lists_pairs_within_the_limit() {
    let g = graph(&street(""), NetworkProfile::Walk);
    let p = |x: f64| {
        let (lon, lat) = ll(x, 0.0);
        Place { lon, lat }
    };
    let far = {
        let (lon, lat) = ll(0.0, 5000.0);
        Place { lon, lat }
    };
    let m = g.matrix(&MatrixRequest {
        sources: vec![p(0.0), far],
        targets: vec![p(200.0), p(900.0), p(-600.0)],
        metric: Metric::Distance,
        limit: 700.0,
        settings: WalkSettings::default(),
    });
    assert_eq!(m.sources_off_network, vec![1]);
    let mut pairs: Vec<(u32, u32, f64)> = (0..m.from.len())
        .map(|i| (m.from[i], m.to[i], m.cost[i]))
        .collect();
    pairs.sort_by_key(|p| p.1);
    assert_eq!(pairs.len(), 2);
    assert_eq!((pairs[0].1, pairs[0].2.round()), (0, 200.0));
    assert_eq!((pairs[1].1, pairs[1].2.round()), (2, 600.0));
}
