//! Design check results shown on the map and in the issue list (06 §9.2).

use crate::geom::P2;
use serde::Serialize;

/// How serious a finding is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// The design cannot be built or run like this.
    Error,
    /// Allowed, but below the recommended value.
    Warning,
    /// For information.
    Info,
    /// Everything checked passed.
    Ok,
}

/// One finding.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Issue {
    /// Severity.
    pub severity: Severity,
    /// Plain-language message with the numbers and what to do.
    pub text: String,
    /// Where on the map, local metres.
    #[serde(skip)]
    pub at: Option<P2>,
    /// The element it is about.
    pub ref_id: Option<u32>,
}

impl Issue {
    /// Purpose: an error at a place on an element.
    pub fn error(text: impl Into<String>, at: Option<P2>, ref_id: u32) -> Self {
        Self { severity: Severity::Error, text: text.into(), at, ref_id: Some(ref_id) }
    }
    /// Purpose: a warning at a place on an element.
    pub fn warning(text: impl Into<String>, at: Option<P2>, ref_id: u32) -> Self {
        Self { severity: Severity::Warning, text: text.into(), at, ref_id: Some(ref_id) }
    }
    /// Purpose: information at a place on an element.
    pub fn info(text: impl Into<String>, at: Option<P2>, ref_id: Option<u32>) -> Self {
        Self { severity: Severity::Info, text: text.into(), at, ref_id }
    }
}

/// Purpose: format a length like the panel does ("85 m", "1.25 km").
pub fn fmt_m(m: f64) -> String {
    if !m.is_finite() {
        "—".into()
    } else if m.abs() >= 10_000.0 {
        format!("{:.1} km", m / 1000.0)
    } else if m.abs() >= 1000.0 {
        format!("{:.2} km", m / 1000.0)
    } else {
        format!("{} m", m.round())
    }
}
