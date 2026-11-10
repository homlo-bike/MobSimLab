//! People living in the buildings of the noise map (ADR-0038 step N2), for the exposure counts
//! that the Environmental Noise Directive (2002/49/EC, Annex VI) reports as people by band.
//!
//! Two sources, in this order:
//!
//! 1. **WorldPop** (constrained 100 m grid, R2025A): the people of each grid cell are shared
//!    among the buildings that may hold homes and whose centre lies in the cell, by floor area
//!    (footprint × storeys). People in a cell without such a building stay unplaced and are
//!    reported as such.
//! 2. **Building size**, where the grid could not be loaded: floor area ÷
//!    `noise.floor_area_per_person_m2`.
//!
//! A building may hold homes unless OSM tags it with another use (shop, office, garage, church…),
//! and when its footprint is at least `noise.population_min_footprint_m2` (sheds and garages
//! tagged only `building=yes`). Storeys are OSM `building:levels`, else the height ÷ the storey
//! height, else the default height ÷ the storey height, at least one.

use serde::{Deserialize, Serialize};

use crate::screening::{BuildingInput, HeightRule};

/// People per cell on a regular grid, as the map sends it.
///
/// In the engine the corner and spacing are local metres. The WebAssembly binding takes them in
/// degrees (`x0`, `y0` the longitude and latitude of the south-west corner of the south-west
/// cell, `dx`, `dy` the cell size) and projects them like the lines.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PopulationInput {
    /// West edge of the first column, m.
    pub x0: f64,
    /// South edge of the first row, m.
    pub y0: f64,
    /// Cell width, m.
    pub dx: f64,
    /// Cell height, m.
    pub dy: f64,
    /// Columns.
    pub nx: usize,
    /// Rows, south to north.
    pub ny: usize,
    /// People per cell, row by row from the south-west (x fastest).
    pub people: Vec<f64>,
}

/// Where the people counts come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeopleSource {
    /// The population grid, shared among the buildings by floor area.
    Grid,
    /// Floor area ÷ floor area per person.
    BuildingSize,
}

/// People per building.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Residents {
    /// People per input building.
    pub people: Vec<f64>,
    pub source: PeopleSource,
    /// Grid people in cells without a building that may hold homes (0 for the building size).
    pub unplaced: f64,
}

/// Settings of the people counts (the noise plugin's assumptions).
#[derive(Debug, Clone, Copy)]
pub struct PeopleRule {
    pub height: HeightRule,
    /// Gross floor area per resident, m² (building-size estimate).
    pub floor_area_per_person_m2: f64,
    /// Smallest footprint that may hold homes, m².
    pub min_footprint_m2: f64,
}

/// Purpose: area of a ring, m² (shoelace; open or closed).
pub fn ring_area(ring: &[[f64; 2]]) -> f64 {
    let n = ring.len();
    if n < 3 {
        return 0.0;
    }
    let mut s = 0.0;
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        s += a[0] * b[1] - b[0] * a[1];
    }
    (s / 2.0).abs()
}

/// Purpose: area centroid of a ring (the vertex mean for a degenerate ring).
fn centroid(ring: &[[f64; 2]]) -> [f64; 2] {
    let n = ring.len();
    let (mut a, mut cx, mut cy) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (p, q) = (ring[i], ring[(i + 1) % n]);
        let c = p[0] * q[1] - q[0] * p[1];
        a += c;
        cx += (p[0] + q[0]) * c;
        cy += (p[1] + q[1]) * c;
    }
    if a.abs() > 1e-9 {
        [cx / (3.0 * a), cy / (3.0 * a)]
    } else {
        let m = n.max(1) as f64;
        [
            ring.iter().map(|p| p[0]).sum::<f64>() / m,
            ring.iter().map(|p| p[1]).sum::<f64>() / m,
        ]
    }
}

/// Purpose: storeys of a building: OSM storeys, else its height ÷ the storey height, at least one.
pub fn storeys(b: &BuildingInput, rule: HeightRule) -> f64 {
    b.levels
        .filter(|l| l.is_finite() && *l > 0.0)
        .unwrap_or_else(|| (b.height(rule) / rule.level_m.max(1.0)).round())
        .max(1.0)
}

/// Purpose: floor area that may hold homes, m²; 0 for another use or a footprint below the minimum.
pub fn home_floor_area(b: &BuildingInput, rule: PeopleRule) -> f64 {
    let a = ring_area(&b.ring);
    if b.homes == Some(false) || a.is_nan() || a < rule.min_footprint_m2 {
        return 0.0;
    }
    a * storeys(b, rule.height)
}

/// Purpose: people per building, from the grid when there is one, else from the building size.
pub fn residents(
    buildings: &[BuildingInput],
    grid: Option<&PopulationInput>,
    rule: PeopleRule,
) -> Residents {
    let floor: Vec<f64> = buildings.iter().map(|b| home_floor_area(b, rule)).collect();
    let valid = grid.filter(|g| {
        g.nx > 0
            && g.ny > 0
            && g.people.len() == g.nx * g.ny
            && g.dx > 0.0
            && g.dy > 0.0
            && g.x0.is_finite()
            && g.y0.is_finite()
    });
    let Some(g) = valid else {
        let per = rule.floor_area_per_person_m2.max(1.0);
        return Residents {
            people: floor.iter().map(|f| f / per).collect(),
            source: PeopleSource::BuildingSize,
            unplaced: 0.0,
        };
    };
    // The grid cell of each building that may hold homes, and the floor area per cell.
    let mut cell = vec![usize::MAX; buildings.len()];
    let mut area = vec![0.0; g.nx * g.ny];
    for (k, b) in buildings.iter().enumerate() {
        if floor[k] <= 0.0 {
            continue;
        }
        let c = centroid(&b.ring);
        let (i, j) = (
            ((c[0] - g.x0) / g.dx).floor(),
            ((c[1] - g.y0) / g.dy).floor(),
        );
        if i < 0.0 || j < 0.0 || i >= g.nx as f64 || j >= g.ny as f64 {
            continue;
        }
        let c = j as usize * g.nx + i as usize;
        cell[k] = c;
        area[c] += floor[k];
    }
    let people = (0..buildings.len())
        .map(|k| match cell[k] {
            usize::MAX => 0.0,
            c => g.people[c].max(0.0) * floor[k] / area[c],
        })
        .collect();
    let unplaced = g
        .people
        .iter()
        .zip(&area)
        .filter(|(_, a)| **a <= 0.0)
        .map(|(p, _)| p.max(0.0))
        .sum();
    Residents {
        people,
        source: PeopleSource::Grid,
        unplaced,
    }
}
