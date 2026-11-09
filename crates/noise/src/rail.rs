//! CNOSSOS-EU railway source (Directive (EU) 2015/996 Annex II §2.3 and Appendix G, as amended by
//! Delegated Directive (EU) 2021/1226): sound power per train in 1/3 octave bands from wheel and
//! rail roughness, contact filter and transfer functions, with impact, squeal, traction,
//! aerodynamic and bridge noise, then summed to the octave bands the propagation uses.
//!
//! The tables are `data/cnossos-rail.json`, extracted from the official texts by
//! `tools/noise/extract_cnossos_rail.py`. The choice of table entries per mode is in the
//! assumption library (`noise.rail_*`).

use crate::params::{Coefficients, Library, Mode, Variant, NB};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

/// Number of 1/3 octave bands, 50 Hz to 10 kHz.
pub const N3: usize = 24;
/// Number of 1/3 octave wavelength bands, 2 000 mm to 0.8 mm.
pub const NW: usize = 35;

/// Traction sound power of one vehicle at sources A and B (Table G-5), dB re 1 pW.
#[derive(Debug, Clone, Deserialize)]
pub struct Traction {
    /// Source A (0.5 m).
    pub a: [f64; N3],
    /// Source B (4 m).
    pub b: [f64; N3],
}

/// Aerodynamic noise at the reference speed (Table G-6).
#[derive(Debug, Clone, Deserialize)]
pub struct Aero {
    /// Reference speed, km/h.
    pub v0_kmh: f64,
    /// Vehicle length the values are given for, m.
    pub vehicle_length_m: f64,
    /// Speed exponent at source A.
    pub alpha_a: f64,
    /// Speed exponent at source B.
    pub alpha_b: f64,
    /// Sound power at source A, dB.
    pub lw_a: [f64; N3],
    /// Sound power at source B, dB.
    pub lw_b: [f64; N3],
}

/// The railway source database (Appendix G). Wavelength spectra have `NW` values (checked on
/// load; serde reads fixed arrays only up to 32).
#[derive(Debug, Clone, Deserialize)]
pub struct RailTables {
    /// Wavelength band centres, mm, long to short.
    pub wavelengths_mm: Vec<f64>,
    /// Frequency band centres, Hz.
    pub frequencies_hz: [f64; N3],
    /// Wheel roughness L_r,VEH by brake type, dB re 1 µm (Table G-1).
    pub wheel_roughness: HashMap<String, Vec<f64>>,
    /// Rail roughness L_r,TR, dB re 1 µm (Table G-1).
    pub rail_roughness: HashMap<String, Vec<f64>>,
    /// Contact filter A_3, dB (Table G-2).
    pub contact_filter: HashMap<String, Vec<f64>>,
    /// Track transfer function L_H,TR, dB (Table G-3).
    pub track_transfer: HashMap<String, [f64; N3]>,
    /// Wheel transfer function L_H,VEH, dB (Table G-3).
    pub wheel_transfer: HashMap<String, [f64; N3]>,
    /// Impact roughness of one switch, joint or crossing per 100 m, dB (Table G-4).
    pub impact_roughness_single: Vec<f64>,
    /// Traction noise per vehicle (Table G-5).
    pub traction: HashMap<String, Traction>,
    /// Aerodynamic noise (Table G-6).
    pub aerodynamic: Aero,
    /// Bridge transfer function L_H,bridge, dB (Table G-7).
    pub bridge_transfer: HashMap<String, [f64; N3]>,
}

impl RailTables {
    /// Purpose: the tables built into the crate from `data/cnossos-rail.json`.
    pub fn builtin() -> &'static RailTables {
        static T: OnceLock<RailTables> = OnceLock::new();
        T.get_or_init(|| {
            let t: RailTables = serde_json::from_str(include_str!("../data/cnossos-rail.json"))
                .expect("crates/noise/data/cnossos-rail.json");
            let ok = |v: &Vec<f64>| v.len() == NW;
            assert!(
                ok(&t.wavelengths_mm)
                    && ok(&t.impact_roughness_single)
                    && [&t.wheel_roughness, &t.rail_roughness, &t.contact_filter]
                        .iter()
                        .all(|m| m.values().all(ok)),
                "cnossos-rail.json: wavelength spectra need {NW} values"
            );
            t
        })
    }

    fn pick<'a, V>(map: &'a HashMap<String, V>, table: &str, id: &str) -> &'a V {
        map.get(id)
            .unwrap_or_else(|| panic!("CNOSSOS-EU {table}: no entry {id}"))
    }
}

