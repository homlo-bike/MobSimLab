//! The railway design document: what the planner draws and what is saved.
//!
//! Positions are metres in the project's local frame around `origin` (x east, y north, see
//! [`crate::proj`]). Ids are unique across stations, tracks and switches. Geometry, checks and
//! the map drawing are derived from this document by [`crate::design::build`].

use crate::params::{ModeParams, RailMode};
use serde::{Deserialize, Serialize};

/// Vertical level of a station or a stretch of track (ADR-0030 point 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    /// Second underground level.
    Underground2,
    /// First underground level.
    Underground,
    /// Street level (at grade).
    Street,
    /// First elevated level (viaduct).
    Elevated,
    /// Second elevated level.
    Elevated2,
}

impl Level {
    /// All levels, lowest first.
    pub const ALL: [Level; 5] = [
        Level::Underground2,
        Level::Underground,
        Level::Street,
        Level::Elevated,
        Level::Elevated2,
    ];
    /// Purpose: drawing order, 0 (lowest) to 4.
    pub fn order(self) -> u8 {
        self as u8
    }
    /// Purpose: below street level.
    pub fn underground(self) -> bool {
        self < Level::Street
    }
    /// Purpose: above street level.
    pub fn elevated(self) -> bool {
        self > Level::Street
    }
    /// Purpose: height of the rails relative to the street, metres.
    pub fn height_m(self, p: &ModeParams) -> f64 {
        match self {
            Level::Underground2 => -2.0 * p.underground_level_depth_m,
            Level::Underground => -p.underground_level_depth_m,
            Level::Street => 0.0,
            Level::Elevated => p.elevated_level_height_m,
            Level::Elevated2 => 2.0 * p.elevated_level_height_m,
        }
    }
    /// Purpose: display name.
    pub fn label(self) -> &'static str {
        match self {
            Level::Underground2 => "underground −2",
            Level::Underground => "underground −1",
            Level::Street => "street level",
            Level::Elevated => "elevated +1",
            Level::Elevated2 => "elevated +2",
        }
    }
}

/// The whole drawing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Network {
    /// Longitude and latitude of the local frame's origin, degrees.
    pub origin: [f64; 2],
    /// Rail mode; sets the design values.
    pub mode: RailMode,
    /// Project overrides of the mode's design values; the library defaults when absent.
    #[serde(default)]
    pub params: Option<ModeParams>,
    /// Longest train planned on the line, m; defaults to the platform length minus 5 m.
    #[serde(default)]
    pub train_length_m: Option<f64>,
    /// Stations.
    #[serde(default)]
    pub stations: Vec<Station>,
    /// Tracks (alignments).
    #[serde(default)]
    pub tracks: Vec<Track>,
    /// Switches and crossovers.
    #[serde(default)]
    pub switches: Vec<Switch>,
    /// The signal plan, once generated and edited by the planner; `None` until then (the
    /// topology export then generates one).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signals: Option<Vec<crate::signal::Signal>>,
    /// Slips the planner put into diamond crossings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub slips: Vec<crate::slip::Slip>,
}

impl Network {
    /// Purpose: empty drawing for a mode around an origin.
    pub fn new(mode: RailMode, origin: [f64; 2]) -> Self {
        Self {
            origin,
            mode,
            params: None,
            train_length_m: None,
            stations: vec![],
            tracks: vec![],
            switches: vec![],
            signals: None,
            slips: vec![],
        }
    }
    /// Purpose: the next free id.
    pub fn next_id(&self) -> u32 {
        let s = self.stations.iter().map(|o| o.id);
        let t = self.tracks.iter().map(|o| o.id);
        let w = self.switches.iter().map(|o| o.id);
        s.chain(t).chain(w).max().unwrap_or(0) + 1
    }
}

/// A station: platforms with one track per platform edge (ADR-0030 point 1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Station {
    /// Id.
    pub id: u32,
    /// Name.
    pub name: String,
    /// Centre, m east.
    pub x: f64,
    /// Centre, m north.
    pub y: f64,
    /// Direction of the platforms, degrees counter-clockwise from east.
    #[serde(default)]
    pub rotation_deg: f64,
    /// Level.
    pub level: Level,
    /// Side platforms, 0 to 2 (one track each).
    pub side_platforms: u8,
    /// Island platforms, 0 to 3 (two tracks each).
    pub island_platforms: u8,
    /// Platform length, m.
    pub platform_length_m: f64,
    /// Railway system of the station; `None` is the network's mode. Stations of different modes
    /// are separate infrastructure in one drawing (a tram stop next to a metro station).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<RailMode>,
}

