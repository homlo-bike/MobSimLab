import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (zh). */
export const workspaceUiZh = {
  "checks.menu": "检查",
  "checks.menuCount": "检查：{errors} 个错误，{warnings} 个警告",
  "checks.title": "所有模式的检查",
  "checks.none": "暂无需要检查的内容。绘制一条线路、一段铁路或一个车场后，检查结果会显示在这里。",
  "checks.lastOpened": "上次打开时的状态",
  "checks.streetLine": "道路线路 · {name}",
  "checks.railway": "铁路",
  "checks.depot": "车场 · {name}",
  "undo.undo": "撤销",
  "undo.redo": "重做",
  "tour.checks.title": "检查",
  "tour.checks.body":
    "铃铛列出所有模式的检查，错误在前：道路线路、铁路、车场和插件的线路。选择一项即可查看其位置。",
  "settings.serverTab": "服务器",
  "settings.pluginsTab": "插件",
  "settings.server.local":
    "MobSimLab 正在这台电脑上运行。你也可以将此应用连接到在后台运行的 MobSimLab 服务器，例如 Docker 服务器。",
  "settings.server.address": "服务器地址",
  "settings.server.connect": "连接",
  "settings.server.note":
    "应用会先检查服务器，并在切换前询问你。这台电脑上的项目会保留在这里：将其保存为 .mslab 文件即可迁移。你可以在应用的设置（⌘, 或 Ctrl+,）中切换回来。",
  "settings.plugins.intro": "为此 MobSimLab 安装插件。之后每个项目可在其项目偏好设置中开启或关闭插件。",
} satisfies WorkspaceUiMessages;
