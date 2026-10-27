//! Spike S2 benchmark: simulate one day on the synthetic loop network and print
//! a JSON report. Usage: `bench_s2 [sim_seconds] [dt]` (defaults 86400 and 1.0).

use std::time::Instant;

use rail_sim::scenarios::{loop_network, LoopNetworkParams};
use rail_sim::{RailSim, SimConfig};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let sim_s: f64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(86_400.0);
    let dt: f64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1.0);
    let params = LoopNetworkParams::default();
    let net = loop_network(&params);
    let n_sections = net.sections.len();
    let mut sim = RailSim::new(net.sections, SimConfig::default()).expect("valid sections");
    let t_build = Instant::now();
    for spec in net.trains {
        sim.add_train(spec).expect("train placement");
    }
    let build_s = t_build.elapsed().as_secs_f64();
    let start = Instant::now();
    let mut checks = 0u32;
    let check_every = (3_600.0 / dt) as u64;
    while sim.time() + 1e-9 < sim_s {
        sim.step(dt);
        if sim.stats().steps % check_every == 0 {
            sim.check_invariants().expect("safety invariant");
            checks += 1;
        }
    }
    let wall = start.elapsed().as_secs_f64();
    sim.check_invariants().expect("safety invariant");
    let st = sim.stats();
    let report = serde_json::json!({
        "scenario": params,
        "sections": n_sections,
        "trains": sim.train_count(),
        "sim_seconds": sim_s,
        "dt_s": dt,
        "build_seconds": build_s,
        "wall_seconds": wall,
        "speedup_vs_real_time": sim_s / wall,
        "train_km": st.train_km,
        "avg_speed_kmh": st.train_km / (sim.train_count() as f64 * sim_s / 3600.0),
        "routes_set": st.routes_set,
        "route_requests_rejected": st.route_requests_rejected,
        "stop_arrivals": st.stop_arrivals,
        "deadlocks": st.deadlocks,
        "invariant_checks_passed": checks + 1,
    });
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
}
