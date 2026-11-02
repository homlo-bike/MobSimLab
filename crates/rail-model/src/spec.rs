//! Input description of a railway network for operations (ADR-0032 §1).
//!
//! This is the shape the railway design tool's topology export is compiled
//! from. All units are SI: metres, metres per second, seconds. Chainage runs
//! from end `A` (0 m) to end `B` (track length) of each track.

use serde::{Deserialize, Serialize};

/// One end of a track.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum End {
    /// The end at chainage 0.
    A,
    /// The end at chainage = track length.
    B,
}

/// Direction of travel along a track.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Dir {
    /// From end `A` to end `B` (increasing chainage).
    Up,
    /// From end `B` to end `A` (decreasing chainage).
    Down,
}

impl Dir {
    /// Purpose: the opposite direction.
    pub fn reverse(self) -> Dir {
        match self {
            Dir::Up => Dir::Down,
            Dir::Down => Dir::Up,
        }
    }
    /// Purpose: the end a train leaves a track by when travelling in this direction.
    pub fn exit_end(self) -> End {
        match self {
            Dir::Up => End::B,
            Dir::Down => End::A,
        }
    }
    /// Purpose: the direction of travel of a train that enters a track at `end`.
    pub fn entering_at(end: End) -> Dir {
        match end {
            End::A => Dir::Up,
            End::B => Dir::Down,
        }
    }
}

/// A reference to one end of a track by its stable id.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TrackEnd {
    /// Stable track id.
    pub track: String,
    /// Which end.
    pub end: End,
}

/// A value that holds on a chainage range of a track.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Range {
    /// Start chainage in metres.
    pub from_m: f64,
    /// End chainage in metres (> `from_m`).
    pub to_m: f64,
    /// The value on this range.
    pub value: f64,
}

/// Which directions trains may run on a track.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Directions {
    /// Both directions (bidirectional signalling or single track).
    #[default]
    Both,
    /// Only from `A` to `B`.
    UpOnly,
    /// Only from `B` to `A`.
    DownOnly,
}

/// What a track is used for (ADR-0030 point 10).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrackUse {
    /// Part of routes that trains run over.
    #[default]
    Running,
    /// Stabling siding or depot track.
    Storage,
}

/// A piece of track between two nodes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TrackSpec {
    /// Stable id from the design tool.
    pub id: String,
    /// Length in metres (> 0).
    pub length_m: f64,
    /// Line speed in m/s (> 0).
    pub line_speed_mps: f64,
    /// Lower speed limits on parts of the track (curves, structures), m/s.
    #[serde(default)]
    pub speed_ranges: Vec<Range>,
    /// Gradient ranges as rise over run in the `Up` direction (0.01 = 1 % up).
    #[serde(default)]
    pub gradient_ranges: Vec<Range>,
    /// Allowed directions.
    #[serde(default)]
    pub directions: Directions,
    /// Running or storage track.
    #[serde(default)]
    pub usage: TrackUse,
    /// Railway system (mode) of the track, for example `metro` or `regional`.
    #[serde(default)]
    pub mode: Option<String>,
}

/// Position of a switch.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum SwitchPosition {
    /// The common leg connects to the straight (main) leg.
    Straight,
    /// The common leg connects to the diverging leg.
    Diverging,
}

/// How track ends meet.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum NodeSpec {
    /// Two track ends joined (detection boundary, signal joint or plain joint).
    Link {
        /// One end.
        a: TrackEnd,
        /// The other end.
        b: TrackEnd,
    },
    /// A turnout: the common track end connects to one of two leg track ends.
    Switch {
        /// Stable switch id.
        id: String,
        /// The end of the track on the toe (common) side.
        common: TrackEnd,
        /// The end of the track on the straight leg.
        straight: TrackEnd,
        /// The end of the track on the diverging leg.
        diverging: TrackEnd,
        /// Permitted speed through the diverging leg, m/s.
        diverging_speed_mps: f64,
        /// Time to throw and lock the switch, seconds.
        throw_time_s: f64,
    },
    /// The end of the line. Trains stop before it.
    BufferStop {
        /// Stable id.
        id: String,
        /// The track end it closes.
        at: TrackEnd,
    },
}

