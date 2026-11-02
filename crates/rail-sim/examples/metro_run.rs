//! Plans a day on the example metro line and runs it through the interlocking:
//! `cargo run --release -p rail-sim --example metro_run`.

use rail_model::{examples, Model};
use rail_plan::{plan, PlanParams};
use rail_sim::network::{NetParams, NetworkSim};

#[path = "../../rail-plan/tests/common/mod.rs"]
mod common;

fn main() {
    let m = Model::compile(&examples::metro_line()).unwrap();
    let p = plan(&m, &[common::metro_m1()], &PlanParams::default()).unwrap();
    let mut sim = NetworkSim::new(&m, &p, NetParams::default()).unwrap();
    let r = sim.run_until(30.0 * 3600.0);
    if let Err(e) = &r {
        println!("STOPPED: {e}");
        for t in sim.trains() {
            println!("{t:?}");
        }
    }
    let calls = sim.calls();
    let done: Vec<_> = calls
        .iter()
        .filter(|c| c.arrive_s.is_some() || c.depart_s.is_some())
        .collect();
    let delays: Vec<f64> = calls
        .iter()
        .filter_map(|c| Some(c.arrive_s? - c.planned_arrive_s?))
        .collect();
    let max = delays.iter().copied().fold(0.0, f64::max);
    let min = delays.iter().copied().fold(0.0, f64::min);
    let early_dep = calls
        .iter()
        .filter(|c| matches!((c.depart_s, c.planned_depart_s), (Some(a), Some(p)) if a < p - 0.5))
        .count();
    for c in calls
        .iter()
        .filter(|c| c.depart_s.is_none() && c.planned_depart_s.is_some())
        .take(5)
    {
        println!("missing departure {c:?}");
    }
    println!("earliest arrival {min:.0} s, departures before plan {early_dep}");
    let late = delays.iter().filter(|d| **d > 60.0).count();
    println!(
        "time {:.0} s, {} of {} calls served, max arrival delay {:.0} s, {} arrivals over 1 min late, {} events, routes locked {}",
        sim.time(),
        done.len(),
        calls.len(),
        max,
        late,
        sim.events().len(),
        sim.interlocking().routes_locked
    );
    for e in sim.events().iter().take(10) {
        println!("{e:?}");
    }
    if std::env::var("SHOW").is_ok() {
        for c in calls {
            let d = c.arrive_s.zip(c.planned_arrive_s).map(|(a, p)| a - p);
            let e = c.depart_s.zip(c.planned_depart_s).map(|(a, p)| a - p);
            if d.is_some_and(|x| x > 20.0) || e.is_some_and(|x| x > 20.0) {
                println!(
                    "{} call {} {} arr {:?} dep {:?}  delay arr {:?} dep {:?}",
                    c.name,
                    c.call,
                    c.place,
                    c.planned_arrive_s,
                    c.planned_depart_s,
                    d.map(|x| x.round()),
                    e.map(|x| x.round())
                );
            }
        }
    }
}
