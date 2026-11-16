//! Capacity of a depot against the fleet of the lines that use it (07-simulation §7 step 4), and a slot for
//! every vehicle so the road simulation can start and park each one in its own slot (§3.2).

use crate::layout::Issue;
use crate::model::{FleetGroup, Layout, ZoneKind};
use crate::vehicle::VehicleSpec;
use serde::Serialize;

/// Slots of each kind.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct SlotCounts {
    /// Parking slots.
    pub parking: u32,
    /// Charging slots (one charger each).
    pub charging: u32,
    /// Workshop positions.
    pub maintenance: u32,
    /// Slots for spare vehicles.
    pub reserve: u32,
}

/// One vehicle type of the fleet against the slots it fits.
#[derive(Debug, Clone, Serialize)]
pub struct Row {
    /// Vehicle key.
    pub vehicle: String,
    /// Vehicle name.
    pub name: String,
    /// Length, m.
    pub length_m: f64,
    /// Vehicles of this type with spares.
    pub needed: u32,
    /// Of them, battery vehicles that charge in the depot.
    pub charging_needed: u32,
    /// Parking, charging and reserve slots long and wide enough for it.
    pub fitting_slots: u32,
    /// Charging slots long and wide enough for it.
    pub fitting_charging: u32,
    /// Vehicles that got a slot.
    pub placed: u32,
}

/// The slot one vehicle starts and ends its day in.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Assignment {
    /// Line id.
    pub line: String,
    /// Vehicle number within the line, from 1.
    pub vehicle: u32,
    /// Lane id.
    pub lane: String,
    /// Slot id.
    pub slot: String,
    /// The slot has a charger.
    pub charger: bool,
}

/// Capacity report.
#[derive(Debug, Clone, Serialize)]
pub struct Capacity {
    /// Slots by kind.
    pub slots: SlotCounts,
    /// Chargers, and their power each, kW.
    pub chargers: u32,
    /// Power of each charger, kW.
    pub charger_power_kw: f64,
    /// Per vehicle type.
    pub rows: Vec<Row>,
    /// Vehicles of all lines (with spares).
    pub fleet: u32,
    /// A slot per vehicle.
    pub assignments: Vec<Assignment>,
    /// Shortfalls.
    pub issues: Vec<Issue>,
}

/// Purpose: whether a vehicle fits a slot (length, and width with 0.3 m to spare).
pub fn fits(v: &VehicleSpec, length_m: f64, width_m: f64) -> bool {
    v.length_m <= length_m + 0.05 && v.width_m <= width_m - 0.3 + 1e-9
}

/// Purpose: count slots, check them against the fleet and give every vehicle a slot.
/// Inputs: the layout, the vehicle types, the fleet groups and the charger power (`depot.charger_power_kw`).
/// Assignment: battery vehicles first, longest vehicles first, each in the shortest free slot that fits:
/// charging slots for battery vehicles, then parking, reserve, and last charging slots for the others.
/// Workshop positions are not used for parking. Lanes fill from their exit end, so a line's vehicles
/// stand together.
pub fn assign(
    layout: &Layout,
    vehicles: &[VehicleSpec],
    fleet: &[FleetGroup],
    charger_power_kw: f64,
) -> Capacity {
    struct S<'a> {
        lane: &'a str,
        id: &'a str,
        kind: ZoneKind,
        charger: bool,
        length: f64,
        width: f64,
        free: bool,
    }
    let mut slots: Vec<S> = Vec::new();
    let mut counts = SlotCounts::default();
    let mut chargers = 0;
    for l in &layout.lanes {
        for s in &l.slots {
            match l.kind {
                ZoneKind::Parking => counts.parking += 1,
                ZoneKind::Charging => counts.charging += 1,
                ZoneKind::Maintenance => counts.maintenance += 1,
                ZoneKind::Reserve => counts.reserve += 1,
                ZoneKind::Circulation => {}
            }
            if s.charger {
                chargers += 1;
            }
            slots.push(S {
                lane: &l.id,
                id: &s.id,
                kind: l.kind,
                charger: s.charger,
                length: s.length_m,
                width: s.width_m,
                free: l.kind != ZoneKind::Maintenance,
            });
        }
    }
    let spec = |key: &str| vehicles.iter().find(|v| v.key == key);
    let mut order: Vec<&FleetGroup> = fleet.iter().filter(|g| g.count > 0).collect();
    order.sort_by(|a, b| {
        b.charging
            .cmp(&a.charging)
            .then_with(|| {
                let la = spec(&a.vehicle).map_or(0.0, |v| v.length_m);
                let lb = spec(&b.vehicle).map_or(0.0, |v| v.length_m);
                lb.total_cmp(&la)
            })
            .then_with(|| a.line.cmp(&b.line))
    });
    let mut assignments = Vec::new();
    let mut issues = Vec::new();
    let mut placed_by_key: std::collections::HashMap<String, u32> = Default::default();
    for g in &order {
        let Some(v) = spec(&g.vehicle) else {
            issues.push(Issue::new(
                "error",
                Some(&g.line),
                format!("{}: its vehicle is unknown to the depot.", label(g)),
            ));
            continue;
        };
        let mut short = 0;
        let mut on_plain = 0;
        for n in 1..=g.count {
            let rank = |s: &S| -> Option<u8> {
                if !s.free || !fits(v, s.length, s.width) {
                    return None;
                }
                Some(match (g.charging, s.charger, s.kind) {
                    (true, true, _) => 0,
                    (_, false, ZoneKind::Parking) => 1,
                    (_, false, ZoneKind::Reserve) => 2,
                    (false, true, _) => 3,
                    _ => 4,
                })
            };
            // Best kind first, then the shortest slot, then layout order.
            let best = slots
                .iter()
                .enumerate()
                .filter_map(|(i, s)| rank(s).map(|r| (r, s.length, i)))
                .min_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)).then(a.2.cmp(&b.2)));
            match best {
                Some((r, _, i)) => {
                    let s = &mut slots[i];
                    s.free = false;
                    if g.charging && !s.charger {
                        on_plain += 1;
                    }
                    let _ = r;
                    assignments.push(Assignment {
                        line: g.line.clone(),
                        vehicle: n,
                        lane: s.lane.to_string(),
                        slot: s.id.to_string(),
                        charger: s.charger,
                    });
                    *placed_by_key.entry(v.key.clone()).or_default() += 1;
                }
                None => short += 1,
            }
        }
        if short > 0 {
            issues.push(Issue::new(
                "error",
                Some(&g.line),
                format!(
                    "{}: {short} of {} vehicles have no slot that fits them ({:.1} m long).",
                    label(g),
                    g.count,
                    v.length_m
                ),
            ));
        }
        if on_plain > 0 {
            issues.push(Issue::new(
                "warning",
                Some(&g.line),
                format!(
                    "{}: {on_plain} battery vehicles park without a charger.",
                    label(g)
                ),
            ));
        }
    }
    // Rows per vehicle type.
    let mut rows: Vec<Row> = Vec::new();
    for g in fleet.iter().filter(|g| g.count > 0) {
        let Some(v) = spec(&g.vehicle) else { continue };
        let row = match rows.iter_mut().position(|r| r.vehicle == v.key) {
            Some(i) => &mut rows[i],
            None => {
                let usable = |s: &S| s.kind != ZoneKind::Maintenance && fits(v, s.length, s.width);
                rows.push(Row {
                    vehicle: v.key.clone(),
                    name: v.name.clone(),
                    length_m: v.length_m,
                    needed: 0,
                    charging_needed: 0,
                    fitting_slots: slots.iter().filter(|s| usable(s)).count() as u32,
                    fitting_charging: slots.iter().filter(|s| usable(s) && s.charger).count()
                        as u32,
                    placed: placed_by_key.get(&v.key).copied().unwrap_or(0),
                });
                rows.last_mut().expect("just pushed")
            }
        };
        row.needed += g.count;
        if g.charging {
            row.charging_needed += g.count;
        }
    }
    let fleet_n: u32 = fleet.iter().map(|g| g.count).sum();
    Capacity {
        slots: counts,
        chargers,
        charger_power_kw,
        rows,
        fleet: fleet_n,
        assignments,
        issues,
    }
}

