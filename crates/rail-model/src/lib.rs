//! MobSimLab railway operations model (ADR-0032 §1).
//!
//! Compiles a network description (tracks, switches, buffer stops, signals,
//! detection sections, stations and platform edges) into what the planner and
//! the kernel share:
//!
//! - tracks split into pieces at route signals, grouped into **train detection
//!   sections** (switch areas and diamond crossings, also between railway
//!   systems, are one section that only one train may occupy);
//! - the **route table**: every route from a main, block or shunting signal to
//!   the next one in the same direction, with the switch positions it needs, its
//!   **overlap** and the list of **conflicting routes**;
//! - **station groups**: stations with the same normalised name are one station
//!   in several parts;
//! - speed and gradient profiles and platform stopping points along any path.
#![warn(missing_docs)]

pub mod examples;
pub mod model;
pub mod spec;
pub mod topology;

pub use model::{
    normalise_name, GroupId, LevelCrossing, Model, Neighbour, Piece, PieceId, Platform, PlatformId,
    ProfileSegment, Route, RouteExit, RouteId, Signal, SignalAt, SignalId, Station, StationGroup,
    StationId, Step, Successor, Switch, SwitchId, Tds, TdsId,
};
pub use spec::{
    DetectionSpec, Dir, Directions, End, InfraSpec, LevelCrossingSpec, NodeSpec, PlatformSpec,
    Range, SignalKind, SignalSpec, StationSpec, SwitchPosition, TrackEnd, TrackSpec, TrackUse,
    TrainProtection,
};
