//! A street laid out section by section: the planner's custom layout in the GIS tab.
//!
//! A [`Section`] is one strip of the street from building to building, listed left to right looking
//! along the OSM way: a lane or path with the road users allowed on it (cars, buses, trams, bikes,
//! taxis, pedestrians; more than one is mixed traffic) and the way it runs, or a strip no one travels
//! on (parking, a traffic island, a green strip, protection between lanes).
//!
//! The layout replaces the street's OSM lanes. For the bus road graph, the railway design and the road
//! simulation it is reduced to what they read ([`Layout`]): the general traffic lanes in each direction,
//! where buses and trams have their own lanes, whether those lanes are protected from the traffic, and
//! whether cars may use the street at all.

use serde::{Deserialize, Serialize};

/// What a section of the street is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SectionKind {
    /// A lane or path that the users of the section travel along.
    Lane,
    /// Parking along the street.
    Parking,
    /// A traffic island or median.
    Island,
    /// A green strip: trees, grass or shrubs.
    Green,
    /// Protection between lanes: a kerb, bollards or planters.
    Protection,
}

/// Who may use a lane.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoadUser {
    /// Cars, vans and lorries: general traffic.
    Car,
    /// Buses.
    Bus,
    /// Trams (rails run in the lane).
    Tram,
    /// Bikes.
    Bike,
    /// Taxis.
    Taxi,
    /// People on foot.
    Walk,
}

/// Which way a lane runs, along the OSM way's node order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SectionDir {
    /// In the way's direction.
    Forward,
    /// Against it.
    Backward,
    /// Both ways.
    Both,
}

/// One strip of a street laid out by the planner.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Section {
    /// What the section is.
    pub kind: SectionKind,
    /// Who may use it (lanes only; empty: no one yet).
    #[serde(default)]
    pub users: Vec<RoadUser>,
    /// Which way it runs (lanes that vehicles or bikes use). `None`: both ways.
    #[serde(default)]
    pub dir: Option<SectionDir>,
    /// Width, m.
    pub width: f64,
    /// How a protection, island or green strip is built or planted (`kerb`, `bollards`, `planters`,
    /// `raised`, `painted`, `trees`, `grass`, `shrubs`). Drawing only.
    #[serde(default)]
    pub style: Option<String>,
}

impl Section {
    /// Purpose: whether `u` may use the section.
    pub fn has(&self, u: RoadUser) -> bool {
        self.kind == SectionKind::Lane && self.users.contains(&u)
    }

    /// Purpose: whether vehicles or bikes travel along it (a lane with a user other than pedestrians).
    pub fn moves(&self) -> bool {
        self.kind == SectionKind::Lane && self.users.iter().any(|&u| u != RoadUser::Walk)
    }

    /// Purpose: whether it runs forward (`true`) or backward (`false`) along the way.
    pub fn goes(&self, forward: bool) -> bool {
        self.moves()
            && match self.dir.unwrap_or(SectionDir::Both) {
                SectionDir::Both => true,
                SectionDir::Forward => forward,
                SectionDir::Backward => !forward,
            }
    }

    /// Purpose: whether it is a lane of its own for `u`: `u` may use it and cars may not.
    pub fn own(&self, u: RoadUser) -> bool {
        self.has(u) && !self.has(RoadUser::Car)
    }

    /// Purpose: whether it keeps the traffic out of the lane beside it.
    fn shields(&self) -> bool {
        matches!(
            self.kind,
            SectionKind::Parking
                | SectionKind::Island
                | SectionKind::Green
                | SectionKind::Protection
        )
    }
}

/// What a custom layout means for traffic, as the routing and simulation read it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Layout {
    /// General traffic lanes (cars may use them) forward along the way.
    pub cars_forward: u8,
    /// General traffic lanes backward.
    pub cars_backward: u8,
    /// Buses may drive forward (in a lane of their own or in mixed traffic).
    pub bus_forward: bool,
    /// Buses may drive backward.
    pub bus_backward: bool,
    /// Bus lanes (no cars) forward.
    pub bus_lanes_forward: u8,
    /// Bus lanes backward.
    pub bus_lanes_backward: u8,
    /// A lane of its own for bikes (cars may not use it).
    pub bike_lane: bool,
    /// A tram runs along the street.
    pub tram: bool,
    /// The tram has lanes of its own (no cars) in every direction it runs.
    pub tram_own_lane: bool,
    /// Every bus, tram and bike lane of its own has parking, an island, a green strip or protection
    /// beside it, or no cars use the street: the traffic cannot drive or stop in them.
    pub separated: bool,
}

