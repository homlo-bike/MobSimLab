import type { AreaMessages } from "./en";

/** Project area messages (it). */
export const areaIt = {
  "aw.title": "Area del progetto",
  "aw.editing": "Modifica dell’area di {name}",
  "aw.search": "Cerca un luogo per spostare la mappa, ad esempio Homs",
  "aw.tools": "Strumenti di disegno",
  "aw.draw": "Disegna poligono",
  "aw.edit": "Modifica punti",
  "aw.pan": "Sposta",
  "aw.hint.draw":
    "Fai clic per aggiungere vertici. Fai clic sul primo vertice o premi Invio per chiudere il poligono. Backspace rimuove l’ultimo vertice.",
  "aw.hint.edit":
    "Fai clic su un poligono per selezionarlo. Trascina un vertice per spostarlo, trascina un punto medio per aggiungere un vertice, fai doppio clic su un vertice per rimuoverlo.",
  "aw.hint.pan": "Trascina per spostare la mappa. Fai clic su un poligono per selezionarlo.",
  "aw.statArea": "Superficie",
  "aw.statDownload": "Download stimato",
  "aw.mb": "{mb} MB",
  "aw.limit": "Limite {mb} MB",
  "aw.overLimit":
    "L’area contiene più dati di mappa dei {mb} MB consentiti a un progetto. Riducila, oppure imposta i poligoni lungo i percorsi su solo strade principali e ferrovie.",
  "aw.polygons": "Poligoni",
  "aw.empty":
    "Ancora nessun poligono. Disegnane uno intorno a ogni luogo coperto dal progetto e uno stretto lungo ogni collegamento interurbano.",
  "aw.detail.full": "Completo",
  "aw.detail.main": "Solo strade principali e ferrovie",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "Nome",
  "aw.detail": "Dettaglio",
  "aw.fullHelp": "Strade, percorsi, edifici, scuole e ospedali, popolazione a 100 m, terreno.",
  "aw.mainHelp":
    "Autostrade, strade di grande comunicazione e principali, ferrovie, terreno, popolazione a 1 km. Niente edifici: disegna i centri lungo il percorso come Completo per la mappa del rumore e l’accesso a piedi.",
  "aw.delete": "Elimina poligono",
  "aw.newName": "Area {n}",
  "aw.save": "Salva area",
  "aw.confirm.title": "Scaricare i dati di mappa per le parti nuove?",
  "aw.confirm.body":
    "Nuove o modificate: {list}. Richiedono circa {mb} MB. Le parti rimosse non sono più usate. Non viene scaricato nulla finché non confermi.",
  "aw.confirm.item": "{name} ({detail}, {area} km²)",
  "aw.confirm.back": "Torna alla mappa",
  "aw.confirm.save": "Salva e scarica {mb} MB",
  "aw.select": "Seleziona area",
  "aw.selectHint":
    "Disegna i confini del progetto su una mappa. I dati di mappa vengono scaricati solo al loro interno.",
  "aw.change": "Cambia area",
  "aw.download": "circa {mb} MB di dati di mappa",
  "aw.outline": "Contorno dell’area del progetto",
  "aw.prefsIntro":
    "I poligoni disegnati intorno al progetto. I dati di mappa vengono scaricati solo al loro interno, al dettaglio di ciascun poligono.",
  "aw.dataFrom": "Dati di mappa del {date}",
  "aw.noData": "Dati di mappa non ancora scaricati",
  "aw.editArea": "Modifica area",
  "aw.drawArea": "Disegna area",
  "aw.refresh": "Aggiorna dati di mappa",
  "aw.refreshHelp":
    "Aggiorna scarica i dati OpenStreetMap attuali per la stessa area; fino ad allora il piano mantiene la data dei suoi dati.",
  "aw.none": "Ancora nessuna area del progetto. Disegnane una perché gli strumenti abbiano dati di mappa.",
  "aw.saved": "Area salvata.",
  "aw.data.noArea":
    "Disegna prima l’area del progetto in Preferenze del progetto: le importazioni la coprono.",
  "aw.data.area": "Area del progetto: {names}. Le importazioni coprono solo questi poligoni, {area} km².",
  "aw.pop.none": "Ancora nessuna area del progetto. Disegnala in Preferenze del progetto.",
  "aw.pop.box": "I poligoni dell'area del progetto: {km2} km². Le importazioni coprono solo loro.",
  "aw.tiles.one": "{count} tassello di mappa",
  "aw.tiles.other": "{count} tasselli di mappa",
  "aw.count.one": "{count} poligono",
  "aw.count.other": "{count} poligoni",
  "aw.out.title": "Scaricare dati cartografici fuori dall'area del progetto?",
  "aw.out.note":
    "La regione {name} esce dall'area del progetto. La sua parte esterna richiede nuovi dati cartografici.",
  "aw.out.part": "Parte esterna",
  "aw.out.km2": "circa {km2} km²",
  "aw.out.detail": "Dettaglio per la parte esterna",
  "aw.out.overLimit":
    "Con essa, l'area del progetto contiene più dati cartografici dei {mb} MB consentiti a un progetto. Scegli solo strade principali e ferrovie, oppure riduci l'area nelle preferenze del progetto.",
  "aw.out.adds":
    "Il download aggiunge la regione all'area del progetto come nuovo poligono, modificabile in seguito nella finestra dell'area.",
  "aw.out.keep": "Mantieni la regione, senza download",
  "aw.out.download": "Scarica {mb} MB",
  "aw.out.downloading": "Download in corso…",
  "aw.data.regions": "Regioni Geofabrik",
  "aw.data.regionsHelp": "Un download per ogni paese toccato dai poligoni, ciascuno ritagliato ai poligoni.",
  "aw.outside.streetLine": "La linea {name} esce dall'area del progetto, dove non ci sono dati cartografici.",
  "aw.outside.pluginLine": "La linea {name} esce dall'area del progetto, dove non ci sono dati cartografici.",
  "aw.outside.railway": "La ferrovia esce dall'area del progetto, dove non ci sono dati cartografici.",
  "aw.outside.depot": "Il deposito {name} esce dall'area del progetto, dove non ci sono dati cartografici.",
  "aw.outside.cargoBike":
    "Il percorso della cargo bike esce dall'area del progetto, dove non ci sono dati cartografici.",
  "aw.outside.fix": "Amplia l'area in Preferenze del progetto, Area del progetto.",
} satisfies AreaMessages;
