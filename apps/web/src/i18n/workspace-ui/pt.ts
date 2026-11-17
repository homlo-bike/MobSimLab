import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (pt). */
export const workspaceUiPt = {
  "checks.menu": "Verificações",
  "checks.menuCount": "Verificações: {errors} erros, {warnings} avisos",
  "checks.title": "Verificações de todos os modos",
  "checks.none":
    "Ainda nada a verificar. Desenhe uma linha, uma ferrovia ou uma garagem e as verificações aparecem aqui.",
  "checks.lastOpened": "como na última abertura",
  "checks.streetLine": "Linha rodoviária · {name}",
  "checks.railway": "Ferrovia",
  "checks.depot": "Garagem · {name}",
  "undo.undo": "Desfazer",
  "undo.redo": "Refazer",
  "tour.checks.title": "Verificações",
  "tour.checks.body":
    "O sino lista as verificações de todos os modos, erros primeiro: linhas rodoviárias, ferrovia, garagens e linhas dos plugins. Escolha uma para ver onde está.",
  "settings.serverTab": "Servidor",
  "settings.pluginsTab": "Plugins",
  "settings.server.local":
    "O MobSimLab está a funcionar neste computador. Em vez disso, pode ligar esta aplicação a um servidor MobSimLab em segundo plano, como o servidor Docker.",
  "settings.server.address": "Endereço do servidor",
  "settings.server.connect": "Ligar",
  "settings.server.note":
    "A aplicação verifica o servidor e pergunta antes de mudar. Os projetos deste computador ficam aqui: mova-os guardando-os como ficheiros .mslab. Pode voltar nas Definições da aplicação (⌘, ou Ctrl+,).",
  "settings.plugins.intro":
    "Instale plugins para este MobSimLab. Cada projeto ativa-os ou desativa-os depois nas suas Preferências do projeto.",
} satisfies WorkspaceUiMessages;
