//! Findings of the kits' live checks, in the same shape as the other editors' checks.

use serde::{Deserialize, Serialize};

/// How serious a finding is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    /// The design cannot work as drawn.
    Error,
    /// The design works but breaks a recommended value or needs attention.
    Warning,
    /// Something the planner should know, such as a check that is not available yet.
    Info,
}

/// One finding: what is wrong, where, and which parameter or rule it comes from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Issue {
    pub level: Level,
    /// Stable id of the check, such as `span.too_long`.
    pub code: String,
    /// Plain-language message for the planner.
    pub message: String,
    /// Index of the station or pier the finding is about, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub station: Option<usize>,
    /// Index of the section or leg the finding is about, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<usize>,
    /// The assumption parameter the check uses, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter: Option<String>,
}

impl Issue {
    /// Purpose: a finding with no location.
    pub fn new(level: Level, code: &str, message: impl Into<String>) -> Self {
        Self {
            level,
            code: code.into(),
            message: message.into(),
            station: None,
            section: None,
            parameter: None,
        }
    }

    /// Purpose: the finding located at station or pier `i`.
    pub fn at_station(mut self, i: usize) -> Self {
        self.station = Some(i);
        self
    }

    /// Purpose: the finding located on section or leg `i`.
    pub fn at_section(mut self, i: usize) -> Self {
        self.section = Some(i);
        self
    }

    /// Purpose: the finding with the assumption parameter it checks against.
    pub fn param(mut self, key: &str) -> Self {
        self.parameter = Some(key.into());
        self
    }
}
