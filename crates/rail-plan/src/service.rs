//! Service lines drawn in the railway editor (ADR-0032 §2, ADR-0034): the planner picks the stations
//! a line stops at, a train from the vehicle catalogue and the headways of the day; this module turns
//! them into [`LineSpec`]s, plans the day on the design's topology export and publishes the result in
//! the journey planner's timetable form.
//!
//! The catalogue gives a train's length, top speed, power and capacity, but rarely its tractive effort,
//! running resistance or braking. Those come from the mode's assumptions (`mode.acceleration_ms2`,
//! `mode.service_decel_ms2`, see `assumptions/DEFAULTS.md`) and the estimates in [`train_params`].

use engine_msg::{msg, Msg};
use journey_planner::timetable::Timetable;
use rail_dynamics::TrainParams;
use rail_model::topology::{import_json, ImportOptions, StorageRole};
use rail_model::{Model, TrackUse};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::path::{departure_routes, find_path, Place};
use crate::{
    journey_timetable, plan, Band, Call, Issue, LineSpec, Pick, PlanParams, RouteInfo, RunKind,
};

/// A train type from the vehicle catalogue, as the editor sends it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ServiceVehicle {
    /// Catalogue id (file name without `.json`).
    pub id: String,
    /// Display name.
    pub name: String,
    /// Length of one unit, m.
    pub length_m: f64,
    /// Top speed, km/h.
    pub top_speed_kmh: f64,
    /// Traction power of one unit, kW, when the catalogue gives it.
    #[serde(default)]
    pub power_kw: Option<f64>,
    /// Empty mass of one unit, t, when the catalogue gives it.
    #[serde(default)]
    pub empty_mass_t: Option<f64>,
    /// Passengers one unit carries (seats and standing places at the planning density).
    #[serde(default)]
    pub capacity: f64,
}

/// One service line of the railway editor.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ServiceLine {
    /// Stable id; trip ids start with it.
    pub id: String,
    /// Public name (short name in the journey planner).
    pub name: String,
    /// Colour without `#`.
    #[serde(default)]
    pub color: Option<String>,
    /// Station part ids of the topology export (`st<id>`), first terminal to last.
    pub stations: Vec<String>,
    /// The train type.
    pub vehicle: ServiceVehicle,
    /// Units coupled per train (≥ 1).
    #[serde(default = "one")]
    pub units: u32,
    /// Rail mode id for the assumptions (`metro`, `regional_rail`…).
    pub mode: String,
    /// First departure from the first terminal, s after midnight.
    pub first_s: f64,
    /// No departure at or after this time, s after midnight (may pass 24:00).
    pub last_s: f64,
    /// Headway in the peaks, s.
    pub peak_headway_s: f64,
    /// Headway outside the peaks, s.
    pub offpeak_headway_s: f64,
    /// Peak windows `[from, to)`, s after midnight.
    #[serde(default = "default_peaks")]
    pub peaks: Vec<[f64; 2]>,
    /// Dwell at intermediate stops, s; the mode's dwell when absent.
    #[serde(default)]
    pub dwell_s: Option<f64>,
    /// Minimum turn-back in the terminal platform, s; the mode's layover when absent.
    #[serde(default)]
    pub turnback_s: Option<f64>,
    /// Starting acceleration, m/s² (`mode.acceleration_ms2`); the mode's when absent.
    #[serde(default)]
    pub accel_ms2: Option<f64>,
    /// Service braking rate, m/s² (`mode.service_braking_ms2`); the mode's when absent.
    #[serde(default)]
    pub decel_ms2: Option<f64>,
    /// Running-time supplement share (`timetable.recovery_share`); 5 % when absent.
    #[serde(default)]
    pub supplement_share: Option<f64>,
}

fn one() -> u32 {
    1
}

fn default_peaks() -> Vec<[f64; 2]> {
    vec![[7.0 * 3600.0, 9.0 * 3600.0], [16.0 * 3600.0, 19.0 * 3600.0]]
}

/// What the editor shows for one line after publishing.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LineReport {
    /// Line id.
    pub id: String,
    /// Passenger trips placed, both directions.
    pub trips: usize,
    /// Running time first terminal → last of the first outbound trip, s.
    pub outbound_s: Option<f64>,
    /// Running time of the first return trip, s.
    pub return_s: Option<f64>,
    /// Trains the line needs (distinct vehicles of its trips).
    pub trains: usize,
    /// What went wrong or was changed, in words (English).
    pub issues: Vec<String>,
    /// The same as messages, one per entry of `issues`, for the app to show in the user's language.
    pub issue_msgs: Vec<Msg>,
    /// The stations of the first outbound trip with their distance from the first terminal along the
    /// track, for the time-distance graph. Empty when no outbound trip runs.
    pub stations: Vec<StationKm>,
    /// Trips moved from their clock-face departure to keep clear of other trains.
    pub shifted: Vec<ShiftedTrip>,
    /// Trips that could not run, with the reason and, for a conflict, the train in the way.
    pub unplaced: Vec<UnplacedTrip>,
}

/// A station of a line and its distance along the track (time-distance graph).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StationKm {
    /// The journey planner's station id (`group:<key>`, the stops' `parent_station`).
    pub station_id: String,
    /// Station name.
    pub name: String,
    /// Distance from the first terminal along the track, km.
    pub km: f64,
}

