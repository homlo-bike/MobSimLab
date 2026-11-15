//! Energy and emissions of the service lines (energy plugin, calculation `energy_emissions`).
//!
//! A first estimate from the service each line runs, before the simulation exists: vehicle-km a year
//! times an energy intensity, split between electric and diesel traction, times an emission factor.
//!
//! - **Electric traction** is counted where the energy is bought: at the substation for rail and
//!   trolleybuses, at the charger for battery buses (the charging loss on top of the energy taken from
//!   the battery). Its greenhouse gas emissions come from the grid's emission intensity.
//! - **Diesel** is counted in litres; its emissions are tank-to-wheel (burning it) plus well-to-tank
//!   (producing and delivering it), so electric and diesel traction are compared on the same footing.
//! - **Intensity** is per vehicle-km for street modes, whose vehicles are of one size, and per place-km
//!   for rail, whose trains range from a 2-car tram to a 16-car high-speed train: the line's places per
//!   train (seats and standing) times the value per place-km gives the value per train-km.
//!
//! All values are parameters of the plugin (`energy.*`, resolved for the line's mode with the project's
//! own values on top), so the estimate is as good as those values and says which ones it used.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One line: its mode, its yearly service and the parameter values for its mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LineInput {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub mode: String,
    /// Vehicle-km a year (trains counted once, however many units).
    pub vehicle_km: f64,
    /// Places per vehicle or train (seats and standing).
    #[serde(default)]
    pub places: f64,
    /// `energy.*` parameter values for the line's mode, by key.
    pub params: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnergyInput {
    pub lines: Vec<LineInput>,
}

/// Energy and emissions of one line, or of a group of lines, a year.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Totals {
    pub vehicle_km: f64,
    /// Electricity bought (substation or charger), kWh.
    pub electricity_kwh: f64,
    /// Diesel, litres.
    pub diesel_l: f64,
    /// Final energy, electricity plus the diesel's energy content, kWh.
    pub energy_kwh: f64,
    /// Greenhouse gas emissions, kg CO2e: electricity generation, diesel well-to-tank and tank-to-wheel.
    pub co2e_kg: f64,
    pub co2e_electric_kg: f64,
    pub co2e_diesel_kg: f64,
    /// Place-km a year (vehicle-km times places), for the intensity per place-km.
    pub place_km: f64,
}

impl Totals {
    fn add(&mut self, o: &Totals) {
        self.vehicle_km += o.vehicle_km;
        self.electricity_kwh += o.electricity_kwh;
        self.diesel_l += o.diesel_l;
        self.energy_kwh += o.energy_kwh;
        self.co2e_kg += o.co2e_kg;
        self.co2e_electric_kg += o.co2e_electric_kg;
        self.co2e_diesel_kg += o.co2e_diesel_kg;
        self.place_km += o.place_km;
    }
}

/// One line's estimate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LineEstimate {
    pub id: String,
    pub name: String,
    pub mode: String,
    #[serde(flatten)]
    pub totals: Totals,
    /// Share of the vehicle-km run on electricity (0 to 1).
    pub electric_share: f64,
    /// kWh of final energy per vehicle-km.
    pub kwh_per_vkm: f64,
    /// g CO2e per vehicle-km.
    pub g_per_vkm: f64,
    /// g CO2e per place-km offered (every place filled); null without places.
    pub g_per_place_km: Option<f64>,
    /// Whether the intensity came per place-km (rail) rather than per vehicle-km (street).
    pub per_place: bool,
    /// Parameters the line needed and did not get; they count as 0.
    pub missing: Vec<String>,
}

/// The estimate: per line, per mode and for the network.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnergyEstimate {
    pub lines: Vec<LineEstimate>,
    pub by_mode: BTreeMap<String, Totals>,
    pub total: Totals,
}

