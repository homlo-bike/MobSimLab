//! Route a street line through points on a real OSM extract and print a summary.
//!
//! Usage: `cargo run --release -p street-routing --example route_osm -- area.osm LON,LAT LON,LAT ...`
//! Every point becomes a stop; the first and last become end stops.

use std::time::Instant;
use street_routing::{
    parse_osm_xml, Mode, PointKind, RoadGraph, RoutingRules, StreetLine, VehicleProfile,
};

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (file, pts) = args
        .split_first()
        .ok_or("usage: route_osm FILE LON,LAT LON,LAT ...")?;
    let t0 = Instant::now();
    let xml = std::fs::read_to_string(file).map_err(|e| e.to_string())?;
    let data = parse_osm_xml(&xml)?;
    let g = RoadGraph::from_osm(&data)?;
    println!(
        "graph: {} nodes, {} arcs, {} turn bans, built in {:.2} s",
        g.nodes.len(),
        g.arcs.len(),
        g.banned.len(),
        t0.elapsed().as_secs_f64()
    );
    let mut line = StreetLine::new(
        VehicleProfile::default_for(Mode::Bus),
        RoutingRules::default(),
    );
    let t1 = Instant::now();
    for (i, p) in pts.iter().enumerate() {
        let (lon, lat) = p.split_once(',').ok_or("points are LON,LAT")?;
        let kind = if i == 0 || i == pts.len() - 1 {
            PointKind::EndStop
        } else {
            PointKind::Stop
        };
        line.add_point(
            &g,
            lon.parse().map_err(|_| "bad lon")?,
            lat.parse().map_err(|_| "bad lat")?,
            kind,
        );
    }
    println!(
        "{} points routed in {:.1} ms",
        pts.len(),
        t1.elapsed().as_secs_f64() * 1000.0
    );
    let v = line.view(&g);
    for p in &v.points {
        println!("  {} {:?} {:?} {}", p.seq + 1, p.kind, p.status, p.name);
    }
    for l in &v.legs {
        println!(
            "  leg {}: {:.0} m, {:.0} s, {:?} {}",
            l.index,
            l.length_m,
            l.time_s,
            l.status,
            l.message.clone().unwrap_or_default()
        );
    }
    for i in &v.issues {
        println!("  issue: {i}");
    }
    Ok(())
}