/// A departure the planner moved to keep clear of other trains.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ShiftedTrip {
    /// Trip id.
    pub trip: String,
    /// By how much, s (positive = later).
    pub by_s: f64,
}

/// A trip the planner could not run.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct UnplacedTrip {
    /// Trip id.
    pub trip: String,
    /// Why, in words (English).
    pub reason: String,
    /// The same as a message, for the app to show in the user's language.
    pub reason_msg: Msg,
    /// The trip in the way, for a conflict.
    pub blocked_by: Option<String>,
}

/// The published timetable and the per-line report.
#[derive(Clone, Debug, Serialize)]
pub struct ServicePublication {
    /// The journey planner's timetable (`contracts/published-timetable.schema.json`).
    pub timetable: Timetable,
    /// One report per line, in input order.
    pub lines: Vec<LineReport>,
    /// Notes from the topology import and the stop placement, in English.
    pub notes: Vec<String>,
    /// The same notes as keys and values, for the app to show in the user's language.
    pub note_msgs: Vec<Msg>,
    /// Trains of each line per clock hour on each topology section, for the noise map's
    /// timetabled input (ADR-0038 step N3).
    pub section_trains: Vec<SectionTrains>,
    /// The day's vehicle blocks (vehicle schedules): each train's runs in order, from its first
    /// pull-out or trip to its last trip or pull-in. Sorted by the first departure.
    pub blocks: Vec<VehicleBlock>,
}

/// One run of a vehicle block.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BlockRun {
    /// `service` (a passenger trip), `pull_out` (from stabling) or `pull_in` (to stabling).
    pub kind: String,
    /// Line id.
    pub line: String,
    /// Trip id (the journey planner's trip id for a passenger trip).
    pub trip: String,
    /// 0 = outbound (the line's station order), 1 = return.
    pub direction: u8,
    /// Station the run starts at; None for a storage track.
    pub from: Option<String>,
    /// Station the run ends at; None for a storage track.
    pub to: Option<String>,
    /// Departure, s after midnight.
    pub depart_s: f64,
    /// Arrival, s after midnight.
    pub arrive_s: f64,
    /// Distance along the track, km.
    pub km: f64,
}

/// The runs one train makes in a day (a vehicle block).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct VehicleBlock {
    /// Train number in the plan.
    pub vehicle: usize,
    /// Runs in time order.
    pub runs: Vec<BlockRun>,
}

/// Settings of a publication the project can change.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PublishOptions {
    /// Longest a train waits in a terminal for its next trip before it goes to stabling instead, s;
    /// the planner's default when absent.
    #[serde(default)]
    pub max_idle_s: Option<f64>,
}

/// How many trains of one line pass one section of the topology export in each clock hour.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SectionTrains {
    /// Section id of the topology export (`t{track}.{line}.{piece}`, `s…`, `w…`).
    pub section: String,
    /// Service line id.
    pub line: String,
    /// Trains entering the section in each hour 0–23 of the clock, both directions together;
    /// trips after midnight count in the early hours.
    pub hours: [u32; 24],
}

/// Mode values from the assumption library (central values, `assumptions/DEFAULTS.md`) and estimates.
struct ModeValues {
    /// `mode.acceleration_ms2`.
    accel: f64,
    /// `mode.service_decel_ms2`.
    decel: f64,
    /// `mode.dwell_s`.
    dwell_s: f64,
    /// Empty mass per metre of train when the catalogue has none, t/m (educated guess from
    /// catalogue vehicles that give their mass).
    tare_t_per_m: f64,
    /// Minimum turn-back, s (`timetable.layover_min`, 3 min for metro-like modes).
    turnback_s: f64,
}

fn mode_values(mode: &str) -> ModeValues {
    let v = |accel, decel, dwell_s, tare_t_per_m, turnback_s| ModeValues {
        accel,
        decel,
        dwell_s,
        tare_t_per_m,
        turnback_s,
    };
    match mode {
        "tram" => v(1.2, 1.3, 25.0, 1.15, 180.0),
        "light_rail" => v(1.1, 1.1, 30.0, 1.3, 180.0),
        "metro" => v(1.1, 1.1, 30.0, 1.5, 180.0),
        "commuter_rail" => v(0.9, 0.9, 45.0, 1.7, 300.0),
        "regional_rail" => v(0.8, 0.8, 60.0, 1.7, 300.0),
        "long_distance_rail" => v(0.5, 0.7, 120.0, 2.0, 600.0),
        "high_speed_rail" => v(0.4, 0.6, 120.0, 2.1, 600.0),
        _ => v(0.9, 0.9, 45.0, 1.7, 300.0),
    }
}

/// Purpose: the rank of a rail mode's trains where lines share track ([`LineSpec::priority`]):
/// high-speed over long-distance over regional over commuter trains, as on German and French
/// main lines, where a regional train waits in a loop for the ICE or TGV. Urban modes run on
/// their own track and do not overtake.
/// Inputs: the mode id. Output: the rank, 0 for modes that never overtake.
pub fn mode_priority(mode: &str) -> u8 {
    match mode {
        "high_speed_rail" => 4,
        "long_distance_rail" => 3,
        "regional_rail" => 2,
        "commuter_rail" => 1,
        _ => 0,
    }
}