const ELECTRIC_SHARE: &str = "energy.electric_share";
const KWH_PER_VKM: &str = "energy.electric_kwh_per_vkm";
const WH_PER_PLACE_KM: &str = "energy.electric_wh_per_place_km";
const L_PER_VKM: &str = "energy.diesel_l_per_vkm";
const ML_PER_PLACE_KM: &str = "energy.diesel_ml_per_place_km";
const CHARGING_LOSS: &str = "energy.charging_loss_share";
const GRID: &str = "energy.grid_kg_co2e_per_kwh";
const DIESEL_TTW: &str = "energy.diesel_ttw_kg_co2e_per_l";
const DIESEL_WTT: &str = "energy.diesel_wtt_kg_co2e_per_l";
const DIESEL_KWH: &str = "energy.diesel_kwh_per_l";

fn finite(x: f64) -> f64 {
    if x.is_finite() {
        x.max(0.0)
    } else {
        0.0
    }
}

/// Purpose: the energy and emissions of one line a year.
/// Input: the line with its mode's parameter values. Output: the line's estimate.
pub fn line(l: &LineInput) -> LineEstimate {
    let mut missing = Vec::new();
    let mut p = |k: &str| match l.params.get(k) {
        Some(v) => finite(*v),
        None => {
            missing.push(k.to_string());
            0.0
        }
    };
    let share = p(ELECTRIC_SHARE).min(1.0);
    let places = finite(l.places);
    let vkm = finite(l.vehicle_km);
    let wh_place = p(WH_PER_PLACE_KM);
    let ml_place = p(ML_PER_PLACE_KM);
    let per_place = places > 0.0 && (wh_place > 0.0 || ml_place > 0.0);
    let (kwh_vkm, l_vkm) = if per_place {
        (wh_place * places / 1000.0, ml_place * places / 1000.0)
    } else {
        (p(KWH_PER_VKM), p(L_PER_VKM))
    };
    let loss = p(CHARGING_LOSS);
    let grid = p(GRID);
    let (ttw, wtt, diesel_kwh) = if share < 1.0 {
        (p(DIESEL_TTW), p(DIESEL_WTT), p(DIESEL_KWH))
    } else {
        (0.0, 0.0, 0.0)
    };
    let electricity_kwh = vkm * share * kwh_vkm * (1.0 + loss);
    let diesel_l = vkm * (1.0 - share) * l_vkm;
    let co2e_electric_kg = electricity_kwh * grid;
    let co2e_diesel_kg = diesel_l * (ttw + wtt);
    let totals = Totals {
        vehicle_km: vkm,
        electricity_kwh,
        diesel_l,
        energy_kwh: electricity_kwh + diesel_l * diesel_kwh,
        co2e_kg: co2e_electric_kg + co2e_diesel_kg,
        co2e_electric_kg,
        co2e_diesel_kg,
        place_km: vkm * places,
    };
    let per = |a: f64, b: f64| if b > 0.0 { a / b } else { 0.0 };
    LineEstimate {
        id: l.id.clone(),
        name: l.name.clone(),
        mode: l.mode.clone(),
        electric_share: share,
        kwh_per_vkm: per(totals.energy_kwh, vkm),
        g_per_vkm: per(totals.co2e_kg * 1000.0, vkm),
        g_per_place_km: (totals.place_km > 0.0).then(|| totals.co2e_kg * 1000.0 / totals.place_km),
        per_place,
        missing,
        totals,
    }
}

