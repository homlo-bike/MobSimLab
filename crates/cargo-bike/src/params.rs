//! The plugin's assumption values (`plugins/cargo-bike/assumptions/parameters.yaml`, exported to
//! `data/defaults.json` by `tools/cargo-bike/export_defaults.py`), with the project's own values on top.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

/// One parameter of the defaults file.
#[derive(Debug, Clone, Deserialize)]
pub struct Default3 {
    /// Shown in the tab.
    pub label: String,
    /// Unit.
    pub unit: String,
    /// Low value.
    pub low: f64,
    /// Central value (the default).
    pub central: f64,
    /// High value.
    pub high: f64,
}

#[derive(Deserialize)]
struct DefaultsFile {
    params: BTreeMap<String, Default3>,
    default_kit: String,
    kits: Vec<Kit>,
}

/// A kit preset (`plugins/cargo-bike/kits.json`): parameter values it sets, by key without the prefix.
/// Money values are 2024 EUR like the parameters'.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct Kit {
    /// Id kept in the project.
    pub id: String,
    /// Name shown when the language has none of its own.
    pub label: String,
    /// 2 or 3.
    pub wheels: u8,
    /// Parameter values.
    pub values: BTreeMap<String, f64>,
}

fn file() -> &'static DefaultsFile {
    static F: OnceLock<DefaultsFile> = OnceLock::new();
    F.get_or_init(|| {
        serde_json::from_str(include_str!("../data/defaults.json"))
            .expect("data/defaults.json is valid")
    })
}

/// Purpose: the kit presets and the id of the one the parameters' defaults describe.
pub fn kits() -> (&'static str, &'static [Kit]) {
    let f = file();
    (&f.default_kit, &f.kits)
}

/// Purpose: every parameter of the plugin with its low, central and high value, by key without the
/// `cargo_bike.` prefix (for example `battery_wh` or `savings.fuel_eur_l`).
pub fn defaults() -> &'static BTreeMap<String, Default3> {
    &file().params
}

/// The values a calculation uses: the central defaults, replaced by the project's own where it set them.
#[derive(Debug, Clone, Default)]
pub struct Values {
    own: HashMap<String, f64>,
}

impl Values {
    /// Purpose: values with the project's own (keys with or without the `cargo_bike.` prefix).
    /// Non-finite numbers are ignored.
    pub fn new(own: &HashMap<String, f64>) -> Self {
        let own = own
            .iter()
            .filter(|(_, v)| v.is_finite())
            .map(|(k, v)| (k.strip_prefix("cargo_bike.").unwrap_or(k).to_string(), *v))
            .collect();
        Self { own }
    }

    /// Purpose: the project's own value, if it set one.
    pub fn own(&self, key: &str) -> Option<f64> {
        self.own.get(key).copied()
    }

    /// Purpose: one value: the project's own, else the central default.
    /// Panics on a key the plugin does not define (a programming error, caught by the tests).
    pub fn get(&self, key: &str) -> f64 {
        if let Some(v) = self.own.get(key) {
            return *v;
        }
        defaults()
            .get(key)
            .unwrap_or_else(|| panic!("unknown cargo bike parameter {key}"))
            .central
    }
}

/// The bike, rider and motor as the energy model needs them, in SI units.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bike {
    /// Bike, load and rider, kg.
    pub mass_kg: f64,
    /// Usable battery energy, Wh.
    pub usable_wh: f64,
    /// Nominal battery energy, Wh.
    pub battery_wh: f64,
    /// Sustained mechanical motor power, W.
    pub motor_w: f64,
    /// Motor and controller efficiency.
    pub motor_eff: f64,
    /// Chain and gears efficiency.
    pub drive_eff: f64,
    /// Speed above which the motor stops helping, m/s.
    pub cutoff_ms: f64,
    /// Share of the pedalling power the motor gives.
    pub assist_share: f64,
    /// Rider's sustained power, W.
    pub rider_w: f64,
    /// Rolling resistance coefficient.
    pub crr: f64,
    /// Drag area, m².
    pub cda: f64,
    /// Air density, kg/m³.
    pub rho: f64,
    /// Cruising speed per street class, m/s.
    pub speed_ms: [f64; 4],
    /// Stops per metre per street class.
    pub stops_per_m: [f64; 4],
    /// Share of traffic signals that stop the bike.
    pub signal_stop_share: f64,
    /// Route choice weight per street class.
    pub route_factor: [f64; 4],
    /// Street over straight-line distance for the range map.
    pub detour: f64,
    /// Height smoothing window, m.
    pub smoothing_m: f64,
}