/// Mass of one passenger with luggage for the planning load, kg.
const PASSENGER_KG: f64 = 75.0;
/// Share of the capacity on board for running times (a well-used train, not a crush load).
const PLANNING_LOAD_SHARE: f64 = 0.5;

/// Purpose: running-time parameters of a train of `units` catalogue units.
/// The mass is the empty mass (catalogue, else `tare_t_per_m` × length) plus half the capacity at
/// 75 kg; the starting tractive effort gives the mode's acceleration; the power is the catalogue's,
/// else what holds that effort up to 40 % of the top speed. Running resistance follows the Davis form
/// with educated-guess coefficients per tonne and a front-and-length air term.
pub fn train_params(v: &ServiceVehicle, units: u32, mode: &str) -> TrainParams {
    train_params_with(v, units, mode, None, None)
}

/// Purpose: as [`train_params`], with the project's acceleration and service braking rate (m/s²)
/// in place of the mode's where given.
pub fn train_params_with(
    v: &ServiceVehicle,
    units: u32,
    mode: &str,
    accel_ms2: Option<f64>,
    decel_ms2: Option<f64>,
) -> TrainParams {
    let mut mv = mode_values(mode);
    let ok = |x: &f64| x.is_finite() && *x > 0.0;
    if let Some(a) = accel_ms2.filter(ok) {
        mv.accel = a;
    }
    if let Some(d) = decel_ms2.filter(ok) {
        mv.decel = d;
    }
    let n = f64::from(units.max(1));
    let length_m = v.length_m.max(5.0) * n;
    let empty_t = v
        .empty_mass_t
        .unwrap_or(v.length_m.max(5.0) * mv.tare_t_per_m)
        * n;
    let load_t = v.capacity.max(0.0) * n * PLANNING_LOAD_SHARE * PASSENGER_KG / 1000.0;
    let mass_kg = (empty_t + load_t) * 1000.0;
    let rot = 1.08;
    let max_speed_mps = (v.top_speed_kmh.max(10.0)) / 3.6;
    let max_tractive_effort_n = mass_kg * rot * mv.accel;
    let power_w = v
        .power_kw
        .filter(|p| *p > 0.0)
        .map_or(max_tractive_effort_n * 0.4 * max_speed_mps, |p| {
            p * 1000.0 * n
        });
    let mass_t = mass_kg / 1000.0;
    TrainParams {
        length_m,
        mass_kg,
        rotating_mass_factor: rot,
        max_tractive_effort_n,
        power_w,
        davis_a_n: 12.0 * mass_t,
        davis_b_n_per_mps: 0.15 * mass_t,
        davis_c_n_per_mps2: 2.5 + 0.03 * length_m,
        service_decel_mps2: mv.decel,
        max_speed_mps,
    }
}

/// Purpose: the headway bands of a service day, with the gradual start and finish a railway runs:
/// the first half hour at twice the off-peak headway, then one and a half times it, then off-peak;
/// in the hour before each peak, two steps from the off-peak towards the peak headway so the peak
/// headway runs from the peak's start; in the hour after it, two steps back; and the day ends in
/// reverse of how it started, while the trains go back to the depot. Ramps share an off-peak
/// stretch shorter than two hours. Headways are rounded to whole minutes.
/// Inputs: the line. Output: the bands, in time order.
pub fn service_bands(l: &ServiceLine) -> Vec<Band> {
    let peak = l.peak_headway_s.max(60.0);
    let off = l.offpeak_headway_s.max(60.0);
    // The plain bands: (from, to, peak?).
    let mut plain: Vec<(f64, f64, bool)> = Vec::new();
    let mut t = l.first_s;
    let mut peaks = l.peaks.clone();
    peaks.sort_by(|a, b| a[0].total_cmp(&b[0]));
    for [a, b] in peaks {
        let from = a.max(l.first_s);
        let to = b.min(l.last_s);
        if to <= from || to <= t {
            continue;
        }
        let from = from.max(t);
        if from > t {
            plain.push((t, from, false));
        }
        plain.push((from, to, true));
        t = to;
    }
    if l.last_s > t {
        plain.push((t, l.last_s, false));
    }
    let round = |h: f64| ((h / 60.0).round() * 60.0).max(60.0);
    let mut out: Vec<Band> = Vec::new();
    let mut push = |from_s: f64, to_s: f64, h: f64| {
        if to_s - from_s < 1.0 {
            return;
        }
        let headway_s = round(h);
        match out.last_mut() {
            Some(b) if (b.headway_s - headway_s).abs() < 1e-6 && (b.to_s - from_s).abs() < 1e-6 => {
                b.to_s = to_s
            }
            _ => out.push(Band {
                from_s,
                to_s,
                headway_s,
            }),
        }
    };
    let ramp_peak = (off - peak).abs() >= 60.0;
    for (k, &(from, to, is_peak)) in plain.iter().enumerate() {
        if is_peak {
            push(from, to, peak);
            continue;
        }
        let r = (RAMP_S).min((to - from) / 2.0);
        // The ramp at the start of this off-peak stretch: the day's start or after a peak.
        let (a, b) = if k == 0 {
            (2.0 * off, 1.5 * off)
        } else if ramp_peak {
            (peak + (off - peak) / 3.0, peak + 2.0 * (off - peak) / 3.0)
        } else {
            (off, off)
        };
        // The ramp at its end: before a peak, or the day's end.
        let (c, d) = if k + 1 == plain.len() {
            (1.5 * off, 2.0 * off)
        } else if ramp_peak {
            (off + (peak - off) / 3.0, off + 2.0 * (peak - off) / 3.0)
        } else {
            (off, off)
        };
        push(from, from + r / 2.0, a);
        push(from + r / 2.0, from + r, b);
        push(from + r, to - r, off);
        push(to - r, to - r / 2.0, c);
        push(to - r / 2.0, to, d);
    }
    out
}

