import type { AdviceMessages } from "./en";

/** Advice messages (nl). */
export const adviceNl = {
  "advice.title": "Wat beter kan",
  "advice.intro": "De problemen die deze run vond, het ernstigste eerst, en wat u aan elk ervan kunt doen.",
  "advice.none": "Niets te verbeteren: deze run vond geen knelpunt of probleem.",
  "advice.show": "Op de kaart tonen",
  "advice.more": "Nog {n} niet getoond.",
  "advice.severity.problem": "Probleem",
  "advice.severity.warning": "Waarschuwing",
  "advice.crowdMap": "Op de kaart tonen hoe vol de voertuigen zijn (drukste uur van elke lijn)",
  "advice.cap.stopped": "{line}: de run is gestopt: {problem}",
  "advice.cap.stoppedFix": "Los dit op in het spoorontwerp en voer de test daarna opnieuw uit.",
  "advice.cap.unplaced": "{line}: ritten die niet op het spoor passen: {n}",
  "advice.cap.unplacedFix":
    "Laat de lijn in deze periode minder vaak rijden, of geef de treinen meer ruimte waar ze elkaar tegenkomen: meer perronsporen of overloopwissels in {terminal}, of een passeerspoor op enkelspoor.",
  "advice.cap.terminal":
    "{line}: eindpunt {terminal} is het knelpunt, bezet {share} van het drukste uur (grens {limit})",
  "advice.cap.terminalFix":
    "Treinen bezetten de perronsporen te lang. Verkort het keren (kortere keertijd, of een machinist die aan elk eind wacht), voeg een perronspoor toe, of leg de overloopwissel dichter bij de perrons zodat treinen hem eerder vrijmaken.",
  "advice.cap.section":
    "{line}: spoorsectie {section} is het knelpunt, bezet {share} van het drukste uur (grens {limit})",
  "advice.cap.sectionFix":
    "Treinen bezetten deze sectie langer dan elke andere. Een hogere snelheid erdoorheen laat ze hem eerder vrijmaken; anders rijden hier minder treinen.",
  "advice.cap.sectionPlatform":
    "Deze sectie is een perronspoor: treinen bezetten het zolang ze langs het perron staan. Kortere stops daar, of een tweede perronspoor voor deze richting, laten de volgende trein eerder binnen.",
  "advice.cap.sectionSwitches":
    "Deze sectie is een wisselgebied: treinen bezetten het terwijl hun rijweg over de wissels wordt ingesteld en opgeheven. Wissels met een hogere snelheid in de afbuigende tak, of wissels die zo liggen dat beide richtingen elkaar niet kruisen, maken het eerder vrij.",
  "advice.cap.signalAdd":
    "Deze sectie op vrije baan is {length} m lang, maar een blok heeft bij {speed} km/h maar {block} m nodig. Plaats een bloksein op ongeveer {at} m langs spoor {track}, zodat de volgende trein eerder de eerste helft in kan.",
  "advice.cap.signalShort":
    "Deze sectie is {length} m lang, minder dan twee blokken van {block} m bij {speed} km/h, dus nog een sein liet te weinig ruimte om te stoppen. Treinen kunnen dichter volgen met cabinesignalering (CBTC of ETCS niveau 2), of met een lagere snelheid hier.",
  "advice.cap.sectionCab":
    "Met cabinesignalering volgen treinen al op remafstand ({block} m bij {speed} km/h); seinen bepalen de afstand niet. Een hogere snelheid in de sectie, of minder treinen, maakt haar eerder vrij.",
  "advice.cap.sectionSight":
    "Trams rijden hier op zicht, dus seinen bepalen de afstand niet. Kortere stops in de buurt, of een eigen baan los van het verkeer, maken haar eerder vrij.",
  "advice.cap.nearNote": "Het werkt nog, maar er is weinig ruimte om treinen toe te voegen.",
  "advice.cap.pileUp":
    "{line}: vertragingen stapelen zich op en zijn aan het eind van de periode gemiddeld nog {late}",
  "advice.cap.pileUpFix":
    "Voeg buffertijd toe op de eindpunten, of rijd iets minder vaak, zodat een te late trein de volgende niet ophoudt.",
  "advice.cap.full": "{line}: voertuigen zijn voor {share} vol van {from} tot {to}, {time}",
  "advice.cap.fullMore":
    "{left} mensen blijven in de periode achter. Het spoor laat tot {n} treinen per uur per richting toe: rijd vaker, of gebruik langere treinen.",
  "advice.cap.fullLonger":
    "{left} mensen blijven in de periode achter. Rijd vaker als het spoor dat toelaat, of gebruik langere voertuigen.",
  "advice.cap.streetPileUp":
    "{line}: vertragingen stapelen zich op straat op en zijn aan het eind nog {late}",
  "advice.cap.streetPileUpFix":
    "Plan meer tijd voor de omloop of een langere keertijd aan de eindhaltes, zodat voertuigen kunnen inlopen; een eigen rijstrook waar ze verkeer tegenkomen helpt het meest.",
  "advice.road.cannotRun": "{line} kon niet rijden",
  "advice.road.cannotRunFix": "{problem}. Herstel de route in Maken → Wegroute en voer daarna opnieuw uit.",
  "advice.road.late": "{line}: maar {share} van de vertrekken op tijd (advies onder {limit})",
  "advice.road.mostlySignals":
    "Elke rit verliest {signals} min bij rode verkeerslichten en {traffic} min in het verkeer, dus het meeste bij de verkeerslichten die hier staan.",
  "advice.road.mostlyTraffic":
    "Elke rit verliest {traffic} min in het verkeer en {signals} min bij rode verkeerslichten, dus het meeste in de straten die hier staan.",
  "advice.road.moreTime":
    "De omloop duurde {run} min tegen {planned} min gepland: plan meer rijtijd, of zet een voertuig extra in.",
  "advice.road.bunched": "{line}: {share} van de vertrekken komt in clusters",
  "advice.road.bunchedFix":
    "Voertuigen halen elkaar in. Houd ze aan de eindhaltes vast op de dienstregeling, geef daar een langere keertijd, of geef de lijn een eigen rijstrook waar ze tijd verliest.",
  "advice.road.ranOut": "{line}: voertuigen waarvan de lading op raakte: {n}",
  "advice.road.ranOutFix":
    "Gebruik een grotere accu, laad aan de eindhaltes, of wissel voertuigen in de loop van de dag.",
  "advice.road.stuck": "{line}: voertuigen die 5 minuten of langer vaststonden: {n}",
  "advice.road.stuckFix":
    "Controleer op het GIS-tabblad de straatinrichting en de verkeerslichten op deze plek: misschien ontbreekt een afslag, of het verkeer blokkeert het kruispunt.",
  "advice.road.notBack": "{line}: voertuigen niet terug in de stalling aan het eind: {n}",
  "advice.road.notBackFix":
    "Controleer de route tussen de lijn en haar stalling, of laat meer tijd na de laatste rit.",
  "advice.road.unnamedStreet": "een straat zonder naam",
  "advice.road.unnamedJunction": "een kruispunt",
  "advice.road.spot.signal": "Rood licht op {place}: {min} min verloren in totaal ({lines})",
  "advice.road.spot.signalFix":
    "De lijnen wachten hier langer dan waar ook. Vraag voor hen voorrang bij dit verkeerslicht, of lichttijden die bij hen passen. De wegsimulatie modelleert voorrang nog niet en kan de winst dus niet tonen.",
  "advice.road.spot.street": "Verkeer op {place}: {min} min verloren in totaal ({lines})",
  "advice.road.spot.streetFix":
    "Geef de lijnen een eigen rijstrook in deze straat (GIS-tabblad, straatinrichting: busbaan), of leid ze via een andere straat.",
  "advice.road.spot.junction": "Stilstaan op {place}: {min} min verloren in totaal ({lines})",
  "advice.road.spot.junctionFix":
    "Voertuigen staan stil op dit kruispunt, wachtend om af te slaan of tot de uitgang vrij is. Een eigen rijstrook tot daar, of een aparte afslagfase bij de verkeerslichten, helpt.",
} satisfies AdviceMessages;
