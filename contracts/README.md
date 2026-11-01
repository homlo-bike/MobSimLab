# Contracts

JSON Schemas for data that one part of MobSimLab produces and another consumes. Each schema names its producer and is checked in CI against real output.

| Schema | Producer | Consumer | Check |
|--------|----------|----------|-------|
| [rail-topology.schema.json](rail-topology.schema.json) | `crates/rail-design` (`topology` module; the railway tool's **Download track topology**) | Railway operations (ADR-0032): routes, timetables, reservations | `cargo run -p rail-design --example topology -- DIR`, then `tools/contracts/check_rail_topology.py DIR/*.json` |

## Railway topology

The railway design (ADR-0030, ADR-0033) is exported as a graph of physical tracks:

- **Sections**: one track between two nodes. These are the lines of an alignment (cut at switch points), station tracks and the diverging legs of switches. Each section carries its length, mode, gauge, use (running or storage), electrification, and ranges of level, permitted speed, ramp gradient and curve radius along it. It also lists its platform edges and its geometry.
- **Nodes**: where section ends meet. A node is `end` (a buffer stop or unconnected end), `join` or `switch`.
- **Links**: the movements a train may make through a node. At a switch point a train goes from the toe side into either leg, never from one leg into the other.
- **Switches**: catalogue element, diverging speed and radius, and the conflict sections that one train at a time may occupy.
- **Platform edges**: station, station name, side, and the stretch of the station track they serve.
- **Crossings** of two alignments, with each track's chainage and the fouling points before and after. The fouling distance is (c + e_other/2) / sin θ + (e_own/2) / tan θ, where c is the larger clearance marker distance of the two systems, e the track spacing and θ the crossing angle. A same-level crossing (`diamond`) is a conflict for one train at a time from either railway system. A grade-separated crossing is not a conflict. A `clash` is a design error.
- **Depot groups**: connected storage sections.

Ids come from the document's ids, so they stay the same while the elements they come from stay (see the schema's descriptions). `valid` is false while the design has errors.
