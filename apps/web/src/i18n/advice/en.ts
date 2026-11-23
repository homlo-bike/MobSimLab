/**
 * English messages of the advice after a run (apps/web/src/features/advice): what to improve after the system
 * test (`advice.cap.*`) and the road run (`advice.road.*`). Merged into each language's dictionary; every
 * language has its own file next to this one.
 */
export const adviceEn = {
  "advice.title": "What to improve",
  "advice.intro": "Problems this run found, the worst first, and what you can do about each.",
  "advice.none": "Nothing to improve: this run found no bottleneck or problem.",
  "advice.show": "Show on the map",
  "advice.more": "{n} more not shown.",
  "advice.severity.problem": "Problem",
  "advice.severity.warning": "Warning",
  "advice.crowdMap": "Show how full the vehicles are on the map (busiest hour of each line)",
  "advice.cap.stopped": "{line}: the run stopped: {problem}",
  "advice.cap.stoppedFix": "Fix this in the railway tool, then run the test again.",
  "advice.cap.unplaced": "{line}: trips that do not fit on the track: {n}",
  "advice.cap.unplacedFix":
    "Run the line less often in this period, or give its trains more room where they meet: more platforms or crossovers at {terminal}, or a passing loop on single track.",
  "advice.cap.terminal":
    "{line}: {terminal} terminal is the bottleneck, in use {share} of the busiest hour (limit {limit})",
  "advice.cap.terminalFix":
    "Trains hold its platforms too long. Shorten the turnaround (a shorter layover, or a driver waiting at each end), add a platform track, or move the crossover closer to the platforms so trains clear it sooner.",
  "advice.cap.section":
    "{line}: track section {section} is the bottleneck, in use {share} of the busiest hour (limit {limit})",
  "advice.cap.sectionFix":
    "Trains hold this section longer than any other. A higher speed through it lets them clear it sooner; otherwise run fewer trains here.",
  "advice.cap.sectionPlatform":
    "This section is a platform track: trains hold it while they stand at the platform. Shorter stops there, or a second platform track for this direction, let the next train in sooner.",
  "advice.cap.sectionSwitches":
    "This section is a switch area: trains hold it while their route through the switches is set and cleared. Turnouts with a higher speed on the diverging track, or switches placed so that the two directions do not cross each other, free it sooner.",
  "advice.cap.signalAdd":
    "This plain-line section is {length} m long, but a block needs only {block} m at {speed} km/h. Add a block signal at about {at} m along track {track}, so that the next train can follow into the first half sooner.",
  "advice.cap.signalShort":
    "This section is {length} m long, less than two blocks of {block} m at {speed} km/h, so another signal would leave too little room to stop. Trains can follow closer with cab signalling (CBTC or ETCS level 2), or with a lower speed here.",
  "advice.cap.sectionCab":
    "Under cab signalling trains already follow at braking distance ({block} m at {speed} km/h); signals do not set the spacing. A higher speed through the section, or fewer trains, frees it sooner.",
  "advice.cap.sectionSight":
    "Trams drive on sight here, so signals do not set the spacing. Shorter stops nearby, or a track of their own away from road traffic, free it sooner.",
  "advice.cap.nearNote": "It still works, but there is little room to add trains.",
  "advice.cap.pileUp": "{line}: delays pile up and are still {late} on average when the period ends",
  "advice.cap.pileUpFix":
    "Add recovery time at the terminals, or run slightly less often, so that a late train does not hold up the next one.",
  "advice.cap.full": "{line}: vehicles are {share} full from {from} to {to}, {time}",
  "advice.cap.fullMore":
    "{left} people are left behind over the period. The track allows up to {n} trains an hour each way: run more often, or use longer trains.",
  "advice.cap.fullLonger":
    "{left} people are left behind over the period. Run more often if the track allows it, or use longer vehicles.",
  "advice.cap.streetPileUp": "{line}: delays pile up on the street and are still {late} at the end",
  "advice.cap.streetPileUpFix":
    "Plan more time for the circuit or a longer layover at the end stops, so vehicles can catch up; a lane of its own where it meets traffic helps most.",
  "advice.road.cannotRun": "{line} could not run",
  "advice.road.cannotRunFix": "{problem}. Fix the street line in Create → Street line, then run again.",
  "advice.road.late": "{line}: only {share} of departures on time (advice below {limit})",
  "advice.road.mostlySignals":
    "Each trip loses {signals} min at red lights and {traffic} min in traffic, so most of it at the traffic lights listed here.",
  "advice.road.mostlyTraffic":
    "Each trip loses {traffic} min in traffic and {signals} min at red lights, so most of it on the streets listed here.",
  "advice.road.moreTime":
    "The circuit took {run} min against {planned} min planned: plan more running time, or add a vehicle.",
  "advice.road.bunched": "{line}: {share} of departures come bunched",
  "advice.road.bunchedFix":
    "Vehicles catch up with each other. Hold them at the end stops to the timetable, give a longer layover there, or give the line a lane of its own where it loses time.",
  "advice.road.ranOut": "{line}: vehicles that ran out of charge: {n}",
  "advice.road.ranOutFix": "Use a larger battery, charge at the end stops, or swap vehicles during the day.",
  "advice.road.stuck": "{line}: vehicles stuck for 5 minutes or more: {n}",
  "advice.road.stuckFix":
    "Check the street setup and the traffic lights at this place in the GIS tab: a turn may be missing, or traffic blocks the junction.",
  "advice.road.notBack": "{line}: vehicles not back in the depot by the end: {n}",
  "advice.road.notBackFix":
    "Check the route between the line and its depot, or allow more time after the last trip.",
  "advice.road.unnamedStreet": "a street without a name",
  "advice.road.unnamedJunction": "a junction",
  "advice.road.spot.signal": "Red light on {place}: {min} min lost in all ({lines})",
  "advice.road.spot.signalFix":
    "The lines wait here longer than anywhere else. Ask for priority for them at this light, or for signal timings that suit them. The road run does not model priority yet, so it cannot show the gain.",
  "advice.road.spot.street": "Traffic on {place}: {min} min lost in all ({lines})",
  "advice.road.spot.streetFix":
    "Give the lines a lane of their own on this street (GIS tab, street setup: bus lane), or take them along another street.",
  "advice.road.spot.junction": "Standing in {place}: {min} min lost in all ({lines})",
  "advice.road.spot.junctionFix":
    "Vehicles stand inside this junction, waiting to turn or for the way out to clear. A lane of their own up to it, or a separate turn phase at its lights, helps.",
};

/** A language's advice messages: every key of the English ones. */
export type AdviceMessages = Record<keyof typeof adviceEn, string>;