/// The vehicle and track of one rail line, as chosen by the assumption library.
#[derive(Debug, Clone)]
pub struct RailSource {
    wheel_roughness: Vec<f64>,
    rail_roughness: Vec<f64>,
    contact_filter: Vec<f64>,
    track_transfer: [f64; N3],
    wheel_transfer: [f64; N3],
    bridge_transfer: [f64; N3],
    traction: Traction,
    /// Lowest speed for the roughness, km/h.
    pub min_speed_kmh: f64,
    /// Speed above which aerodynamic noise is added, km/h.
    pub aero_from_kmh: f64,
    /// Vehicles in a train.
    pub vehicles: f64,
    /// Axles in a train.
    pub axles: f64,
    /// Traction sources in a train (powered vehicles plus locomotives).
    pub traction_units: f64,
    /// Train length, m.
    pub train_length_m: f64,
}

impl RailSource {
    /// Purpose: the CNOSSOS-EU description of a train of `mode` and length `train_length_m`.
    /// Inputs: assumption library, mode, train length m, variant of the ranges.
    pub fn new(lib: &Library, mode: Mode, train_length_m: f64, var: Variant) -> RailSource {
        let t = RailTables::builtin();
        let m = Some(mode);
        let veh_len = lib.get("noise.rail_vehicle_length_m", m, var).max(1.0);
        let len = train_length_m.max(1.0);
        let vehicles = (len / veh_len).round().max(1.0);
        let axles = vehicles * lib.get("noise.rail_axles_per_vehicle", m, var).max(1.0);
        let traction_units = vehicles
            * lib
                .get("noise.rail_powered_vehicle_share", m, var)
                .clamp(0.0, 1.0)
            + lib.get("noise.rail_locomotives_per_train", m, var).max(0.0);
        let ch = |k: &str| lib.choice(k, m, var);
        RailSource {
            wheel_roughness: RailTables::pick(
                &t.wheel_roughness,
                "Table G-1",
                ch("noise.rail_wheel_roughness"),
            )
            .clone(),
            rail_roughness: RailTables::pick(
                &t.rail_roughness,
                "Table G-1",
                ch("noise.rail_rail_roughness"),
            )
            .clone(),
            contact_filter: RailTables::pick(
                &t.contact_filter,
                "Table G-2",
                ch("noise.rail_contact_filter"),
            )
            .clone(),
            track_transfer: *RailTables::pick(
                &t.track_transfer,
                "Table G-3",
                ch("noise.rail_track_transfer"),
            ),
            wheel_transfer: *RailTables::pick(
                &t.wheel_transfer,
                "Table G-3",
                ch("noise.rail_wheel_transfer"),
            ),
            bridge_transfer: *RailTables::pick(
                &t.bridge_transfer,
                "Table G-7",
                ch("noise.rail_bridge_transfer"),
            ),
            traction: t
                .traction
                .get(ch("noise.rail_traction"))
                .unwrap_or_else(|| panic!("CNOSSOS-EU Table G-5: no entry"))
                .clone(),
            min_speed_kmh: lib.get("noise.rail_min_roughness_speed_kmh", m, var),
            aero_from_kmh: lib.get("noise.rail_aero_from_kmh", m, var),
            vehicles,
            axles,
            traction_units,
            train_length_m: len,
        }
    }
}

/// Where a piece of track is and what it carries.
#[derive(Debug, Clone, Copy, Default)]
pub struct TrackState {
    /// Speed, km/h.
    pub v_kmh: f64,
    /// Squeal excess added to the rolling noise, dB (0 for none).
    pub squeal_db: f64,
    /// Joint (switch, crossing) density n_l, 1/m (0 for none).
    pub joint_density: f64,
    /// On a bridge: add the bridge structure source.
    pub bridge: bool,
    /// Added to the track part of rolling noise, dB (embedded tram track).
    pub track_db: f64,
}

/// Sound power of one train, A-weighted, octave bands 63 Hz to 8 kHz, linear (pW).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct TrainPower {
    /// Source A with the dipole and vertical directivity: rolling, impact, squeal, traction A,
    /// aerodynamic A.
    pub a: [f64; NB],
    /// Source A, omnidirectional: bridge structure.
    pub a_bridge: [f64; NB],
    /// Source B with the dipole only: traction B.
    pub b: [f64; NB],
    /// Source B with the dipole and the aerodynamic vertical directivity.
    pub b_aero: [f64; NB],
}

impl TrainPower {
    /// Purpose: total A-weighted sound power, dB re 1 pW.
    pub fn total_db(&self) -> f64 {
        let s: f64 = (0..NB)
            .map(|b| self.a[b] + self.a_bridge[b] + self.b[b] + self.b_aero[b])
            .sum();
        10.0 * s.log10()
    }
}

fn p10(l: f64) -> f64 {
    10f64.powf(l / 10.0)
}

