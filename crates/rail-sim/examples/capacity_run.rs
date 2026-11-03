//! Capacity run of the example metro line in the morning peak, with the frequency sweep:
//! `cargo run --release -p rail-sim --example capacity_run`.

use rail_model::{examples, Model};
use rail_plan::examples::metro_m1;
use rail_sim::capacity::{
    capacity_run, practical_maximum, sweep_headways, sweep_point, CapacityParams, Verdict,
};

fn main() {
    let m = Model::compile(&examples::metro_line()).unwrap();
    let lines = vec![metro_m1()];
    let mut p = CapacityParams::default();
    if let Some(h) = std::env::args().nth(1) {
        let h: f64 = h.parse().unwrap();
        p.from_s = h * 3600.0;
        p.to_s = (h + 2.0) * 3600.0;
    }
    let t = std::time::Instant::now();
    let run = capacity_run(&m, &lines, &p).unwrap();
    println!(
        "verdict {:?} in {:.2} s",
        run.verdict,
        t.elapsed().as_secs_f64()
    );
    println!("{:?}", run.fleet);
    for l in &run.lines {
        println!("{} {:?}", l.line, l.planned);
        let works = l.planned.verdict <= Verdict::NearLimit;
        let mut pts = vec![l.planned.clone()];
        for h in sweep_headways(&lines[0], &p, works) {
            let t = std::time::Instant::now();
            let pt = sweep_point(&m, &lines, &p, 0, h).unwrap();
            println!(
                "  every {:.0} s: {:?} consumption {:.0} % residual {:.0} s knock-on {:.0} s unplaced {} ({:.2} s) {:?}",
                h, pt.verdict, pt.consumption.max(pt.terminal_share) * 100.0, pt.residual_delay_s, pt.knock_on_s, pt.unplaced,
                t.elapsed().as_secs_f64(), pt.problems
            );
            let stop = pt.verdict == Verdict::NotEnoughCapacity;
            pts.push(pt);
            if stop && works {
                break;
            }
        }
        let refs: Vec<_> = pts.iter().collect();
        println!(
            "  practical maximum {:?} trains/h",
            practical_maximum(&refs)
        );
    }
    for i in &run.issues {
        println!("issue {i}");
    }
}