impl Bike {
    /// Purpose: the bike from the plugin's values.
    pub fn from_values(v: &Values) -> Self {
        let kmh = |k: &str| v.get(k).max(1.0) / 3.6;
        let share = |k: &str| v.get(k).clamp(0.0, 1.0);
        let eff = |k: &str| v.get(k).clamp(0.05, 1.0);
        let battery_wh = v.get("battery_wh").max(0.0);
        Self {
            mass_kg: (v.get("bike_mass_kg") + v.get("load_kg") + v.get("rider_mass_kg")).max(1.0),
            usable_wh: battery_wh * share("battery_usable_share"),
            battery_wh,
            motor_w: v.get("motor_rated_w").max(0.0),
            motor_eff: eff("motor_efficiency"),
            drive_eff: eff("drivetrain_efficiency"),
            cutoff_ms: kmh("assist_cutoff_kmh"),
            assist_share: share("assist_share"),
            rider_w: v.get("rider_power_w").max(0.0),
            crr: v.get("rolling_resistance").max(0.0),
            cda: v.get("drag_area_m2").max(0.0),
            rho: v.get("air_density").max(0.0),
            speed_ms: [
                kmh("speed_separated_kmh"),
                kmh("speed_lane_kmh"),
                kmh("speed_quiet_kmh"),
                kmh("speed_mixed_kmh"),
            ],
            stops_per_m: [
                v.get("stops_per_km_separated").max(0.0) / 1000.0,
                v.get("stops_per_km_lane").max(0.0) / 1000.0,
                v.get("stops_per_km_quiet").max(0.0) / 1000.0,
                v.get("stops_per_km_mixed").max(0.0) / 1000.0,
            ],
            signal_stop_share: share("signal_stop_share"),
            route_factor: [
                v.get("route_factor_separated").max(0.1),
                v.get("route_factor_lane").max(0.1),
                v.get("route_factor_quiet").max(0.1),
                v.get("route_factor_mixed").max(0.1),
            ],
            detour: v.get("detour_factor").max(1.0),
            smoothing_m: v.get("elevation_smoothing_m").max(0.0),
        }
    }
}

impl std::default::Default for Bike {
    fn default() -> Self {
        Self::from_values(&Values::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_the_kit_of_the_product_owner() {
        let b = Bike::default();
        assert_eq!(b.mass_kg, 35.0 + 80.0 + 90.0);
        assert_eq!(b.battery_wh, 900.0);
        assert_eq!(b.motor_w, 250.0);
        assert!((b.cutoff_ms - 25.0 / 3.6).abs() < 1e-9);
        assert_eq!(Values::default().get("savings.bike_price_eur"), 4000.0);
    }

    #[test]
    fn project_values_win_with_or_without_prefix() {
        let own = HashMap::from([
            ("cargo_bike.load_kg".to_string(), 0.0),
            ("battery_wh".to_string(), 500.0),
            ("rider_mass_kg".to_string(), f64::NAN),
        ]);
        let b = Bike::from_values(&Values::new(&own));
        assert_eq!(b.mass_kg, 35.0 + 90.0);
        assert_eq!(b.battery_wh, 500.0);
    }

    #[test]
    fn the_default_kit_matches_the_defaults() {
        let (id, kits) = kits();
        let kit = kits.iter().find(|k| k.id == id).expect("default kit");
        for (k, v) in &kit.values {
            assert_eq!(defaults()[k].central, *v, "{k}");
        }
    }
}
