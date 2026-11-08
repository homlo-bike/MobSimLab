//! Writes the topology of each mode's example line as JSON, one file per mode, into the
//! directory given as the first argument (default: the current directory). CI validates them
//! against `contracts/rail-topology.schema.json`. Each example has the example street across the
//! main line, so the level crossings are checked too, and the example existing railway joined by
//! the crossing line.

use rail_design::sample::{sample, sample_railways, sample_streets};
use rail_design::{build, build_with_osm, topology::topology, RailMode};

fn main() {
    let dir = std::env::args().nth(1).unwrap_or_else(|| ".".into());
    for m in RailMode::ALL {
        let net = sample(m, 7.0, 50.9);
        let plain = build(&net, None);
        let (streets, railways) = (sample_streets(&plain), sample_railways(&plain));
        let t = topology(&build_with_osm(&net, None, &streets, &railways));
        let path = format!("{dir}/{}.json", m.id());
        std::fs::write(&path, serde_json::to_string_pretty(&t).expect("serialise")).expect("write");
        println!(
            "{path}: {} sections, {} nodes, {} links, {} switches, {} platform edges, {} crossings, {} level crossings, {} depot groups, {} existing joins, valid {}",
            t.sections.len(),
            t.nodes.len(),
            t.links.len(),
            t.switches.len(),
            t.platform_edges.len(),
            t.crossings.len(),
            t.level_crossings.len(),
            t.depot_groups.len(),
            t.existing_joins.len(),
            t.valid
        );
    }
}
