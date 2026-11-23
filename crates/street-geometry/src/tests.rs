use super::*;
use street_routing::parse_osm_xml;
use street_routing::setup::TramShare;

/// A crossroads in central Damascus: a two-way primary road (west–east, 2 lanes) crossed by a
/// one-way secondary road (south–north, 2 lanes), about 150 m each way.
fn crossroads() -> OsmData {
    let xml = r#"<?xml version="1.0"?>
<osm version="0.6">
  <node id="1" lat="33.5130" lon="36.2880"/>
  <node id="2" lat="33.5130" lon="36.2896"/>
  <node id="3" lat="33.5130" lon="36.2912"/>
  <node id="4" lat="33.5116" lon="36.2896"/>
  <node id="5" lat="33.5144" lon="36.2896"/>
  <node id="9" lat="33.5150" lon="36.2950"/>
  <way id="100">
    <nd ref="1"/><nd ref="2"/><nd ref="3"/>
    <tag k="highway" v="primary"/><tag k="lanes" v="2"/><tag k="name" v="A &amp; B"/>
  </way>
  <way id="200">
    <nd ref="4"/><nd ref="2"/><nd ref="5"/>
    <tag k="highway" v="secondary"/><tag k="oneway" v="yes"/><tag k="lanes" v="2"/>
  </way>
  <way id="300">
    <nd ref="5"/><nd ref="9"/>
    <tag k="railway" v="tram"/>
  </way>
</osm>"#;
    parse_osm_xml(xml).expect("fixture parses")
}

/// The lanes of one road of a way, left to right. The junction splits each fixture way into two roads with
/// the same lanes, drawn one after the other.
fn kinds(g: &Geometry, way: i64) -> Vec<LaneKind> {
    let all: Vec<LaneKind> = g
        .lanes
        .iter()
        .filter(|l| l.way == way)
        .map(|l| l.kind)
        .collect();
    assert!(!all.is_empty(), "way {way} drawn");
    let half = all.len() / 2;
    if all.len().is_multiple_of(2) && all[..half] == all[half..] {
        all[..half].to_vec()
    } else {
        all
    }
}

fn setup(way: i64) -> StreetSetup {
    StreetSetup {
        way,
        ..StreetSetup::default()
    }
}

#[test]
fn draws_lanes_junctions_and_lines_in_lon_lat() {
    let g = build(&crossroads(), &[], None).expect("builds");
    assert_eq!(g.driving_side, "right");
    let k = kinds(&g, 100);
    assert_eq!(k.iter().filter(|k| **k == LaneKind::Traffic).count(), 2);
    assert!(k.contains(&LaneKind::Pavement), "inferred pavements: {k:?}");
    assert!(!g.junctions.is_empty());
    // A two-way road has a centre line, the one-way road a dashed lane line.
    assert!(g.lines.iter().any(|l| l.kind == LineKind::Centre));
    assert!(g.lines.iter().any(|l| l.kind == LineKind::Lane));
    // Railway ways are left to the railway editor.
    assert!(g.lanes.iter().all(|l| l.way != 300));
    // Rings are closed lon/lat pairs near the fixture, rounded to 1e-6°.
    for l in &g.lanes {
        assert!(l.ring.len() >= 8 && l.ring.len() % 2 == 0);
        for p in l.ring.chunks(2) {
            assert!((36.28..36.30).contains(&p[0]) && (33.50..33.52).contains(&p[1]));
            assert!(((p[0] * 1e6).round() - p[0] * 1e6).abs() < 1e-6);
        }
        assert_eq!(l.ring[..2], l.ring[l.ring.len() - 2..]);
    }
}

#[test]
fn a_setup_bus_lane_becomes_a_bus_lane() {
    let bus = StreetSetup {
        bus_lane: Some(true),
        ..setup(100)
    };
    let g = build(&crossroads(), &[bus], None).expect("builds");
    let k = kinds(&g, 100);
    assert_eq!(
        k.iter().filter(|k| **k == LaneKind::Bus).count(),
        2,
        "{k:?}"
    );
    // The street keeps its two traffic lanes, as the setup panel counts them (OSM `lanes` counts bus lanes).
    assert_eq!(
        k.iter().filter(|k| **k == LaneKind::Traffic).count(),
        2,
        "{k:?}"
    );
    // At the kerb, outside the traffic lanes.
    let traffic = k
        .iter()
        .position(|k| *k == LaneKind::Traffic)
        .expect("traffic");
    assert!(k[..traffic].contains(&LaneKind::Bus) && k[traffic..].contains(&LaneKind::Bus));
}

#[test]
fn separated_bus_lanes_get_a_kerb_on_the_traffic_side() {
    let bus = StreetSetup {
        bus_lane: Some(true),
        separated: Some(true),
        ..setup(100)
    };
    let g = build(&crossroads(), &[bus], None).expect("builds");
    let k = kinds(&g, 100);
    for (i, kind) in k.iter().enumerate() {
        if *kind == LaneKind::Bus {
            let traffic_side = if k.get(i + 1) == Some(&LaneKind::Traffic) || i + 1 == k.len() {
                k.get(i + 1)
            } else {
                k.get(i.wrapping_sub(1))
            };
            assert_ne!(traffic_side, Some(&LaneKind::Traffic), "{k:?}");
        }
    }
    assert!(k.contains(&LaneKind::Kerb));
}

