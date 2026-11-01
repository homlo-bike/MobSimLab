//! Journeys as the planner returns them: legs with times, and the time split into its parts.

use serde::{Deserialize, Serialize};

/// A point on a journey: the origin, the destination or a stop.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Place {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_code: Option<String>,
    pub lon: f64,
    pub lat: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WalkKind {
    /// From the origin to the first stop.
    Access,
    /// Between two stops at a change.
    Transfer,
    /// From the last stop to the destination.
    Egress,
    /// The whole journey on foot.
    Direct,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WaitKind {
    /// At the first stop, for the first vehicle.
    Initial,
    /// At a change, for the connecting vehicle.
    Transfer,
}

/// One part of a journey.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Leg {
    Walk {
        kind: WalkKind,
        from: Place,
        to: Place,
        start_s: u32,
        end_s: u32,
        distance_m: f64,
    },
    Wait {
        kind: WaitKind,
        at: Place,
        start_s: u32,
        end_s: u32,
    },
    Ride {
        route_id: String,
        route_short_name: String,
        mode: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        route_color: Option<String>,
        trip_id: String,
        from: Place,
        to: Place,
        start_s: u32,
        end_s: u32,
        /// Stops passed between boarding and alighting (calls, not pass-throughs).
        intermediate_stops: u32,
        /// Boarded over a guaranteed (timed) connection.
        guaranteed: bool,
    },
}

impl Leg {
    pub fn start_s(&self) -> u32 {
        match self {
            Leg::Walk { start_s, .. } | Leg::Wait { start_s, .. } | Leg::Ride { start_s, .. } => {
                *start_s
            }
        }
    }
    pub fn end_s(&self) -> u32 {
        match self {
            Leg::Walk { end_s, .. } | Leg::Wait { end_s, .. } | Leg::Ride { end_s, .. } => *end_s,
        }
    }
}

/// Where the time of a journey goes. The parts add up to `Journey::total_s`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Breakdown {
    /// Walking from the origin and to the destination (or all the way).
    pub walk_s: u32,
    /// Waiting at the first stop for the first vehicle, when leaving at the asked time.
    pub wait_s: u32,
    /// On board, including dwell at intermediate stops.
    pub in_vehicle_s: u32,
    /// Walking between stops at changes.
    pub transfer_walk_s: u32,
    /// Waiting for the connecting vehicle at changes (including the minimum change time at one stop).
    pub transfer_wait_s: u32,
    /// Arrive-by only: time between arriving and the asked arrival time.
    pub early_arrival_s: u32,
}

impl Breakdown {
    pub fn total(&self) -> u32 {
        self.walk_s
            + self.wait_s
            + self.in_vehicle_s
            + self.transfer_walk_s
            + self.transfer_wait_s
            + self.early_arrival_s
    }
}

/// One way from A to B.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Journey {
    /// The asked time: departure for depart-at, arrival for arrive-by.
    pub query_s: u32,
    /// When the journey starts at the origin.
    pub depart_s: u32,
    /// Latest time to leave the origin and still make the same vehicles (no wait at the first stop).
    pub leave_s: u32,
    pub arrive_s: u32,
    /// Depart-at: arrival minus the asked time. Arrive-by: the asked time minus the departure.
    pub total_s: u32,
    /// Door to door when leaving at `leave_s`.
    pub door_to_door_s: u32,
    pub rides: u32,
    pub transfers: u32,
    pub walk_m: f64,
    pub breakdown: Breakdown,
    pub legs: Vec<Leg>,
}

impl Journey {
    /// Purpose: fill times, breakdown and totals from the legs of a journey starting at `depart_s`.
    pub(crate) fn from_legs(query_s: u32, depart_s: u32, legs: Vec<Leg>) -> Journey {
        let mut b = Breakdown::default();
        let mut walk_m = 0.0;
        let mut rides = 0;
        for l in &legs {
            let d = l.end_s() - l.start_s();
            match l {
                Leg::Walk {
                    kind, distance_m, ..
                } => {
                    walk_m += distance_m;
                    match kind {
                        WalkKind::Transfer => b.transfer_walk_s += d,
                        _ => b.walk_s += d,
                    }
                }
                Leg::Wait {
                    kind: WaitKind::Initial,
                    ..
                } => b.wait_s += d,
                Leg::Wait {
                    kind: WaitKind::Transfer,
                    ..
                } => b.transfer_wait_s += d,
                Leg::Ride { .. } => {
                    b.in_vehicle_s += d;
                    rides += 1;
                }
            }
        }
        let arrive_s = legs.last().map_or(depart_s, Leg::end_s);
        let leave_s = match legs.iter().position(|l| matches!(l, Leg::Ride { .. })) {
            Some(i) => {
                let walked: u32 = legs[..i]
                    .iter()
                    .filter(|l| matches!(l, Leg::Walk { .. }))
                    .map(|l| l.end_s() - l.start_s())
                    .sum();
                legs[i].start_s() - walked
            }
            None => depart_s,
        };
        Journey {
            query_s,
            depart_s,
            leave_s,
            arrive_s,
            total_s: arrive_s - depart_s,
            door_to_door_s: arrive_s - leave_s,
            rides,
            transfers: rides.saturating_sub(1),
            walk_m,
            breakdown: b,
            legs,
        }
    }
}
