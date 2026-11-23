//! Terrain for the noise map (ADR-0038 step N2): ground heights from the shared terrain source
//! (Copernicus GLO-30, `apps/api/src/terrain`), turned from a surface model into bare ground.
//!
//! GLO-30 is a digital surface model: it holds the roofs and the tree tops. Used as it is, every
//! building would screen twice (as terrain and as a footprint) and every tree row would act as a
//! wall. So the heights are cleaned before use, in three steps:
//!
//! 1. Samples inside a building footprint are dropped.
//! 2. A morphological opening (a minimum, then a maximum, over a square window of
//!    `noise.terrain_filter_window_m`) removes anything narrower than the window that stands above
//!    its surroundings: the remaining buildings, trees, bridges. Hills and embankments wider than
//!    the window stay. This is the filter of Zhang et al. (2003) with one window.
//! 3. Gaps are filled from their neighbours.
//!
//! Heights are then interpolated bilinearly; outside the grid the nearest edge value is used.

use serde::{Deserialize, Serialize};

/// Ground heights on a regular grid, as the map sends them.
///
/// In the engine (`noise::estimate`) the corner and spacing are local metres. The WebAssembly
/// binding takes them in degrees (`x0`, `y0` as longitude and latitude of the south-west sample,
/// `dx`, `dy` in degrees) and projects them like the lines.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TerrainInput {
    /// West edge (first column), m.
    pub x0: f64,
    /// South edge (first row), m.
    pub y0: f64,
    /// Column spacing, m.
    pub dx: f64,
    /// Row spacing, m.
    pub dy: f64,
    /// Columns.
    pub nx: usize,
    /// Rows, south to north.
    pub ny: usize,
    /// Heights, row by row from the south-west (x fastest), m; `None` where the source has no data.
    pub z: Vec<Option<f64>>,
}

/// Bare-ground heights, cleaned as described in the module documentation.
#[derive(Debug, Clone)]
pub struct Ground {
    x0: f64,
    y0: f64,
    dx: f64,
    dy: f64,
    nx: usize,
    ny: usize,
    z: Vec<f64>,
    /// Highest ground height, m.
    pub max: f64,
    /// Lowest ground height, m.
    pub min: f64,
}

