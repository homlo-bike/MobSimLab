# Research R1: cable car and ferry service lines, and other modes worth adding

- Date: 2026-11-02
- Status: Research for [ADR-0036](../adr/0036-cable-car-and-ferry-lines.md) (Proposed)
- Asked by: product owner, 2026-11-02: "In addition to street service lines and rail service lines, add cable car and ferry service lines. Start with research on industry, startups, requirements and infrastructure design. What other similar public mobility solutions should be included?"
- Related: [01 Overview, out of scope](../architecture/01-overview.md) (ferry and aerial cable car were listed as later candidates), ADR-0018 (assumptions), ADR-0026 (vehicle catalogue), ADR-0029 (street lines), ADR-0030/0032 (railway design and operations), ADR-0034 (journey planner)

**How to read the numbers.** Values marked *(src)* come from the linked source. Values marked *(to verify)* are from general industry knowledge and must be checked before they enter the assumption library; in the library they start as `basis: educated-guess`, `check: unverified` (ADR-0018). Manufacturer figures are marketing maxima, not planning values.

## 1. Aerial ropeways (cable cars) in urban transport

### 1.1 Why cities build them

Urban ropeways cross what roads and rails cannot cheaply cross: steep hillsides with informal settlements (Medellín, La Paz, Mexico City), rivers and harbours (London, Koblenz, Brest, Toulouse), and motorway or rail corridors (Créteil). They need only stations and towers on the ground, so land take and construction time are small compared with a tram or metro. Their limits are capacity (a few thousand passengers per hour and direction), line speed (about 20–30 km/h), straight lines between stations, wind, and the politics of flying over private property.

Reference systems:

