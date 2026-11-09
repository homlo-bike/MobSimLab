//! MobSimLab noise estimate of service lines (ADR-0038).
//!
//! Step N1: the quick estimate the street line tool and the railway editor show while a line is
//! drawn. Sources are the drawn lines (CNOSSOS-EU road emission for buses, the CNOSSOS-EU railway
//! source database for rail), propagation is free field
//! over flat ground (ISO 9613-1 absorption, ISO 9613-2 ground effect, no buildings), and the
//! indicators are L_den and L_night at 4 m. Pure functions, deterministic, SI units; the values
//! come from `plugins/noise/assumptions/parameters.yaml` through `data/defaults.json`, the
//! CNOSSOS-EU tables from `data/cnossos-road.json` and `data/cnossos-rail.json`.
//!
//! Modules:
//! - [`params`]: assumption values and coefficients.
//! - [`emission`]: road emission.
//! - [`rail`]: CNOSSOS-EU railway emission and directivity.
//! - [`propagation`]: divergence, absorption, ground.
//! - [`estimate`]: the corridor, the map grid and the checks.

pub mod emission;
pub mod estimate;
pub mod ground;
pub use estimate::{Band, Check, Grid, Severity};
pub mod params;
pub mod propagation;
pub mod rail;
pub mod screening;

pub use estimate::{
    estimate, Estimate, EstimateInput, Flows, LineInput, PointSourceInput, Range, RangeKind,
};
pub use ground::TerrainInput;
pub use params::{Library, Mode, Variant};
pub use screening::BuildingInput;

/// Map colour of a level, following the ISO 1996-2 / DIN 45682 convention for 5 dB bands, or
/// `None` below `from_db`. Output: `[r, g, b]`.
pub fn band_colour(level_db: f64, from_db: f64) -> Option<[u8; 3]> {
    const C: [(f64, [u8; 3]); 7] = [
        (45.0, [0xce, 0xe4, 0xcc]),
        (50.0, [0xe2, 0xf2, 0xbf]),
        (55.0, [0xf3, 0xc6, 0x83]),
        (60.0, [0xe8, 0x7e, 0x4d]),
        (65.0, [0xcd, 0x46, 0x3e]),
        (70.0, [0xa1, 0x1a, 0x4d]),
        (75.0, [0x75, 0x08, 0x5c]),
    ];
    if level_db.is_nan() || level_db < from_db {
        return None;
    }
    C.iter()
        .rev()
        .find(|(lo, _)| level_db >= *lo)
        .map(|(_, c)| *c)
        .or(Some(C[0].1))
}

#[cfg(test)]
mod tests;