impl Ground {
    /// Purpose: bare ground from a terrain grid. Inputs: the grid, the building rings (local
    /// metres) whose samples are dropped, the opening window, m. Output: `None` when the grid is
    /// malformed or has no data.
    pub fn new(t: &TerrainInput, rings: &[&[[f64; 2]]], window_m: f64) -> Option<Self> {
        let (nx, ny) = (t.nx, t.ny);
        if nx < 2
            || ny < 2
            || t.z.len() != nx * ny
            || !(t.dx > 0.0 && t.dy > 0.0)
            || !t.x0.is_finite()
            || !t.y0.is_finite()
        {
            return None;
        }
        let mut z: Vec<Option<f64>> = t.z.iter().map(|v| v.filter(|h| h.is_finite())).collect();
        // 1. Drop the samples inside buildings.
        for ring in rings {
            if ring.len() < 3 {
                continue;
            }
            let (mut bx0, mut by0, mut bx1, mut by1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
            for p in ring.iter() {
                bx0 = bx0.min(p[0]);
                by0 = by0.min(p[1]);
                bx1 = bx1.max(p[0]);
                by1 = by1.max(p[1]);
            }
            let i0 = ((bx0 - t.x0) / t.dx).ceil().max(0.0) as usize;
            let i1 = ((bx1 - t.x0) / t.dx).floor();
            let j0 = ((by0 - t.y0) / t.dy).ceil().max(0.0) as usize;
            let j1 = ((by1 - t.y0) / t.dy).floor();
            if i1 < 0.0 || j1 < 0.0 {
                continue;
            }
            let (i1, j1) = ((i1 as usize).min(nx - 1), (j1 as usize).min(ny - 1));
            for j in j0..=j1 {
                for i in i0..=i1 {
                    let p = [t.x0 + i as f64 * t.dx, t.y0 + j as f64 * t.dy];
                    if crate::screening::point_in_ring(p, ring) {
                        z[j * nx + i] = None;
                    }
                }
            }
        }
        if z.iter().all(Option::is_none) {
            return None;
        }
        // 2. Opening: minimum then maximum over the window.
        let rx = ((window_m / 2.0) / t.dx).round().max(0.0) as usize;
        let ry = ((window_m / 2.0) / t.dy).round().max(0.0) as usize;
        if rx > 0 || ry > 0 {
            let lo = filter(&z, nx, ny, rx, ry, f64::min);
            let opened = filter(&lo, nx, ny, rx, ry, f64::max);
            // Keep data where the opening has none (all samples round it were dropped).
            z = opened.into_iter().zip(z).map(|(o, v)| o.or(v)).collect();
        }
        // 3. Fill the gaps from their neighbours, then any rest with the mean.
        let z = fill(z, nx, ny);
        let mean = {
            let v: Vec<f64> = z.iter().flatten().copied().collect();
            v.iter().sum::<f64>() / v.len().max(1) as f64
        };
        let z: Vec<f64> = z.into_iter().map(|v| v.unwrap_or(mean)).collect();
        let max = z.iter().copied().fold(f64::MIN, f64::max);
        let min = z.iter().copied().fold(f64::MAX, f64::min);
        Some(Self {
            x0: t.x0,
            y0: t.y0,
            dx: t.dx,
            dy: t.dy,
            nx,
            ny,
            z,
            max,
            min,
        })
    }

    /// Purpose: ground height at a point, m; bilinear, the nearest edge outside the grid.
    pub fn at(&self, p: [f64; 2]) -> f64 {
        let fx = ((p[0] - self.x0) / self.dx).clamp(0.0, (self.nx - 1) as f64);
        let fy = ((p[1] - self.y0) / self.dy).clamp(0.0, (self.ny - 1) as f64);
        let i = (fx.floor() as usize).min(self.nx - 2);
        let j = (fy.floor() as usize).min(self.ny - 2);
        let (u, v) = (fx - i as f64, fy - j as f64);
        let at = |i: usize, j: usize| self.z[j * self.nx + i];
        at(i, j) * (1.0 - u) * (1.0 - v)
            + at(i + 1, j) * u * (1.0 - v)
            + at(i, j + 1) * (1.0 - u) * v
            + at(i + 1, j + 1) * u * v
    }

    /// Purpose: spacing used to sample the ground along a path, m.
    pub fn step(&self) -> f64 {
        self.dx.min(self.dy).max(5.0)
    }

    /// Purpose: true when the ground varies by less than `tol` metres (treated as flat).
    pub fn is_flat(&self, tol: f64) -> bool {
        self.max - self.min < tol
    }
}

/// Purpose: separable square-window filter (`f` is min or max) over the samples with data.
fn filter(
    z: &[Option<f64>],
    nx: usize,
    ny: usize,
    rx: usize,
    ry: usize,
    f: fn(f64, f64) -> f64,
) -> Vec<Option<f64>> {
    let mut rows = vec![None; nx * ny];
    for j in 0..ny {
        for i in 0..nx {
            let (a, b) = (i.saturating_sub(rx), (i + rx).min(nx - 1));
            rows[j * nx + i] = (a..=b).filter_map(|k| z[j * nx + k]).reduce(f);
        }
    }
    let mut out = vec![None; nx * ny];
    for j in 0..ny {
        for i in 0..nx {
            let (a, b) = (j.saturating_sub(ry), (j + ry).min(ny - 1));
            out[j * nx + i] = (a..=b).filter_map(|k| rows[k * nx + i]).reduce(f);
        }
    }
    out
}

/// Purpose: fill missing samples with the mean of their filled neighbours, pass by pass: each pass fills
/// the gaps next to samples filled before it. Only the gaps next to the last pass's samples are looked at, so a
/// grid loaded only along the lines (the rest missing) fills in time proportional to its size.
fn fill(mut z: Vec<Option<f64>>, nx: usize, ny: usize) -> Vec<Option<f64>> {
    let neighbours = |k: usize| {
        let (i, j) = (k % nx, k / nx);
        [
            (i > 0).then(|| k - 1),
            (i + 1 < nx).then(|| k + 1),
            (j > 0).then(|| k - nx),
            (j + 1 < ny).then(|| k + nx),
        ]
        .into_iter()
        .flatten()
    };
    let mut queued = vec![false; nx * ny];
    let mut front: Vec<usize> = Vec::new();
    for k in 0..nx * ny {
        if z[k].is_none() && neighbours(k).any(|n| z[n].is_some()) {
            queued[k] = true;
            front.push(k);
        }
    }
    while !front.is_empty() {
        // Values from the samples filled before this pass only.
        let values: Vec<f64> = front
            .iter()
            .map(|&k| {
                let (mut s, mut n) = (0.0, 0);
                for m in neighbours(k) {
                    if let Some(v) = z[m] {
                        s += v;
                        n += 1;
                    }
                }
                s / n as f64
            })
            .collect();
        for (&k, v) in front.iter().zip(values) {
            z[k] = Some(v);
        }
        let mut next = Vec::new();
        for &k in &front {
            for m in neighbours(k) {
                if z[m].is_none() && !queued[m] {
                    queued[m] = true;
                    next.push(m);
                }
            }
        }
        front = next;
    }
    z
}

#[cfg(test)]
mod fill_tests {
    use super::*;

    #[test]
    fn fills_gaps_pass_by_pass_from_their_filled_neighbours() {
        // 3 × 1: the middle gap takes the mean of both ends.
        let z = fill(vec![Some(1.0), None, Some(3.0)], 3, 1);
        assert_eq!(z, vec![Some(1.0), Some(2.0), Some(3.0)]);
        // 3 × 3 with one corner: the second pass uses the first pass's samples.
        let mut g = vec![None; 9];
        g[0] = Some(4.0);
        let z = fill(g, 3, 3);
        assert!(z.iter().all(|v| *v == Some(4.0)));
    }

    #[test]
    fn a_large_grid_loaded_only_along_a_line_fills_quickly() {
        // 1,500 × 1,000 samples (45 × 30 km at 30 m) with heights only along one row.
        let (nx, ny) = (1500, 1000);
        let mut z = vec![None; nx * ny];
        for i in 0..nx {
            z[500 * nx + i] = Some(i as f64);
        }
        let t = std::time::Instant::now();
        let z = fill(z, nx, ny);
        assert!(z.iter().all(Option::is_some));
        assert_eq!(z[nx + 7], Some(7.0));
        assert!(t.elapsed().as_secs_f64() < 5.0, "took {:?}", t.elapsed());
    }
}