| System | Opened | Type | Notes |
|--------|--------|------|-------|
| Metrocable, Medellín | 2004 (line K) | Monocable detachable gondola (MGD) | First modern urban gondola fully integrated with a metro; the model for Latin America *(to verify)* |
| Mi Teleférico, La Paz–El Alto | 2014 onwards | MGD, Doppelmayr | Largest urban ropeway network, about 10 lines *(to verify)* |
| Cablebús, Mexico City | 2021 (L1, L2), 2024 (L3) | MGD, Doppelmayr (L3) | L3: 1,000 p/h/dir initially, 3,000 final phase *(src: [Doppelmayr press release](https://www.doppelmayr.com/wp-content/uploads/2024/09/PR_Cablebus-Linea-3-Mexico-City_Inauguration_September-2024_EN.pdf))* |
| Seilbahn Koblenz | 2010 | Tricable (3S), Doppelmayr | Rhine crossing, built for a garden show and kept *(src: [operator](https://www.seilbahn-koblenz.de/cable-car.html))* |
| IFS Cloud Cable Car, London | 2012 | MGD, Doppelmayr | Thames crossing; low ridership shows that a ropeway still needs a network and demand *(to verify)* |
| Téléphérique de Brest | 2016 | Aerial tramway (reversible), Bartholet | Two cabins pass over each other on one track; crosses the Penfeld *(to verify)* |
| Téléo, Toulouse | 2022 | 3S, Poma | About 3 km, crosses the Garonne and a hill; part of the Tisséo network and fare *(to verify)* |
| Câble C1, Créteil–Villeneuve-Saint-Georges | 2025 | MGD | First urban ropeway in Île-de-France; slows above 70 km/h wind, stops above 90 km/h with replacement buses *(src: [IDFM](https://www.iledefrance-mobilites.fr/en/le-reseau/projets/cablec1/questions/quelles-seront-les-precautions-prises-en-cas-dintemperies))* |
| Portland Aerial Tram; Roosevelt Island Tramway, New York | 2006; 1976 (rebuilt 2010) | Aerial tramway | Commuter shuttles on fixed short links *(to verify)* |

### 1.2 Technologies

| Technology | How it moves | Cabin | Typical line speed | Capacity (p/h/dir) | Wind tolerance | Planning notes |
|------------|-------------|-------|--------------------|--------------------|----------------|----------------|
| **Monocable detachable gondola (MGD, 1S)** | One haul-and-carry rope loop moves continuously; cabins detach in stations and crawl past the platforms | 8–10 (up to 15) | up to 6 m/s *(to verify)* | up to 3,000–4,500 *(src: [Poma](https://www.poma.net/wp-content/uploads/2022/06/Brochure-urbaine-EN.pdf), up to 4,500)* | about 60–70 km/h *(src: [wandernundmehr.at](https://www.wandernundmehr.at/faq/wann-fahren-gondeln-nicht))* | Cheapest, most common urban choice; short spans, many towers |
| **Bicable gondola (2S, BDG)** | One carrying rope, one haul rope | 15–17 | about 6–7 m/s *(to verify)* | about 3,000 *(to verify)* | about 80 km/h *(src: manufacturer claim cited by [Gondola Project](https://www.gondolaproject.com/2010/01/24/technologies-module-2-mdg/))* | Rare in cities |
| **Tricable gondola (3S)** | Two carrying ropes, one haul rope | 30–35 | up to 7.5–8.5 m/s *(to verify)* | up to 5,000 *(src: [Aerial Technologies](https://www.scribd.com/document/254537443/Aerial-Technologies))*; Doppelmayr TRI-Line claims up to 8,000 *(src: [liftblog](https://liftblog.com/2022/09/07/doppelmayr-introduces-tri-line-three-cable-system/))* | up to about 100–110 km/h *(src: [wandernundmehr.at](https://www.wandernundmehr.at/faq/wann-fahren-gondeln-nicht))* | Long spans (1–3 km), few towers; expensive |
| **Funitel** | Two parallel haul ropes, wide cabins | 20–30 | about 6–7 m/s | about 3,000–4,000 *(to verify)* | high | Mostly ski resorts |
| **Aerial tramway (reversible)** | Two cabins shuttle on fixed ropes and stop at the same time | 30–200 | up to 10–12 m/s *(to verify)* | 500–2,000, falls with length *(to verify)* | high | Timetabled shuttle; capacity = 2 × cabin size per round trip |
| **Pulsed gondola** | Groups of fixed-grip cabins; the rope stops when a group is in the stations | 4–15 | 4–5 m/s | low | medium | Cheap, short links |

Generic ceiling for any ropeway: about 6,000 p/h/dir *(src: [Doppelmayr urban FAQ](https://www.doppelmayr.com/files/sites/default/data/_general_content/pdfs/2020_Urban_FAQs_ENG.pdf))*. A 10-cabin MGD at 6 m/s with cabins every 12 s gives 3,000 p/h/dir at full load.

**Continuous versus reversible changes the whole operating model.** A continuous gondola has no timetable: it is a moving belt of cabins with a cabin interval of 8–30 s, so passengers just turn up. A reversible tram is a timetabled shuttle like a funicular.

### 1.3 Industry players and startups

| Group | Who | Notes |
|-------|-----|-------|
| Established manufacturers | Doppelmayr/Garaventa (Austria/Switzerland); Leitner and Poma (HTI group, Italy/France); Bartholet (Switzerland); MND (France) | Doppelmayr and HTI together build most urban systems. Urban work is about 20 % of the largest maker's sales *(src: [The Guardian Nigeria / AFP](https://guardian.ng/news/world/as-planet-gets-warmer-ski-gondola-maker-goes-urban/))* |
| Planners and consultants | Gondola Project / CUP (Creative Urban Projects), SYSTRA, Egis, Ingérop *(to verify)* | Feasibility, alignment and integration studies |
| **Whoosh (formerly Swyft Cities)**, New Zealand/US | Autonomous, lightweight on-demand pods hanging from fixed cables; ex-Google founders; first public system in Queenstown targeted for 2026; studied by Sugar Land, Texas *(src: [TechCrunch](https://techcrunch.com/2022/05/19/swyft-cities-is-the-winner-of-the-techcrunch-mobility-2022-pitch-off), [New Atlas](https://newatlas.com/urban-transport/whoosh-gondola-pods/), [Sugar Land](https://sugarlandtx.gov/CivicAlerts.asp?AID=1888))* | Closer to personal rapid transit (PRT) than to a gondola: point-to-point, no fixed stopping pattern |
| **Zippar**, Japan | Self-driving aerial cabins on rails and ropes, able to curve without stations *(src: [Rio Times](https://www.riotimesonline.com/riding-the-skies-zippars-infrastructures-vision-for-traffic-free-asian-cities/))* | Hybrid between ropeway and suspended monorail |
| **RWTH Aachen "UpBus"** | Autonomous electric bus whose cabin detaches from the chassis and continues on a ropeway; trial planned for August 2025 *(src: [EV Magazine](https://evmagz.com/germanys-rwth-aachen-advances-testing-of-modular-autonomous-electric-bus-cable-car-concept/amp/))* | Research; a street-to-cable handover |

The startups matter for MobSimLab mainly as a reminder that "cable" is a family: the model should allow on-demand point-to-point service later, not only fixed stopping patterns.

### 1.4 Requirements and regulation

- **EU:** Regulation (EU) 2016/424 on cableway installations, which explicitly covers urban transport *(src: [legislation.gov.uk copy](https://www.legislation.gov.uk/eur/2016/424/pdfs/eur_20160424_adopted_en.pdf))*. Harmonised standards: EN 12929-1/-2 (general requirements, including wind; under revision to treat wind better), EN 12927 (ropes), EN 13796 (carriers), EN 1909 (recovery and evacuation), EN 1709 (pre-commissioning inspection) *(src: [evs.ee EN 12929-2](https://www.evs.ee/en/evs-en-12929-2-2015-a1-2022-consolidated), [genorma EN 12929-1](https://genorma.com/en/standards/en-12929-1-2015))*. **US:** ANSI B77.1 *(to verify)*.
- **Wind** is the main operational limit. Typical behaviour: warning at about 40 km/h, slow-down at about 60–70 km/h, stop at about 60–110 km/h depending on technology and site *(src: [IDFM](https://www.iledefrance-mobilites.fr/en/le-reseau/projets/cablec1/questions/quelles-seront-les-precautions-prises-en-cas-dintemperies), [wandernundmehr.at](https://www.wandernundmehr.at/faq/wann-fahren-gondeln-nicht))*. The 2026 Titlis/Engelberg cabin detachment, attributed to a gust, keeps wind high on the regulator's list *(src: [liftblog](https://liftblog.com/2026/03/18/one-dead-in-swiss-gondola-detachment))*.
- **Evacuation:** every line needs a recovery concept (auxiliary drive bringing cabins back to stations) and, where that fails, rope or ground evacuation. Height above ground and access for rescue teams under the line limit where a line may run.
- **Overflight** of homes and private land is the most common reason urban projects stall. France created a public overflight easement for urban ropeways in 2015 *(to verify)*; elsewhere it is negotiated case by case.
- **Clearance:** minimum distance between the lowest point of a loaded cabin (rope sag plus swing) and ground, roads, buildings and power lines, set by EN 12929 and national rules *(to verify exact values)*.
- **Accessibility:** cabins with level boarding; stations slow cabins further or stop them for wheelchair users and prams.

### 1.5 Infrastructure design

| Element | What the planner decides | What MobSimLab can check at planning grade |
|---------|--------------------------|--------------------------------------------|
| **Alignment** | Straight sections between stations. A detachable line changes direction only in a station (an intermediate or angle station). | Angle at each station within the system's limit |
| **Stations** | Drive or return terminal, intermediate (boarding) station, angle station (no boarding, or optional) | Footprint (typically 30–60 m long for an MGD), level access, link to street, platform length vs cabin interval |
| **Towers** | Number, height, position | Span limit per technology (MGD a few hundred metres, 3S over 1 km), max tower height, clearance from the DEM and building heights (OSM `height`, `building:levels`) with rope sag |
| **Ropes and drive** | Line speed, number of cabins, drive power | Capacity, cycle time, power demand |
| **Cabin garage** | Where cabins are stored at night | Cabin count = line length × 2 ÷ cabin spacing + reserve; this is the "depot" |
| **Overflight corridor** | Width either side of the line | Buildings and land parcels flown over, length over private property |
| **Wind exposure** | — | Share of hours above the slow-down and stop thresholds from a wind statistic the planner supplies |

Cost: about €20–35 million per km for recent urban systems, stations being the largest item *(to verify against Toulouse Téléo and Câble C1 published costs)*. Operating cost per passenger-km is low because one control room runs the whole line.

## 2. Ferries and water buses

### 2.1 Urban and regional ferry services

| Kind | Examples | Character |
|------|----------|-----------|
| River or harbour **water bus** with several piers | Hamburg HADAG, Bangkok Chao Phraya Express, Istanbul Şehir Hatları, London Uber Boat by Thames Clippers, Brisbane CityCat *(to verify)* | A bus line on water: stops every 0.5–3 km, timetabled, 8–25 knots |
| Short **crossing shuttle** | Amsterdam IJ ferries, Hong Kong Star Ferry *(to verify)* | Two piers, high frequency, very short crossings, often free or integrated fare |
| **Commuter fast ferry** | NYC Ferry, Sydney Ferries, San Francisco Bay Ferry, Stockholm *pendelbåt* *(to verify)* | Fewer stops, 25–35 knots, catamarans |
| **Car and passenger ferry (ro-pax)** | Norwegian fjord ferries | Vehicles drive on and off: links road network to road network |
| **On-demand water taxi** | Venice, many startups | Demand-responsive on water |

US practice puts ferry capacity in TCQSM 3rd edition, Chapter 9, with station capacity in Chapter 10 *(src: [TCQSM 3rd ed., National Academies](https://www.nationalacademies.org/read/24766/chapter/11))*, and the newer TCRP Research Report 238, *Quantitative Procedures for Designing and Operating Ferry Services* (2023), covers boarding throughput, dwell and manoeuvring *(src: [National Academies](https://www.nationalacademies.org/read/26748/chapter/5))*. These are the natural first sources for the assumption library, as TCQSM already is for buses.

### 2.2 Industry players and startups

| Group | Who | Notes |
|-------|-----|-------|
| Shipbuilders | Damen (NL), Incat and Austal (AU), Fjellstrand and Brødrene Aa (NO) *(to verify)* | Monohull and catamaran ferries, increasingly battery-electric |
| Battery and propulsion suppliers | Corvus Energy, Echandia, Leclanché, Torqeedo *(to verify)* | Battery systems and shore charging |
| **Candela**, Sweden | P-12 electric hydrofoil, 30 passengers, in commuter service in Stockholm and announced for Lake Tahoe; claims about 80 % less energy than conventional vessels *(src: [TechCrunch](https://techcrunch.com/2024/11/21/candela-brings-its-p-12-electric-ferry-to-tahoe-and-adds-another-14m-to-build-more), [Marine Industry News](https://marineindustrynews.co.uk/candela-raises-20m-for-mass-electric-ferry-production/))* | Hydrofoils cut wake and energy; speed about 25 knots *(to verify)* |
| **Navier**, US | N30 electric hydrofoil, used as a corporate shuttle in the San Francisco Bay Area *(src: [EV Magazine](https://evmagazine.com/top10/top-10-water-taxis))* | Specs provisional |
| **Zeabuz**, Norway (Torghatten) | Autonomous electric passenger ferry; first commercial service in Stockholm in 2023 *(src: [EU Clean energy for EU islands](https://clean-energy-islands.ec.europa.eu/news/worlds-first-commercial-autonomous-electric-passenger-ferry-has-been-launched-stockholm), [Zag Daily](https://zagdaily.com/tech/zeabuz-takes-home-eu-start-up-prize-for-mobility/))* | Small, frequent, on-demand crossings without crew |

Trend: battery-electric short crossings with fast shore charging during the dwell, hydrofoils on longer urban routes, and autonomous small ferries replacing bridges that would be too expensive.

### 2.3 Requirements and regulation

- **International:** SOLAS and the IMO **High-Speed Craft (HSC) Code** for fast craft.
- **EU domestic voyages:** Directive 2009/45/EC applies above 12 passengers and splits sea areas A–D by distance from shore and wave climate. Area C: significant wave height above 2.5 m with less than 10 % probability per year, within 5 miles of shore; Area D: above 1.5 m with less than 10 % probability, within 3 miles *(src: [EUR-Lex consolidated](https://eur-lex.europa.eu/eli/dir/2009/45))*. Inland waterways are under separate rules (Directive (EU) 2016/1629 *(to verify)*). **US:** 46 CFR Subchapter T (small passenger vessels) and K *(to verify)*.
- **Weather:** waves, wind, fog (visibility) and ice cancel or slow sailings; each class of vessel has an operating limit.
- **Crew:** minimum safe manning per vessel, which dominates operating cost for small boats (and is the case for autonomy).
- **Accessibility:** step-free boarding needs a gangway or ramp that copes with the tidal or river-level range.

### 2.4 Infrastructure design

| Element | What the planner decides | What MobSimLab can check at planning grade |
|---------|--------------------------|--------------------------------------------|
| **Pier / landing** | Fixed quay or floating pontoon; number of **berths**; gangways per berth | Berth occupancy (berths are a reserved resource, like platforms); walk link to street and other modes; level range handled by the gangway |
| **Fairway** | The water path, routed automatically on navigable water | Route stays on water polygons with a shore clearance; passes under bridges only if the vessel's air draught fits (OSM `maxheight`, `seamark:bridge:clearance_height`); draught vs depth where the planner gives a depth |
| **Speed zones** | Harbour, wash-restricted and canal speed limits | Running time from speed per zone, plus acceleration and berthing manoeuvre |
| **Locks** | Waterway locks on the route (OSM `waterway=lock_gate`) | Lock cycle time, one vessel group at a time |
| **Charging** | Shore chargers at some piers | Energy per trip vs battery and charge during dwell (same model as battery buses) |
| **Home port / yard** | Where vessels lie overnight and are maintained | The ferry "depot": berth count vs fleet |

Running time = berthing approach + sailing at the zone speeds + berthing; dwell is driven by boarding throughput per gangway, which TCRP Report 238 treats as the capacity limit at busy terminals *(src: [National Academies](https://www.nationalacademies.org/read/26748/chapter/7))*.

## 3. Other public mobility modes worth adding

Ranked by how well they fit MobSimLab's existing engines and how often planners need them.

| Priority | Mode | Why | Fits which existing tool |
|----------|------|-----|--------------------------|
| **1 (with this work)** | **Funicular** | Hill links in many cities (Lisbon, Haifa Carmelit, Valparaíso, Budapest); two counterweighted cars on one track with a passing loop | Railway design tool and rail kernel: a rail mode with fixed two-car shuttle operation and steep gradients. GTFS route type 7 |
| **1** | **Aerial tramway** (reversible) | Same as cable car but timetabled | Cable car tool, shuttle operation |
| **2** | **Automated people mover (APM) and monorail** | Airports, new districts, some cities (Las Vegas, Chongqing, São Paulo) | Railway tool and kernel with a guideway "gauge" and CBTC; cable-driven APMs (Doppelmayr Cable Liner, *to verify*) fit the cable engine instead. GTFS route type 12 for monorail |
| **2** | **Rack (cog) railway** | Steep mountain and city lines (Stuttgart Zacke, Zürich Dolderbahn *(to verify)*) | Rail mode with a rack section allowing much steeper gradients and lower speeds |
| **2** | **Public lifts, inclined elevators and outdoor escalators** | Medellín Comuna 13 escalators, Lisbon and Valparaíso lifts, Genoa | Not lines: walk links with a capacity and wait time in the walk graph (journey planner and 15-minute walk analysis) |
| **2** | **Guided bus / trackless tram (ART)** | Already close to BRT | Street line tool, vehicle catalogue entry only |
| **3** | **Demand-responsive transport (DRT, microtransit)** and **autonomous shuttles** | Common in low-density areas; listed out of scope for v1 | Needs a dispatch model (zones, booking, pooling), a separate ADR. Autonomous shuttles on fixed routes are just a street mode vehicle |
| **3** | **Bike share, e-scooters, cargo bikes** | First and last mile | GBFS as data for access to stops (already the v1 position), not simulated |
| **3** | **On-demand cable pods (PRT)** and **water taxis** | Startups above | Later, on top of the DRT dispatch model |

Not recommended: hyperloop and urban air mobility (eVTOL "air taxis"). Neither runs as public scheduled transport today, and their parameters cannot be sourced.

## 4. Where the research points

1. Treat **cable car** (continuous gondolas and reversible trams) and **ferry** as two new mode families with their own drawing tools, both sharing the station-and-line concepts already used for rail.
2. A continuous gondola is **frequency-based** (no timetable); the existing journey planner already expands frequency patterns into trips.
3. Ferries are **timetabled** like rail, with **berths** as the reserved resource, running times from speed zones, and weather as a disruption scenario.
4. Add **funicular** at the same time through the railway tool; plan people movers, monorails, rack railways and public lifts next; leave DRT for its own ADR.
5. The assumption library needs new entries for both modes; start with TCQSM Chapter 9 and TCRP Report 238 for ferries, and EN 12929 plus manufacturer data for ropeways.

The decisions are in [ADR-0036](../adr/0036-cable-car-and-ferry-lines.md).
