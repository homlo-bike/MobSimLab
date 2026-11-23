//! Streets the planner's setups close to buses.
//!
//! A street set up in the GIS tab can take a street, or one direction of it, away from buses: a layout
//! with only pavements, or a street made one-way. The road graph built with the setups simply leaves
//! those arcs out, so a line drawn along such a street goes round it and a stop on it moves to the
//! nearest street buses can use. [`bus_closures`] lists what the setups took away, so the street line
//! tool can say so ([`crate::line::StreetLine::mark_setup_closures`]).

use crate::graph::bus_directions;
use crate::osm::OsmData;
use crate::setup::StreetSetup;
use std::collections::HashMap;

/// The directions of one OSM way that the setups closed to buses (that OSM alone left open).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Closed {
    /// Along the way as drawn.
    pub forward: bool,
    /// Against the way as drawn.
    pub backward: bool,
}

/// Purpose: what the setups take away from buses, by OSM way. Ways buses could not use before, or
/// can use in the same directions after, are left out.
pub fn bus_closures(data: &OsmData, setups: &[StreetSetup]) -> HashMap<i64, Closed> {
    let by_way: HashMap<i64, &StreetSetup> = setups.iter().map(|s| (s.way, s)).collect();
    let mut out = HashMap::new();
    for w in &data.ways {
        let Some(s) = by_way.get(&w.id) else {
            continue;
        };
        let Some((fwd, bwd)) = bus_directions(&w.tags) else {
            continue;
        };
        let mut tags = w.tags.clone();
        s.apply(&mut tags);
        let (af, ab) = bus_directions(&tags).unwrap_or((false, false));
        let c = Closed {
            forward: fwd && !af,
            backward: bwd && !ab,
        };
        if c.forward || c.backward {
            out.insert(w.id, c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::osm::parse_osm_xml;
    use crate::sections::{RoadUser, Section, SectionKind};

    const XML: &str = r#"<osm>
      <node id="1" lat="52.0" lon="13.0"/><node id="2" lat="52.0" lon="13.001"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
      <way id="11"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/></way>
    </osm>"#;

    fn walk_only(way: i64) -> StreetSetup {
        let walk = Section {
            kind: SectionKind::Lane,
            users: vec![RoadUser::Walk],
            dir: None,
            width: 3.0,
            style: None,
        };
        StreetSetup {
            way,
            sections: Some(vec![walk.clone(), walk]),
            ..StreetSetup::default()
        }
    }

    #[test]
    fn a_layout_for_people_on_foot_closes_the_street_both_ways() {
        let d = parse_osm_xml(XML).unwrap();
        let c = bus_closures(&d, &[walk_only(10)]);
        assert_eq!(
            c.get(&10),
            Some(&Closed {
                forward: true,
                backward: true
            })
        );
    }

    #[test]
    fn a_street_made_one_way_closes_the_other_direction() {
        let d = parse_osm_xml(XML).unwrap();
        let s = StreetSetup {
            way: 10,
            oneway: Some(true),
            ..StreetSetup::default()
        };
        assert_eq!(
            bus_closures(&d, &[s]).get(&10),
            Some(&Closed {
                forward: false,
                backward: true
            })
        );
    }

    #[test]
    fn streets_buses_never_used_and_unchanged_streets_are_left_out() {
        let d = parse_osm_xml(XML).unwrap();
        let lanes = StreetSetup {
            way: 10,
            bus_lane: Some(true),
            ..StreetSetup::default()
        };
        assert!(bus_closures(&d, &[walk_only(11), lanes]).is_empty());
    }
}
