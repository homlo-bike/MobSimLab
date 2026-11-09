//! Service lines drawn in the railway editor (ADR-0032 §2, ADR-0034): the planner picks the stations
//! a line stops at, a train from the vehicle catalogue and the headways of the day; this module turns
//! them into [`LineSpec`]s, plans the day on the design's topology export and publishes the result in
//! the journey planner's timetable form.
//!
//! The catalogue gives a train's length, top speed, power and capacity, but rarely its tractive effort,
//! running resistance or braking. Those come from the mode's assumptions (`mode.acceleration_ms2`,
//! `mode.service_decel_ms2`, see `assumptions/DEFAULTS.md`) and the estimates in [`train_params`].

use journey_planner::timetable::Timetable;
use rail_dynamics::TrainParams;
use rail_model::topology::{import_json, ImportOptions};
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
    /// What went wrong or was changed, in words.
    pub issues: Vec<String>,
}

/// The published timetable and the per-line report.
#[derive(Clone, Debug, Serialize)]
pub struct ServicePublication {
    /// The journey planner's timetable (`contracts/published-timetable.schema.json`).
    pub timetable: Timetable,
    /// One report per line, in input order.
    pub lines: Vec<LineReport>,
    /// Notes from the topology import and the stop placement.
    pub notes: Vec<String>,
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
    let mv = mode_values(mode);
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

/// Purpose: service bands from the first and last departure, the peaks and both headways.
pub fn service_bands(l: &ServiceLine) -> Vec<Band> {
    let mut out = Vec::new();
    let peak = l.peak_headway_s.max(60.0);
    let off = l.offpeak_headway_s.max(60.0);
    let mut t = l.first_s;
    let mut peaks = l.peaks.clone();
    peaks.sort_by(|a, b| a[0].total_cmp(&b[0]));
    let mut push = |from_s: f64, to_s: f64, headway_s: f64| {
        if to_s > from_s {
            out.push(Band {
                from_s,
                to_s,
                headway_s,
            });
        }
    };
    for [a, b] in peaks {
        let from = a.max(l.first_s);
        let to = b.min(l.last_s);
        if to <= from || to <= t {
            continue;
        }
        let from = from.max(t);
        push(t, from, off);
        push(from, to, peak);
        t = to;
    }
    push(t, l.last_s, off);
    out
}

/// Purpose: the planner's line from an editor line.
/// Inputs: the line and the compiled model (for the storage tracks and terminal platforms).
/// Trains stable on the design's storage tracks; without any, in the terminal platforms overnight.
pub fn line_spec(l: &ServiceLine, m: &Model) -> LineSpec {
    let mv = mode_values(&l.mode);
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
        train: train_params(&l.vehicle, l.units, &l.mode),
        dwell_s: l.dwell_s.unwrap_or(mv.dwell_s),
        turnback_s: l.turnback_s.unwrap_or(mv.turnback_s),
        supplement_share: 0.05,
        stabling,
        bands: service_bands(l),
        return_offset_s: None,
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

/// Purpose: the issue in words for the editor.
fn issue_text(issue: &Issue, names: &PlatformNames) -> String {
    match issue {
        Issue::NoPath { direction, .. } => format!(
            "No track connects the stops {}. Check that the stations are joined by track in the order of the stops.",
            if *direction == 0 { "in the line's direction" } else { "in the return direction" }
        ),
        Issue::Unplaced { trip, reason, .. } => format!("Trip {trip} could not run: {reason}."),
        Issue::Shifted { run, by_s } => format!(
            "{run} {} by {} s to keep clear of another train.",
            if *by_s >= 0.0 { "leaves later" } else { "leaves earlier" },
            by_s.abs().round()
        ),
        Issue::PlatformChange { trip, usual, used } => format!(
            "{trip} uses platform {} instead of {}.",
            names.platform(used),
            names.platform(usual)
        ),
        Issue::NotStabled { vehicle, at, reason } => {
            format!("Train {vehicle} stays overnight at {at}: {reason}.")
        }
    }
}

/// Platform labels for the issue texts.
struct PlatformNames<'a> {
    m: &'a Model,
}

impl PlatformNames<'_> {
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
) -> Result<ServicePublication, String> {
    for l in lines {
        if l.stations.len() < 2 {
            return Err(format!("{} needs at least two stops.", l.name));
        }
    }
    let imp = import_json(topology_json, &ImportOptions::default())?;
    let m =
        Model::compile(&imp.spec).map_err(|e| format!("the track layout cannot be used: {e:?}"))?;
    let specs: Vec<LineSpec> = lines.iter().map(|l| line_spec(l, &m)).collect();
    let p = plan(&m, &specs, &PlanParams::default())?;
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
            }
        })
        .collect();
    let mut notes: Vec<String> = Vec::new();
    // Many small shifts say little each; count them per line instead.
    let mut shifted = vec![0usize; lines.len()];
    // Trips that could not run, per line and reason (a busy day can drop hundreds for one reason).
    let mut unplaced: Vec<BTreeMap<String, Vec<String>>> = vec![BTreeMap::new(); lines.len()];
    for issue in &p.issues {
        let line = issue_line(issue, &ids);
        match (issue, line) {
            (Issue::Shifted { .. }, Some(i)) => shifted[i] += 1,
            (Issue::Unplaced { trip, reason, .. }, Some(i)) => unplaced[i]
                .entry(reason.clone())
                .or_default()
                .push(trip.clone()),
            (_, Some(i)) => reports[i].issues.push(issue_text(issue, &names)),
            (_, None) => notes.push(issue_text(issue, &names)),
        }
    }
    for (i, by_reason) in unplaced.into_iter().enumerate() {
        let mut blocked = false;
        let mut no_train = false;
        for (reason, trips) in by_reason {
            blocked |= reason.contains("conflict-free");
            no_train |= reason.contains("stabling");
            reports[i].issues.push(if trips.len() == 1 {
                format!("Trip {} could not run: {reason}.", trips[0])
            } else {
                format!(
                    "{} trips could not run ({} first): {reason}.",
                    trips.len(),
                    trips[0]
                )
            });
        }
        if blocked {
            reports[i].issues.push(
                "Trains get in each other's way on the track. Crossovers next to the terminals let trains turn without blocking the other track; otherwise run less often."
                    .into(),
            );
        }
        if no_train {
            reports[i].issues.push(
                "No train was free to start some trips: the terminal platforms are full. A storage track joined to a terminal holds spare trains."
                    .into(),
            );
        }
    }
    for (i, n) in shifted.into_iter().enumerate() {
        if n > 0 {
            reports[i].issues.push(format!(
                "{n} departure{} moved from the clock-face times to keep clear of other trains.",
                if n == 1 { "" } else { "s" }
            ));
        }
    }
    for (r, l) in reports.iter_mut().zip(lines) {
        if r.trips == 0 && r.issues.is_empty() {
            r.issues.push(format!(
                "No trips between {} and {}.",
                clock(l.first_s),
                clock(l.last_s)
            ));
        }
    }
    notes.extend(imp.notes.iter().filter(|n| !n.is_empty()).cloned());
    notes.extend(jt.notes);
    Ok(ServicePublication {
        timetable: jt.timetable,
        lines: reports,
        notes,
    })
}

