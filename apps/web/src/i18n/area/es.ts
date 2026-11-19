import type { AreaMessages } from "./en";

/** Project area messages (es). */
export const areaEs = {
  "aw.title": "Área del proyecto",
  "aw.editing": "Editando el área de {name}",
  "aw.search": "Busque un lugar para mover el mapa, como Homs",
  "aw.tools": "Herramientas de dibujo",
  "aw.draw": "Dibujar polígono",
  "aw.edit": "Editar puntos",
  "aw.pan": "Mover",
  "aw.hint.draw":
    "Haga clic para añadir vértices. Haga clic en el primer vértice o pulse Intro para cerrar el polígono. Retroceso quita el último vértice.",
  "aw.hint.edit":
    "Haga clic en un polígono para seleccionarlo. Arrastre un vértice para moverlo, arrastre un punto medio para añadir un vértice y haga doble clic en un vértice para quitarlo.",
  "aw.hint.pan": "Arrastre para mover el mapa. Haga clic en un polígono para seleccionarlo.",
  "aw.statArea": "Superficie",
  "aw.statDownload": "Descarga estimada",
  "aw.mb": "{mb} MB",
  "aw.limit": "Límite {mb} MB",
  "aw.overLimit":
    "El área contiene más datos de mapa que los {mb} MB que puede tener un proyecto. Redúzcala o ponga los polígonos a lo largo de las rutas en solo carreteras principales y ferrocarriles.",
  "aw.polygons": "Polígonos",
  "aw.empty":
    "Aún no hay polígonos. Dibuje uno alrededor de cada lugar que cubre el proyecto y uno estrecho a lo largo de cada ruta interurbana.",
  "aw.detail.full": "Completo",
  "aw.detail.main": "Solo carreteras principales y ferrocarriles",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "Nombre",
  "aw.detail": "Detalle",
  "aw.fullHelp": "Calles, caminos, edificios, escuelas y hospitales, población a 100 m, terreno.",
  "aw.mainHelp":
    "Autopistas, carreteras troncales y principales, ferrocarriles, terreno, población a 1 km. Sin edificios: dibuje las ciudades de la ruta como Completo para el mapa de ruido y el acceso a pie.",
  "aw.delete": "Eliminar polígono",
  "aw.newName": "Área {n}",
  "aw.save": "Guardar área",
  "aw.confirm.title": "¿Descargar datos de mapa para las partes nuevas?",
  "aw.confirm.body":
    "Nuevas o cambiadas: {list}. Necesitan unos {mb} MB. Las partes eliminadas dejan de usarse. No se descarga nada hasta que confirme.",
  "aw.confirm.item": "{name} ({detail}, {area} km²)",
  "aw.confirm.back": "Volver al mapa",
  "aw.confirm.save": "Guardar y descargar {mb} MB",
  "aw.select": "Seleccionar área",
  "aw.selectHint":
    "Dibuje los límites del proyecto en un mapa. Los datos de mapa solo se descargan dentro de ellos.",
  "aw.change": "Cambiar área",
  "aw.download": "unos {mb} MB de datos de mapa",
  "aw.outline": "Contorno del área del proyecto",
  "aw.prefsIntro":
    "Los polígonos dibujados alrededor del proyecto. Los datos de mapa solo se descargan dentro de ellos, con el detalle de cada polígono.",
  "aw.dataFrom": "Datos de mapa del {date}",
  "aw.noData": "Datos de mapa aún no descargados",
  "aw.editArea": "Editar área",
  "aw.drawArea": "Dibujar área",
  "aw.refresh": "Actualizar datos de mapa",
  "aw.refreshHelp":
    "Actualizar descarga los datos actuales de OpenStreetMap para la misma área; el plan conserva su fecha de datos hasta que lo haga.",
  "aw.none": "Aún no hay área del proyecto. Dibuje una para que las herramientas tengan datos de mapa.",
  "aw.saved": "Área guardada.",
  "aw.data.noArea":
    "Dibuje primero el área del proyecto en Preferencias del proyecto: las importaciones la cubren.",
  "aw.data.area":
    "Área del proyecto: {names}. Las importaciones cubren el rectángulo que la rodea, {area} km².",
  "aw.pop.none": "Aún no hay área del proyecto. Dibújela en Preferencias del proyecto.",
  "aw.pop.box": "El rectángulo alrededor del área del proyecto: {km2} km².",
  "aw.tiles.one": "{count} tesela de mapa",
  "aw.tiles.other": "{count} teselas de mapa",
  "aw.count.one": "{count} polígono",
  "aw.count.other": "{count} polígonos",
  "aw.out.title": "¿Descargar datos de mapa fuera del área del proyecto?",
  "aw.out.note":
    "La región {name} sale del área del proyecto. Su parte exterior necesita nuevos datos de mapa.",
  "aw.out.part": "Parte exterior",
  "aw.out.km2": "unos {km2} km²",
  "aw.out.detail": "Detalle de la parte exterior",
  "aw.out.overLimit":
    "Con ella, el área del proyecto contiene más datos de mapa que los {mb} MB que puede tener un proyecto. Elija solo vías principales y ferrocarriles, o reduzca el área en las preferencias del proyecto.",
  "aw.out.adds":
    "Descargar añade la región al área del proyecto como un polígono nuevo, que podrá editar después en la ventana del área.",
  "aw.out.keep": "Conservar la región, sin descargar",
  "aw.out.download": "Descargar {mb} MB",
  "aw.out.downloading": "Descargando…",
} satisfies AreaMessages;