/// Signal types (07 §4.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignalKind {
    /// Main signal: routes start and end at main signals.
    Main,
    /// Automatic block signal on plain line; also a route boundary.
    Block,
    /// Shunting signal (depot and siding moves).
    Shunting,
    /// Distant signal: announces the next main signal; not a route boundary.
    Distant,
}

/// A signal at a chainage on a track, facing trains that travel in `facing`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SignalSpec {
    /// Stable id.
    pub id: String,
    /// Track it stands on.
    pub track: String,
    /// Chainage in metres.
    pub position_m: f64,
    /// Direction of the trains it applies to.
    pub facing: Dir,
    /// Signal type.
    pub kind: SignalKind,
    /// Overlap beyond this signal in metres; the network default if absent.
    #[serde(default)]
    pub overlap_m: Option<f64>,
}

/// Several tracks that form one train detection section, for example the
/// three track stubs of a switch up to its fouling points, or the two tracks
/// of a diamond crossing (also between railway systems).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DetectionSpec {
    /// Stable id of the section.
    pub id: String,
    /// The tracks it covers. They must not carry route signals mid-track.
    pub tracks: Vec<String>,
}

/// A station, or one part of a station.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StationSpec {
    /// Stable id.
    pub id: String,
    /// Name as the planner sees it. Stations with the same normalised name form one group.
    pub name: String,
    /// Explicit group key, to merge differently named parts or split same-named ones.
    #[serde(default)]
    pub group: Option<String>,
}

/// A platform edge along a track.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlatformSpec {
    /// Stable platform edge id.
    pub id: String,
    /// Station (part) id.
    pub station: String,
    /// Label passengers see, for example "3".
    #[serde(default)]
    pub label: Option<String>,
    /// Track along the platform edge.
    pub track: String,
    /// Start chainage in metres.
    pub from_m: f64,
    /// End chainage in metres.
    pub to_m: f64,
}

/// Where a track crosses a street on one level (a level crossing). The railway
/// owns it: the street is closed before a train arrives and the train's route
/// over it is cleared only once the street is closed (ADR-0007, 07 §5).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LevelCrossingSpec {
    /// Stable id.
    pub id: String,
    /// Track it is on.
    pub track: String,
    /// Chainage of the crossing point on that track, m.
    pub position_m: f64,
    /// Half length of the track stretch the street covers, m.
    pub rail_zone_m: f64,
    /// Distance before the crossing at which an approaching train closes the street, m.
    pub approach_m: f64,
    /// Warning time before the train arrives, s.
    pub warning_time_s: f64,
    /// Protection: `barriers` or `traffic_signals`.
    pub protection: String,
    /// OpenStreetMap way id of the street.
    pub street_way: i64,
    /// Street name.
    pub street_name: String,
    /// Distance from the crossing point to each road stop line, m. Road vehicles never stop inside it.
    pub keep_clear_m: f64,
    /// Whether buses use the street.
    pub bus: bool,
}

/// The whole network as the operations model needs it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct InfraSpec {
    /// Tracks.
    pub tracks: Vec<TrackSpec>,
    /// Links, switches and buffer stops.
    pub nodes: Vec<NodeSpec>,
    /// Signals.
    pub signals: Vec<SignalSpec>,
    /// Detection sections spanning several tracks.
    #[serde(default)]
    pub detection: Vec<DetectionSpec>,
    /// Stations and station parts.
    #[serde(default)]
    pub stations: Vec<StationSpec>,
    /// Platform edges.
    #[serde(default)]
    pub platforms: Vec<PlatformSpec>,
    /// Level crossings with streets.
    #[serde(default)]
    pub level_crossings: Vec<LevelCrossingSpec>,
    /// Overlap used when a signal gives none, metres (`signalling.overlap_*`).
    #[serde(default = "default_overlap")]
    pub default_overlap_m: f64,
}

fn default_overlap() -> f64 {
    200.0
}
