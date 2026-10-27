//! Minimal OSM XML reader: nodes, ways and turn-restriction relations.
//!
//! Reads the files written by `tools/osm/overpass_fetch.py` or exported from
//! openstreetmap.org. Data © OpenStreetMap contributors, ODbL.

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::collections::BTreeMap;

/// Tag map of one OSM element.
pub type Tags = BTreeMap<String, String>;

/// An OSM node.
#[derive(Debug, Clone, PartialEq)]
pub struct RawNode {
    /// OSM id.
    pub id: i64,
    /// Longitude in degrees.
    pub lon: f64,
    /// Latitude in degrees.
    pub lat: f64,
    /// Tags (empty for most nodes).
    pub tags: Tags,
}

/// An OSM way.
#[derive(Debug, Clone, PartialEq)]
pub struct RawWay {
    /// OSM id.
    pub id: i64,
    /// Node ids in order.
    pub nodes: Vec<i64>,
    /// Tags.
    pub tags: Tags,
}

/// Whether a restriction forbids one turn or allows only one turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestrictionKind {
    /// `no_*`: the turn from `from` to `to` is banned.
    No,
    /// `only_*`: every turn from `from` except to `to` is banned.
    Only,
}

/// A turn restriction with a via node (via-way restrictions are not read yet).
#[derive(Debug, Clone, PartialEq)]
pub struct RawRestriction {
    /// Way the vehicle comes from.
    pub from_way: i64,
    /// Junction node.
    pub via_node: i64,
    /// Way the vehicle turns into.
    pub to_way: i64,
    /// Ban or mandatory turn.
    pub kind: RestrictionKind,
}

/// Everything the road graph builder needs from an OSM extract.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct OsmData {
    /// All nodes.
    pub nodes: Vec<RawNode>,
    /// All ways.
    pub ways: Vec<RawWay>,
    /// Turn restrictions that apply to buses.
    pub restrictions: Vec<RawRestriction>,
}

fn attr(e: &BytesStart, key: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == key)
        .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
}

/// Purpose: decide whether a restriction relation applies to buses and which kind it is.
/// Inputs: the relation tags. Output: `None` when it does not apply.
fn restriction_kind(tags: &Tags) -> Option<RestrictionKind> {
    if tags.get("type").map(String::as_str) != Some("restriction") {
        return None;
    }
    let exempt = tags
        .get("except")
        .is_some_and(|v| v.split(';').any(|m| matches!(m.trim(), "bus" | "psv")));
    let value = tags
        .get("restriction:bus")
        .or_else(|| tags.get("restriction:psv"))
        .or(if exempt {
            None
        } else {
            tags.get("restriction")
        })?;
    if value.starts_with("no_") {
        Some(RestrictionKind::No)
    } else if value.starts_with("only_") {
        Some(RestrictionKind::Only)
    } else {
        None
    }
}