impl Layout {
    /// Purpose: reduce the sections of a street to what the routing and simulation read.
    pub fn of(sections: &[Section]) -> Self {
        let count = |f: &dyn Fn(&Section) -> bool| {
            u8::try_from(sections.iter().filter(|s| f(s)).count()).unwrap_or(u8::MAX)
        };
        let any = |f: &dyn Fn(&Section) -> bool| sections.iter().any(f);
        let cars_forward = count(&|s| s.goes(true) && s.has(RoadUser::Car));
        let cars_backward = count(&|s| s.goes(false) && s.has(RoadUser::Car));
        let no_cars = cars_forward == 0 && cars_backward == 0;
        let shielded = |i: usize| {
            (i > 0 && sections[i - 1].shields())
                || sections.get(i + 1).is_some_and(Section::shields)
        };
        let separated = no_cars
            || sections.iter().enumerate().all(|(i, s)| {
                let own = s.own(RoadUser::Bus) || s.own(RoadUser::Tram) || s.own(RoadUser::Bike);
                !own || !s.moves() || shielded(i)
            });
        let tram_dirs = |own: bool, forward: bool| {
            any(&|s| {
                s.goes(forward)
                    && if own {
                        s.own(RoadUser::Tram)
                    } else {
                        s.has(RoadUser::Tram)
                    }
            })
        };
        let tram = any(&|s| s.has(RoadUser::Tram));
        let tram_own_lane = tram
            && [true, false]
                .iter()
                .all(|&f| !tram_dirs(false, f) || tram_dirs(true, f));
        Layout {
            cars_forward,
            cars_backward,
            bus_forward: any(&|s| s.goes(true) && s.has(RoadUser::Bus)),
            bus_backward: any(&|s| s.goes(false) && s.has(RoadUser::Bus)),
            bus_lanes_forward: count(&|s| s.goes(true) && s.own(RoadUser::Bus)),
            bus_lanes_backward: count(&|s| s.goes(false) && s.own(RoadUser::Bus)),
            bike_lane: any(&|s| s.moves() && s.own(RoadUser::Bike)),
            tram,
            tram_own_lane,
            separated,
        }
    }

    /// Purpose: whether cars may use the street.
    pub fn cars(&self) -> bool {
        self.cars_forward + self.cars_backward > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use RoadUser::*;

    pub(crate) fn lane(users: &[RoadUser], dir: SectionDir) -> Section {
        Section {
            kind: SectionKind::Lane,
            users: users.to_vec(),
            dir: Some(dir),
            width: 3.0,
            style: None,
        }
    }

    fn strip(kind: SectionKind) -> Section {
        Section {
            kind,
            users: Vec::new(),
            dir: None,
            width: 1.0,
            style: None,
        }
    }

    #[test]
    fn general_traffic_both_ways() {
        let l = Layout::of(&[
            lane(&[Walk], SectionDir::Both),
            lane(&[Car, Bus, Taxi], SectionDir::Backward),
            lane(&[Car, Bus, Taxi], SectionDir::Forward),
            lane(&[Car, Bus, Taxi], SectionDir::Forward),
            lane(&[Walk], SectionDir::Both),
        ]);
        assert_eq!((l.cars_forward, l.cars_backward), (2, 1));
        assert!(l.bus_forward && l.bus_backward);
        assert_eq!((l.bus_lanes_forward, l.bus_lanes_backward), (0, 0));
        assert!(!l.tram && !l.bike_lane);
    }

    #[test]
    fn centre_bus_lanes_behind_protection_are_separated() {
        let l = Layout::of(&[
            lane(&[Car], SectionDir::Backward),
            strip(SectionKind::Protection),
            lane(&[Bus], SectionDir::Backward),
            strip(SectionKind::Island),
            lane(&[Bus], SectionDir::Forward),
            strip(SectionKind::Protection),
            lane(&[Car], SectionDir::Forward),
        ]);
        assert_eq!((l.bus_lanes_forward, l.bus_lanes_backward), (1, 1));
        assert!(l.separated);
        // The same bus lanes painted next to the cars are not.
        let painted = Layout::of(&[
            lane(&[Car], SectionDir::Backward),
            lane(&[Bus], SectionDir::Backward),
            lane(&[Bus], SectionDir::Forward),
            lane(&[Car], SectionDir::Forward),
        ]);
        assert!(!painted.separated);
    }

    #[test]
    fn trams_and_people_only() {
        let l = Layout::of(&[
            lane(&[Walk], SectionDir::Both),
            lane(&[Tram], SectionDir::Backward),
            lane(&[Tram], SectionDir::Forward),
            lane(&[Walk], SectionDir::Both),
        ]);
        assert!(!l.cars() && !l.bus_forward && !l.bus_backward);
        assert!(l.tram && l.tram_own_lane && l.separated);
    }

    #[test]
    fn a_tram_sharing_a_lane_with_cars_is_mixed() {
        let l = Layout::of(&[
            lane(&[Car, Tram], SectionDir::Backward),
            lane(&[Tram], SectionDir::Forward),
            lane(&[Car], SectionDir::Forward),
        ]);
        assert!(l.tram && !l.tram_own_lane);
    }

    #[test]
    fn a_section_reads_from_json() {
        let s: Section = serde_json::from_str(
            r#"{"kind":"lane","users":["bus","taxi"],"dir":"backward","width":3.3}"#,
        )
        .unwrap();
        assert_eq!(
            s,
            Section {
                width: 3.3,
                ..lane(&[Bus, Taxi], SectionDir::Backward)
            }
        );
        let g: Section =
            serde_json::from_str(r#"{"kind":"green","width":2.5,"style":"trees"}"#).unwrap();
        assert!(!g.moves() && g.shields());
    }
}
