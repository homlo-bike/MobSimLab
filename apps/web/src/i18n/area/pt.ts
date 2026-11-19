import type { AreaMessages } from "./en";

/** Project area messages (pt). */
export const areaPt = {
  "aw.title": "Área do projeto",
  "aw.editing": "Editando a área de {name}",
  "aw.search": "Pesquise um lugar para mover o mapa, como Homs",
  "aw.tools": "Ferramentas de desenho",
  "aw.draw": "Desenhar polígono",
  "aw.edit": "Editar pontos",
  "aw.pan": "Mover",
  "aw.hint.draw":
    "Clique para adicionar vértices. Clique no primeiro vértice ou pressione Enter para fechar o polígono. Backspace remove o último vértice.",
  "aw.hint.edit":
    "Clique em um polígono para selecioná-lo. Arraste um vértice para movê-lo, arraste um ponto médio para adicionar um vértice, clique duas vezes em um vértice para removê-lo.",
  "aw.hint.pan": "Arraste para mover o mapa. Clique em um polígono para selecioná-lo.",
  "aw.statArea": "Área",
  "aw.statDownload": "Download estimado",
  "aw.mb": "{mb} MB",
  "aw.limit": "Limite {mb} MB",
  "aw.overLimit":
    "A área contém mais dados de mapa do que os {mb} MB que um projeto pode ter. Reduza-a, ou defina os polígonos ao longo dos percursos como só estradas principais e ferrovias.",
  "aw.polygons": "Polígonos",
  "aw.empty":
    "Ainda não há polígonos. Desenhe um ao redor de cada lugar que o projeto abrange e um estreito ao longo de cada ligação intercidades.",
  "aw.detail.full": "Completo",
  "aw.detail.main": "Só estradas principais e ferrovias",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "Nome",
  "aw.detail": "Detalhe",
  "aw.fullHelp": "Ruas, caminhos, edifícios, escolas e hospitais, população a 100 m, terreno.",
  "aw.mainHelp":
    "Rodovias, estradas nacionais e principais, ferrovias, terreno, população a 1 km. Sem edifícios: desenhe as localidades do percurso como Completo para o mapa de ruído e o acesso a pé.",
  "aw.delete": "Eliminar polígono",
  "aw.newName": "Área {n}",
  "aw.save": "Salvar área",
  "aw.confirm.title": "Baixar dados de mapa das partes novas?",
  "aw.confirm.body":
    "Novas ou alteradas: {list}. Precisam de cerca de {mb} MB. As partes removidas deixam de ser usadas. Nada é baixado até você confirmar.",
  "aw.confirm.item": "{name} ({detail}, {area} km²)",
  "aw.confirm.back": "Voltar ao mapa",
  "aw.confirm.save": "Salvar e baixar {mb} MB",
  "aw.select": "Selecionar área",
  "aw.selectHint": "Desenhe os limites do projeto em um mapa. Os dados de mapa só são baixados dentro deles.",
  "aw.change": "Alterar área",
  "aw.download": "cerca de {mb} MB de dados de mapa",
  "aw.outline": "Contorno da área do projeto",
  "aw.prefsIntro":
    "Os polígonos desenhados ao redor do projeto. Os dados de mapa só são baixados dentro deles, com o detalhe de cada polígono.",
  "aw.dataFrom": "Dados de mapa de {date}",
  "aw.noData": "Dados de mapa ainda não baixados",
  "aw.editArea": "Editar área",
  "aw.drawArea": "Desenhar área",
  "aw.refresh": "Atualizar dados de mapa",
  "aw.refreshHelp":
    "Atualizar baixa os dados atuais do OpenStreetMap para a mesma área; até lá o plano mantém a data dos seus dados.",
  "aw.none": "Ainda não há área do projeto. Desenhe uma para que as ferramentas tenham dados de mapa.",
  "aw.saved": "Área salva.",
  "aw.data.noArea":
    "Desenhe primeiro a área do projeto nas Preferências do projeto: as importações a cobrem.",
  "aw.data.area": "Área do projeto: {names}. As importações cobrem o retângulo ao redor dela, {area} km².",
  "aw.pop.none": "Ainda não há área do projeto. Desenhe-a nas Preferências do projeto.",
  "aw.pop.box": "O retângulo ao redor da área do projeto: {km2} km².",
  "aw.tiles.one": "{count} bloco de mapa",
  "aw.tiles.other": "{count} blocos de mapa",
  "aw.count.one": "{count} polígono",
  "aw.count.other": "{count} polígonos",
  "aw.out.title": "Baixar dados de mapa fora da área do projeto?",
  "aw.out.note":
    "A região {name} ultrapassa a área do projeto. A parte de fora precisa de novos dados de mapa.",
  "aw.out.part": "Parte de fora",
  "aw.out.km2": "cerca de {km2} km²",
  "aw.out.detail": "Detalhe da parte de fora",
  "aw.out.overLimit":
    "Com ela, a área do projeto tem mais dados de mapa do que os {mb} MB permitidos por projeto. Escolha só vias principais e ferrovias, ou reduza a área nas preferências do projeto.",
  "aw.out.adds":
    "Baixar adiciona a região à área do projeto como um novo polígono, que pode ser editado depois na janela da área.",
  "aw.out.keep": "Manter a região, sem baixar",
  "aw.out.download": "Baixar {mb} MB",
  "aw.out.downloading": "Baixando…",
} satisfies AreaMessages;
