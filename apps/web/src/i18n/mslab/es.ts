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
} satisfies MslabMessages;
