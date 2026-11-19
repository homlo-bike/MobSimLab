import type { pluginAdminEn } from "./en";

/** Português: messages of the Plugins tab of Administration. */
export const pluginAdminPt: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro": "Plugins deste MobSimLab. Um plugin desativado aqui fica desativado em todos os projetos.",
  "padmin.publishers": "Editores e limites",
  "padmin.configure": "Configurar",
  "padmin.configureName": "Configurar {name}",
  "padmin.useName": "Usar {name} neste MobSimLab",
  "padmin.offEverywhere": "Desativado em todos os projetos",
  "padmin.needsKey": "Precisa de uma chave de API",
  "padmin.accept": "Aceitar alterações",
  "padmin.services": "Serviços que este plugin usa",
  "padmin.nothingToSet":
    "Este plugin não tem nada para configurar. Cada projeto o ativa ou desativa nas Preferências do projeto.",
  "padmin.versions": "Versões instaladas",
  "padmin.undo": "Desfazer",
  "padmin.removedOnAccept": "A chave é removida quando você aceitar as alterações.",
  "padmin.changedOnAccept": "Alterado quando você aceitar as alterações.",
  "padmin.keyReplace": "Digite uma nova chave para substituir a salva",
  "padmin.esriTermsFirst": "Aceite os termos de uso da Esri para salvar a chave.",
  "padmin.offByAdmin": "Desativado neste MobSimLab por um administrador.",
};
