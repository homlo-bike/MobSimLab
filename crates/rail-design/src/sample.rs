//! An example line for a mode, scaled to the mode: two stations, a double track with two curves,
//! a crossover, a turnout to a stabling siding and a crossing line (a tram line on one shared
//! diamond for commuter and regional rail). Used by the editor's
//! "Example" button and by the tests. [`sample_streets`] adds a street with a bus route across the
//! main line: on the level where the mode allows level crossings, else on a bridge.

use crate::design::build;
use crate::geom::{at_s, P2};
use crate::model::{
    Anchor, Bed, Level, Network, Pi, Power, Station, Switch, SwitchKind, Track, TrackUse,
};
use crate::params::{defaults, RailMode};

fn scale(m: RailMode) -> f64 {
    match m {
        RailMode::Tram => 600.0,
        RailMode::LightRail => 1000.0,
        RailMode::Metro => 1300.0,
        RailMode::CommuterRail => 2500.0,
        RailMode::RegionalRail => 3500.0,
        RailMode::LongDistanceRail => 6000.0,
        RailMode::HighSpeedRail => 10000.0,
    }
}

fn track(id: u32, start: Anchor, end: Option<Anchor>, level: Level) -> Track {
    Track {
        id,
        name: String::new(),
        start,
        end,
        points: vec![],
        tracks: 2,
        level,
        power: Power::Auto,
        usage: TrackUse::Running,
        bed: Bed::Auto,
        lead_start_m: 30.0,
        lead_end_m: 30.0,
        radius_start_m: None,
        radius_end_m: None,
        directions: vec![],
        mode: None,
    }
}

/// Purpose: the example network for a mode around an origin (degrees).
pub fn sample(mode: RailMode, lon: f64, lat: f64) -> Network {
    let d = defaults();
    let p = d.mode(mode);
    let big = scale(mode);
    let mut net = Network::new(mode, [lon, lat]);
    let (la, lb) = match mode {
        RailMode::Metro => (Level::Underground, Level::Elevated),
        _ => (Level::Street, Level::Street),
    };
    let station = |id: u32, name: &str, x: f64, y: f64, level: Level| Station {
        id,
        name: name.into(),
        x,
        y,
        rotation_deg: 0.0,
        level,
        side_platforms: if mode == RailMode::Tram { 2 } else { 0 },
        island_platforms: if mode == RailMode::Tram { 0 } else { 1 },
        platform_length_m: p.platform_length_m,
        mode: None,
    };
    let start_x = -0.5 * big;
    net.stations.push(station(1, "Riverside", start_x, 0.0, la));
    net.stations
        .push(station(2, "Northgate", start_x + big, 0.25 * big, lb));
    let mut main = track(
        3,
        Anchor::Station {
            station: 1,
            end: 1,
            tracks: vec![0, 1],
        },
        Some(Anchor::Station {
            station: 2,
            end: 0,
            tracks: vec![0, 1],
        }),
        // metro: out of the underground station, up to street level and on to the viaduct
        if mode == RailMode::Metro {
            Level::Street
        } else {
            la
        },
    );
    main.lead_start_m = 0.25 * big;
    main.lead_end_m = 0.3 * big;
    net.tracks.push(main);
    let g = build(&net, None);
    let Some(mg) = g.track(3).cloned() else {
        return net;
    };
    let (Some(c1), Some(c2)) = (mg.curves.first().cloned(), mg.curves.get(1).cloned()) else {
        return net;
    };
    let turnout = d
        .switch(&p.default_turnout)
        .and_then(|s| s.turnout_geometry());
    // Crossover, then a turnout to a stabling siding, on the straight between the two curves.
    let ramp_end = mg
        .ramps
        .iter()
        .filter(|r| r.s0 < mg.length / 2.0)
        .map(|r| r.s1)
        .fold(0.0, f64::max);
    let xo_s = c1.s1.max(ramp_end).max(mg.spread_start) + 15.0;
    if let Some(t) = turnout {
        let lx = 2.0 * t.a + mg.spacing * t.n;
        if xo_s + lx < c2.s0 - 5.0 {
            net.switches.push(Switch {
                id: 4,
                kind: SwitchKind::Crossover,
                track: 3,
                s: xo_s,
                element: p.default_turnout.clone(),
                side: 1,
                direction: 1,
                flip: false,
            });
        }
        // Turnout on the outer side, to a stabling siding.
        let side: i8 = if c2.deflection > 0.0 { -1 } else { 1 };
        let s_tu = xo_s + lx + (t.a + t.b).max(20.0);
        if s_tu + t.a + t.b < c2.s0 - 20.0 {
            net.switches.push(Switch {
                id: 5,
                kind: SwitchKind::Turnout,
                track: 3,
                s: s_tu,
                element: p.default_turnout.clone(),
                side,
                direction: 1,
                flip: false,
            });
            let g2 = build(&net, None);
            if let Some(leg) = g2.switch(5).and_then(|s| s.anchors.first().copied()) {
                let target = p.track_centre_m + 1.5;
                let lead = ((target - t.radius * (1.0 - t.alpha.cos())) / t.alpha.sin()).max(8.0);
                let q = at_s(&mg.centre, s_tu);
                let ux = P2::dir(q.h);
                let bend = leg.p.add(leg.dir.unwrap_or(ux).mul(lead));
                let len = (p.platform_length_m * 1.15).max(60.0);
                let end = bend.add(ux.mul(len));
                let mut siding = track(
                    6,
                    Anchor::Switch { switch: 5, leg: 0 },
                    None,
                    mg.level_at(s_tu).unwrap_or(la),
                );
                siding.tracks = 1;
                siding.usage = TrackUse::Storage;
                siding.name = "Stabling siding".into();
                siding.lead_start_m = lead;
                siding.end = Some(Anchor::Free {
                    x: end.x,
                    y: end.y,
                    level: None,
                });
                net.tracks.push(siding);
            }
        }
    }
    // A crossing line: on the level with a diamond for tram and light rail, else on another level.
    let sx = c2.s0 - 0.06 * big;
    let q = at_s(&mg.centre, sx);
    let n = P2::dir(q.h).left();
    let hl = 0.22 * big;
    // Commuter and regional rail cross a street-level tram line: two railway systems on one
    // shared diamond.
    let (lv, cross_mode) = match mode {
        RailMode::Tram | RailMode::LightRail => (Level::Street, None),
        RailMode::Metro => (Level::Underground, None),
        RailMode::CommuterRail | RailMode::RegionalRail => (Level::Street, Some(RailMode::Tram)),
        _ => (Level::Elevated, None),
    };
    let a = q.p.sub(n.mul(hl));
    let b = q.p.add(n.mul(hl));
    let mut cross = track(
        7,
        Anchor::Free {
            x: a.x,
            y: a.y,
            level: Some(lv),
        },
        Some(Anchor::Free {
            x: b.x,
            y: b.y,
            level: Some(lv),
        }),
        lv,
    );
    cross.name = if cross_mode.is_some() {
        "Tram line"
    } else {
        "Cross-town line"
    }
    .into();
    cross.mode = cross_mode;
    cross.points = vec![Pi {
        x: q.p.x,
        y: q.p.y,
        radius_m: None,
        level: None,
    }];
    net.tracks.push(cross);
    net
}