#[test]
fn a_tram_of_its_own_runs_in_the_middle() {
    let tram = StreetSetup {
        tram: Some(TramShare::OwnLane),
        ..setup(100)
    };
    let g = build(&crossroads(), &[tram], None).expect("builds");
    let k = kinds(&g, 100);
    let trams: Vec<usize> = (0..k.len()).filter(|&i| k[i] == LaneKind::Tram).collect();
    assert_eq!(trams.len(), 2, "{k:?}");
    // One traffic lane on each side of the two tram lanes.
    assert_eq!(k[trams[0] - 1], LaneKind::Traffic, "{k:?}");
    assert_eq!(k[trams[1] + 1], LaneKind::Traffic, "{k:?}");
    assert_eq!(trams[1], trams[0] + 1);
}

#[test]
fn a_separated_tram_lane_on_a_one_way_street_is_inside_kerbs() {
    let tram = StreetSetup {
        tram: Some(TramShare::OwnLane),
        separated: Some(true),
        ..setup(200)
    };
    let g = build(&crossroads(), &[tram], None).expect("builds");
    let k = kinds(&g, 200);
    let t = k
        .iter()
        .position(|k| *k == LaneKind::Tram)
        .expect("tram lane");
    assert_eq!(k[t - 1], LaneKind::Kerb, "{k:?}");
    assert_eq!(k[t + 1], LaneKind::Kerb, "{k:?}");
    // Inner side where traffic keeps right: the tram is left of the traffic lanes.
    assert!(k[t + 1..].contains(&LaneKind::Traffic), "{k:?}");
    assert!(!k[..t].contains(&LaneKind::Traffic), "{k:?}");
}

#[test]
fn a_tram_in_mixed_traffic_draws_rails() {
    let tram = StreetSetup {
        tram: Some(TramShare::Mixed),
        ..setup(100)
    };
    let g = build(&crossroads(), &[tram], None).expect("builds");
    // Two roads (one each side of the junction), rails in the inner lane of each direction on each.
    assert_eq!(
        g.lines.iter().filter(|l| l.kind == LineKind::Rails).count(),
        4
    );
    assert!(!kinds(&g, 100).contains(&LaneKind::Tram));
}

#[test]
fn traffic_keeps_left_in_left_hand_countries() {
    // The same crossroads moved to central London.
    let mut data = crossroads();
    for n in &mut data.nodes {
        n.lat += 51.5072 - 33.5130;
        n.lon += -0.1276 - 36.2896;
    }
    let g = build(&data, &[], None).expect("builds");
    assert_eq!(g.driving_side, "left");
}

#[test]
fn osm_xml_escapes_tag_values() {
    let xml = to_osm_xml(&crossroads());
    assert!(xml.contains("v=\"A &amp; B\""));
    assert!(xml.starts_with("<?xml"));
    let back = parse_osm_xml(&xml).expect("round trip");
    assert_eq!(back.ways.len(), 3);
    assert_eq!(
        back.ways[0].tags.get("name").map(String::as_str),
        Some("A & B")
    );
}

#[test]
fn setup_lanes_leaves_roads_without_setup_values_alone() {
    let g = build(&crossroads(), &[], None).expect("builds");
    let before = kinds(&g, 100);
    let empty = setup(100);
    let g2 = build(&crossroads(), &[empty], None).expect("builds");
    assert_eq!(kinds(&g2, 100), before);
}

fn profile(g: &Geometry, way: i64) -> &[LaneProfile] {
    &g.roads
        .iter()
        .find(|r| r.way == way)
        .expect("way profiled")
        .lanes
}

#[test]
fn each_way_has_one_lane_profile_with_widths_and_directions() {
    let bus = StreetSetup {
        bus_lane: Some(true),
        ..setup(100)
    };
    let g = build(&crossroads(), &[bus], None).expect("builds");
    // One profile per street way, none for the railway.
    let ways: Vec<i64> = g.roads.iter().map(|r| r.way).collect();
    assert_eq!(ways, vec![100, 200]);
    let p = profile(&g, 100);
    let listed: Vec<LaneKind> = p.iter().map(|l| l.kind).collect();
    assert_eq!(listed, kinds(&g, 100), "same lanes as drawn");
    // Two-way: lanes against the way on the left, with it on the right (traffic keeps right).
    let traffic: Vec<&LaneProfile> = p.iter().filter(|l| l.kind == LaneKind::Traffic).collect();
    assert_eq!(traffic.first().map(|l| l.dir), Some(LaneDir::Backward));
    assert_eq!(traffic.last().map(|l| l.dir), Some(LaneDir::Forward));
    for l in p {
        assert!((0.05..6.0).contains(&l.width), "{l:?}");
        assert!(!l.rails);
    }
    // One-way: every traffic lane runs with the way.
    assert!(profile(&g, 200)
        .iter()
        .filter(|l| l.kind == LaneKind::Traffic)
        .all(|l| l.dir == LaneDir::Forward));
}

