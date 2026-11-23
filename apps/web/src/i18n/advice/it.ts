import type { AdviceMessages } from "./en";

/** Advice messages (it). */
export const adviceIt = {
  "advice.title": "Cosa migliorare",
  "advice.intro":
    "I problemi trovati da questa simulazione, il più grave per primo, e cosa puoi fare per ciascuno.",
  "advice.none": "Niente da migliorare: questa simulazione non ha trovato colli di bottiglia né problemi.",
  "advice.show": "Mostra sulla mappa",
  "advice.more": "Altri {n} non mostrati.",
  "advice.severity.problem": "Problema",
  "advice.severity.warning": "Avviso",
  "advice.crowdMap": "Mostra sulla mappa quanto sono pieni i veicoli (ora di punta di ogni linea)",
  "advice.cap.stopped": "{line}: la simulazione si è fermata: {problem}",
  "advice.cap.stoppedFix": "Correggi il problema nello strumento ferroviario, poi esegui di nuovo il test.",
  "advice.cap.unplaced": "{line}: corse che non trovano posto sui binari: {n}",
  "advice.cap.unplacedFix":
    "Fai circolare la linea meno spesso in questo periodo, oppure dai ai suoi treni più spazio dove si incontrano: più binari di stazionamento o comunicazioni a {terminal}, o un punto di incrocio sul binario unico.",
  "advice.cap.terminal":
    "{line}: il capolinea {terminal} è il collo di bottiglia, occupato per il {share} dell’ora di punta (limite {limit})",
  "advice.cap.terminalFix":
    "I treni occupano i suoi binari troppo a lungo. Accorcia l’inversione (una sosta più breve, o un macchinista che aspetta a ogni estremità), aggiungi un binario di stazione, o avvicina la comunicazione ai binari perché i treni la liberino prima.",
  "advice.cap.section":
    "{line}: la sezione di binario {section} è il collo di bottiglia, occupata per il {share} dell’ora di punta (limite {limit})",
  "advice.cap.sectionFix":
    "I treni occupano questa sezione più a lungo di ogni altra. Una velocità maggiore la fa liberare prima; altrimenti fai circolare meno treni qui.",
  "advice.cap.sectionPlatform":
    "Questa sezione è un binario di stazione: i treni la occupano mentre sono fermi al marciapiede. Fermate più brevi, o un secondo binario per questa direzione, fanno entrare prima il treno successivo.",
  "advice.cap.sectionSwitches":
    "Questa sezione è una zona di scambi: i treni la occupano mentre il loro itinerario sugli scambi viene formato e distrutto. Scambi con velocità più alta in deviata, o disposti in modo che le due direzioni non si incrocino, la liberano prima.",
  "advice.cap.signalAdd":
    "Questa sezione di linea è lunga {length} m, ma a {speed} km/h una sezione di blocco richiede solo {block} m. Aggiungi un segnale di blocco a circa {at} m sul binario {track}, così il treno successivo può entrare prima nella prima metà.",
  "advice.cap.signalShort":
    "Questa sezione è lunga {length} m, meno di due sezioni di blocco da {block} m a {speed} km/h, quindi un altro segnale lascerebbe troppo poco spazio per fermarsi. I treni possono distanziarsi meno con il segnalamento in cabina (CBTC o ETCS livello 2), o con una velocità più bassa qui.",
  "advice.cap.sectionCab":
    "Con il segnalamento in cabina i treni si seguono già a distanza di frenatura ({block} m a {speed} km/h); non sono i segnali a fissare il distanziamento. Una velocità maggiore nella sezione, o meno treni, la liberano prima.",
  "advice.cap.sectionSight":
    "Qui i tram marciano a vista, quindi non sono i segnali a fissare il distanziamento. Fermate più brevi nelle vicinanze, o una sede propria lontana dal traffico, la liberano prima.",
  "advice.cap.nearNote": "Funziona ancora, ma c’è poco margine per aggiungere treni.",
  "advice.cap.pileUp":
    "{line}: i ritardi si accumulano e alla fine del periodo sono ancora di {late} in media",
  "advice.cap.pileUpFix":
    "Aggiungi tempo di recupero ai capolinea, o circola un po’ meno spesso, così un treno in ritardo non trattiene il successivo.",
  "advice.cap.full": "{line}: i veicoli sono pieni al {share} da {from} a {to}, {time}",
  "advice.cap.fullMore":
    "{left} persone restano a terra nel periodo. La linea consente fino a {n} treni l’ora per direzione: circola più spesso, o usa treni più lunghi.",
  "advice.cap.fullLonger":
    "{left} persone restano a terra nel periodo. Circola più spesso se la linea lo consente, o usa veicoli più lunghi.",
  "advice.cap.streetPileUp": "{line}: i ritardi si accumulano su strada e alla fine sono ancora di {late}",
  "advice.cap.streetPileUpFix":
    "Prevedi più tempo per il giro o una sosta più lunga ai capolinea, così i veicoli possono recuperare; aiuta soprattutto una corsia riservata dove incontrano il traffico.",
  "advice.road.cannotRun": "{line} non ha potuto circolare",
  "advice.road.cannotRunFix": "{problem}. Correggi la linea in Crea → Linee su strada, poi esegui di nuovo.",
  "advice.road.late": "{line}: solo il {share} delle partenze in orario (avviso sotto il {limit})",
  "advice.road.mostlySignals":
    "Ogni corsa perde {signals} min ai semafori rossi e {traffic} min nel traffico, quindi soprattutto ai semafori elencati qui.",
  "advice.road.mostlyTraffic":
    "Ogni corsa perde {traffic} min nel traffico e {signals} min ai semafori rossi, quindi soprattutto nelle strade elencate qui.",
  "advice.road.moreTime":
    "Il giro ha richiesto {run} min contro i {planned} min previsti: prevedi più tempo di percorrenza, o aggiungi un veicolo.",
  "advice.road.bunched": "{line}: il {share} delle partenze arriva accodato",
  "advice.road.bunchedFix":
    "I veicoli si raggiungono. Trattienili ai capolinea secondo l’orario, dai lì una sosta più lunga, o dai alla linea una corsia riservata dove perde tempo.",
  "advice.road.ranOut": "{line}: veicoli rimasti senza carica: {n}",
  "advice.road.ranOutFix":
    "Usa una batteria più grande, ricarica ai capolinea, o cambia i veicoli durante la giornata.",
  "advice.road.stuck": "{line}: veicoli bloccati per 5 minuti o più: {n}",
  "advice.road.stuckFix":
    "Controlla nella scheda GIS l’assetto della strada e i semafori in questo punto: può mancare una svolta, o il traffico blocca l’incrocio.",
  "advice.road.notBack": "{line}: veicoli non rientrati in deposito alla fine: {n}",
  "advice.road.notBackFix":
    "Controlla il percorso tra la linea e il suo deposito, o lascia più tempo dopo l’ultima corsa.",
  "advice.road.unnamedStreet": "una strada senza nome",
  "advice.road.unnamedJunction": "un incrocio",
  "advice.road.spot.signal": "Semaforo rosso su {place}: {min} min persi in tutto ({lines})",
  "advice.road.spot.signalFix":
    "Le linee aspettano qui più che altrove. Chiedi per loro la priorità a questo semaforo, o tempi semaforici adatti. La simulazione stradale non modella ancora la priorità, quindi non può mostrarne il guadagno.",
  "advice.road.spot.street": "Traffico su {place}: {min} min persi in tutto ({lines})",
  "advice.road.spot.streetFix":
    "Dai alle linee una corsia riservata su questa strada (scheda GIS, assetto della strada: corsia bus), o falle passare per un’altra strada.",
  "advice.road.spot.junction": "Fermi in {place}: {min} min persi in tutto ({lines})",
  "advice.road.spot.junctionFix":
    "I veicoli restano fermi dentro questo incrocio, in attesa di svoltare o che l’uscita si liberi. Aiuta una corsia riservata fino all’incrocio, o una fase semaforica separata per la svolta.",
} satisfies AdviceMessages;
