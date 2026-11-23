import type { AdviceMessages } from "./en";

/** Advice messages (es). */
export const adviceEs = {
  "advice.title": "Qué mejorar",
  "advice.intro":
    "Los problemas que encontró esta ejecución, el más grave primero, y qué puede hacer con cada uno.",
  "advice.none": "Nada que mejorar: esta ejecución no encontró ningún cuello de botella ni problema.",
  "advice.show": "Mostrar en el mapa",
  "advice.more": "{n} más no mostrados.",
  "advice.severity.problem": "Problema",
  "advice.severity.warning": "Advertencia",
  "advice.crowdMap": "Mostrar en el mapa lo llenos que van los vehículos (hora punta de cada línea)",
  "advice.cap.stopped": "{line}: la ejecución se detuvo: {problem}",
  "advice.cap.stoppedFix": "Corríjalo en la herramienta ferroviaria y vuelva a ejecutar la prueba.",
  "advice.cap.unplaced": "{line}: viajes que no caben en la vía: {n}",
  "advice.cap.unplacedFix":
    "Haga circular la línea con menos frecuencia en este periodo, o dé a sus trenes más espacio donde se encuentran: más andenes o escapes en {terminal}, o un apartadero en vía única.",
  "advice.cap.terminal":
    "{line}: la terminal {terminal} es el cuello de botella, ocupada el {share} de la hora punta (límite {limit})",
  "advice.cap.terminalFix":
    "Los trenes ocupan sus andenes demasiado tiempo. Acorte la maniobra de regreso (un tiempo de espera más corto, o un maquinista esperando en cada extremo), añada una vía de andén, o acerque el escape a los andenes para que los trenes lo liberen antes.",
  "advice.cap.section":
    "{line}: el tramo de vía {section} es el cuello de botella, ocupado el {share} de la hora punta (límite {limit})",
  "advice.cap.sectionFix":
    "Los trenes ocupan este tramo más que cualquier otro. Una velocidad mayor en él les permite liberarlo antes; si no, haga circular menos trenes aquí.",
  "advice.cap.sectionPlatform":
    "Este tramo es una vía de andén: los trenes lo ocupan mientras están parados en el andén. Paradas más cortas, o una segunda vía de andén para este sentido, dejan entrar antes al siguiente tren.",
  "advice.cap.sectionSwitches":
    "Este tramo es una zona de desvíos: los trenes lo ocupan mientras se establece y se libera su itinerario por los desvíos. Desvíos con más velocidad en la vía desviada, o colocados para que los dos sentidos no se crucen, lo liberan antes.",
  "advice.cap.signalAdd":
    "Este tramo de plena vía mide {length} m, pero un cantón solo necesita {block} m a {speed} km/h. Añada una señal de bloqueo hacia {at} m de la vía {track}, para que el siguiente tren pueda entrar antes en la primera mitad.",
  "advice.cap.signalShort":
    "Este tramo mide {length} m, menos de dos cantones de {block} m a {speed} km/h, así que otra señal dejaría muy poco espacio para frenar. Los trenes pueden seguirse más de cerca con señalización en cabina (CBTC o ETCS nivel 2), o con una velocidad menor aquí.",
  "advice.cap.sectionCab":
    "Con señalización en cabina los trenes ya se siguen a distancia de frenado ({block} m a {speed} km/h); las señales no fijan la separación. Una velocidad mayor en el tramo, o menos trenes, lo libera antes.",
  "advice.cap.sectionSight":
    "Aquí los tranvías circulan a la vista, así que las señales no fijan la separación. Paradas más cortas cerca, o una plataforma propia lejos del tráfico, lo liberan antes.",
  "advice.cap.nearNote": "Aún funciona, pero queda poco margen para añadir trenes.",
  "advice.cap.pileUp": "{line}: los retrasos se acumulan y aún son de {late} de media al terminar el periodo",
  "advice.cap.pileUpFix":
    "Añada tiempo de recuperación en las terminales, o circule algo menos a menudo, para que un tren retrasado no retenga al siguiente.",
  "advice.cap.full": "{line}: los vehículos van al {share} de {from} a {to}, {time}",
  "advice.cap.fullMore":
    "{left} personas se quedan en tierra durante el periodo. La vía permite hasta {n} trenes por hora y sentido: circule más a menudo, o use trenes más largos.",
  "advice.cap.fullLonger":
    "{left} personas se quedan en tierra durante el periodo. Circule más a menudo si la vía lo permite, o use vehículos más largos.",
  "advice.cap.streetPileUp": "{line}: los retrasos se acumulan en la calle y aún son de {late} al final",
  "advice.cap.streetPileUpFix":
    "Planifique más tiempo para la vuelta o una espera más larga en las paradas finales, para que los vehículos recuperen; lo que más ayuda es un carril propio donde se encuentran con el tráfico.",
  "advice.road.cannotRun": "{line} no pudo circular",
  "advice.road.cannotRunFix": "{problem}. Corrija la ruta en Crear → Ruta por calle y vuelva a ejecutar.",
  "advice.road.late": "{line}: solo el {share} de las salidas a tiempo (aviso por debajo de {limit})",
  "advice.road.mostlySignals":
    "Cada viaje pierde {signals} min en semáforos en rojo y {traffic} min en el tráfico, así que la mayor parte en los semáforos listados aquí.",
  "advice.road.mostlyTraffic":
    "Cada viaje pierde {traffic} min en el tráfico y {signals} min en semáforos en rojo, así que la mayor parte en las calles listadas aquí.",
  "advice.road.moreTime":
    "La vuelta duró {run} min frente a {planned} min previstos: planifique más tiempo de recorrido, o añada un vehículo.",
  "advice.road.bunched": "{line}: el {share} de las salidas llegan agrupadas",
  "advice.road.bunchedFix":
    "Los vehículos se alcanzan entre sí. Reténgalos en las paradas finales según el horario, deles allí una espera más larga, o dé a la línea un carril propio donde pierde tiempo.",
  "advice.road.ranOut": "{line}: vehículos que se quedaron sin carga: {n}",
  "advice.road.ranOutFix":
    "Use una batería más grande, cargue en las paradas finales, o cambie los vehículos durante el día.",
  "advice.road.stuck": "{line}: vehículos atascados 5 minutos o más: {n}",
  "advice.road.stuckFix":
    "Revise la configuración de la calle y los semáforos en este lugar en la pestaña SIG: puede faltar un giro, o el tráfico bloquea el cruce.",
  "advice.road.notBack": "{line}: vehículos que no volvieron a la cochera al final: {n}",
  "advice.road.notBackFix":
    "Revise la ruta entre la línea y su cochera, o deje más tiempo tras el último viaje.",
  "advice.road.unnamedStreet": "una calle sin nombre",
  "advice.road.unnamedJunction": "un cruce",
  "advice.road.spot.signal": "Semáforo en rojo en {place}: {min} min perdidos en total ({lines})",
  "advice.road.spot.signalFix":
    "Las líneas esperan aquí más que en ningún otro lugar. Pida prioridad para ellas en este semáforo, o tiempos de semáforo que les convengan. La simulación de calle aún no modela la prioridad, así que no puede mostrar la ganancia.",
  "advice.road.spot.street": "Tráfico en {place}: {min} min perdidos en total ({lines})",
  "advice.road.spot.streetFix":
    "Dé a las líneas un carril propio en esta calle (pestaña SIG, configuración de la calle: carril bus), o llévelas por otra calle.",
  "advice.road.spot.junction": "Detenidos en {place}: {min} min perdidos en total ({lines})",
  "advice.road.spot.junctionFix":
    "Los vehículos se quedan dentro de este cruce, esperando para girar o a que se libere la salida. Ayuda un carril propio hasta el cruce, o una fase de giro separada en sus semáforos.",
} satisfies AdviceMessages;
