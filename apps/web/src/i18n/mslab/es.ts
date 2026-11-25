import type { MslabMessages } from "./en";

/** .mslab project file messages (es). */
export const mslabEs = {
  "menu.saveMslab": "Guardar como archivo .mslab",
  "home.openMslab": "Abrir archivo .mslab",
  "home.openingMslab": "Abriendo el archivo…",
  "home.openedMslab": "«{name}» abierto como proyecto nuevo.",
  "home.leftOut": "No incluido: {list}",
  "mslab.body":
    "Guarda los dibujos, preferencias, escenarios y plugins del proyecto en un archivo que puede volver a abrir en cualquier MobSimLab.",
  "mslab.runs": "Incluir las simulaciones guardadas (el archivo será más grande)",
  "mslab.map":
    "Incluir datos de mapa para el visor estático: calles, edificios, población y cifras del país del área del proyecto (archivo más grande; puede tardar unos minutos)",
  "static.empty":
    "Este sitio aún no tiene proyectos. Ponga archivos .mslab en su carpeta projects y ejecute tools/add-projects.mjs.",
  "mslab.save": "Guardar archivo",
  "savedFiles.title": "Archivos de proyecto guardados",
  "savedFiles.intro":
    "Elija qué contiene un archivo .mslab guardado. Un proyecto abierto desde el archivo usa estos datos de inmediato. Los tamaños son antes de comprimir el archivo.",
  "savedFiles.refresh": "Actualizar",
  "savedFiles.loadFailed": "No se pudieron cargar los tamaños.",
  "savedFiles.whenSaving": "Se crea al guardar el archivo",
  "savedFiles.none": "Ninguno aún",
  "savedFiles.from": "De {source}",
  "savedFiles.at": "Última actualización {date}",
  "savedFiles.update": "Actualizar",
  "savedFiles.updateOf": "Actualizar {name}",
  "savedFiles.always": "Siempre se guarda",
  "savedFiles.later": "Aún no se guarda en archivos: llegará en una actualización posterior",
  "savedFiles.include": "Incluir {name} en los archivos guardados",
  "savedFiles.total": "Guardado en archivos ahora: {size} antes de comprimir",
  "savedFiles.design": "Dibujos y ajustes",
  "savedFiles.vehicles": "Vehículos propios y flota",
  "savedFiles.processed": "Resultados calculados (horarios, tablas, SIG, esquema)",
  "savedFiles.runs": "Ejecuciones de simulación y de demanda (con matrices OD)",
  "savedFiles.comments": "Comentarios y conversaciones",
  "savedFiles.history": "Historial de cambios",
  "savedFiles.osm": "Datos de OpenStreetMap del área del proyecto",
  "savedFiles.liveTiles": "Teselas de mapa que las herramientas obtuvieron en vivo",
  "savedFiles.elevation": "Elevación",
  "savedFiles.population": "Población",
  "savedFiles.uploads": "Sus archivos subidos de mapa, elevación y población",
  "savedFiles.facts": "Datos de la ubicación (país, festivos, clima)",
  "savedFiles.economy": "Datos económicos (Banco Mundial)",
  "savedFiles.otherFetched": "Otros datos obtenidos (bicicletas compartidas, profundidades, lugares)",
  "savedFiles.viewerMap": "Datos de mapa para el visor estático",
  "mslab.results":
    "Incluir los resultados calculados por las herramientas (el proyecto se abre sin volver a calcularlos)",
  "mslab.vehicles": "Incluir los vehículos propios y la flota del proyecto",
  "mslab.fromPrefs": "Estas opciones parten de Preferencias del proyecto → Archivos de proyecto guardados.",
} satisfies MslabMessages;
