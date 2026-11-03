//! Street setup: what the planner sets for a street in the GIS tab, over what OpenStreetMap says.
//!
//! A [`StreetSetup`] belongs to one OSM way and says how its carriageway is shared: the number of
//! general traffic lanes, a bus lane, a bike lane, a physical separation (kerb, barrier or
//! separate track bed) between the transit lanes and the traffic beside them, and whether a tram
//! along the street has its own lane or runs in mixed traffic. Every field is optional: unset
//! fields keep what OSM says (or what the tools infer from it).
//!
//! The setup is applied as tag overrides on the OSM way ([`apply_setups`]), so the bus road graph
//! ([`crate::graph`]) and the railway design (`rail-design`'s `street_from_osm`) read user edits
//! and OSM data the same way (06-gis §3: road edges are built from OSM and user edits). Values
//! with no OSM tag use the `mobsimlab:` namespace:
//!
//! - `mobsimlab:traffic_lanes`: general traffic lanes over both directions;
//! - `mobsimlab:separated`: `yes` or `no`;
//! - `mobsimlab:tram`: `own_lane` or `mixed`;
//! - `mobsimlab:setup`: `yes` on every way the planner set up.
//!
//! The extra running time a bus loses in the traffic of a main road comes from the assumption
//! library: `street.mixed_traffic_delay_share` and `street.bus_lane_delay_share`.

use crate::osm::{OsmData, Tags};
use serde::{Deserialize, Serialize};

/// How a tram along the street shares it with road traffic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TramShare {
    /// The tram has its own lane (reserved track); road traffic drives beside it.
    OwnLane,
    /// Cars, buses and lorries drive on the track; the tram runs in traffic.
    Mixed,
}

/// The planner's setup of one street (one OSM way). `None` keeps what OSM says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct StreetSetup {
    /// OSM way id.
    pub way: i64,
    /// General traffic lanes over both directions (not counting bus or tram lanes).
    #[serde(default)]
    pub traffic_lanes: Option<u8>,
    /// A bus lane in each direction of travel.
    #[serde(default)]
    pub bus_lane: Option<bool>,
    /// A bike lane in each direction of travel.
    #[serde(default)]
    pub bike_lane: Option<bool>,
    /// A kerb, barrier or separate track bed between the bus or tram lane (and the bike lane)
    /// and the general traffic, so cars cannot drive or park in them.
    #[serde(default)]
    pub separated: Option<bool>,
    /// Tram along this street: own lane or mixed traffic.
    #[serde(default)]
    pub tram: Option<TramShare>,
}

/// Extra running time of a bus in the general traffic of a main road, as a share of the
/// free-flow running time (assumption `street.mixed_traffic_delay_share`, central value).
pub const MIXED_TRAFFIC_DELAY_SHARE: f64 = 0.25;
/// Extra running time in a bus lane that is only painted (cars turn across it, park and load in
/// it), as a share of the free-flow running time (assumption `street.bus_lane_delay_share`).
pub const BUS_LANE_DELAY_SHARE: f64 = 0.08;

/// Main roads: traffic jams and gridlock hold up buses and trams that run in their traffic.
pub fn main_road(class: &str) -> bool {
    matches!(
        class,
        "trunk" | "trunk_link" | "primary" | "primary_link" | "secondary" | "secondary_link"
    )
}

fn yes(v: Option<&String>) -> bool {
    matches!(
        v.map(String::as_str),
        Some("yes" | "designated" | "true" | "1")
    )
}

/// Purpose: whether OSM tags give the street a bus lane (or make it a busway).
pub fn osm_bus_lane(tags: &Tags) -> bool {
    matches!(
        tags.get("highway").map(String::as_str),
        Some("busway" | "bus_guideway")
    ) || ["busway", "busway:left", "busway:right", "busway:both"]
        .iter()
        .any(|k| {
            matches!(
                tags.get(*k).map(String::as_str),
                Some("lane" | "opposite_lane")
            )
        })
        || tags.keys().any(|k| {
            k.starts_with("bus:lanes") || k.starts_with("lanes:bus") || k.starts_with("lanes:psv")
        })
}

/// Purpose: whether OSM tags give the street a bike lane or cycle track along it.
pub fn osm_bike_lane(tags: &Tags) -> bool {
    [
        "cycleway",
        "cycleway:both",
        "cycleway:left",
        "cycleway:right",
    ]
    .iter()
    .any(|k| {
        matches!(
            tags.get(*k).map(String::as_str),
            Some("lane" | "track" | "opposite_lane" | "opposite_track" | "share_busway")
        )
    }) || tags.keys().any(|k| k.starts_with("cycleway:lanes"))
        || yes(tags.get("bicycle_road"))
}