/// How long a gradual start, finish or change to and from a peak takes, s.
const RAMP_S: f64 = 3600.0;

/// Purpose: the planner's line from an editor line.
/// Inputs: the line and the compiled model (for the storage tracks and terminal platforms).
/// Trains stable on the design's storage tracks; without any, in the terminal platforms overnight.
pub fn line_spec(l: &ServiceLine, m: &Model) -> LineSpec {
    line_spec_with_roles(l, m, &BTreeMap::new())
}

/// Purpose: [`line_spec`] with what the drawing says each storage track is for: an end-station
/// siding marked for layover only holds no train overnight, so trains come to it from an
/// overnight track before they are needed (Homlo, Damascus test). Tracks without a role hold
/// trains overnight and between trips, as before.
/// Inputs: the line, the model and the roles by track id. Output: the planner's line.
pub fn line_spec_with_roles(
    l: &ServiceLine,
    m: &Model,
    roles: &BTreeMap<String, StorageRole>,
) -> LineSpec {
    let mv = mode_values(&l.mode);
    let layover: Vec<String> = roles
        .iter()
        .filter(|(_, r)| **r == StorageRole::Layover)
        .map(|(t, _)| t.clone())
        .filter(|t| m.track(t).is_some())
        .collect();
    let mut stabling: Vec<String> = m
        .tracks
        .iter()
        .filter(|t| t.usage == TrackUse::Storage)
        .map(|t| t.id.clone())
        .collect();
    let ends = [l.stations.first(), l.stations.last()];
    for st in m
        .stations
        .iter()
        .filter(|s| ends.iter().any(|e| e.is_some_and(|e| *e == s.id)))
    {
        for &p in &st.platforms {
            let id = m.tracks[m.platforms[p as usize].track].id.clone();
            if !stabling.contains(&id) {
                stabling.push(id);
            }
        }
    }
    LineSpec {
        id: l.id.clone(),
        name: l.name.clone(),
        calls: l
            .stations
            .iter()
            .map(|s| Call {
                pick: Pick::Station(s.clone()),
                stop: true,
                dwell_s: None,
            })
            .collect(),
        train: train_params_with(&l.vehicle, l.units, &l.mode, l.accel_ms2, l.decel_ms2),
        dwell_s: l.dwell_s.unwrap_or(mv.dwell_s),
        turnback_s: l.turnback_s.unwrap_or(mv.turnback_s),
        supplement_share: l
            .supplement_share
            .filter(|x| x.is_finite() && (0.0..1.0).contains(x))
            .unwrap_or(0.05),
        stabling,
        layover,
        bands: service_bands(l),
        return_offset_s: None,
        priority: mode_priority(&l.mode),
    }
}

/// Purpose: which line an issue belongs to (trip and run names start with the line id and `-`).
fn issue_line(issue: &Issue, ids: &[&str]) -> Option<usize> {
    let name = match issue {
        Issue::NoPath { line, .. } => return ids.iter().position(|i| i == line),
        Issue::Unplaced { trip, .. } => trip,
        Issue::Shifted { run, .. } => run,
        Issue::PlatformChange { trip, .. } => trip,
        Issue::NotStabled { .. } => return None,
    };
    ids.iter()
        .enumerate()
        .filter(|(_, id)| {
            name.strip_prefix(**id)
                .is_some_and(|rest| rest.starts_with('-'))
        })
        .max_by_key(|(_, id)| id.len())
        .map(|(i, _)| i)
}

fn clock(s: f64) -> String {
    let m = (s / 60.0).round() as i64;
    format!("{:02}:{:02}", m / 60, m % 60)
}

/// Purpose: a planner issue in words, with platforms named as the editor shows them.
pub fn issue_message(issue: &Issue, m: &Model) -> Msg {
    issue_text(issue, &PlatformNames { m })
}

/// Purpose: the issue in words for the editor.
fn issue_text(issue: &Issue, names: &PlatformNames) -> Msg {
    match issue {
        Issue::NoPath {
            direction,
            reason: None,
            ..
        } => {
            if *direction == 0 {
                msg!("rail.plan.no_track_outbound")
            } else {
                msg!("rail.plan.no_track_return")
            }
        }
        Issue::NoPath {
            direction,
            reason: Some(why),
            ..
        } => {
            let why = why.clone().map_text(&|t| names.reason(t));
            if *direction == 0 {
                msg!("rail.plan.cannot_run_outbound", reason = why)
            } else {
                msg!("rail.plan.cannot_run_return", reason = why)
            }
        }
        Issue::Unplaced { trip, reason, .. } => {
            msg!(
                "rail.plan.trip_not_run",
                trip = trip,
                reason = reason.clone()
            )
        }
        Issue::Shifted { run, by_s } => Msg::new(if *by_s >= 0.0 {
            "rail.plan.leaves_later"
        } else {
            "rail.plan.leaves_earlier"
        })
        .arg("run", run)
        .arg("by", format!("{} s", by_s.abs().round())),
        Issue::PlatformChange { trip, usual, used } => msg!(
            "rail.plan.platform_change",
            trip = trip,
            used = names.platform(used),
            usual = names.platform(usual)
        ),
        Issue::NotStabled {
            vehicle,
            at,
            reason,
        } => msg!(
            "rail.plan.not_stabled",
            train = vehicle.to_string(),
            at = at,
            reason = reason.clone()
        ),
    }
}

