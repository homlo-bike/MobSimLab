//! Times building and viewing the example line for every mode (the editor rebuilds on each drag).

use rail_design::{build, sample::sample, view::view, RailMode};
use std::time::Instant;

fn main() {
    for m in RailMode::ALL {
        let net = sample(m, 7.0, 50.9);
        let t0 = Instant::now();
        let d = build(&net, None);
        let t1 = Instant::now();
        let v = view(&d).to_string();
        let t2 = Instant::now();
        println!(
            "{:<20} build {:>6.1} ms  view {:>6.1} ms  json {:>7} kB  issues {}",
            format!("{m:?}"),
            (t1 - t0).as_secs_f64() * 1e3,
            (t2 - t1).as_secs_f64() * 1e3,
            v.len() / 1024,
            d.issues.len()
        );
    }
}