#[test]
fn the_profile_marks_rails_of_trams() {
    let mixed = StreetSetup {
        tram: Some(TramShare::Mixed),
        ..setup(100)
    };
    let g = build(&crossroads(), &[mixed], None).expect("builds");
    let railed: Vec<LaneKind> = profile(&g, 100)
        .iter()
        .filter(|l| l.rails)
        .map(|l| l.kind)
        .collect();
    assert_eq!(railed, vec![LaneKind::Traffic, LaneKind::Traffic]);

    let own = StreetSetup {
        tram: Some(TramShare::OwnLane),
        ..setup(100)
    };
    let g = build(&crossroads(), &[own], None).expect("builds");
    let p = profile(&g, 100);
    assert!(p
        .iter()
        .filter(|l| l.kind == LaneKind::Tram)
        .all(|l| l.rails && (l.width - TRAM_LANE_M).abs() < 1e-9));
}

#[test]
fn the_project_driving_side_wins_over_the_country() {
    // Damascus drives on the right; a project set to the left gets left-hand lanes.
    let g = build(&crossroads(), &[], Some(DrivingSide::Left)).expect("builds");
    assert_eq!(g.driving_side, "left");
    let traffic: Vec<&LaneProfile> = profile(&g, 100)
        .iter()
        .filter(|l| l.kind == LaneKind::Traffic)
        .collect();
    assert_eq!(traffic.first().map(|l| l.dir), Some(LaneDir::Forward));
    assert_eq!(traffic.last().map(|l| l.dir), Some(LaneDir::Backward));
}

#[test]
fn a_two_way_street_made_one_way_has_its_lanes_one_way() {
    let one = StreetSetup {
        oneway: Some(true),
        ..setup(100)
    };
    let g = build(&crossroads(), &[one], None).expect("builds");
    let p = profile(&g, 100);
    assert!(p
        .iter()
        .filter(|l| l.kind == LaneKind::Traffic)
        .all(|l| l.dir == LaneDir::Forward));
    let two = StreetSetup {
        oneway: Some(false),
        ..setup(200)
    };
    let g = build(&crossroads(), &[two], None).expect("builds");
    let dirs: Vec<LaneDir> = profile(&g, 200)
        .iter()
        .filter(|l| l.kind == LaneKind::Traffic)
        .map(|l| l.dir)
        .collect();
    assert!(
        dirs.contains(&LaneDir::Forward) && dirs.contains(&LaneDir::Backward),
        "{dirs:?}"
    );
}

#[test]
fn a_custom_layout_is_drawn_section_by_section() {
    use street_routing::{RoadUser::*, Section, SectionDir, SectionKind};
    let lane = |users: &[street_routing::RoadUser], dir, width| Section {
        kind: SectionKind::Lane,
        users: users.to_vec(),
        dir,
        width,
        style: None,
    };
    let strip = |kind, width, style: &str| Section {
        kind,
        users: Vec::new(),
        dir: None,
        width,
        style: Some(style.into()),
    };
    let sections = vec![
        lane(&[Walk], None, 4.0),
        strip(SectionKind::Green, 2.5, "trees"),
        lane(&[Car, Tram], Some(SectionDir::Backward), 3.2),
        strip(SectionKind::Protection, 0.5, "planters"),
        lane(&[Bus], Some(SectionDir::Backward), 3.3),
        strip(SectionKind::Island, 1.5, "raised"),
        lane(&[Bus], Some(SectionDir::Forward), 3.3),
        lane(&[Car], Some(SectionDir::Forward), 3.1),
        lane(&[Bike, Walk], None, 3.0),
    ];
    let s = StreetSetup {
        sections: Some(sections),
        ..setup(100)
    };
    let g = build(&crossroads(), &[s], None).expect("builds");
    let k = |x: &str| match x {
        "pavement" => LaneKind::Pavement,
        "green" => LaneKind::Green,
        "traffic" => LaneKind::Traffic,
        "kerb" => LaneKind::Kerb,
        "bus" => LaneKind::Bus,
        "island" => LaneKind::Island,
        _ => LaneKind::SharedUse,
    };
    let want: Vec<LaneKind> = [
        "pavement", "green", "traffic", "kerb", "bus", "island", "bus", "traffic", "shared",
    ]
    .iter()
    .map(|x| k(x))
    .collect();
    assert_eq!(kinds(&g, 100), want);
    let p = profile(&g, 100);
    assert_eq!(p[0].width, 4.0);
    assert_eq!(p[2].dir, LaneDir::Backward);
    assert_eq!(p[6].dir, LaneDir::Forward);
    // Rails along the traffic lane the tram shares with cars.
    assert!(p[2].rails && !p[7].rails);
    assert!(g.lines.iter().any(|l| l.kind == LineKind::Rails));
}
