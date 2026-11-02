//! Plans a day on the example metro line and prints the timetable summary:
//! `cargo run --release -p rail-plan --example metro_day`.
//! Set `SHOW_RUNS=1` to print every run.

use rail_model::{examples, Model};
use rail_plan::{gtfs_time, plan, publish, report, PlanParams, RunKind};

#[path = "../tests/common/mod.rs"]
mod common;

fn main() {
    let m = Model::compile(&examples::metro_line()).unwrap();
    let line = common::metro_m1();
    let ids = vec![line.id.clone()];
    let p = plan(&m, &[line], &PlanParams::default()).unwrap();
    if std::env::var("SHOW_RUNS").is_ok() {
        for r in &p.runs {
            let calls: Vec<String> = r
                .calls
                .iter()
                .map(|c| {
                    format!(
                        "{} {}/{}",
                        c.id,
                        c.arrive_s.map(gtfs_time).unwrap_or_default(),
                        c.depart_s.map(gtfs_time).unwrap_or_default()
                    )
                })
                .collect();
            println!(
                "{:<14} {:<8} train {} {}",
                r.name,
                format!("{:?}", r.kind),
                r.vehicle,
                calls.join(" | ")
            );
        }
    }
    let rep = report(&m, &p, &ids, PlanParams::default().min_buffer_s, 0.15, 0.85);
    println!(
        "{} trips, {} trains used, {} out at most, {} reserve, {} conflicts, {} issues",
        rep.trips,
        rep.vehicles,
        rep.peak_out,
        rep.reserve,
        rep.conflicts.len(),
        p.issues.len()
    );
    println!(
        "pull-outs {}, pull-ins {}",
        p.runs.iter().filter(|r| r.kind == RunKind::PullOut).count(),
        p.runs.iter().filter(|r| r.kind == RunKind::PullIn).count()
    );
    for c in rep.capacity.iter().filter(|c| c.hour == 8 || c.hour == 12) {
        println!(
            "{} dir {} {:02}:00  {} trains  line {:.0} %  terminal {} {:.0} %  bottleneck {} ({:.0} %)",
            c.line,
            c.direction,
            c.hour,
            c.trains,
            c.consumption * 100.0,
            c.terminal,
            c.terminal_share * 100.0,
            c.bottleneck,
            c.bottleneck_share * 100.0
        );
    }
    for x in &rep.max_capacity {
        println!(
            "{} dir {}: {} trains/h planned at {:02}:00, maximum {:.1} theoretical, {:.1} practical",
            x.line, x.direction, x.planned_per_hour, x.hour, x.theoretical_per_hour, x.practical_per_hour
        );
    }
    let pubt = publish(&m, &p, &ids);
    println!(
        "published: {} stops, {} trips, {} stop times",
        pubt.stops.len(),
        pubt.trips.len(),
        pubt.stop_times.len()
    );
    for i in &p.issues {
        println!("issue {i:?}");
    }
}
