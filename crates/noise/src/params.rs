//! Assumption values (`assumptions/parameters/noise.yaml`, exported to `data/defaults.json`) and the
//! CNOSSOS-EU road coefficient file (`data/cnossos-road.json`).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

/// Number of octave bands, 63 Hz to 8 kHz.
pub const NB: usize = 8;
/// Octave band centre frequencies, Hz.
pub const BANDS_HZ: [f64; NB] = [63.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0];

/// Transit mode of a source. Ids match `assumptions/parameters/modes.yaml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// Bus.
    Bus,
    /// Bus rapid transit.
    Brt,
    /// Trolleybus (always electric).
    Trolleybus,
    /// Intercity bus or coach.
    IntercityBus,
    /// Tram.
    Tram,
    /// Light rail.
    LightRail,
    /// Metro.
    Metro,
    /// Commuter rail.
    CommuterRail,
    /// Regional rail.
    RegionalRail,
    /// Intercity, long-distance rail.
    LongDistanceRail,
    /// High-speed rail.
    HighSpeedRail,
}

impl Mode {
    /// Purpose: the assumption library id of the mode.
    pub fn id(self) -> &'static str {
        match self {
            Mode::Bus => "bus",
            Mode::Brt => "brt",
            Mode::Trolleybus => "trolleybus",
            Mode::IntercityBus => "intercity_bus",
            Mode::Tram => "tram",
            Mode::LightRail => "light_rail",
            Mode::Metro => "metro",
            Mode::CommuterRail => "commuter_rail",
            Mode::RegionalRail => "regional_rail",
            Mode::LongDistanceRail => "long_distance_rail",
            Mode::HighSpeedRail => "high_speed_rail",
        }
    }

    /// Purpose: true for the road modes (CNOSSOS-EU road emission).
    pub fn is_road(self) -> bool {
        matches!(
            self,
            Mode::Bus | Mode::Brt | Mode::Trolleybus | Mode::IntercityBus
        )
    }

    /// Purpose: true for modes that take the tram squeal rule of Directive (EU) 2021/1226.
    pub fn is_tram(self) -> bool {
        matches!(self, Mode::Tram | Mode::LightRail)
    }
}

/// Which end of the assumption ranges a run uses. `Low` is the quieter end of every emission value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Variant {
    /// Low values (quieter).
    Low = 0,
    /// Central values.
    Central = 1,
    /// High values (louder).
    High = 2,
}

/// All three variants, in index order.
pub const VARIANTS: [Variant; 3] = [Variant::Low, Variant::Central, Variant::High];

#[derive(Deserialize)]
struct DefaultsFile {
    params: HashMap<String, HashMap<String, [f64; 3]>>,
}

/// The noise assumption values: `[low, central, high]` per key, per mode with a `*` fallback.
#[derive(Debug, Clone)]
pub struct Library {
    params: HashMap<String, HashMap<String, [f64; 3]>>,
}

impl Library {
    /// Purpose: the library built into the crate from `data/defaults.json`.
    /// Output: a shared reference. Panics only if the generated file is malformed (caught by tests).
    pub fn builtin() -> &'static Library {
        static LIB: OnceLock<Library> = OnceLock::new();
        LIB.get_or_init(|| {
            let f: DefaultsFile = serde_json::from_str(include_str!("../data/defaults.json"))
                .expect("crates/noise/data/defaults.json");
            Library { params: f.params }
        })
    }

    /// Purpose: `[low, central, high]` of `key` for `mode` (or the `*` value).
    /// Panics on an unknown key: every key the crate reads is checked by a test.
    pub fn range(&self, key: &str, mode: Option<Mode>) -> [f64; 3] {
        let row = self
            .params
            .get(key)
            .unwrap_or_else(|| panic!("unknown noise parameter {key}"));
        mode.and_then(|m| row.get(m.id()))
            .or_else(|| row.get("*"))
            .copied()
            .unwrap_or_else(|| panic!("{key} has no global value"))
    }

    /// Purpose: the value of `key` for `mode` at the given variant.
    pub fn get(&self, key: &str, mode: Option<Mode>, v: Variant) -> f64 {
        self.range(key, mode)[v as usize]
    }

    /// Purpose: the central value of `key` with no mode context.
    pub fn central(&self, key: &str) -> f64 {
        self.get(key, None, Variant::Central)
    }

    /// Purpose: replace the value of `key` (all variants, all modes) with `value`, as a project
    /// preference does. Side effects: changes this copy only.
    pub fn set(&mut self, key: &str, value: f64) {
        let row = self.params.entry(key.to_string()).or_default();
        row.clear();
        row.insert("*".into(), [value; 3]);
    }

    /// Purpose: every key with its global range, for the panel and tests.
    pub fn keys(&self) -> Vec<&str> {
        let mut k: Vec<&str> = self.params.keys().map(String::as_str).collect();
        k.sort_unstable();
        k
    }
}

/// CNOSSOS-EU road coefficients of one vehicle category.
#[derive(Debug, Clone, Deserialize)]
pub struct RoadCoefficients {
    /// CNOSSOS-EU category number.
    pub cnossos_category: u8,
    /// Rolling noise A_R per band, dB.
    pub a_r: [f64; NB],
    /// Rolling noise B_R per band.
    pub b_r: [f64; NB],
    /// Propulsion noise A_P per band, dB.
    pub a_p: [f64; NB],
    /// Propulsion noise B_P per band.
    pub b_p: [f64; NB],
    /// Rolling correction at a signalised junction, dB.
    pub c_r_junction: f64,
    /// Propulsion correction at a signalised junction, dB.
    pub c_p_junction: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct Shape {
    values: [f64; NB],
}

/// The coefficient file.
#[derive(Debug, Clone, Deserialize)]
pub struct Coefficients {
    /// A-weighting per band, dB.
    pub a_weighting_db: [f64; NB],
    /// Road categories by name (`medium_heavy`, `heavy`).
    pub categories: HashMap<String, RoadCoefficients>,
    rail_spectrum_shape_db: Shape,
}

impl Coefficients {
    /// Purpose: the coefficients built into the crate from `data/cnossos-road.json`.
    pub fn builtin() -> &'static Coefficients {
        static C: OnceLock<Coefficients> = OnceLock::new();
        C.get_or_init(|| {
            serde_json::from_str(include_str!("../data/cnossos-road.json"))
                .expect("crates/noise/data/cnossos-road.json")
        })
    }

    /// Purpose: the A-weighted rail spectrum shape, normalised so its bands sum to 0 dB.
    pub fn rail_shape(&self) -> [f64; NB] {
        let v = self.rail_spectrum_shape_db.values;
        let tot = 10.0 * v.iter().map(|x| 10f64.powf(x / 10.0)).sum::<f64>().log10();
        v.map(|x| x - tot)
    }
}
