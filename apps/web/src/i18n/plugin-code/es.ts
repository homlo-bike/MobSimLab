import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (es). */
export const pluginCodeEs = {
  "pcode.title": "Cálculos de plugins",
  "pcode.intro":
    "Cálculos de los plugins instalados. Se ejecutan en un entorno aislado en su navegador, sin acceso a internet ni a otros proyectos.",
  "pcode.by": "{plugin} · de {publisher}",
  "pcode.run": "Calcular",
  "pcode.running": "Calculando…",
  "pcode.failed": "{plugin} no pudo calcular: {error}",
  "pcode.noRows": "Sin filas.",
  "pcode.log": "Registro del plugin ({count} líneas)",
  "pcode.import": "Importar {label} ({plugin})",
  "pcode.export": "Descargar como {label} ({plugin})",
  "pcode.importFailed": "{plugin} no pudo leer el archivo: {error}",
  "pcode.exportFailed": "{plugin} no pudo escribir el archivo: {error}",
  "pcode.frameTitle": "{tab}, una página del plugin {plugin}",
  "pcode.frameNote":
    "Esta página viene del plugin {plugin} de {publisher}. No puede acceder a internet ni a su cuenta.",
  "pcode.runsCode": "Ejecuta su propio código en un entorno aislado",
  "pcode.limits": "Límites del código de plugins",
  "pcode.limitsIntro":
    "Cada llamada al código de un plugin recibe como máximo esta memoria y este tiempo, en el navegador y en el servidor.",
  "pcode.memory": "Memoria (MB)",
  "pcode.time": "Tiempo (segundos)",
  "pcode.saveLimits": "Guardar límites",
  "pcode.saved": "Guardado.",
  "pcode.installIntro":
    "Suba un archivo .msplugin. MobSimLab lo comprueba y muestra lo que añade antes de instalarlo. Los plugins pueden añadir modos, herramientas, parámetros y fuentes, y ejecutar su propio código (cálculos, importaciones, exportaciones y páginas de pestaña) en un entorno aislado sin acceso a internet.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "Fotos aéreas de unos 0,3 a 1 m por píxel. Esri exige una clave de API de ArcGIS de una cuenta de ArcGIS Location Platform y aceptar sus condiciones. Los mosaicos pasan por este MobSimLab, así que los navegadores nunca ven la clave, y no se guardan.",
  "esri.key": "Clave de API de ArcGIS",
  "esri.accept": "Acepto las condiciones de uso de Esri para este MobSimLab",
  "esri.terms": "Condiciones de Esri",
  "esri.save": "Guardar clave",
  "esri.remove": "Quitar clave",
  "esri.saved":
    "Clave terminada en {end} guardada por {name} el {date}. Esri World Imagery aparece en el control de capas del mapa.",
  "esri.none": "No hay clave guardada: Esri World Imagery no se ofrece.",
} satisfies PluginCodeMessages;
