import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (kk). */
export const pluginCodeKk = {
  "pcode.title": "Плагин есептері",
  "pcode.intro":
    "Орнатылған плагиндердің есептері. Олар браузеріңіздегі құмсалғышта, интернетке немесе басқа жобаларға қол жеткізусіз жұмыс істейді.",
  "pcode.by": "{plugin} · {publisher}",
  "pcode.run": "Есептеу",
  "pcode.running": "Есептелуде…",
  "pcode.failed": "{plugin} есептей алмады: {error}",
  "pcode.noRows": "Жолдар жоқ.",
  "pcode.log": "Плагин журналы ({count} жол)",
  "pcode.import": "{label} импорттау ({plugin})",
  "pcode.export": "{label} ретінде жүктеп алу ({plugin})",
  "pcode.importFailed": "{plugin} файлды оқи алмады: {error}",
  "pcode.exportFailed": "{plugin} файлды жаза алмады: {error}",
  "pcode.frameTitle": "{tab}, {plugin} плагинінің беті",
  "pcode.frameNote":
    "Бұл бет {publisher} шығарған {plugin} плагинінен келеді. Ол интернетке немесе тіркелгіңізге қол жеткізе алмайды.",
  "pcode.runsCode": "Өз кодын құмсалғышта іске қосады",
  "pcode.limits": "Плагин кодының шектеулері",
  "pcode.limitsIntro":
    "Плагин кодының әр шақыруы браузерде және серверде ең көбі осынша жад пен уақыт алады.",
  "pcode.memory": "Жад (МБ)",
  "pcode.time": "Уақыт (секунд)",
  "pcode.saveLimits": "Шектеулерді сақтау",
  "pcode.saved": "Сақталды.",
  "pcode.installIntro":
    ".msplugin файлын жүктеңіз. MobSimLab оны тексеріп, орнатпас бұрын не қосатынын көрсетеді. Плагиндер көлік түрлерін, құралдарды, параметрлер мен дереккөздерді қосып, өз кодын (есептер, импорт, экспорт және қойынды беттері) интернетсіз құмсалғышта іске қоса алады.",
} satisfies PluginCodeMessages;
