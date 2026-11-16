//! Example MobSimLab plugin code (ADR-0036 Phase 2): a CSV timetable importer and exporter, and a calculation
//! that sums up each route of the project's timetable.
//!
//! Built three times, once per world (`calculation`, `importer`, `exporter` features), into three components
//! that import nothing but `mobsimlab:plugin/host`. The CSV has one row per call:
//! `trip_id,route,mode,stop_name,lat,lon,time` with `time` as `HH:MM` or `HH:MM:SS` (past 24:00 allowed).

// Each world uses part of it.
#[allow(dead_code)]
mod timetable;

#[cfg(feature = "calculation")]
mod world {
    wit_bindgen::generate!({ path: "../../../../contracts/wit", world: "calculation" });
    use mobsimlab::plugin::host::{log, progress, Level};

    struct Plugin;
    impl Guest for Plugin {
        fn calculate(id: String, input: String) -> Result<String, String> {
            if id != "route_summary" {
                return Err(format!("unknown calculation {id}"));
            }
            log(Level::Info, "summing up routes");
            let out = crate::timetable::route_summary(&input)?;
            progress(1.0);
            Ok(out)
        }
    }
    export!(Plugin);
}

#[cfg(feature = "importer")]
mod world {
    wit_bindgen::generate!({ path: "../../../../contracts/wit", world: "importer" });

    struct Plugin;
    impl Guest for Plugin {
        fn import_files(id: String, files: Vec<File>, _options: String) -> Result<String, String> {
            if id != "csv_import" {
                return Err(format!("unknown importer {id}"));
            }
            let file = files
                .iter()
                .find(|f| f.name.to_ascii_lowercase().ends_with(".csv"))
                .ok_or("the upload holds no .csv file")?;
            let text = std::str::from_utf8(&file.data).map_err(|_| "the CSV file is not UTF-8")?;
            crate::timetable::import_csv(text)
        }
    }
    export!(Plugin);
}

#[cfg(feature = "exporter")]
mod world {
    wit_bindgen::generate!({ path: "../../../../contracts/wit", world: "exporter" });

    struct Plugin;
    impl Guest for Plugin {
        fn export_files(id: String, input: String) -> Result<Vec<File>, String> {
            if id != "csv_export" {
                return Err(format!("unknown exporter {id}"));
            }
            let csv = crate::timetable::export_csv(&input)?;
            Ok(vec![File { name: "timetable.csv".into(), data: csv.into_bytes() }])
        }
    }
    export!(Plugin);
}
