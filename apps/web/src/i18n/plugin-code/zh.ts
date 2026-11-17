import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (zh). */
export const pluginCodeZh = {
  "pcode.title": "插件计算",
  "pcode.intro": "已安装插件的计算。它们在浏览器的沙箱中运行，无法访问互联网或其他项目。",
  "pcode.by": "{plugin} · {publisher} 提供",
  "pcode.run": "计算",
  "pcode.running": "正在计算…",
  "pcode.failed": "{plugin} 无法计算：{error}",
  "pcode.noRows": "没有行。",
  "pcode.log": "插件日志（{count} 行）",
  "pcode.import": "导入 {label}（{plugin}）",
  "pcode.export": "下载为 {label}（{plugin}）",
  "pcode.importFailed": "{plugin} 无法读取文件：{error}",
  "pcode.exportFailed": "{plugin} 无法写入文件：{error}",
  "pcode.frameTitle": "{tab}，{plugin} 插件的页面",
  "pcode.frameNote": "此页面来自 {publisher} 的 {plugin} 插件。它无法访问互联网或您的账户。",
  "pcode.runsCode": "在沙箱中运行自己的代码",
  "pcode.limits": "插件代码限制",
  "pcode.limitsIntro": "每次调用插件代码，在浏览器和服务器上最多获得这么多内存和时间。",
  "pcode.memory": "内存（MB）",
  "pcode.time": "时间（秒）",
  "pcode.saveLimits": "保存限制",
  "pcode.saved": "已保存。",
  "pcode.installIntro":
    "上传 .msplugin 文件。MobSimLab 会检查它，并在安装前显示它添加的内容。插件可以添加交通方式、工具、参数和来源，并在无法联网的沙箱中运行自己的代码（计算、导入、导出和标签页）。",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "约 0.3 至 1 米/像素的航空影像。Esri 需要来自 ArcGIS Location Platform 账户的 ArcGIS API 密钥，并须接受其条款。瓦片经由本 MobSimLab 获取，浏览器不会看到密钥，瓦片也不会被保存。",
  "esri.key": "ArcGIS API 密钥",
  "esri.accept": "我代表本 MobSimLab 接受 Esri 的使用条款",
  "esri.terms": "Esri 条款",
  "esri.save": "保存密钥",
  "esri.remove": "删除密钥",
  "esri.saved": "以 {end} 结尾的密钥由 {name} 于 {date} 保存。地图图层控件中已提供 Esri World Imagery。",
  "esri.none": "未保存密钥：不提供 Esri World Imagery。",
} satisfies PluginCodeMessages;
