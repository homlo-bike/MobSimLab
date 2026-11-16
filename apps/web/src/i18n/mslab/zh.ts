import type { MslabMessages } from "./en";

/** .mslab project file messages (zh). */
export const mslabZh = {
  "menu.saveMslab": "另存为 .mslab 文件",
  "home.openMslab": "打开 .mslab 文件",
  "home.openingMslab": "正在打开文件…",
  "home.openedMslab": "已将“{name}”作为新项目打开。",
  "home.leftOut": "未导入：{list}",
  "mslab.body": "将项目的图纸、偏好设置、方案和插件保存在一个文件中，可在任何 MobSimLab 中重新打开。",
  "mslab.runs": "包含已保存的模拟运行（文件会更大）",
  "mslab.map": "包含静态查看器的地图数据：项目区域的街道、建筑、人口和国家数据（文件更大；可能需要几分钟）",
  "static.empty": "此站点还没有项目。请将 .mslab 文件放入 projects 文件夹，然后运行 tools/add-projects.mjs。",
  "mslab.save": "保存文件",
} satisfies MslabMessages;
