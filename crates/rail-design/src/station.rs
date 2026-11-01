//! Station layout: side and island platforms, one track per platform edge (ADR-0030 point 1).
//!
//! In the station frame `a` runs along the platforms (the rotation direction) and `n` across
//! them, positive to the left. Tracks are straight (point 2) and end in connection points at both
//! ends of the station, singly or as adjacent pairs, which the line's tracks must meet tangentially.

use crate::geom::P2;
use crate::model::{Level, Station};
use crate::params::ModeParams;

/// A station track.
#[derive(Debug, Clone, PartialEq)]
pub struct StationTrack {
    /// Offset across the station, m (positive left).
    pub n: f64,
    /// Platform edge on the left of the track (looking along the rotation).
    pub platform_left: bool,
    /// Platform edge on the right.
    pub platform_right: bool,
}

/// A platform.
#[derive(Debug, Clone, PartialEq)]
pub struct Platform {
    /// Right edge offset, m.
    pub n0: f64,
    /// Left edge offset, m.
    pub n1: f64,
    /// Island (two edges) or side platform.
    pub island: bool,
}

/// A place where line tracks attach to the station.
#[derive(Debug, Clone, PartialEq)]
pub struct Connection {
    /// 0 behind the station, 1 ahead.
    pub end: u8,
    /// Station track indices (one, or two adjacent).
    pub tracks: Vec<usize>,
    /// Position (the middle of a pair).
    pub p: P2,
    /// Unit direction pointing out of the station.
    pub dir: P2,
    /// Track centre distance of a pair (0 for one track).
    pub spacing: f64,
}

/// Derived station geometry.
#[derive(Debug, Clone, PartialEq)]
pub struct StationGeo {
    /// Station id.
    pub id: u32,
    /// Level.
    pub level: Level,
    /// Centre.
    pub centre: P2,
    /// Unit vector along the platforms.
    pub u: P2,
    /// Unit vector across, to the left.
    pub v: P2,
    /// Half the length of the station tracks (platform plus the track beyond each end), m.
    pub half_len: f64,
    /// Half the width of the station box, m.
    pub half_w: f64,
    /// Half the platform length, m.
    pub platform_half: f64,
    /// Tracks, right to left.
    pub tracks: Vec<StationTrack>,
    /// Platforms, right to left.
    pub platforms: Vec<Platform>,
    /// Connection points at both ends.
    pub connections: Vec<Connection>,
}

impl StationGeo {
    /// Purpose: a point in the station frame (`a` along, `n` across) in local metres.
    pub fn point(&self, a: f64, n: f64) -> P2 {
        self.centre.add(self.u.mul(a)).add(self.v.mul(n))
    }
    /// Purpose: the connection point for an end and a set of station tracks, if it exists.
    pub fn connection(&self, end: u8, tracks: &[usize]) -> Option<&Connection> {
        self.connections
            .iter()
            .find(|c| c.end == end && c.tracks == tracks)
    }
}

enum El {
    Platform { w: f64, island: bool },
    Track,
}

