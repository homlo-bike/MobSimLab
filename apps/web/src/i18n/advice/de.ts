import type { AdviceMessages } from "./en";

/** Advice messages (de). */
export const adviceDe = {
  "advice.title": "Was sich verbessern lässt",
  "advice.intro":
    "Die Probleme, die dieser Lauf gefunden hat, das schwerste zuerst, und was Sie jeweils tun können.",
  "advice.none": "Nichts zu verbessern: Dieser Lauf hat keinen Engpass und kein Problem gefunden.",
  "advice.show": "Auf der Karte zeigen",
  "advice.more": "{n} weitere nicht angezeigt.",
  "advice.severity.problem": "Problem",
  "advice.severity.warning": "Warnung",
  "advice.crowdMap": "Auf der Karte zeigen, wie voll die Fahrzeuge sind (stärkste Stunde jeder Linie)",
  "advice.cap.stopped": "{line}: Der Lauf wurde abgebrochen: {problem}",
  "advice.cap.stoppedFix": "Beheben Sie das im Bahn-Werkzeug und starten Sie den Test dann erneut.",
  "advice.cap.unplaced": "{line}: Fahrten, die nicht auf die Gleise passen: {n}",
  "advice.cap.unplacedFix":
    "Lassen Sie die Linie in diesem Zeitraum seltener fahren, oder geben Sie ihren Zügen mehr Raum, wo sie sich begegnen: mehr Bahnsteiggleise oder Gleiswechsel in {terminal} oder eine Kreuzungsstelle auf eingleisiger Strecke.",
  "advice.cap.terminal":
    "{line}: Der Endbahnhof {terminal} ist der Engpass, belegt zu {share} der stärksten Stunde (Grenze {limit})",
  "advice.cap.terminalFix":
    "Die Züge belegen seine Bahnsteige zu lange. Verkürzen Sie die Wende (kürzere Standzeit oder ein wartender Triebfahrzeugführer an jedem Ende), fügen Sie ein Bahnsteiggleis hinzu oder legen Sie den Gleiswechsel näher an die Bahnsteige, damit die Züge ihn früher räumen.",
  "advice.cap.section":
    "{line}: Der Gleisabschnitt {section} ist der Engpass, belegt zu {share} der stärksten Stunde (Grenze {limit})",
  "advice.cap.sectionFix":
    "Die Züge belegen diesen Abschnitt länger als jeden anderen. Eine höhere Geschwindigkeit darin lässt sie ihn früher räumen; andernfalls fahren Sie hier weniger Züge.",
  "advice.cap.sectionPlatform":
    "Dieser Abschnitt ist ein Bahnsteiggleis: Die Züge belegen es, solange sie am Bahnsteig halten. Kürzere Halte dort oder ein zweites Bahnsteiggleis für diese Richtung lassen den nächsten Zug früher einfahren.",
  "advice.cap.sectionSwitches":
    "Dieser Abschnitt ist ein Weichenbereich: Die Züge belegen ihn, während ihre Fahrstraße über die Weichen eingestellt und aufgelöst wird. Weichen mit höherer Geschwindigkeit im abzweigenden Strang oder Weichen, die so liegen, dass sich die beiden Richtungen nicht kreuzen, geben ihn früher frei.",
  "advice.cap.signalAdd":
    "Dieser Abschnitt auf freier Strecke ist {length} m lang, ein Block braucht bei {speed} km/h aber nur {block} m. Stellen Sie bei etwa {at} m auf Gleis {track} ein Blocksignal auf, damit der nächste Zug früher in die erste Hälfte nachrücken kann.",
  "advice.cap.signalShort":
    "Dieser Abschnitt ist {length} m lang, weniger als zwei Blöcke von {block} m bei {speed} km/h; ein weiteres Signal ließe zu wenig Raum zum Anhalten. Dichter folgen können die Züge mit Führerstandssignalisierung (CBTC oder ETCS Level 2) oder mit einer niedrigeren Geschwindigkeit hier.",
  "advice.cap.sectionCab":
    "Mit Führerstandssignalisierung folgen die Züge bereits im Bremswegabstand ({block} m bei {speed} km/h); Signale bestimmen den Abstand nicht. Eine höhere Geschwindigkeit im Abschnitt oder weniger Züge geben ihn früher frei.",
  "advice.cap.sectionSight":
    "Straßenbahnen fahren hier auf Sicht, Signale bestimmen den Abstand also nicht. Kürzere Halte in der Nähe oder ein eigener Gleiskörper abseits des Straßenverkehrs geben ihn früher frei.",
  "advice.cap.nearNote": "Es funktioniert noch, aber es gibt kaum Raum für weitere Züge.",
  "advice.cap.pileUp":
    "{line}: Verspätungen schaukeln sich auf und betragen am Ende des Zeitraums im Mittel noch {late}",
  "advice.cap.pileUpFix":
    "Planen Sie mehr Pufferzeit an den Endbahnhöfen ein oder fahren Sie etwas seltener, damit ein verspäteter Zug nicht den nächsten aufhält.",
  "advice.cap.full": "{line}: Die Fahrzeuge sind von {from} bis {to} zu {share} ausgelastet, {time}",
  "advice.cap.fullMore":
    "{left} Fahrgäste bleiben über den Zeitraum zurück. Die Strecke erlaubt bis zu {n} Züge pro Stunde und Richtung: Fahren Sie öfter oder setzen Sie längere Züge ein.",
  "advice.cap.fullLonger":
    "{left} Fahrgäste bleiben über den Zeitraum zurück. Fahren Sie öfter, wenn die Strecke es erlaubt, oder setzen Sie längere Fahrzeuge ein.",
  "advice.cap.streetPileUp":
    "{line}: Verspätungen schaukeln sich auf der Straße auf und betragen am Ende noch {late}",
  "advice.cap.streetPileUpFix":
    "Planen Sie mehr Zeit für den Umlauf oder eine längere Wendezeit an den Endhaltestellen ein, damit die Fahrzeuge aufholen können; am meisten hilft eine eigene Spur dort, wo sie auf Verkehr treffen.",
  "advice.road.cannotRun": "{line} konnte nicht fahren",
  "advice.road.cannotRunFix":
    "{problem}. Korrigieren Sie die Straßenlinie unter Erstellen → Straßenlinie und starten Sie dann erneut.",
  "advice.road.late": "{line}: Nur {share} der Abfahrten pünktlich (Hinweis unter {limit})",
  "advice.road.mostlySignals":
    "Jede Fahrt verliert {signals} min an roten Ampeln und {traffic} min im Verkehr, also das meiste an den hier aufgeführten Ampeln.",
  "advice.road.mostlyTraffic":
    "Jede Fahrt verliert {traffic} min im Verkehr und {signals} min an roten Ampeln, also das meiste auf den hier aufgeführten Straßen.",
  "advice.road.moreTime":
    "Der Umlauf dauerte {run} min statt der geplanten {planned} min: Planen Sie mehr Fahrzeit ein oder setzen Sie ein Fahrzeug mehr ein.",
  "advice.road.bunched": "{line}: {share} der Abfahrten kommen im Pulk",
  "advice.road.bunchedFix":
    "Die Fahrzeuge holen einander ein. Halten Sie sie an den Endhaltestellen nach Fahrplan zurück, geben Sie dort eine längere Wendezeit oder geben Sie der Linie eine eigene Spur, wo sie Zeit verliert.",
  "advice.road.ranOut": "{line}: Fahrzeuge, deren Batterie leer wurde: {n}",
  "advice.road.ranOutFix":
    "Verwenden Sie eine größere Batterie, laden Sie an den Endhaltestellen oder tauschen Sie die Fahrzeuge im Laufe des Tages.",
  "advice.road.stuck": "{line}: Fahrzeuge, die 5 Minuten oder länger feststeckten: {n}",
  "advice.road.stuckFix":
    "Prüfen Sie im GIS-Tab die Straßeneinrichtung und die Ampeln an dieser Stelle: Vielleicht fehlt eine Abbiegebeziehung oder der Verkehr blockiert die Kreuzung.",
  "advice.road.notBack": "{line}: Fahrzeuge, die am Ende nicht im Betriebshof zurück waren: {n}",
  "advice.road.notBackFix":
    "Prüfen Sie den Weg zwischen der Linie und ihrem Betriebshof oder lassen Sie nach der letzten Fahrt mehr Zeit.",
  "advice.road.unnamedStreet": "einer Straße ohne Namen",
  "advice.road.unnamedJunction": "einer Kreuzung",
  "advice.road.spot.signal": "Rote Ampel an {place}: insgesamt {min} min verloren ({lines})",
  "advice.road.spot.signalFix":
    "Die Linien warten hier länger als irgendwo sonst. Fragen Sie nach einer Bevorrechtigung für sie an dieser Ampel oder nach Signalzeiten, die zu ihnen passen. Die Straßensimulation bildet Bevorrechtigung noch nicht ab und kann den Gewinn daher nicht zeigen.",
  "advice.road.spot.street": "Verkehr auf {place}: insgesamt {min} min verloren ({lines})",
  "advice.road.spot.streetFix":
    "Geben Sie den Linien auf dieser Straße eine eigene Spur (GIS-Tab, Straßeneinrichtung: Busspur), oder führen Sie sie über eine andere Straße.",
  "advice.road.spot.junction": "Stehen in {place}: insgesamt {min} min verloren ({lines})",
  "advice.road.spot.junctionFix":
    "Die Fahrzeuge stehen in dieser Kreuzung und warten aufs Abbiegen oder darauf, dass die Ausfahrt frei wird. Eine eigene Spur bis dorthin oder eine eigene Abbiegephase an ihrer Ampel hilft.",
} satisfies AdviceMessages;