/// Purpose: what keeps the design's storage tracks from feeding a line: a storage track with no
/// signal to leave by, or no storage track that reaches either end of the line.
/// Output: sentences for the line's report (none when a storage track reaches a terminal, or the
/// design has no storage track: its trains then stable in the terminal platforms by design).
fn stabling_problems(m: &Model, spec: &LineSpec, l: &ServiceLine) -> Vec<Msg> {
    let storage: Vec<usize> = (0..m.tracks.len())
        .filter(|&t| {
            m.tracks[t].usage == TrackUse::Storage && spec.stabling.contains(&m.tracks[t].id)
        })
        .collect();
    if storage.is_empty() {
        return Vec::new();
    }
    let max_routes = PlanParams::default().max_routes;
    let mut out = Vec::new();
    let mut leaves = Vec::new();
    // A storage track split by a signal is several model tracks (`t166.0.0/0`, `/1`); it can be
    // left when any of them can. Named as the planner drew it: "storage track 166".
    let drawn = |t: usize| {
        let id = &m.tracks[t].id;
        let base = id.split('/').next().unwrap_or(id);
        base.strip_prefix('t')
            .and_then(|r| r.split('.').next())
            .map_or(base.to_string(), |n| format!("storage track {n}"))
    };
    let mut stuck: Vec<String> = Vec::new();
    let mut free: Vec<String> = Vec::new();
    for &t in &storage {
        let starts: Vec<_> = [rail_model::Dir::Up, rail_model::Dir::Down]
            .into_iter()
            .map(|d| departure_routes(m, Place::Storage(t), d))
            .filter(|r| !r.is_empty())
            .collect();
        if starts.is_empty() {
            stuck.push(drawn(t));
        } else {
            free.push(drawn(t));
            leaves.push(starts);
        }
    }
    stuck.sort();
    stuck.dedup();
    for name in stuck.into_iter().filter(|n| !free.contains(n)) {
        out.push(msg!("rail.plan.storage_no_exit_signal", track = name));
    }
    let terminals: Vec<(String, Vec<Place>)> = [l.stations.first(), l.stations.last()]
        .into_iter()
        .flatten()
        .filter_map(|id| m.stations.iter().find(|s| &s.id == id))
        .map(|st| {
            (
                st.name.clone(),
                st.platforms.iter().map(|&p| Place::Platform(p)).collect(),
            )
        })
        .collect();
    let reached = |places: &[Place]| {
        leaves.iter().flatten().any(|start| {
            places
                .iter()
                .any(|&p| find_path(m, start, &[vec![(p, 0.0)]], max_routes).is_some())
        })
    };
    if !leaves.is_empty() && !terminals.iter().any(|(_, ps)| reached(ps)) {
        let names: Vec<&str> = terminals.iter().map(|(n, _)| n.as_str()).collect();
        out.push(msg!(
            "rail.plan.no_storage_reaches",
            stations = names.join(" / ")
        ));
    }
    out
}

/// Platform labels for the issue texts.
struct PlatformNames<'a> {
    m: &'a Model,
}