/// Whether a train can run from one station to the next of a line.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Reach {
    /// A path exists from a platform of `from` to a platform of `to`.
    pub ok: bool,
    /// Why not, in words, when it does not.
    pub reason: Option<String>,
}

/// Purpose: check, while the planner picks a line's stations in order, that a train standing at a
/// platform of station part `from` can reach a platform of station part `to` along the track
/// (either way out of the platform, through switches the design allows).
/// Inputs: the topology export (JSON text) and two station part ids (`st<id>`).
/// Output: the answer; Err when the design cannot be used for operations.
pub fn station_reachable(topology_json: &str, from: &str, to: &str) -> Result<Reach, String> {
    let imp = import_json(topology_json, &ImportOptions::default())?;
    let m =
        Model::compile(&imp.spec).map_err(|e| format!("the track layout cannot be used: {e:?}"))?;
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
    let no = |reason: String| Reach {
        ok: false,
        reason: Some(reason),
    };
    let (Some(a), Some(b)) = (platforms(from), platforms(to)) else {
        return Err(format!("unknown station {from} or {to}"));
    };
    if a.is_empty() || b.is_empty() {
        let which = if a.is_empty() { from } else { to };
        return Ok(no(format!("{} has no platform on a track.", name(which))));
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
                });
            }
        }
    }
    Ok(no(format!(
        "No track leads from {} to {}. Join them with track (and switches where lines meet), or pick the stations in the order trains pass them.",
        name(from),
        name(to)
    )))
}