/// Where a track begins or ends.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Anchor {
    /// A free point (buffer stop, or not yet connected).
    Free {
        /// m east.
        x: f64,
        /// m north.
        y: f64,
        /// Level at this point; the track's level when absent.
        #[serde(default)]
        level: Option<Level>,
    },
    /// A station connection point.
    Station {
        /// Station id.
        station: u32,
        /// 0 = the end behind the platforms' start, 1 = the end ahead (in the rotation direction).
        end: u8,
        /// Station track indices, right to left looking along the rotation: one, or two adjacent.
        tracks: Vec<usize>,
    },
    /// The diverging leg of a turnout or double junction.
    Switch {
        /// Switch id.
        switch: u32,
        /// Leg index (0 for the only leg).
        #[serde(default)]
        leg: usize,
    },
}

/// Electrification of a track.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Power {
    /// The mode's default supply system.
    #[default]
    Auto,
    /// Overhead line.
    Overhead,
    /// Third rail.
    ThirdRail,
    /// Not electrified.
    None,
}

/// What a track is used for (ADR-0030 point 10).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackUse {
    /// Running track that trains are routed over.
    #[default]
    Running,
    /// Stabling siding or depot track.
    Storage,
}

/// Track bed at street level.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Bed {
    /// Embedded for tram and light rail, ballast otherwise.
    #[default]
    Auto,
    /// Ballast and sleepers.
    Ballast,
    /// Embedded in the street surface (no cant).
    Embedded,
}

/// Running direction of one track relative to the drawing direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    /// From start to end.
    Forward,
    /// From end to start.
    Back,
    /// Both ways.
    Both,
}

/// An intersection point the planner clicked; a curve is fitted round it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pi {
    /// m east.
    pub x: f64,
    /// m north.
    pub y: f64,
    /// Curve radius; the mode's recommended radius when absent.
    #[serde(default)]
    pub radius_m: Option<f64>,
    /// Level from this point on; the track's level when absent.
    #[serde(default)]
    pub level: Option<Level>,
}

/// A track alignment between two anchors, single or double track (ADR-0030 point 4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    /// Id.
    pub id: u32,
    /// Optional name.
    #[serde(default)]
    pub name: String,
    /// Start.
    pub start: Anchor,
    /// End; open while drawing.
    #[serde(default)]
    pub end: Option<Anchor>,
    /// Intersection points between the ends.
    #[serde(default)]
    pub points: Vec<Pi>,
    /// 1 or 2 tracks.
    pub tracks: u8,
    /// Default level of the points.
    pub level: Level,
    /// Electrification.
    #[serde(default)]
    pub power: Power,
    /// Running or storage.
    #[serde(default, rename = "use")]
    pub usage: TrackUse,
    /// Track bed at street level.
    #[serde(default)]
    pub bed: Bed,
    /// Straight run out of the start anchor before the first curve, m.
    #[serde(default = "default_lead")]
    pub lead_start_m: f64,
    /// Straight run into the end anchor after the last curve, m.
    #[serde(default = "default_lead")]
    pub lead_end_m: f64,
    /// Radius of the curve after the start lead.
    #[serde(default)]
    pub radius_start_m: Option<f64>,
    /// Radius of the curve before the end lead.
    #[serde(default)]
    pub radius_end_m: Option<f64>,
    /// Running direction per track (left track first on double track); right-hand running when empty.
    #[serde(default)]
    pub directions: Vec<Direction>,
    /// Railway system of the track; `None` takes the mode of what it starts from (station or
    /// switch), else the network's mode. Tracks of different modes may cross on one level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<RailMode>,
}

fn default_lead() -> f64 {
    30.0
}

/// Kind of a switch placed on a track.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SwitchKind {
    /// One turnout; the leg starts a single track.
    Turnout,
    /// Double junction on double track: two turnouts and a diamond; the leg starts a double track.
    DoubleJunction,
    /// Crossover between the two tracks of a double track.
    Crossover,
    /// Scissors crossover: two crossovers and a diamond.
    Scissors,
}

/// A catalogue switch placed on a track at a chainage (ADR-0030 point 5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Switch {
    /// Id.
    pub id: u32,
    /// Kind.
    pub kind: SwitchKind,
    /// The track (alignment) it sits on.
    pub track: u32,
    /// Chainage of the switch start (blade tip of the first turnout), m.
    pub s: f64,
    /// Turnout id from the catalogue (crossovers are built from two of them).
    pub element: String,
    /// Side the diverging track leaves to: 1 left, −1 right (looking along the track).
    #[serde(default = "one")]
    pub side: i8,
    /// 1 when the switch faces increasing chainage, −1 when it faces back.
    #[serde(default = "one")]
    pub direction: i8,
    /// Crossovers: mirror (from the left track to the right one instead).
    #[serde(default)]
    pub flip: bool,
}

fn one() -> i8 {
    1
}