/// Purpose: the energy and emissions of every line, summed per mode and for the network.
/// Input: the lines with their parameter values. Output: the estimate; lines keep their order.
pub fn estimate(input: &EnergyInput) -> EnergyEstimate {
    let lines: Vec<LineEstimate> = input.lines.iter().map(line).collect();
    let mut by_mode: BTreeMap<String, Totals> = BTreeMap::new();
    let mut total = Totals::default();
    for l in &lines {
        by_mode.entry(l.mode.clone()).or_default().add(&l.totals);
        total.add(&l.totals);
    }
    EnergyEstimate {
        lines,
        by_mode,
        total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(kv: &[(&str, f64)]) -> BTreeMap<String, f64> {
        let mut m: BTreeMap<String, f64> = [
            (ELECTRIC_SHARE, 0.0),
            (KWH_PER_VKM, 1.15),
            (WH_PER_PLACE_KM, 0.0),
            (L_PER_VKM, 0.39),
            (ML_PER_PLACE_KM, 0.0),
            (CHARGING_LOSS, 0.1),
            (GRID, 0.2),
            (DIESEL_TTW, 2.66),
            (DIESEL_WTT, 0.61),
            (DIESEL_KWH, 10.0),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), *v))
        .collect();
        for (k, v) in kv {
            m.insert(k.to_string(), *v);
        }
        m
    }

    fn bus(share: f64) -> LineInput {
        LineInput {
            id: "street:0".into(),
            name: "10".into(),
            mode: "bus".into(),
            vehicle_km: 1_000_000.0,
            places: 80.0,
            params: params(&[(ELECTRIC_SHARE, share)]),
        }
    }

    #[test]
    fn diesel_bus_burns_litres_and_emits_well_to_wheel() {
        let e = line(&bus(0.0));
        // 1 million km at 0.39 L/km: 390,000 L, 3.9 GWh, (2.66 + 0.61) × 390,000 kg.
        assert!((e.totals.diesel_l - 390_000.0).abs() < 1e-6);
        assert_eq!(e.totals.electricity_kwh, 0.0);
        assert!((e.totals.energy_kwh - 3_900_000.0).abs() < 1e-3);
        assert!((e.totals.co2e_kg - 3.27 * 390_000.0).abs() < 1e-3);
        assert!((e.g_per_vkm - 1275.3).abs() < 1e-6);
        assert!(!e.per_place);
        assert!(e.missing.is_empty());
    }

    #[test]
    fn battery_bus_buys_electricity_with_the_charging_loss() {
        let e = line(&bus(1.0));
        // 1.15 kWh/km from the battery, 10 % lost charging: 1.265 GWh from the grid at 0.2 kg/kWh.
        assert!((e.totals.electricity_kwh - 1_265_000.0).abs() < 1e-3);
        assert_eq!(e.totals.diesel_l, 0.0);
        assert!((e.totals.co2e_kg - 253_000.0).abs() < 1e-3);
        // Diesel factors are not needed for a fully electric line.
        let mut l = bus(1.0);
        l.params.remove(DIESEL_TTW);
        assert!(line(&l).missing.is_empty());
    }

    #[test]
    fn rail_scales_with_the_places_of_the_train_and_sums_per_mode() {
        let tram = |id: &str, places: f64| LineInput {
            id: id.into(),
            name: id.into(),
            mode: "tram".into(),
            vehicle_km: 500_000.0,
            places,
            params: params(&[
                (ELECTRIC_SHARE, 1.0),
                (WH_PER_PLACE_KM, 15.0),
                (CHARGING_LOSS, 0.0),
            ]),
        };
        let e = estimate(&EnergyInput {
            lines: vec![tram("a", 200.0), tram("b", 400.0), bus(0.0)],
        });
        // 15 Wh × 200 places = 3 kWh per tram-km.
        assert!((e.lines[0].kwh_per_vkm - 3.0).abs() < 1e-9);
        assert!((e.lines[1].kwh_per_vkm - 6.0).abs() < 1e-9);
        assert!(e.lines[0].per_place);
        // 15 Wh × 0.2 kg/kWh = 3 g per place-km.
        assert!((e.lines[0].g_per_place_km.unwrap() - 3.0).abs() < 1e-9);
        let t = &e.by_mode["tram"];
        assert!((t.electricity_kwh - 4_500_000.0).abs() < 1e-3);
        assert!((e.total.co2e_kg - (900_000.0 + 3.27 * 390_000.0)).abs() < 1e-3);
        assert_eq!(e.by_mode.len(), 2);
    }

    #[test]
    fn missing_values_count_as_zero_and_are_named() {
        let mut l = bus(0.0);
        l.params.remove(L_PER_VKM);
        l.vehicle_km = f64::NAN;
        let e = line(&l);
        assert_eq!(e.missing, vec![L_PER_VKM.to_string()]);
        assert_eq!(e.totals.co2e_kg, 0.0);
        assert_eq!(e.g_per_vkm, 0.0);
    }
}