impl PlatformNames<'_> {
    /// A planner reason with each platform id in it named as the editor shows it.
    fn reason(&self, why: &str) -> String {
        why.split(' ')
            .map(|w| {
                if self.m.platform(w).is_some() {
                    self.platform(w)
                } else {
                    w.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// The station a platform belongs to (its id when unknown).
    fn station_of(&self, id: &str) -> String {
        self.m.platform(id).map_or(id.to_string(), |p| {
            let pf = &self.m.platforms[p as usize];
            self.m.stations[pf.station as usize].name.clone()
        })
    }

    fn platform(&self, id: &str) -> String {
        self.m.platform(id).map_or(id.to_string(), |p| {
            let pf = &self.m.platforms[p as usize];
            let st = &self.m.stations[pf.station as usize];
            match &pf.label {
                Some(l) => format!("{l} at {}", st.name),
                None => format!("{id} at {}", st.name),
            }
        })
    }
}

/// Purpose: plan the editor's service lines on the design and publish them for the journey planner.
/// Inputs: the topology export of the design (JSON text), the lines, the day type id.
/// Output: the timetable with a report per line; Err when the design cannot be planned on (errors in
/// the design, an unknown station) or a line has fewer than two stops.
pub fn publish_service(
    topology_json: &str,
    lines: &[ServiceLine],
    service_id: &str,
) -> Result<ServicePublication, Msg> {
    publish_service_with(topology_json, lines, service_id, &PublishOptions::default())
}

/// Purpose: [`publish_service`] with the project's settings (`opts`).
pub fn publish_service_with(
    topology_json: &str,
    lines: &[ServiceLine],
    service_id: &str,
    opts: &PublishOptions,
) -> Result<ServicePublication, Msg> {
    for l in lines {
        if l.stations.len() < 2 {
            return Err(msg!("rail.plan.two_stops", line = &l.name));
        }
    }
    let imp = import_json(topology_json, &ImportOptions::default())?;
    let m = Model::compile(&imp.spec).map_err(layout_unusable)?;
    let specs: Vec<LineSpec> = lines
        .iter()
        .map(|l| line_spec_with_roles(l, &m, &imp.storage_roles))
        .collect();
    let mut params = PlanParams::default();
    if let Some(v) = opts.max_idle_s.filter(|v| v.is_finite() && *v >= 0.0) {
        params.max_idle_s = v;
    }
    let p = plan(&m, &specs, &params)?;
    let routes: Vec<RouteInfo> = lines
        .iter()
        .map(|l| RouteInfo {
            id: l.id.clone(),
            name: l.name.clone(),
            mode: Some(l.mode.clone()),
            color: l
                .color
                .as_ref()
                .map(|c| c.trim_start_matches('#').to_string()),
        })
        .collect();
    let origin = imp.origin.unwrap_or([0.0, 0.0]);
    let jt = journey_timetable(&m, &p, &routes, &imp.platform_places, origin, service_id);

    let ids: Vec<&str> = lines.iter().map(|l| l.id.as_str()).collect();
    let names = PlatformNames { m: &m };
    let mut reports: Vec<LineReport> = lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let service = || {
                p.runs
                    .iter()
                    .filter(move |r| r.line == i && r.kind == RunKind::Service)
            };
            let first = |dir: u8| {
                service()
                    .filter(|r| r.direction == dir)
                    .min_by(|a, b| a.depart_s().total_cmp(&b.depart_s()))
                    .map(|r| r.arrive_s() - r.depart_s())
            };
            let mut trains: Vec<usize> = service().map(|r| r.vehicle).collect();
            trains.sort_unstable();
            trains.dedup();
            LineReport {
                id: l.id.clone(),
                trips: service().count(),
                outbound_s: first(0),
                return_s: first(1),
                trains: trains.len(),
                issues: Vec::new(),
                issue_msgs: Vec::new(),
                stations: service()
                    .filter(|r| r.direction == 0)
                    .min_by(|a, b| a.depart_s().total_cmp(&b.depart_s()))
                    .map(|r| station_km(&m, r))
                    .unwrap_or_default(),
                shifted: Vec::new(),
                unplaced: Vec::new(),
            }
        })
        .collect();
    let mut note_msgs: Vec<Msg> = Vec::new();
    // Many small shifts say little each; count them per line instead.
    let mut shifted = vec![0usize; lines.len()];
    // Trips that could not run, per line and reason (a busy day can drop hundreds for one reason).
    let mut unplaced: Vec<BTreeMap<String, (Msg, Vec<String>)>> =
        vec![BTreeMap::new(); lines.len()];
    // Trips that used another platform than usual, counted per line and station: one line each
    // instead of one per trip.
    let mut platform_changes: Vec<BTreeMap<String, usize>> = vec![BTreeMap::new(); lines.len()];
    for issue in &p.issues {
        let line = issue_line(issue, &ids);
        match (issue, line) {
            (Issue::Shifted { run, by_s }, Some(i)) => {
                shifted[i] += 1;
                reports[i].shifted.push(ShiftedTrip {
                    trip: run.clone(),
                    by_s: *by_s,
                });
            }
            (
                Issue::Unplaced {
                    trip,
                    reason,
                    blocked_by,
                    ..
                },
                Some(i),
            ) => {
                reports[i].unplaced.push(UnplacedTrip {
                    trip: trip.clone(),
                    reason: reason.english(),
                    reason_msg: reason.clone(),
                    blocked_by: blocked_by.clone(),
                });
                unplaced[i]
                    .entry(reason.english())
                    .or_insert_with(|| (reason.clone(), Vec::new()))
                    .1
                    .push(trip.clone())
            }
            (Issue::PlatformChange { used, .. }, Some(i)) => {
                let at = names.station_of(used);
                *platform_changes[i].entry(at).or_default() += 1;
            }
            (_, Some(i)) => reports[i].issue_msgs.push(issue_text(issue, &names)),
            (_, None) => note_msgs.push(issue_text(issue, &names)),
        }
    }
    // Where trains can come from: a depot whose trains cannot reach the line is a design problem
    // the timetable alone would only show as trips without a train (Damascus test, bug 9).
    for (i, spec) in specs.iter().enumerate() {
        reports[i]
            .issue_msgs
            .extend(stabling_problems(&m, spec, &lines[i]));
    }
    for (i, by_reason) in unplaced.into_iter().enumerate() {
        let mut blocked = false;
        let mut no_train = false;
        for (text, (reason, trips)) in by_reason {
            blocked |= text.contains("conflict-free");
            no_train |= text.contains("stabling");
            reports[i].issue_msgs.push(if trips.len() == 1 {
                msg!("rail.plan.trip_not_run", trip = &trips[0], reason = reason)
            } else {
                msg!(
                    "rail.plan.trips_not_run",
                    count = trips.len().to_string(),
                    first = &trips[0],
                    reason = reason
                )
            });
        }
        if blocked {
            reports[i]
                .issue_msgs
                .push(msg!("rail.plan.trains_in_the_way"));
        }
        if no_train {
            reports[i].issue_msgs.push(msg!("rail.plan.no_free_train"));
        }
    }
    for (i, by_station) in platform_changes.into_iter().enumerate() {
        for (station, n) in by_station {
            reports[i].issue_msgs.push(if n == 1 {
                msg!("rail.plan.platform_changes_one", station = station)
            } else {
                msg!(
                    "rail.plan.platform_changes",
                    station = station,
                    count = n.to_string()
                )
            });
        }
    }
    for (i, n) in shifted.into_iter().enumerate() {
        if n > 0 {
            reports[i].issue_msgs.push(if n == 1 {
                msg!("rail.plan.shifted_one")
            } else {
                msg!("rail.plan.shifted", count = n.to_string())
            });
        }
    }
    for (r, l) in reports.iter_mut().zip(lines) {
        if r.trips == 0 && r.issue_msgs.is_empty() {
            r.issue_msgs.push(msg!(
                "rail.plan.no_trips",
                from = clock(l.first_s),
                to = clock(l.last_s)
            ));
        }
        r.issues = r.issue_msgs.iter().map(Msg::english).collect();
    }
    note_msgs.extend(imp.notes.iter().cloned());
    note_msgs.extend(jt.notes);
    let notes = note_msgs.iter().map(Msg::english).collect();
    let section_trains = section_trains(&m, &p, &ids);
    Ok(ServicePublication {
        timetable: jt.timetable,
        lines: reports,
        notes,
        note_msgs,
        section_trains,
        blocks: vehicle_blocks(&m, &p, &ids),
    })
}

/// Purpose: the plan's runs grouped by train, each in time order, trains by their first departure.
fn vehicle_blocks(m: &Model, p: &crate::Plan, ids: &[&str]) -> Vec<VehicleBlock> {
    let mut by: BTreeMap<usize, Vec<&crate::PlannedRun>> = BTreeMap::new();
    for r in &p.runs {
        by.entry(r.vehicle).or_default().push(r);
    }
    let place_name = |c: Option<&crate::CallTime>| -> Option<String> {
        match c?.place {
            Place::Platform(pf) => {
                let st = &m.stations[m.platforms[pf as usize].station as usize];
                Some(m.groups[st.group as usize].name.clone())
            }
            Place::Storage(_) => None,
        }
    };
    let mut out: Vec<VehicleBlock> = by
        .into_iter()
        .map(|(vehicle, mut runs)| {
            runs.sort_by(|a, b| a.depart_s().total_cmp(&b.depart_s()));
            VehicleBlock {
                vehicle,
                runs: runs
                    .into_iter()
                    .map(|r| {
                        let length: f64 = r
                            .run
                            .routes
                            .iter()
                            .map(|&id| m.routes[id as usize].length_m)
                            .sum();
                        let end = r.run.end_m.unwrap_or(length);
                        BlockRun {
                            kind: match r.kind {
                                RunKind::Service => "service",
                                RunKind::PullOut => "pull_out",
                                RunKind::PullIn => "pull_in",
                            }
                            .into(),
                            line: ids.get(r.line).map_or(String::new(), |s| s.to_string()),
                            trip: r.name.clone(),
                            direction: r.direction,
                            from: place_name(r.calls.first()),
                            to: place_name(r.calls.last()),
                            depart_s: r.depart_s(),
                            arrive_s: r.arrive_s(),
                            km: ((end - r.run.start_m) / 1000.0).max(0.0),
                        }
                    })
                    .collect(),
            }
        })
        .collect();
    out.sort_by(|a, b| {
        let first = |v: &VehicleBlock| v.runs.first().map_or(f64::MAX, |r| r.depart_s);
        first(a).total_cmp(&first(b))
    });
    out
}

/// Purpose: count the passenger trips of each line on each section of the topology export by the
/// clock hour they pass it, for the noise map (ADR-0038 step N3).
/// Inputs: the compiled model, the plan and the line ids in input order.
/// Output: one row per section and line with trains, sorted by section then line.
/// A trip passes a sub-track at the time interpolated linearly between its departure and its
/// arrival by the position of the sub-track's middle along its path; dwells at intermediate stops
/// are spread over the trip, which moves a time by at most the trip's dwells. A section counts a
/// trip once even when the trip runs over several of its sub-tracks.
fn section_trains(m: &Model, p: &crate::Plan, ids: &[&str]) -> Vec<SectionTrains> {
    let mut out: BTreeMap<(String, usize), [u32; 24]> = BTreeMap::new();
    for r in p.runs.iter().filter(|r| r.kind == RunKind::Service) {
        let Ok(steps) = crate::route_steps(m, &r.run.routes) else {
            continue;
        };
        let total: f64 = steps
            .iter()
            .map(|s| m.pieces[s.piece as usize].length_m())
            .sum();
        let (x0, x1) = (r.run.start_m, r.run.end_m.unwrap_or(total));
        let (t0, t1) = (r.depart_s(), r.arrive_s());
        let mut seen: Vec<&str> = Vec::new();
        let mut pos = 0.0;
        for st in &steps {
            let piece = &m.pieces[st.piece as usize];
            let mid = pos + piece.length_m() / 2.0;
            pos += piece.length_m();
            if mid < x0 || mid > x1 {
                continue;
            }
            let id = m.tracks[piece.track].id.as_str();
            // Sub-tracks of a section are `section/k` (rail_model::topology).
            let section = id.split_once('/').map_or(id, |(a, _)| a);
            if seen.contains(&section) {
                continue;
            }
            seen.push(section);
            let t = if x1 > x0 {
                t0 + (t1 - t0) * (mid - x0) / (x1 - x0)
            } else {
                t0
            };
            let hour = ((t / 3600.0).floor() as i64).rem_euclid(24) as usize;
            out.entry((section.to_string(), r.line)).or_insert([0; 24])[hour] += 1;
        }
    }
    out.into_iter()
        .map(|((section, line), hours)| SectionTrains {
            section,
            line: ids.get(line).map_or_else(String::new, |s| s.to_string()),
            hours,
        })
        .collect()
}

/// Purpose: the stopping stations of a run with their distance from its origin along the path.
/// The origin is at 0, intermediate stops at the run's stop positions and the destination at the end
/// of the path; the rows match the stop times the journey timetable publishes for the run.
fn station_km(m: &Model, r: &crate::PlannedRun) -> Vec<StationKm> {
    let n = r.calls.len();
    let origin = r.run.start_m;
    let mut k = 0;
    let mut out = Vec::new();
    for (i, c) in r.calls.iter().enumerate() {
        if !c.stop {
            continue;
        }
        let pos = if i == 0 {
            origin
        } else if i + 1 == n {
            r.run.end_m.unwrap_or(origin)
        } else {
            let p = r.run.stops.get(k).map_or(origin, |s| s.position_m);
            k += 1;
            p
        };
        let Place::Platform(p) = c.place else {
            continue;
        };
        let st = &m.stations[m.platforms[p as usize].station as usize];
        let g = &m.groups[st.group as usize];
        out.push(StationKm {
            station_id: format!("group:{}", g.key),
            name: g.name.clone(),
            km: ((pos - origin) / 1000.0).max(0.0),
        });
    }
    out
}

/// Whether a train can run from one station to the next of a line.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Reach {
    /// A path exists from a platform of `from` to a platform of `to`.
    pub ok: bool,
    /// Why not, in words (English), when it does not.
    pub reason: Option<String>,
    /// The same as a key and values, for the app to show in the user's language.
    pub reason_msg: Option<Msg>,
}

