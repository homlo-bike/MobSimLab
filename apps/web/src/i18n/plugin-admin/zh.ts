import type { pluginAdminEn } from "./en";

/** 中文: messages of the Plugins tab of Administration. */
export const pluginAdminZh: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro": "此 MobSimLab 的插件。在这里关闭的插件在所有项目中都会关闭。",
  "padmin.publishers": "发布者和限制",
  "padmin.configure": "配置",
  "padmin.configureName": "配置 {name}",
  "padmin.useName": "在此 MobSimLab 上使用 {name}",
  "padmin.offEverywhere": "在所有项目中关闭",
  "padmin.needsKey": "需要 API 密钥",
  "padmin.accept": "接受更改",
  "padmin.services": "此插件使用的服务",
  "padmin.nothingToSet": "此插件无需设置。每个项目在项目偏好设置中开启或关闭它。",
  "padmin.versions": "已安装的版本",
  "padmin.undo": "撤销",
  "padmin.removedOnAccept": "接受更改时将删除该密钥。",
  "padmin.changedOnAccept": "接受更改时生效。",
  "padmin.keyReplace": "输入新密钥以替换已保存的密钥",
  "padmin.esriTermsFirst": "请接受 Esri 的使用条款以保存密钥。",
  "padmin.offByAdmin": "管理员已为此 MobSimLab 关闭该插件。",
};