/// Purpose: whether the transit lanes are separated from the general traffic (the planner's
/// setting; OSM has no common tag for it, so streets from OSM count as not separated, except
/// busways, which are roads of their own).
pub fn separated(tags: &Tags) -> bool {
    match tags.get("mobsimlab:separated").map(String::as_str) {
        Some("yes") => true,
        Some("no") => false,
        _ => matches!(
            tags.get("highway").map(String::as_str),
            Some("busway" | "bus_guideway")
        ),
    }
}

impl StreetSetup {
    /// Purpose: whether the setup changes anything.
    pub fn is_empty(&self) -> bool {
        self.traffic_lanes.is_none()
            && self.bus_lane.is_none()
            && self.bike_lane.is_none()
            && self.separated.is_none()
            && self.tram.is_none()
    }

    /// Purpose: write the setup into the tags of its OSM way.
    /// Side effects: replaces or removes the bus lane, bike lane and lane count tags it sets.
    pub fn apply(&self, tags: &mut Tags) {
        if self.is_empty() {
            return;
        }
        tags.insert("mobsimlab:setup".into(), "yes".into());
        let oneway = matches!(
            tags.get("oneway").map(String::as_str),
            Some("yes" | "true" | "1" | "-1" | "reverse")
        );
        if let Some(bus) = self.bus_lane {
            tags.retain(|k, _| {
                !(k.starts_with("busway")
                    || k.starts_with("bus:lanes")
                    || k.starts_with("lanes:bus")
                    || k.starts_with("lanes:psv"))
            });
            if bus {
                let key = if oneway { "busway" } else { "busway:both" };
                tags.insert(key.into(), "lane".into());
            }
        }
        if let Some(bike) = self.bike_lane {
            tags.retain(|k, _| !k.starts_with("cycleway"));
            let key = if oneway { "cycleway" } else { "cycleway:both" };
            let sep = self.separated.unwrap_or(false);
            let v = match (bike, sep) {
                (false, _) => "no",
                (true, true) => "track",
                (true, false) => "lane",
            };
            tags.insert(key.into(), v.into());
        }
        if let Some(n) = self.traffic_lanes {
            let n = n.max(1);
            tags.insert("mobsimlab:traffic_lanes".into(), n.to_string());
            // OSM `lanes` counts bus lanes too (not tram or bike lanes).
            let bus = self.bus_lane.unwrap_or_else(|| osm_bus_lane(tags));
            let bus_lanes = if !bus {
                0
            } else if oneway {
                1
            } else {
                2
            };
            tags.insert("lanes".into(), (u32::from(n) + bus_lanes).to_string());
            // A tagged width belongs to the old lane layout.
            tags.remove("width");
            tags.remove("width:carriageway");
        }
        if let Some(sep) = self.separated {
            tags.insert(
                "mobsimlab:separated".into(),
                if sep { "yes" } else { "no" }.into(),
            );
        }
        if let Some(t) = self.tram {
            tags.insert(
                "mobsimlab:tram".into(),
                match t {
                    TramShare::OwnLane => "own_lane",
                    TramShare::Mixed => "mixed",
                }
                .into(),
            );
        }
    }
}

/// Purpose: apply the planner's street setups to OSM data (ways not set up stay as they are).
/// Side effects: rewrites the tags of the ways set up.
pub fn apply_setups(data: &mut OsmData, setups: &[StreetSetup]) {
    if setups.is_empty() {
        return;
    }
    let by_way: std::collections::HashMap<i64, &StreetSetup> =
        setups.iter().map(|s| (s.way, s)).collect();
    for w in &mut data.ways {
        if let Some(s) = by_way.get(&w.id) {
            s.apply(&mut w.tags);
        }
    }
}

/// Purpose: the share of extra running time a bus loses on a road (0 off main roads, in a
/// separated bus lane or on a busway).
pub fn delay_share(tags: &Tags) -> f64 {
    let class = tags.get("highway").map_or("", String::as_str);
    if !main_road(class) {
        return 0.0;
    }
    if osm_bus_lane(tags) {
        if separated(tags) {
            0.0
        } else {
            BUS_LANE_DELAY_SHARE
        }
    } else {
        MIXED_TRAFFIC_DELAY_SHARE
    }
}

/// A street as the GIS tab lists it: shape and what OpenStreetMap says, before any setup.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StreetInfo {
    /// OSM way id.
    pub way: i64,
    /// Name (or `ref`), empty when unnamed.
    pub name: String,
    /// OSM `highway` value.
    pub class: String,
    /// Main road (trunk, primary, secondary).
    pub main_road: bool,
    /// One-way street.
    pub oneway: bool,
    /// OSM `lanes` (all motor lanes, bus lanes included), when tagged.
    pub lanes: Option<f64>,
    /// OSM carriageway `width`, m, when tagged.
    pub width_m: Option<f64>,
    /// Speed limit, km/h, when tagged with a number.
    pub maxspeed_kmh: Option<f64>,
    /// OSM gives it a bus lane (or it is a busway).
    pub bus_lane: bool,
    /// OSM gives it a bike lane or cycle track.
    pub bike_lane: bool,
    /// Tram rails in the street (`embedded_rails=tram`, `railway=tram`).
    pub tram: bool,
    /// Shape, `[lon, lat]`.
    pub coords: Vec<[f64; 2]>,
}