/// Purpose: lay out a station's platforms and tracks from the mode's dimensions.
/// Inputs: the station and the mode's design values. Output: the geometry (no side effects).
pub fn layout(st: &Station, p: &ModeParams) -> StationGeo {
    let (mut sides, islands) = (st.side_platforms.min(2), st.island_platforms.min(3));
    if sides + islands == 0 {
        sides = 1;
    }
    let mut els = Vec::new();
    if sides >= 1 {
        els.push(El::Platform {
            w: p.side_platform_width_m,
            island: false,
        });
        els.push(El::Track);
    }
    for _ in 0..islands {
        els.push(El::Track);
        els.push(El::Platform {
            w: p.island_platform_width_m,
            island: true,
        });
        els.push(El::Track);
    }
    if sides >= 2 {
        els.push(El::Track);
        els.push(El::Platform {
            w: p.side_platform_width_m,
            island: false,
        });
    }
    // Walk across the station from the right: platform edges sit at the edge offset from the track
    // centre; adjacent tracks with no platform between them are one track spacing apart.
    let edge = p.platform_edge_offset_m;
    let sleeper_half = p.gauge_m() / 2.0 + 0.6;
    let mut pos: Vec<(f64, f64)> = Vec::new(); // (start, end) per element; tracks: (n, n)
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for (i, el) in els.iter().enumerate() {
        let prev = i.checked_sub(1).map(|j| (&els[j], pos[j]));
        match el {
            El::Platform { w, .. } => {
                let start = match prev {
                    Some((El::Track, (n, _))) => n + edge,
                    Some((El::Platform { .. }, (_, e))) => e,
                    None => 0.0,
                };
                pos.push((start, start + w));
                lo = lo.min(start);
                hi = hi.max(start + w);
            }
            El::Track => {
                let n = match prev {
                    None => 0.0,
                    Some((El::Platform { .. }, (_, e))) => e + edge,
                    Some((El::Track, (m, _))) => m + p.track_centre_m,
                };
                pos.push((n, n));
                lo = lo.min(n - sleeper_half);
                hi = hi.max(n + sleeper_half);
            }
        }
    }
    let mid = (lo + hi) / 2.0;
    let mut tracks = Vec::new();
    let mut platforms = Vec::new();
    for (i, el) in els.iter().enumerate() {
        let (a, b) = (pos[i].0 - mid, pos[i].1 - mid);
        match el {
            El::Platform { island, .. } => platforms.push(Platform {
                n0: a,
                n1: b,
                island: *island,
            }),
            El::Track => tracks.push(StationTrack {
                n: a,
                platform_right: i > 0 && matches!(els[i - 1], El::Platform { .. }),
                platform_left: matches!(els.get(i + 1), Some(El::Platform { .. })),
            }),
        }
    }
    let rot = st.rotation_deg.to_radians();
    let u = P2::dir(rot);
    let v = u.left();
    let platform_half = st.platform_length_m.max(1.0) / 2.0;
    let mut g = StationGeo {
        id: st.id,
        level: st.level,
        centre: P2::new(st.x, st.y),
        u,
        v,
        half_len: platform_half + p.track_beyond_platform_m,
        half_w: (hi - lo) / 2.0 + 1.2,
        platform_half,
        tracks,
        platforms,
        connections: vec![],
    };
    for end in [0u8, 1] {
        let sg = if end == 1 { 1.0 } else { -1.0 };
        let dir = u.mul(sg);
        for (i, t) in g.tracks.iter().enumerate() {
            g.connections.push(Connection {
                end,
                tracks: vec![i],
                p: g.point(sg * g.half_len, t.n),
                dir,
                spacing: 0.0,
            });
        }
        for i in 0..g.tracks.len().saturating_sub(1) {
            let (n0, n1) = (g.tracks[i].n, g.tracks[i + 1].n);
            g.connections.push(Connection {
                end,
                tracks: vec![i, i + 1],
                p: g.point(sg * g.half_len, (n0 + n1) / 2.0),
                dir,
                spacing: n1 - n0,
            });
        }
    }
    g
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::{defaults, RailMode};

    fn station(sides: u8, islands: u8) -> Station {
        Station {
            id: 1,
            name: "A".into(),
            x: 0.0,
            y: 0.0,
            rotation_deg: 0.0,
            level: Level::Street,
            side_platforms: sides,
            island_platforms: islands,
            platform_length_m: 120.0,
            mode: None,
        }
    }

    #[test]
    fn island_station_has_two_tracks_an_island_width_apart() {
        let p = defaults().mode(RailMode::Metro);
        let g = layout(&station(0, 1), p);
        assert_eq!(g.tracks.len(), 2);
        let spacing = g.tracks[1].n - g.tracks[0].n;
        let want = p.island_platform_width_m + 2.0 * p.platform_edge_offset_m;
        assert!((spacing - want).abs() < 1e-9);
        assert!(g.tracks[0].platform_left && g.tracks[1].platform_right);
        // two single connections and one pair at each end
        assert_eq!(g.connections.len(), 6);
    }

    #[test]
    fn two_side_platforms_and_an_island_give_four_tracks() {
        let p = defaults().mode(RailMode::RegionalRail);
        let g = layout(&station(2, 1), p);
        assert_eq!(g.tracks.len(), 4);
        assert_eq!(g.platforms.len(), 3);
        // the two middle tracks share no platform with each other: one track spacing apart?
        // No: track 1 and 2 face the island on both sides.
        assert!(g.tracks[1].platform_left && g.tracks[2].platform_right);
    }
}