/// Purpose: the error for a track layout the operations model cannot use, naming every problem.
pub fn layout_unusable(errors: Vec<Msg>) -> Msg {
    let all = errors
        .into_iter()
        .reduce(|a, b| msg!("rail.sim.join", a = a, b = b))
        .unwrap_or_else(|| msg!("rail.sim.no_reason"));
    msg!("rail.plan.layout_unusable", errors = all)
}

/// Purpose: check, while the planner picks a line's stations in order, that a train standing at a
/// platform of station part `from` can reach a platform of station part `to` along the track
/// (either way out of the platform, through switches the design allows).
/// Inputs: the topology export (JSON text) and two station part ids (`st<id>`).
/// Output: the answer; Err when the design cannot be used for operations.
pub fn station_reachable(topology_json: &str, from: &str, to: &str) -> Result<Reach, Msg> {
    // Whether two stations are joined by track does not depend on the design's other errors (a
    // crossover elsewhere that does not fit, a ramp too short): check the track as drawn, so a
    // service line can get its stops while the planner still fixes unrelated problems. Publishing
    // still refuses a design with errors.
    let mut t: serde_json::Value = serde_json::from_str(topology_json)
        .map_err(|e| msg!("rail.model.topology_unreadable", error = e.to_string()))?;
    if let Some(o) = t.as_object_mut() {
        o.insert("valid".into(), serde_json::Value::Bool(true));
    }
    let imp = import_json(&t.to_string(), &ImportOptions::default())?;
    let m = Model::compile(&imp.spec).map_err(layout_unusable)?;
    let platforms = |id: &str| -> Option<Vec<u32>> {
        m.stations
            .iter()
            .find(|s| s.id == id)
            .map(|s| s.platforms.to_vec())
    };
    let name = |id: &str| {
        m.stations
            .iter()
            .find(|s| s.id == id)
            .map_or(id.to_string(), |s| s.name.clone())
    };
    let no = |reason: Msg| Reach {
        ok: false,
        reason: Some(reason.english()),
        reason_msg: Some(reason),
    };
    let (Some(a), Some(b)) = (platforms(from), platforms(to)) else {
        return Err(msg!("rail.plan.unknown_stations", from = from, to = to));
    };
    if a.is_empty() || b.is_empty() {
        let which = if a.is_empty() { from } else { to };
        return Ok(no(msg!(
            "rail.plan.no_platform_on_track",
            station = name(which)
        )));
    }
    let calls = vec![b
        .iter()
        .map(|&p| (Place::Platform(p as _), 0.0))
        .collect::<Vec<_>>()];
    let p = PlanParams::default();
    for &pa in &a {
        for d in [rail_model::Dir::Up, rail_model::Dir::Down] {
            let start = departure_routes(&m, Place::Platform(pa as _), d);
            if !start.is_empty() && find_path(&m, &start, &calls, p.max_routes).is_some() {
                return Ok(Reach {
                    ok: true,
                    reason: None,
                    reason_msg: None,
                });
            }
        }
    }
    Ok(no(msg!(
        "rail.plan.no_track_between",
        from = name(from),
        to = name(to)
    )))
}
