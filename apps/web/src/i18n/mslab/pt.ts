import type { MslabMessages } from "./en";

/** .mslab project file messages (pt). */
export const mslabPt = {
  "menu.saveMslab": "Guardar como ficheiro .mslab",
  "home.openMslab": "Abrir ficheiro .mslab",
  "home.openingMslab": "A abrir o ficheiro…",
  "home.openedMslab": "“{name}” aberto como novo projeto.",
  "home.leftOut": "Não incluído: {list}",
  "mslab.body":
    "Guarda os desenhos, preferências, cenários e plugins do projeto num ficheiro que pode voltar a abrir em qualquer MobSimLab.",
  "mslab.runs": "Incluir as simulações guardadas (o ficheiro fica maior)",
  "mslab.map":
    "Incluir dados do mapa para o visualizador estático: ruas, edifícios, população e dados do país da área do projeto (arquivo maior; pode levar alguns minutos)",
  "static.empty":
    "Este site ainda não tem projetos. Coloque arquivos .mslab na pasta projects e execute tools/add-projects.mjs.",
  "mslab.save": "Guardar ficheiro",
} satisfies MslabMessages;