/// Purpose: example streets for a built example: "Station Road", a two-lane street with buses
/// and a trolleybus wire, crossing the main line (track 3) at a right angle a quarter of the way
/// along. It crosses on the level for modes that allow level crossings at their line speed, and
/// on a bridge otherwise. Used by the tests and the topology example.
pub fn sample_streets(dz: &crate::design::Design) -> Vec<crate::street::Street> {
    let Some(g) = dz.track(3) else {
        return vec![];
    };
    let p = dz.track_params(3);
    let q = at_s(&g.centre, g.length * 0.25);
    let n = P2::dir(q.h).left();
    let half = 60.0 + g.spacing_at(q.s);
    let level_ok = p.level_crossing_permitted == "yes"
        && p.design_speed_kmh <= p.level_crossing_max_speed_kmh
        && g.level_at(q.s) == Some(Level::Street);
    let coords = [-half, -half / 3.0, half / 3.0, half]
        .iter()
        .map(|k| dz.proj.to_lonlat(q.p.add(n.mul(*k))))
        .collect();
    let mut out = vec![crate::street::Street {
        way: 1001,
        name: "Station Road".into(),
        class: "secondary".into(),
        lanes: None,
        width_m: None,
        oneway: false,
        layer: if level_ok { 0 } else { 1 },
        trolley_wire: true,
        bus: true,
        maxspeed_kmh: None,
        walking_pace: false,
        coords,
        ..Default::default()
    }];
    // Trams and light rail run along a four-lane main street for part of the line: their own
    // lane in the middle, one lane each way beside it, at the street's speed limit.
    if dz.track_mode(3).street_running() {
        let along: Vec<[f64; 2]> = (0..=12)
            .map(|k| at_s(&g.centre, g.length * (0.4 + 0.3 * f64::from(k) / 12.0)))
            .filter(|q| g.level_at(q.s) == Some(Level::Street))
            .map(|q| dz.proj.to_lonlat(q.p))
            .collect();
        if along.len() >= 2 {
            out.push(crate::street::Street {
                way: 1002,
                name: "High Street".into(),
                class: "primary".into(),
                lanes: Some(4.0),
                width_m: None,
                oneway: false,
                layer: 0,
                trolley_wire: false,
                bus: true,
                maxspeed_kmh: None,
                walking_pace: false,
                coords: along,
                ..Default::default()
            });
        }
    }
    out
}