/// Classes the GIS tab lets the planner set up: roads that buses, trams and cars share.
const SETUP_CLASSES: [&str; 16] = [
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
    "residential",
    "living_street",
    "service",
    "busway",
    "road",
    "pedestrian",
    "motorway_link",
];

fn number(v: Option<&String>) -> Option<f64> {
    let v = v?.trim();
    let n: String = v
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    n.parse().ok().filter(|x: &f64| *x > 0.0)
}

/// Purpose: the streets of OSM data that the GIS tab can set up, with what OSM says about them.
pub fn street_infos(data: &OsmData) -> Vec<StreetInfo> {
    let nodes: std::collections::HashMap<i64, [f64; 2]> =
        data.nodes.iter().map(|n| (n.id, [n.lon, n.lat])).collect();
    data.ways
        .iter()
        .filter_map(|w| {
            let class = w.tags.get("highway")?;
            if !SETUP_CLASSES.contains(&class.as_str())
                || w.tags.get("area").is_some_and(|v| v == "yes")
            {
                return None;
            }
            let coords: Vec<[f64; 2]> = w
                .nodes
                .iter()
                .filter_map(|n| nodes.get(n).copied())
                .collect();
            if coords.len() < 2 {
                return None;
            }
            let t = &w.tags;
            Some(StreetInfo {
                way: w.id,
                name: t
                    .get("name")
                    .or_else(|| t.get("ref"))
                    .cloned()
                    .unwrap_or_default(),
                class: class.clone(),
                main_road: main_road(class),
                oneway: matches!(
                    t.get("oneway").map(String::as_str),
                    Some("yes" | "true" | "1" | "-1" | "reverse")
                ) || t.get("junction").is_some_and(|j| j == "roundabout"),
                lanes: number(t.get("lanes")),
                width_m: number(t.get("width")),
                maxspeed_kmh: t.get("maxspeed").and_then(|v| crate::graph::parse_speed(v)),
                bus_lane: osm_bus_lane(t),
                bike_lane: osm_bike_lane(t),
                tram: t.get("embedded_rails").is_some_and(|v| v.contains("tram"))
                    || t.get("railway").is_some_and(|v| v == "tram"),
                coords,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(kv: &[(&str, &str)]) -> Tags {
        kv.iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn a_bus_lane_replaces_the_osm_lane_tags_and_counts_in_lanes() {
        let mut t = tags(&[
            ("highway", "primary"),
            ("lanes", "4"),
            ("width", "14"),
            ("bus:lanes:forward", "|designated"),
        ]);
        StreetSetup {
            way: 1,
            traffic_lanes: Some(2),
            bus_lane: Some(true),
            separated: Some(true),
            ..Default::default()
        }
        .apply(&mut t);
        assert_eq!(t.get("busway:both").map(String::as_str), Some("lane"));
        assert!(!t.contains_key("bus:lanes:forward"));
        assert_eq!(t.get("lanes").map(String::as_str), Some("4"));
        assert!(!t.contains_key("width"));
        assert!(osm_bus_lane(&t) && separated(&t));
        assert_eq!(delay_share(&t), 0.0);
    }

    #[test]
    fn main_roads_without_a_bus_lane_delay_buses() {
        let t = tags(&[("highway", "secondary")]);
        assert_eq!(delay_share(&t), MIXED_TRAFFIC_DELAY_SHARE);
        let t = tags(&[("highway", "secondary"), ("busway", "lane")]);
        assert_eq!(delay_share(&t), BUS_LANE_DELAY_SHARE);
        let t = tags(&[("highway", "residential")]);
        assert_eq!(delay_share(&t), 0.0);
    }

    #[test]
    fn no_bus_lane_and_bike_lanes() {
        let mut t = tags(&[
            ("highway", "primary"),
            ("busway", "lane"),
            ("oneway", "yes"),
        ]);
        StreetSetup {
            way: 1,
            bus_lane: Some(false),
            bike_lane: Some(true),
            tram: Some(TramShare::Mixed),
            ..Default::default()
        }
        .apply(&mut t);
        assert!(!osm_bus_lane(&t));
        assert_eq!(t.get("cycleway").map(String::as_str), Some("lane"));
        assert!(osm_bike_lane(&t));
        assert_eq!(t.get("mobsimlab:tram").map(String::as_str), Some("mixed"));
        assert_eq!(t.get("mobsimlab:setup").map(String::as_str), Some("yes"));
    }
}
