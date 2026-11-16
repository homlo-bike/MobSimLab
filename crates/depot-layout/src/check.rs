//! The swept-path check of each lane (07-simulation §7 step 3): a vehicle of the lane's size drives from
//! its aisle into the lane to the far end, and from the front of the lane out into the next aisle,
//! without coming closer than the clearance to a parked vehicle or leaving the depot.

use crate::geom::{bbox, boxes_near, rect, V2};
use crate::sweep::{fillet, sweep, turn_path, Hit, Path, Scene};
use crate::vehicle::Body;

/// An aisle in local metres; vehicles drive from `a` to `b`.
#[derive(Debug, Clone)]
pub struct AisleGeo {
    /// Start of the centreline.
    pub a: V2,
    /// End of the centreline.
    pub b: V2,
    /// Width, m.
    pub width: f64,
    /// Driven both ways.
    pub two_way: bool,
}

impl AisleGeo {
    /// Purpose: unit direction of travel.
    pub fn dir(&self) -> V2 {
        self.b.sub(self.a).unit()
    }
    /// Purpose: the directions it may be driven: itself, and reversed when two-way.
    pub fn ways(&self) -> Vec<AisleGeo> {
        let mut v = vec![self.clone()];
        if self.two_way {
            v.push(AisleGeo {
                a: self.b,
                b: self.a,
                width: self.width,
                two_way: true,
            });
        }
        v
    }
}

/// A lane in local metres.
#[derive(Debug, Clone)]
pub struct LaneGeo {
    /// Middle of the entry end.
    pub entry: V2,
    /// Middle of the exit end.
    pub exit: V2,
    /// Lane width, m.
    pub width: f64,
    /// The parked vehicles, as solid rectangles.
    pub parked: Vec<[V2; 4]>,
}

impl LaneGeo {
    /// Purpose: unit direction from entry to exit.
    pub fn dir(&self) -> V2 {
        self.exit.sub(self.entry).unit()
    }
    /// Purpose: lane length, m.
    pub fn len(&self) -> f64 {
        self.exit.dist(self.entry)
    }
    /// Purpose: the lane's outline.
    pub fn outline(&self) -> [V2; 4] {
        rect(self.entry, self.dir(), self.len(), self.width)
    }
}

/// Why a lane cannot be entered or left.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fail {
    /// No aisle at that end of the lane.
    NoAisle,
    /// The lane meets the aisle at more than 100°.
    TooSharp,
    /// The turn does not fit: the lane is too short or the aisle too far.
    NoRoom,
    /// The swept path comes too close to a parked vehicle.
    Obstacle,
    /// The swept path leaves the depot.
    Outside,
}

impl From<Hit> for Fail {
    fn from(h: Hit) -> Self {
        match h {
            Hit::Obstacle => Fail::Obstacle,
            Hit::Outside => Fail::Outside,
        }
    }
}

/// What a manoeuvre needs to know about its surroundings.
pub struct Around<'a> {
    /// Parked vehicles of the other lanes, and other solid things.
    pub obstacles: Vec<&'a [V2]>,
    /// Depot outline.
    pub boundary: Option<&'a [V2]>,
    /// Smallest gap, m.
    pub clearance: f64,
}

/// Turn radii tried, as multiples of the vehicle's smallest.
const RADII: [f64; 4] = [1.0, 1.25, 1.5, 2.0];
/// Lateral positions tried in the aisle, as shares of the room to the far side.
const OFFSETS: [f64; 3] = [0.0, 0.5, 1.0];

/// Purpose: the path into the lane from its aisle (either way along a two-way aisle), or why there is none.
pub fn drive_in(
    body: &Body,
    lane: &LaneGeo,
    aisle: &AisleGeo,
    around: &Around,
) -> Result<Path, Fail> {
    let mut last = Fail::NoRoom;
    for a in aisle.ways() {
        match drive_in_one(body, lane, &a, around) {
            Ok(p) => return Ok(p),
            Err(f) => last = worse(last, f),
        }
    }
    Err(last)
}

