import type { PluginKey } from "../plugins";

/** Plugin messages (pt). */
export const pluginsPt = {
  "admin.plugins": "Plugins",
  "plugins.title": "Plugins",
  "plugins.intro":
    "Plugins adicionam modos de transporte, ferramentas e cálculos. Ative os que este projeto usa; ao desativar um, as ferramentas somem e o que foi desenhado é mantido.",
  "plugins.bundled": "Vem com o MobSimLab",
  "plugins.by": "Por {publisher}",
  "plugins.versionN": "Versão {version}",
  "plugins.adds": "Adiciona: {list}",
  "plugins.uses": "Usa: {list}",
  "plugins.parameters": "{count} valores de premissas",
  "plugins.missing":
    "A versão {version} foi removida deste MobSimLab. Escolha outra versão para usá-lo de novo.",
  "plugins.versionOf": "Versão de {name}",
  "plugins.useIn": "Usar {name} neste projeto",
  "plugins.ownerOnly": "Só o proprietário do projeto pode ativar ou desativar plugins.",
  "plugins.perm.readNetwork": "a rede do projeto",
  "plugins.perm.readTimetable": "o horário",
  "plugins.perm.readFleet": "veículos e frota",
  "plugins.perm.readGeodata": "dados de mapa importados",
  "plugins.perm.readResults": "resultados de simulação",
  "plugins.perm.writeResults": "salva os próprios resultados",
  "plugins.perm.writeScenario": "propõe mudanças no cenário",
  "plugins.installTitle": "Instalar um plugin",
  "plugins.installIntro":
    "Envie um arquivo .msplugin. O MobSimLab o verifica e mostra o que ele adiciona antes da instalação. Plugins instalados podem adicionar modos, ferramentas, parâmetros e fontes; plugins com código próprio virão depois.",
  "plugins.choose": "Escolher um arquivo .msplugin",
  "plugins.problems": "Este plugin não pode ser instalado:",
  "plugins.install": "Instalar",
  "plugins.installed": "Plugins instalados",
  "plugins.none": "Nenhum plugin instalado ainda.",
  "plugins.removeOne": "Remover {name} {version}",
  "plugins.inProjects": "Usado em {count} projetos",
  "plugins.bundledTitle": "Incluídos no MobSimLab",
  "plugins.keys": "Editores confiáveis",
  "plugins.keysIntro":
    "Um plugin só é instalado se o editor o assinou com uma destas chaves (ECDSA P-256 ou Ed25519, PEM).",
  "plugins.noKeys": "Nenhuma chave confiável ainda.",
  "plugins.removeKey": "Deixar de confiar em {name}",
  "plugins.addKey": "Adicionar chave",
  "plugins.keyName": "Nome do editor",
  "plugins.keyPem": "Chave pública",
  "plugins.allowUnsigned": "Permitir plugins sem assinatura (modo de desenvolvimento, só proprietários)",
  "plugins.signedBy": "Assinado por {name}",
  "plugins.untrusted": "Assinado com uma chave em que esta instância não confia",
  "plugins.unsigned": "Sem assinatura",
  "plugins.licences": "Licenças: código {code}, dados {data}",
  "plugins.removeConfirm":
    "{name} está ativado em {count} projetos. Remover mesmo assim? Ele será desativado neles e os desenhos serão mantidos.",
} satisfies Record<PluginKey, string>;
