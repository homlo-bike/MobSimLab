import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (pt). */
export const pluginCodePt = {
  "pcode.title": "Cálculos de plugins",
  "pcode.intro": "Cálculos dos plugins instalados. Correm num ambiente isolado no seu navegador, sem acesso à internet nem a outros projetos.",
  "pcode.by": "{plugin} · por {publisher}",
  "pcode.run": "Calcular",
  "pcode.running": "A calcular…",
  "pcode.failed": "{plugin} não conseguiu calcular: {error}",
  "pcode.noRows": "Sem linhas.",
  "pcode.log": "Registo do plugin ({count} linhas)",
  "pcode.import": "Importar {label} ({plugin})",
  "pcode.export": "Transferir como {label} ({plugin})",
  "pcode.importFailed": "{plugin} não conseguiu ler o ficheiro: {error}",
  "pcode.exportFailed": "{plugin} não conseguiu escrever o ficheiro: {error}",
  "pcode.frameTitle": "{tab}, uma página do plugin {plugin}",
  "pcode.frameNote": "Esta página vem do plugin {plugin} de {publisher}. Não tem acesso à internet nem à sua conta.",
  "pcode.runsCode": "Executa o seu próprio código num ambiente isolado",
  "pcode.limits": "Limites do código de plugins",
  "pcode.limitsIntro": "Cada chamada ao código de um plugin recebe no máximo esta memória e este tempo, no navegador e no servidor.",
  "pcode.memory": "Memória (MB)",
  "pcode.time": "Tempo (segundos)",
  "pcode.saveLimits": "Guardar limites",
  "pcode.saved": "Guardado.",
  "pcode.installIntro": "Carregue um ficheiro .msplugin. O MobSimLab verifica-o e mostra o que adiciona antes de o instalar. Os plugins podem adicionar modos, ferramentas, parâmetros e fontes, e executar o seu próprio código (cálculos, importações, exportações e páginas de separador) num ambiente isolado sem acesso à internet.",
} satisfies PluginCodeMessages;
