//! Timing of the noise map with buildings: a 3 km tram line through a city block grid.
//! Run with `cargo run --release -p noise --example map_timing`.

use noise::{estimate, BuildingInput, EstimateInput, Flows, LineInput, Mode};
use std::time::Instant;

fn main() {
    let line = LineInput {
        id: "a".into(),
        label: String::new(),
        mode: Mode::Tram,
        electric: false,
        vehicle_length_m: 35.0,
        flows: Flows {
            day: 12.0,
            evening: 8.0,
            night: 2.0,
        },
        points: vec![[0.0, 0.0], [1500.0, 0.0], [3000.0, 600.0]],
        speed: vec![],
        speed_kmh: Some(40.0),
        ranges: vec![],
        stops_m: vec![],
    };
    // Blocks of 60 × 40 m with 20 m streets, each split into four houses, over 3.4 × 1.6 km.
    let mut buildings = Vec::new();
    let mut y = -800.0;
    while y < 1400.0 {
        let mut x = -200.0;
        while x < 3200.0 {
            for (dx, dy) in [(0.0, 0.0), (30.0, 0.0), (0.0, 20.0), (30.0, 20.0)] {
                let (x0, y0) = (x + dx + 1.0, y + dy + 1.0);
                buildings.push(BuildingInput {
                    ring: vec![
                        [x0, y0],
                        [x0 + 28.0, y0],
                        [x0 + 28.0, y0 + 18.0],
                        [x0, y0 + 18.0],
                    ],
                    height_m: Some(12.0),
                    levels: None,
                    homes: None,
                });
            }
            x += 80.0;
        }
        y += 60.0;
    }
    // Keep the line's street clear.
    buildings.retain(|b| b.ring.iter().all(|p| p[1].abs() > 12.0 || p[0] > 1500.0));
    for (with, refl) in [(false, true), (true, false), (true, true)] {
        let input = EstimateInput {
            lines: vec![line.clone()],
            grid: true,
            grid_reach_m: Some(300.0),
            buildings: if with { buildings.clone() } else { vec![] },
            overrides: if refl {
                Default::default()
            } else {
                [("noise.reflection_order".to_string(), 0.0)].into()
            },
            ..Default::default()
        };
        let t = Instant::now();
        let e = estimate(&input);
        let g = e.grid.unwrap();
        println!(
            "buildings {:>5}, reflections {}: {:.2} s, grid {}×{} at {:.1} m",
            input.buildings.len(),
            if refl { "on " } else { "off" },
            t.elapsed().as_secs_f64(),
            g.nx,
            g.ny,
            g.cell
        );
    }
}
