//! Synthetic networks for benchmarks and tests (Spike S2).

use serde::Serialize;

use crate::model::{StopSpec, TdsSpec, TrainSpec};

/// Parameters of the synthetic loop-line network.
#[derive(Clone, Debug, Serialize)]
pub struct LoopNetworkParams {
    /// Number of independent loop lines. Consecutive pairs share one flat crossing.
    pub lines: usize,
    /// Trains per line.
    pub trains_per_line: usize,
    /// Plain-line blocks per loop.
    pub blocks_per_line: usize,
    /// Block length in metres.
    pub block_len_m: f64,
    /// A station stop at every n-th block.
    pub station_every: usize,
    /// Dwell time at each station in seconds.
    pub dwell_s: f64,
    /// Every n-th block has the reduced speed limit.
    pub slow_every: usize,
    /// Line speed and reduced speed in m/s.
    pub line_speed_mps: f64,
    /// Reduced speed in m/s.
    pub slow_speed_mps: f64,
}

impl Default for LoopNetworkParams {
    /// Purpose: the S2 reference scenario: 40 lines × 50 trains = 2,000 trains,
    /// 150 blocks of 600 m (90 km loops), stations every 4 blocks with 30 s dwell,
    /// 160 km/h line speed and 90 km/h on every 10th block.
    fn default() -> Self {
        Self {
            lines: 40,
            trains_per_line: 50,
            blocks_per_line: 150,
            block_len_m: 600.0,
            station_every: 4,
            dwell_s: 30.0,
            slow_every: 10,
            line_speed_mps: 44.4,
            slow_speed_mps: 25.0,
        }
    }
}

/// Generated network: sections plus train specs ready for [`crate::RailSim`].
pub struct LoopNetwork {
    /// All sections; index = [`crate::TdsId`].
    pub sections: Vec<TdsSpec>,
    /// One spec per train.
    pub trains: Vec<TrainSpec>,
}

/// Purpose: a typical electric multiple unit used by the synthetic scenarios.
/// Values are generic assumptions (200 m, 400 t, 4 MW, 1.0 m/s², 0.8 m/s² service brake).
pub fn generic_emu(
    name: String,
    path: Vec<u32>,
    signals_at: Vec<usize>,
    stops: Vec<StopSpec>,
    start_head_m: f64,
) -> TrainSpec {
    TrainSpec {
        name,
        length_m: 200.0,
        mass_kg: 400_000.0,
        max_accel_mps2: 1.0,
        service_decel_mps2: 0.8,
        max_speed_mps: 44.4,
        power_w: 4.0e6,
        davis_a_n: 4_000.0,
        davis_b_n_per_mps: 100.0,
        davis_c_n_per_mps2: 6.0,
        path,
        signals_at,
        cyclic: true,
        stops,
        start_head_m,
        depart_s: 0.0,
    }
}

/// Purpose: build the synthetic loop network.
/// Inputs: generator parameters.
/// Output: sections and trains. Lines 2i and 2i+1 cross on one shared 50 m
/// section placed halfway along each loop; the route over the crossing also
/// covers the following block, so a train never stops on the crossing.
pub fn loop_network(p: &LoopNetworkParams) -> LoopNetwork {
    let mut sections = Vec::new();
    let mut crossings = Vec::new();
    for _ in 0..p.lines.div_ceil(2) {
        crossings.push(sections.len() as u32);
        sections.push(TdsSpec {
            length_m: 50.0,
            speed_limit_mps: p.slow_speed_mps,
            gradient: 0.0,
        });
    }
    let mut trains = Vec::new();
    let cross_at = p.blocks_per_line / 2;
    for line in 0..p.lines {
        let mut path = Vec::new();
        let mut signals = Vec::new();
        let mut stops = Vec::new();
        let mut block_idx = Vec::new();
        for b in 0..p.blocks_per_line {
            if b == cross_at && (line % 2 == 1 || line + 1 < p.lines) {
                signals.push(path.len());
                path.push(crossings[line / 2]);
                // The block after the crossing has no signal at its start.
                let id = sections.len() as u32;
                sections.push(TdsSpec {
                    length_m: p.block_len_m,
                    speed_limit_mps: p.line_speed_mps,
                    gradient: 0.0,
                });
                path.push(id);
                continue;
            }
            let slow = p.slow_every > 0 && b % p.slow_every == p.slow_every - 1;
            let grad = if b % 7 == 3 {
                0.005
            } else if b % 7 == 5 {
                -0.005
            } else {
                0.0
            };
            let id = sections.len() as u32;
            sections.push(TdsSpec {
                length_m: p.block_len_m,
                speed_limit_mps: if slow {
                    p.slow_speed_mps
                } else {
                    p.line_speed_mps
                },
                gradient: grad,
            });
            signals.push(path.len());
            block_idx.push(path.len());
            if p.station_every > 0 && b % p.station_every == 0 {
                stops.push(StopSpec {
                    path_index: path.len(),
                    offset_m: p.block_len_m - 100.0,
                    dwell_s: p.dwell_s,
                });
            }
            path.push(id);
        }
        let mut cum = Vec::with_capacity(path.len());
        let mut acc = 0.0;
        for &s in &path {
            cum.push(acc);
            acc += sections[s as usize].length_m;
        }
        // Spread trains over signalled plain-line blocks.
        let step = (block_idx.len() / p.trains_per_line.max(1)).max(1);
        for t in 0..p.trains_per_line {
            let k = block_idx[(t * step) % block_idx.len()];
            let head = cum[k] + 400.0;
            trains.push(generic_emu(
                format!("L{line:02}-T{t:02}"),
                path.clone(),
                signals.clone(),
                stops.clone(),
                head,
            ));
        }
    }
    LoopNetwork { sections, trains }
}
