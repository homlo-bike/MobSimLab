//! Messages of the MobSimLab engines as a key and values (ADR: engine messages in the user's language).
//!
//! An engine reports a finding as a [`Msg`]: a key of the message catalog
//! (`crates/engine-msg/messages/en.json`) and the values to put into its text. The app looks the key up in the
//! user's language and fills in the values; [`Msg::english`] gives the English text, for logs, tests and any
//! client without the catalog. A value is plain text (a name, or a number already formatted with its unit) or
//! another message (a part of a sentence that is itself translated).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::OnceLock;

/// The English message catalog: key → text with `{name}` placeholders.
pub const CATALOG_EN: &str = include_str!("../messages/en.json");

/// A message: a catalog key and its values.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Msg {
    /// Catalog key, for example `rail.curve.below_minimum`.
    pub key: String,
    /// Values by placeholder name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub args: BTreeMap<String, Arg>,
}

/// One value of a message.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Arg {
    /// Text shown as it is: a name, or a number with its unit.
    Text(String),
    /// A part of the sentence that is itself a message.
    Msg(Msg),
}

impl From<String> for Arg {
    fn from(s: String) -> Self {
        Arg::Text(s)
    }
}
impl From<&str> for Arg {
    fn from(s: &str) -> Self {
        Arg::Text(s.to_string())
    }
}
impl From<&String> for Arg {
    fn from(s: &String) -> Self {
        Arg::Text(s.clone())
    }
}
impl From<Msg> for Arg {
    fn from(m: Msg) -> Self {
        Arg::Msg(m)
    }
}

fn catalog() -> &'static BTreeMap<String, String> {
    static CAT: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    CAT.get_or_init(|| {
        let v: Value = serde_json::from_str(CATALOG_EN).expect("engine message catalog is JSON");
        v.as_object()
            .expect("engine message catalog is an object")
            .iter()
            .filter(|(k, _)| !k.starts_with('_'))
            .map(|(k, t)| (k.clone(), t.as_str().unwrap_or_default().to_string()))
            .collect()
    })
}

impl Msg {
    /// Purpose: a message without values.
    pub fn new(key: &str) -> Self {
        Self {
            key: key.to_string(),
            args: BTreeMap::new(),
        }
    }

    /// Purpose: the message with one more value.
    pub fn arg(mut self, name: &str, value: impl Into<Arg>) -> Self {
        self.args.insert(name.to_string(), value.into());
        self
    }

    /// Purpose: whether the catalog has this key.
    pub fn known(key: &str) -> bool {
        catalog().contains_key(key)
    }

    /// Purpose: the message in English: the catalog's text with the values filled in.
    /// Output: the key itself when the catalog does not have it (a test catches that).
    pub fn english(&self) -> String {
        let Some(text) = catalog().get(&self.key) else {
            return self.key.clone();
        };
        let mut out = String::with_capacity(text.len() + 16);
        let mut rest = text.as_str();
        while let Some(open) = rest.find('{') {
            out.push_str(&rest[..open]);
            let after = &rest[open + 1..];
            match after.find('}') {
                Some(close) => {
                    let name = &after[..close];
                    match self.args.get(name) {
                        Some(Arg::Text(t)) => out.push_str(t),
                        Some(Arg::Msg(m)) => out.push_str(&m.english()),
                        None => {
                            out.push('{');
                            out.push_str(name);
                            out.push('}');
                        }
                    }
                    rest = &after[close + 1..];
                }
                None => {
                    out.push('{');
                    rest = after;
                }
            }
        }
        out.push_str(rest);
        out
    }
}

impl Msg {
    /// Purpose: the message with every text value (also inside nested messages) passed through `f`.
    pub fn map_text(mut self, f: &dyn Fn(&str) -> String) -> Self {
        for v in self.args.values_mut() {
            *v = match std::mem::replace(v, Arg::Text(String::new())) {
                Arg::Text(t) => Arg::Text(f(&t)),
                Arg::Msg(m) => Arg::Msg(m.map_text(f)),
            };
        }
        self
    }