fn label(g: &FleetGroup) -> String {
    if g.name.is_empty() {
        g.line.clone()
    } else {
        g.name.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Lane, Slot};

    fn lane(id: &str, kind: ZoneKind, n: usize, len: f64, charger: bool) -> Lane {
        Lane {
            id: id.into(),
            zone: "z".into(),
            kind,
            entry: [0.0, 0.0],
            exit: [0.0, 0.0],
            width_m: 3.55,
            aisle_in: None,
            aisle_out: None,
            slots: (0..n)
                .map(|k| Slot {
                    id: format!("{id}-s{}", k + 1),
                    center: [0.0, 0.0],
                    heading_deg: 0.0,
                    length_m: len,
                    width_m: 3.55,
                    charger,
                })
                .collect(),
        }
    }

    fn v(key: &str, len: f64) -> VehicleSpec {
        VehicleSpec {
            key: key.into(),
            name: key.into(),
            length_m: len,
            width_m: 2.55,
            articulations: 0,
            axles_m: None,
            turning_circle_m: None,
        }
    }

    #[test]
    fn battery_buses_get_chargers_and_long_buses_long_slots() {
        let layout = Layout {
            lanes: vec![
                lane("c", ZoneKind::Charging, 2, 12.0, true),
                lane("p", ZoneKind::Parking, 2, 18.0, false),
                lane("q", ZoneKind::Parking, 2, 12.0, false),
                lane("m", ZoneKind::Maintenance, 1, 18.0, false),
            ],
            aisles: vec![],
        };
        let vehicles = vec![v("e12", 12.0), v("d18", 18.0)];
        let fleet = vec![
            FleetGroup {
                line: "a".into(),
                name: "A".into(),
                vehicle: "d18".into(),
                count: 2,
                charging: false,
            },
            FleetGroup {
                line: "b".into(),
                name: "B".into(),
                vehicle: "e12".into(),
                count: 3,
                charging: true,
            },
        ];
        let c = assign(&layout, &vehicles, &fleet, 150.0);
        assert_eq!(
            c.slots,
            SlotCounts {
                parking: 4,
                charging: 2,
                maintenance: 1,
                reserve: 0
            }
        );
        let of = |line: &str| {
            c.assignments
                .iter()
                .filter(|a| a.line == line)
                .map(|a| a.lane.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(of("b"), vec!["c", "c", "q"]);
        assert_eq!(of("a"), vec!["p", "p"]);
        assert!(c
            .issues
            .iter()
            .any(|i| i.message.contains("without a charger")));
    }

    #[test]
    fn shortfall_is_an_error() {
        let layout = Layout {
            lanes: vec![lane("q", ZoneKind::Parking, 1, 12.0, false)],
            aisles: vec![],
        };
        let fleet = vec![FleetGroup {
            line: "a".into(),
            name: "A".into(),
            vehicle: "d18".into(),
            count: 1,
            charging: false,
        }];
        let c = assign(&layout, &[v("d18", 18.0)], &fleet, 150.0);
        assert!(c.assignments.is_empty());
        assert_eq!(c.issues[0].severity, "error");
    }
}