/// Purpose: an example existing railway for a built example: the "Valley Line", already built,
/// which the crossing line (track 7) continues at its end. It is of the crossing line's railway
/// system, gauge, power and level, so the join is clean. Used by the tests and the topology
/// example.
pub fn sample_railways(dz: &crate::design::Design) -> Vec<crate::existing::ExistingRail> {
    let (Some(g), Some(t)) = (dz.track(7), dz.doc_track(7)) else {
        return vec![];
    };
    let Some(q) = g.centre.last() else {
        return vec![];
    };
    let m = dz.track_mode(7);
    let p = dz.track_params(7);
    let ahead = P2::dir(q.h);
    let coords = [0.0, 150.0, 400.0]
        .iter()
        .map(|k| dz.proj.to_lonlat(q.p.add(ahead.mul(*k))))
        .collect();
    let kind = match m {
        RailMode::Tram => "tram",
        RailMode::LightRail => "light_rail",
        RailMode::Metro => "subway",
        _ => "rail",
    };
    let electrified = if dz.third_rail(t) {
        "rail"
    } else if dz.overhead(t) {
        "contact_line"
    } else {
        "no"
    };
    let level = g.level_at(q.s).unwrap_or(t.level);
    vec![crate::existing::ExistingRail {
        way: 2001,
        kind: kind.into(),
        status: "active".into(),
        name: "Valley Line".into(),
        gauge_mm: vec![p.gauge_mm],
        electrified: electrified.into(),
        voltage_v: None,
        maxspeed_kmh: None,
        service: String::new(),
        layer: level.order() as i8 - Level::Street.order() as i8,
        coords,
    }]
}

/// Purpose: an example station throat with a slip: two single storage tracks crossing at 1:9, with
/// the catalogue's double slip in the diamond. Used by the tests and the topology example.
pub fn sample_slip(lon: f64, lat: f64) -> Network {
    let mut net = Network::new(RailMode::RegionalRail, [lon, lat]);
    let n: f64 = 9.0;
    let (c, s) = (n / (1.0 + n * n).sqrt(), 1.0 / (1.0 + n * n).sqrt());
    let free = |x: f64, y: f64| Anchor::Free { x, y, level: None };
    for (id, a, b) in [
        (1, free(-300.0, 0.0), free(300.0, 0.0)),
        (2, free(-300.0 * c, -300.0 * s), free(300.0 * c, 300.0 * s)),
    ] {
        let mut t = track(id, a, Some(b), Level::Street);
        t.tracks = 1;
        t.usage = TrackUse::Storage;
        net.tracks.push(t);
    }
    let id = build(&net, None)
        .crossings
        .first()
        .map(|c| c.id.clone())
        .unwrap_or_default();
    net.slips.push(crate::slip::Slip {
        crossing: id,
        element: "db-dkw-190-1-9".into(),
        side: 0,
    });
    net
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::issue::Severity;

    #[test]
    fn every_mode_builds_an_example_without_geometry_errors() {
        for m in RailMode::ALL {
            let net = sample(m, 7.0, 50.9);
            let dz = build(&net, None);
            assert_eq!(dz.tracks.len(), net.tracks.len(), "{m:?}");
            assert!(!dz.switches.is_empty(), "{m:?}: no switches placed");
            let errors: Vec<_> = dz
                .issues
                .iter()
                .filter(|i| i.severity == Severity::Error)
                .collect();
            assert!(errors.is_empty(), "{m:?}: {errors:#?}");
        }
    }

    #[test]
    fn the_example_street_crosses_on_the_level_only_where_the_mode_allows_it() {
        for m in RailMode::ALL {
            let net = sample(m, 7.0, 50.9);
            let streets = sample_streets(&build(&net, None));
            let dz = crate::design::build_with_streets(&net, None, &streets);
            let errors: Vec<_> = dz
                .issues
                .iter()
                .filter(|i| i.severity == Severity::Error)
                .collect();
            assert!(errors.is_empty(), "{m:?}: {errors:#?}");
            let on_level = dz.level_crossings.iter().filter(|x| x.track == 3).count();
            let expect = matches!(
                m,
                RailMode::Tram
                    | RailMode::LightRail
                    | RailMode::CommuterRail
                    | RailMode::RegionalRail
            );
            assert_eq!(on_level == 1, expect, "{m:?}: {:?}", dz.level_crossings);
        }
    }
}