    /// Purpose: the text value of an argument, when it is one.
    pub fn text_arg(&self, name: &str) -> Option<&str> {
        match self.args.get(name) {
            Some(Arg::Text(t)) => Some(t),
            _ => None,
        }
    }
}

impl std::fmt::Display for Msg {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.english())
    }
}

impl From<Msg> for String {
    fn from(m: Msg) -> Self {
        m.english()
    }
}

/// Builds a [`Msg`]: `msg!("rail.curve.below_minimum", radius = fmt_m(r), what = msg!("rail.what.line"))`.
#[macro_export]
macro_rules! msg {
    ($key:literal $(, $name:ident = $value:expr)* $(,)?) => {
        $crate::Msg::new($key)$(.arg(stringify!($name), $value))*
    };
}

/// Purpose: a JavaScript `Error` for a failed engine call: its `message` is the English text and its
/// `msg` property the message (key and values), so the app can show it in the user's language.
#[cfg(feature = "wasm")]
pub fn js_error(m: &Msg) -> wasm_bindgen::JsValue {
    use wasm_bindgen::prelude::*;
    // Globals only (no JavaScript snippet file), so the module works with every wasm-bindgen target,
    // including the CommonJS build the API loads in Node.
    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = Reflect, js_name = set)]
        fn reflect_set(target: &JsValue, key: &JsValue, value: &JsValue) -> bool;
        #[wasm_bindgen(js_namespace = JSON, js_name = parse)]
        fn json_parse(text: &str) -> JsValue;
    }
    let e: JsValue = JsError::new(&m.english()).into();
    let json = serde_json::to_string(m).unwrap_or_else(|_| "null".into());
    reflect_set(&e, &JsValue::from_str("msg"), &json_parse(&json));
    e
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_key_used_in_the_engines_is_in_the_catalog() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let mut missing = Vec::new();
        let mut stack = vec![root];
        while let Some(dir) = stack.pop() {
            for e in std::fs::read_dir(&dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    if !p.ends_with("target") {
                        stack.push(p);
                    }
                } else if p.extension().is_some_and(|x| x == "rs")
                    && !p.ends_with("engine-msg/src/lib.rs")
                {
                    let src = std::fs::read_to_string(&p).unwrap();
                    for part in src.split("msg!(\"").skip(1) {
                        let key = &part[..part.find('"').unwrap_or(0)];
                        if !Msg::known(key) {
                            missing.push(format!("{}: {key}", p.display()));
                        }
                    }
                }
            }
        }
        assert!(
            missing.is_empty(),
            "keys missing from crates/engine-msg/messages/en.json: {missing:#?}"
        );
    }

    #[test]
    fn fills_in_values_and_nested_messages() {
        let m = msg!("rail.street.named", name = "Baghdad Street");
        assert_eq!(m.english(), "Baghdad Street");
        let m = msg!(
            "rail.crossing.diamond",
            angle = "30°",
            level = msg!("rail.level.street")
        );
        assert_eq!(
            m.english(),
            "Diamond crossing at 30° on street level: the two tracks share one piece of trackwork."
        );
        // A key the catalog does not have reads as the key; a missing value keeps its placeholder.
        assert_eq!(Msg::new("no.such.key").english(), "no.such.key");
        assert!(Msg::new("rail.crossing.diamond")
            .english()
            .contains("{angle}"));
    }

    #[test]
    fn serialises_as_key_and_args() {
        let m = msg!(
            "rail.crossing.diamond",
            angle = "30°",
            level = msg!("rail.level.street")
        );
        assert_eq!(
            serde_json::to_string(&m).unwrap(),
            r#"{"key":"rail.crossing.diamond","args":{"angle":"30°","level":{"key":"rail.level.street"}}}"#
        );
    }
}