/// Purpose: parse OSM XML text.
/// Output: nodes, ways and bus-relevant turn restrictions; an error string on malformed XML.
pub fn parse_osm_xml(xml: &str) -> Result<OsmData, String> {
    let mut reader = Reader::from_str(xml);
    let mut out = OsmData::default();
    enum Current {
        None,
        Node(RawNode),
        Way(RawWay),
        Rel(Tags, Vec<(String, String, i64)>),
    }
    let mut cur = Current::None;
    loop {
        let ev = reader
            .read_event()
            .map_err(|e| format!("OSM XML error at byte {}: {e}", reader.buffer_position()))?;
        let (e, empty) = match &ev {
            Event::Start(e) => (e, false),
            Event::Empty(e) => (e, true),
            Event::End(e) => {
                match (
                    e.name().as_ref(),
                    std::mem::replace(&mut cur, Current::None),
                ) {
                    (b"node", Current::Node(n)) => out.nodes.push(n),
                    (b"way", Current::Way(w)) => out.ways.push(w),
                    (b"relation", Current::Rel(tags, members)) => {
                        push_restriction(&mut out, &tags, &members)
                    }
                    (_, other) => cur = other,
                }
                continue;
            }
            Event::Eof => break,
            _ => continue,
        };
        match e.name().as_ref() {
            b"node" => {
                let id = attr(e, b"id").and_then(|v| v.parse().ok());
                let lat = attr(e, b"lat").and_then(|v| v.parse().ok());
                let lon = attr(e, b"lon").and_then(|v| v.parse().ok());
                if let (Some(id), Some(lat), Some(lon)) = (id, lat, lon) {
                    let n = RawNode {
                        id,
                        lon,
                        lat,
                        tags: Tags::new(),
                    };
                    if empty {
                        out.nodes.push(n);
                    } else {
                        cur = Current::Node(n);
                    }
                }
            }
            b"way" => {
                if let Some(id) = attr(e, b"id").and_then(|v| v.parse().ok()) {
                    if !empty {
                        cur = Current::Way(RawWay {
                            id,
                            nodes: Vec::new(),
                            tags: Tags::new(),
                        });
                    }
                }
            }
            b"relation" if !empty => cur = Current::Rel(Tags::new(), Vec::new()),
            b"nd" => {
                if let (Current::Way(w), Some(r)) =
                    (&mut cur, attr(e, b"ref").and_then(|v| v.parse().ok()))
                {
                    w.nodes.push(r);
                }
            }
            b"member" => {
                if let Current::Rel(_, members) = &mut cur {
                    if let (Some(t), Some(role), Some(r)) = (
                        attr(e, b"type"),
                        attr(e, b"role"),
                        attr(e, b"ref").and_then(|v| v.parse().ok()),
                    ) {
                        members.push((t, role, r));
                    }
                }
            }
            b"tag" => {
                if let (Some(k), Some(v)) = (attr(e, b"k"), attr(e, b"v")) {
                    match &mut cur {
                        Current::Node(n) => drop(n.tags.insert(k, v)),
                        Current::Way(w) => drop(w.tags.insert(k, v)),
                        Current::Rel(t, _) => drop(t.insert(k, v)),
                        Current::None => {}
                    }
                }
            }
            _ => {}
        }
    }
    Ok(out)
}

fn push_restriction(out: &mut OsmData, tags: &Tags, members: &[(String, String, i64)]) {
    let Some(kind) = restriction_kind(tags) else {
        return;
    };
    let find = |ty: &str, role: &str| {
        members
            .iter()
            .find(|(t, r, _)| t == ty && r == role)
            .map(|m| m.2)
    };
    if let (Some(from_way), Some(via_node), Some(to_way)) =
        (find("way", "from"), find("node", "via"), find("way", "to"))
    {
        out.restrictions.push(RawRestriction {
            from_way,
            via_node,
            to_way,
            kind,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_nodes_ways_and_restrictions() {
        let xml = r#"<?xml version="1.0"?><osm version="0.6">
          <node id="1" lat="50.0" lon="7.0"/>
          <node id="2" lat="50.001" lon="7.0"><tag k="highway" v="turning_circle"/></node>
          <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="name" v="A &amp; B"/></way>
          <relation id="99"><member type="way" ref="10" role="from"/><member type="node" ref="2" role="via"/>
            <member type="way" ref="11" role="to"/><tag k="type" v="restriction"/><tag k="restriction" v="no_left_turn"/></relation>
          <relation id="100"><member type="way" ref="10" role="from"/><member type="node" ref="2" role="via"/>
            <member type="way" ref="11" role="to"/><tag k="type" v="restriction"/><tag k="restriction" v="no_left_turn"/>
            <tag k="except" v="psv;bicycle"/></relation>
        </osm>"#;
        let d = parse_osm_xml(xml).unwrap();
        assert_eq!(d.nodes.len(), 2);
        assert_eq!(d.nodes[1].tags["highway"], "turning_circle");
        assert_eq!(d.ways[0].nodes, vec![1, 2]);
        assert_eq!(d.ways[0].tags["name"], "A & B");
        assert_eq!(
            d.restrictions.len(),
            1,
            "the psv-exempt restriction does not apply to buses"
        );
        assert_eq!(d.restrictions[0].kind, RestrictionKind::No);
    }

    #[test]
    fn bus_specific_restriction_wins() {
        let mut t = Tags::new();
        t.insert("type".into(), "restriction".into());
        t.insert("restriction".into(), "no_right_turn".into());
        t.insert("restriction:bus".into(), "only_straight_on".into());
        assert_eq!(restriction_kind(&t), Some(RestrictionKind::Only));
    }
}