/// Purpose: a wavelength spectrum at speed `v_kmh` as a frequency spectrum (f = v/λ, v in m/s),
/// averaging the two neighbouring wavelength bands energetically in proportion to log λ.
/// Beyond the table the end values apply.
pub fn to_frequency(spec: &[f64], v_kmh: f64) -> [f64; N3] {
    let t = RailTables::builtin();
    let w = &t.wavelengths_mm;
    std::array::from_fn(|i| {
        let lambda = v_kmh / 3.6 / t.frequencies_hz[i] * 1000.0;
        if lambda >= w[0] {
            return spec[0];
        }
        if lambda <= w[NW - 1] {
            return spec[NW - 1];
        }
        let k = (1..NW).find(|&k| w[k] <= lambda).unwrap_or(NW - 1);
        let (l0, l1) = (w[k - 1].ln(), w[k].ln());
        let x = (lambda.ln() - l0) / (l1 - l0);
        10.0 * ((1.0 - x) * p10(spec[k - 1]) + x * p10(spec[k])).log10()
    })
}

/// Purpose: CNOSSOS-EU sound power of one train on one piece of track.
/// Inputs: the train and track description, the state of the piece.
/// Output: A-weighted octave band powers per source class, pW.
pub fn train_power(src: &RailSource, st: &TrackState) -> TrainPower {
    let t = RailTables::builtin();
    let aw = Coefficients::builtin().a_weighting_db;
    let v = st.v_kmh.max(1.0);
    // Roughness at the minimum speed (2.3.2): trams and light metro 30, others 50 km/h.
    let vr = v.max(src.min_speed_kmh);
    let rail = to_frequency(&src.rail_roughness, vr);
    let wheel = to_frequency(&src.wheel_roughness, vr);
    let a3 = to_frequency(&src.contact_filter, vr);
    // Impact (2.3.11, 2.3.12): not below the minimum speed.
    let impact = (st.joint_density > 0.0 && v >= src.min_speed_kmh).then(|| {
        let s = to_frequency(&t.impact_roughness_single, vr);
        let k = 10.0 * (st.joint_density / 0.01).log10();
        s.map(|x| x + k)
    });
    let na = 10.0 * src.axles.log10();
    let mut out = TrainPower::default();
    let add = |dst: &mut [f64; NB], i: usize, l: f64| dst[i / 3] += p10(l + aw[i / 3]);
    for i in 0..N3 {
        // Total effective roughness (2.3.7), with impact (2.3.11).
        let mut lr = 10.0 * (p10(rail[i]) + p10(wheel[i])).log10() + a3[i];
        if let Some(im) = &impact {
            lr = 10.0 * (p10(lr) + p10(im[i])).log10();
        }
        // Rolling noise, track and wheel (2.3.8, 2.3.9), with squeal on all bands.
        let tr = lr + src.track_transfer[i] + na + st.squeal_db + st.track_db;
        let veh = lr + src.wheel_transfer[i] + na + st.squeal_db;
        add(&mut out.a, i, tr);
        add(&mut out.a, i, veh);
        // Bridge structure (2.3.18 as replaced by 2021/1226).
        if st.bridge {
            add(&mut out.a_bridge, i, lr + src.bridge_transfer[i] + na);
        }
        // Traction at constant speed equals the idling values (Table G-5), per traction unit.
        if src.traction_units > 0.0 {
            let n = 10.0 * src.traction_units.log10();
            add(&mut out.a, i, src.traction.a[i] + n);
            add(&mut out.b, i, src.traction.b[i] + n);
        }
        // Aerodynamic noise (2.3.13, 2.3.14), per 20 m of train.
        if v > src.aero_from_kmh {
            let ae = &t.aerodynamic;
            let n = 10.0 * (src.train_length_m / ae.vehicle_length_m).log10();
            let s = (v / ae.v0_kmh).log10();
            add(&mut out.a, i, ae.lw_a[i] + ae.alpha_a * s + n);
            add(&mut out.b_aero, i, ae.lw_b[i] + ae.alpha_b * s + n);
        }
    }
    out
}

/// Purpose: horizontal directivity factor (2.3.15), dipole, from sin φ.
pub fn dipole(sin_phi: f64) -> f64 {
    0.01 + 0.99 * sin_phi * sin_phi
}

/// Purpose: vertical directivity of source A (2.3.16 as replaced by 2021/1226), dB, for the
/// elevation angle `psi` (rad, positive upwards) and band centre `fc` Hz.
pub fn vertical_a_db(psi: f64, fc: f64) -> f64 {
    if psi <= 0.0 {
        return 0.0;
    }
    40.0 / 3.0 * (2.0 / 3.0 * (2.0 * psi).sin() - psi.sin()) * ((fc + 600.0) / 200.0).log10()
}

/// Purpose: vertical directivity of aerodynamic source B (2.3.17), dB.
pub fn vertical_b_aero_db(psi: f64) -> f64 {
    if psi < 0.0 {
        10.0 * (psi.cos() * psi.cos()).max(1e-12).log10()
    } else {
        0.0
    }
}
