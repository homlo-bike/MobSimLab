//! Writes an SVG of a sample depot's auto layout with its driving network (for eyeballing the generator).
//! Usage: cargo run -p depot-layout --release --example svg -- out.svg [angle]

use depot_layout::geom::V2;
use depot_layout::model::{DepotInput, FleetGroup, Gate, GateKind, Proj, Rules, Zone, ZoneKind};
use depot_layout::vehicle::VehicleSpec;
use depot_layout::{analyse, generate};
use std::fmt::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = args.get(1).cloned().unwrap_or("depot.svg".into());
    let angle: f64 = args.get(2).and_then(|a| a.parse().ok()).unwrap_or(90.0);
    let proj = Proj::around(&[[8.54, 47.37]]);
    let ll = |x: f64, y: f64| proj.ll(V2::new(x, y));
    let ring = |pts: &[(f64, f64)]| pts.iter().map(|(x, y)| ll(*x, *y)).collect::<Vec<_>>();
    let mut d = DepotInput {
        boundary: ring(&[
            (0., 0.),
            (200., 0.),
            (200., 70.),
            (90., 70.),
            (90., 160.),
            (0., 160.),
        ]),
        gates: vec![
            Gate {
                id: "in".into(),
                kind: GateKind::Entrance,
                lonlat: ll(200., 20.),
            },
            Gate {
                id: "out".into(),
                kind: GateKind::Exit,
                lonlat: ll(200., 55.),
            },
        ],
        zones: vec![
            Zone {
                id: "p".into(),
                kind: ZoneKind::Parking,
                ring: ring(&[(5., 5.), (185., 5.), (185., 65.), (5., 65.)]),
                angle_deg: angle,
                vehicles_per_lane: None,
                vehicle: None,
                aisle_width_m: None,
                heading_deg: None,
            },
            Zone {
                id: "c".into(),
                kind: ZoneKind::Charging,
                ring: ring(&[(5., 75.), (85., 75.), (85., 155.), (5., 155.)]),
                angle_deg: angle,
                vehicles_per_lane: None,
                vehicle: Some("e12".into()),
                aisle_width_m: None,
                heading_deg: None,
            },
        ],
        vehicles: vec![
            VehicleSpec {
                key: "e12".into(),
                name: "12 m".into(),
                length_m: 12.13,
                width_m: 2.55,
                articulations: 0,
                axles_m: None,
                turning_circle_m: Some(21.2),
            },
            VehicleSpec {
                key: "d18".into(),
                name: "18 m".into(),
                length_m: 18.0,
                width_m: 2.55,
                articulations: 1,
                axles_m: None,
                turning_circle_m: None,
            },
        ],
        fleet: vec![
            FleetGroup {
                line: "a".into(),
                name: "A".into(),
                vehicle: "d18".into(),
                count: 10,
                charging: false,
            },
            FleetGroup {
                line: "b".into(),
                name: "B".into(),
                vehicle: "e12".into(),
                count: 8,
                charging: true,
            },
        ],
        rules: Rules::default(),
        layout: None,
    };
    if std::env::var("WHOLE").is_ok() {
        d.zones = vec![Zone {
            id: "all".into(),
            kind: ZoneKind::Parking,
            ring: d.boundary.clone(),
            angle_deg: angle,
            vehicles_per_lane: None,
            vehicle: Some("d18".into()),
            aisle_width_m: None,
            heading_deg: None,
        }];
    }
    let t = std::time::Instant::now();
    let g = generate(&d);
    eprintln!("gen issues {:?}", g.issues);
    let t1 = t.elapsed();
    d.layout = Some(g.layout.clone());
    let t = std::time::Instant::now();
    let r = analyse(&d);
    eprintln!("generate {:?}, analyse {:?}", t1, t.elapsed());
    eprintln!(
        "aisles: {:?}",
        g.layout
            .aisles
            .iter()
            .map(|a| a.width_m)
            .collect::<Vec<_>>()
    );
    eprintln!(
        "lanes {} slots {}",
        g.layout.lanes.len(),
        g.layout.lanes.iter().map(|l| l.slots.len()).sum::<usize>()
    );
    eprintln!("issues {:#?}", r.issues);
    let t = std::time::Instant::now();
    let s = depot_layout::size(&d);
    eprintln!("sizing {:?} {:#?}", t.elapsed(), s.holds);
    let xy = |p: [f64; 2]| {
        let v = proj.xy(p);
        (v.x * 4.0 + 20.0, 700.0 - v.y * 4.0)
    };
    let poly = |pts: &[[f64; 2]], style: &str| {
        let s: Vec<String> = pts
            .iter()
            .map(|p| {
                let (x, y) = xy(*p);
                format!("{x:.1},{y:.1}")
            })
            .collect();
        format!("<polygon points=\"{}\" style=\"{style}\"/>\n", s.join(" "))
    };
    let mut svg = String::from("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"880\" height=\"740\" style=\"background:#fff\">\n");
    svg += &poly(&d.boundary, "fill:#f1f5f9;stroke:#334155;stroke-width:2");
    for z in &d.zones {
        svg += &poly(&z.ring, "fill:none;stroke:#94a3b8;stroke-dasharray:4");
    }
    for a in &g.layout.aisles {
        let (x1, y1) = xy(a.coords[0]);
        let (x2, y2) = xy(a.coords[1]);
        let _ = writeln!(svg, "<line x1=\"{x1}\" y1=\"{y1}\" x2=\"{x2}\" y2=\"{y2}\" stroke=\"#cbd5e1\" stroke-width=\"{}\"/>", a.width_m * 4.0);
    }
    for l in &g.layout.lanes {
        for s in &l.slots {
            let h = depot_layout::model::heading_rad(s.heading_deg);
            let c = proj.xy(s.center);
            let r = depot_layout::geom::rect(
                c.sub(V2::dir(h).mul(s.length_m / 2.0)),
                V2::dir(h),
                s.length_m,
                2.55,
            );
            let pts: Vec<[f64; 2]> = r.iter().map(|q| proj.ll(*q)).collect();
            svg += &poly(
                &pts,
                if s.charger {
                    "fill:#bbf7d0;stroke:#15803d"
                } else {
                    "fill:#bfdbfe;stroke:#1d4ed8"
                },
            );
        }
    }
    for e in &r.network.edges {
        let pts: Vec<String> = e
            .coords
            .iter()
            .map(|p| {
                let (x, y) = xy(*p);
                format!("{x:.1},{y:.1}")
            })
            .collect();
        let col = match e.kind {
            "drive" => "#dc2626",
            "aisle" => "#64748b",
            "gate" => "#000",
            _ => "#f59e0b",
        };
        let _ = writeln!(
            svg,
            "<polyline points=\"{}\" fill=\"none\" stroke=\"{col}\" stroke-width=\"1\"/>",
            pts.join(" ")
        );
    }
    if let Some(l) = g.layout.lanes.get(3) {
        for ring in depot_layout::report::envelope(&d, &l.id) {
            svg += &poly(&ring, "fill:none;stroke:#a855f7;stroke-width:0.5");
        }
    }
    svg += "</svg>\n";
    std::fs::write(&out, svg).unwrap();
}