/// Purpose: the path from the front of the lane out into the next aisle (either way along a two-way
/// aisle), or why there is none.
pub fn drive_out(
    body: &Body,
    lane: &LaneGeo,
    aisle: &AisleGeo,
    around: &Around,
) -> Result<Path, Fail> {
    let mut last = Fail::NoRoom;
    for a in aisle.ways() {
        match drive_out_one(body, lane, &a, around) {
            Ok(p) => return Ok(p),
            Err(f) => last = worse(last, f),
        }
    }
    Err(last)
}

/// Purpose: the more telling of two reasons (a real conflict over a missing turn).
fn worse(a: Fail, b: Fail) -> Fail {
    if a == Fail::NoRoom || a == Fail::TooSharp {
        b
    } else {
        a
    }
}

fn drive_in_one(
    body: &Body,
    lane: &LaneGeo,
    aisle: &AisleGeo,
    around: &Around,
) -> Result<Path, Fail> {
    let d1 = aisle.dir();
    let d2 = lane.dir();
    let phi = d1.cross(d2).atan2(d1.dot(d2));
    if phi.abs() > 100f64.to_radians() {
        return Err(Fail::TooSharp);
    }
    let nrm = d1.perp();
    // Drive on the side of the aisle away from the lane for a wider swing.
    let far = if lane.entry.sub(aisle.a).dot(nrm) > 0.0 {
        -1.0
    } else {
        1.0
    };
    let room = (aisle.width / 2.0 - body.width / 2.0 - around.clearance).max(0.0);
    let deepest = lane.len() - body.axles[1];
    let end = lane.entry.add(d2.mul(deepest.max(0.0)));
    let scene = Scene {
        obstacles: around.obstacles.clone(),
        boundary: around.boundary,
        clearance: around.clearance,
    };
    let mut last = Fail::NoRoom;
    for off in OFFSETS {
        let p1 = aisle.a.add(nrm.mul(far * off * room));
        for k in RADII {
            let Some(t) = fillet(p1, d1, lane.entry, d2, body.r_min * k) else {
                continue;
            };
            if t.b.sub(lane.entry).dot(d2) > deepest {
                continue;
            }
            let path = turn_path(&t, body.length + 2.0, end);
            match sweep(body, &path, &scene, (path.arc_from, path.pts.len())) {
                None => return Ok(path),
                Some(h) => last = h.into(),
            }
        }
    }
    Err(last)
}

fn drive_out_one(
    body: &Body,
    lane: &LaneGeo,
    aisle: &AisleGeo,
    around: &Around,
) -> Result<Path, Fail> {
    let d1 = lane.dir();
    let d2 = aisle.dir();
    let phi = d1.cross(d2).atan2(d1.dot(d2));
    if phi.abs() > 100f64.to_radians() {
        return Err(Fail::TooSharp);
    }
    let start = lane.exit.sub(d1.mul(body.axles[1]));
    let nrm = d2.perp();
    let far = if lane.exit.sub(aisle.a).dot(nrm) > 0.0 {
        -1.0
    } else {
        1.0
    };
    let room = (aisle.width / 2.0 - body.width / 2.0 - around.clearance).max(0.0);
    let scene = Scene {
        obstacles: around.obstacles.clone(),
        boundary: around.boundary,
        clearance: around.clearance,
    };
    let mut last = Fail::NoRoom;
    for off in OFFSETS {
        let p2 = aisle.a.add(nrm.mul(far * off * room));
        for k in RADII {
            let Some(t) = fillet(lane.exit, d1, p2, d2, body.r_min * k) else {
                continue;
            };
            let lead = t.a.sub(start).dot(d1);
            if lead < 0.0 {
                continue;
            }
            let path = turn_path(&t, lead, t.b.add(d2.mul(body.length + 2.0)));
            match sweep(body, &path, &scene, (path.arc_from, path.arc_to)) {
                None => return Ok(path),
                Some(h) => last = h.into(),
            }
        }
    }
    Err(last)
}

/// Purpose: the parked vehicles near a lane (within `reach` metres), from all lanes but `skip`.
pub fn near(lanes: &[LaneGeo], skip: usize, reach: f64) -> Vec<&[V2]> {
    let me = bbox(&lanes[skip].outline());
    lanes
        .iter()
        .enumerate()
        .filter(|(i, l)| *i != skip && boxes_near(me, bbox(&l.outline()), reach))
        .flat_map(|(_, l)| l.parked.iter().map(|r| r.as_slice()))
        .collect()
}
