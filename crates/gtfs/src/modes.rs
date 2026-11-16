//! GTFS route types and MobSimLab modes.
//!
//! Import reads the basic types (0 to 12) and the extended Hierarchical Vehicle Types (100 to 1700).
//! Modes from plugins (ferry, cable car, funicular) keep their ids, so a project without the plugin
//! shows them with the default look. Export writes the basic types, which every consumer reads.

/// Purpose: the MobSimLab mode of a GTFS `route_type`. None when the type is not known.
pub fn mode_of(t: u16) -> Option<&'static str> {
    Some(match t {
        0 => "tram",
        1 => "metro",
        2 => "regional_rail",
        3 => "bus",
        4 => "ferry",
        5 => "tram",
        6 => "cable_car",
        7 => "funicular",
        11 => "trolleybus",
        12 => "metro",
        100 | 105 | 107 | 108 => "regional_rail",
        101 => "high_speed_rail",
        102..=104 => "long_distance_rail",
        106 => "regional_rail",
        109 => "commuter_rail",
        110..=117 => "regional_rail",
        200..=209 => "intercity_bus",
        400..=405 => "metro",
        700..=716 => "bus",
        800 => "trolleybus",
        900..=906 => "tram",
        1000 | 1200 => "ferry",
        1300..=1307 => "cable_car",
        1400 => "funicular",
        1500..=1507 => "bus",
        1700 => "bus",
        _ => return None,
    })
}

/// Purpose: the basic GTFS `route_type` of a core MobSimLab mode. None for plugin modes, whose
/// manifests give theirs (`gtfsRouteType`).
pub fn route_type_of(mode: &str) -> Option<u16> {
    Some(match mode {
        "tram" | "light_rail" => 0,
        "metro" => 1,
        "commuter_rail" | "regional_rail" | "long_distance_rail" | "high_speed_rail" => 2,
        "bus" | "brt" | "intercity_bus" => 3,
        "trolleybus" => 11,
        _ => return None,
    })
}
