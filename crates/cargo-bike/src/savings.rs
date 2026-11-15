//! What a cargo bike saves against a car for the same trips, per year.
//!
//! The plugin's money values are German reference prices of 2024 in EUR. For another country the tab
//! scales them: purchase prices of the bike and the car at the market exchange rate (traded goods), the
//! rest (fuel, electricity, tax, insurance, parking, maintenance) by the price level (PPP). Values the
//! project sets are taken as they are, in the local currency.

use crate::params::{defaults, Values};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// How German 2024 EUR become local prices.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
pub struct Conversion {
    /// Local currency units per EUR at the market exchange rate (purchase prices).
    pub fx: f64,
    /// Local currency units per EUR of German prices, by price level (PPP) (everything else).
    pub ppp: f64,
}

impl Default for Conversion {
    fn default() -> Self {
        Self { fx: 1.0, ppp: 1.0 }
    }
}

/// Keys converted at the exchange rate; the other money keys follow the price level.
const FX_KEYS: [&str; 2] = ["savings.bike_price_eur", "savings.car_price_eur"];

/// Purpose: whether a savings key is an amount of money (unit starting with EUR).
fn is_money(key: &str) -> bool {
    defaults()
        .get(key)
        .is_some_and(|d| d.unit.starts_with("EUR"))
}

/// Purpose: the savings values in local prices: the project's own where set, else the default converted.
pub fn local_values(own: &HashMap<String, f64>, conv: Conversion) -> HashMap<String, f64> {
    let own = Values::new(own);
    defaults()
        .iter()
        .filter(|(k, _)| k.starts_with("savings."))
        .map(|(k, d)| {
            let v = match own.own(k) {
                Some(v) => v,
                None if is_money(k) => {
                    let f = if FX_KEYS.contains(&k.as_str()) {
                        conv.fx
                    } else {
                        conv.ppp
                    };
                    d.central * f
                }
                None => d.central,
            };
            (k.clone(), v)
        })
        .collect()
}

/// One line of the savings table, per year in the local currency.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Line {
    /// `purchase`, `energy`, `tax`, `insurance`, `parking` or `maintenance`.
    pub id: &'static str,
    /// Cost of the car.
    pub car: f64,
    /// Cost of the cargo bike.
    pub bike: f64,
    /// Car minus bike.
    pub saving: f64,
}

/// The savings table.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Savings {
    /// Kilometres a year the cargo bike rides instead of the car.
    pub km_per_year: f64,
    /// Lines per cost item.
    pub lines: Vec<Line>,
    /// Car per year.
    pub car_total: f64,
    /// Bike per year.
    pub bike_total: f64,
    /// Saving per year.
    pub saving_total: f64,
    /// Saving over the bike's lifetime.
    pub saving_lifetime: f64,
    /// Years until the bike's purchase price is paid back by the running savings (car running costs saved
    /// minus the bike's running costs); `null` when it never is.
    pub payback_years: Option<f64>,
    /// Litres of fuel not bought per year.
    pub fuel_l_per_year: f64,
    /// Electricity per year, kWh.
    pub electricity_kwh_per_year: f64,
    /// The values used, in local prices.
    pub values: HashMap<String, f64>,
}

/// Purpose: the yearly savings of riding the cargo bike instead of keeping a car.
/// Inputs: the round trip length (km) and its battery energy per km; the project's own values and the
/// conversion to local prices.
pub fn savings(
    round_trip_km: f64,
    wh_per_km: f64,
    own: &HashMap<String, f64>,
    conv: Conversion,
) -> Savings {
    let v = local_values(own, conv);
    let g = |k: &str| v.get(k).copied().unwrap_or(0.0).max(0.0);
    let km = round_trip_km.max(0.0) * g("savings.trips_per_week") * g("savings.weeks_per_year");
    let fuel_l = km * g("savings.car_fuel_l_100km") / 100.0;
    let kwh = km * wh_per_km.max(0.0) / 1000.0 / g("savings.charger_efficiency").max(0.05);
    let car_years = g("savings.car_years").max(1.0);
    let bike_years = g("savings.bike_lifetime_years").max(1.0);
    let car_dep =
        g("savings.car_price_eur") * (1.0 - g("savings.car_residual_share").min(1.0)) / car_years;
    let bike_dep = g("savings.bike_price_eur") / bike_years;
    let line = |id, car: f64, bike: f64| Line {
        id,
        car,
        bike,
        saving: car - bike,
    };
    let lines = vec![
        line("purchase", car_dep, bike_dep),
        line(
            "energy",
            fuel_l * g("savings.fuel_eur_l"),
            kwh * g("savings.electricity_eur_kwh"),
        ),
        line("tax", g("savings.car_tax_eur"), 0.0),
        line(
            "insurance",
            g("savings.car_insurance_eur"),
            g("savings.bike_insurance_eur"),
        ),
        line("parking", g("savings.car_parking_eur"), 0.0),
        line(
            "maintenance",
            km * g("savings.car_maintenance_eur_km"),
            g("savings.bike_maintenance_eur"),
        ),
    ];
    let car_total: f64 = lines.iter().map(|l| l.car).sum();
    let bike_total: f64 = lines.iter().map(|l| l.bike).sum();
    let running: f64 = lines
        .iter()
        .filter(|l| l.id != "purchase")
        .map(|l| l.saving)
        .sum::<f64>()
        + car_dep;
    Savings {
        km_per_year: km,
        car_total,
        bike_total,
        saving_total: car_total - bike_total,
        saving_lifetime: (car_total - bike_total) * bike_years,
        payback_years: (running > 0.0).then(|| g("savings.bike_price_eur") / running),
        fuel_l_per_year: fuel_l,
        electricity_kwh_per_year: kwh,
        lines,
        values: v,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_daily_cargo_bike_saves_against_a_small_car() {
        let s = savings(20.0, 9.0, &HashMap::new(), Conversion::default());
        // 20 km × 5 trips × 46 weeks.
        assert!((s.km_per_year - 4600.0).abs() < 1e-9);
        assert!(s.saving_total > 0.0);
        let energy = s.lines.iter().find(|l| l.id == "energy").unwrap();
        assert!(energy.car > 10.0 * energy.bike);
        assert!(s.payback_years.unwrap() < 4.0);
    }

    #[test]
    fn prices_follow_the_country_unless_the_project_set_them() {
        let conv = Conversion { fx: 10.0, ppp: 5.0 };
        let own = HashMap::from([("savings.car_tax_eur".to_string(), 42.0)]);
        let v = local_values(&own, conv);
        assert_eq!(v["savings.bike_price_eur"], 40_000.0);
        assert_eq!(v["savings.fuel_eur_l"], 1.75 * 5.0);
        assert_eq!(v["savings.car_tax_eur"], 42.0);
        assert_eq!(v["savings.trips_per_week"], 5.0);
    }
}
