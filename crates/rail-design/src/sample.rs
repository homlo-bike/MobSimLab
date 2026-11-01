//! An example line for a mode, scaled to the mode: two stations, a double track with two curves,
//! a crossover, a turnout to a stabling siding and a crossing line. Used by the editor's
//! "Example" button and by the tests.

use crate::design::build;
use crate::geom::{at_s, P2};
use crate::model::{Anchor, Bed, Level, Network, Pi, Power, Station, Switch, SwitchKind, Track, TrackUse};
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
    };
    let start_x = -0.5 * big;
    net.stations.push(station(1, "Riverside", start_x, 0.0, la));
    net.stations.push(station(2, "Northgate", start_x + big, 0.25 * big, lb));
    let mut main = track(
        3,
        Anchor::Station { station: 1, end: 1, tracks: vec![0, 1] },
        Some(Anchor::Station { station: 2, end: 0, tracks: vec![0, 1] }),
        // metro: out of the underground station, up to street level and on to the viaduct
        if mode == RailMode::Metro { Level::Street } else { la },
    );
    main.lead_start_m = 0.25 * big;
    main.lead_end_m = 0.3 * big;
    net.tracks.push(main);
    let g = build(&net, None);
    let Some(mg) = g.track(3).cloned() else { return net };
    let (Some(c1), Some(c2)) = (mg.curves.first().cloned(), mg.curves.get(1).cloned()) else { return net };
    let turnout = d.switch(&p.default_turnout).and_then(|s| s.turnout_geometry());
    // Crossover, then a turnout to a stabling siding, on the straight between the two curves.
    let ramp_end = mg.ramps.iter().filter(|r| r.s0 < mg.length / 2.0).map(|r| r.s1).fold(0.0, f64::max);
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
                let mut siding = track(6, Anchor::Switch { switch: 5, leg: 0 }, None, mg.level_at(s_tu).unwrap_or(la));
                siding.tracks = 1;
                siding.usage = TrackUse::Storage;
                siding.name = "Stabling siding".into();
                siding.lead_start_m = lead;
                siding.end = Some(Anchor::Free { x: end.x, y: end.y, level: None });
                net.tracks.push(siding);
            }
        }
    }
    // A crossing line: on the level with a diamond for tram and light rail, else on another level.
    let sx = c2.s0 - 0.06 * big;
    let q = at_s(&mg.centre, sx);
    let n = P2::dir(q.h).left();
    let hl = 0.22 * big;
    let lv = match mode {
        RailMode::Tram | RailMode::LightRail => Level::Street,
        RailMode::Metro => Level::Underground,
        _ => Level::Elevated,
    };
    let a = q.p.sub(n.mul(hl));
    let b = q.p.add(n.mul(hl));
    let mut cross = track(
        7,
        Anchor::Free { x: a.x, y: a.y, level: Some(lv) },
        Some(Anchor::Free { x: b.x, y: b.y, level: Some(lv) }),
        lv,
    );
    cross.name = "Cross-town line".into();
    cross.points = vec![Pi { x: q.p.x, y: q.p.y, radius_m: None, level: None }];
    net.tracks.push(cross);
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
            let errors: Vec<_> = dz.issues.iter().filter(|i| i.severity == Severity::Error).collect();
            assert!(errors.is_empty(), "{m:?}: {errors:#?}");
        }
    }
}
