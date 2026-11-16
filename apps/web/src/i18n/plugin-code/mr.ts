import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (mr). */
export const pluginCodeMr = {
  "pcode.title": "प्लगइन गणना",
  "pcode.intro": "स्थापित प्लगइनच्या गणना. त्या तुमच्या ब्राउझरमधील सँडबॉक्समध्ये चालतात, इंटरनेट किंवा इतर प्रकल्पांपर्यंत पोहोच न ठेवता.",
  "pcode.by": "{plugin} · {publisher} यांचे",
  "pcode.run": "गणना करा",
  "pcode.running": "गणना सुरू आहे…",
  "pcode.failed": "{plugin} गणना करू शकले नाही: {error}",
  "pcode.noRows": "एकही ओळ नाही.",
  "pcode.log": "प्लगइन नोंद ({count} ओळी)",
  "pcode.import": "{label} आयात करा ({plugin})",
  "pcode.export": "{label} म्हणून डाउनलोड करा ({plugin})",
  "pcode.importFailed": "{plugin} फाइल वाचू शकले नाही: {error}",
  "pcode.exportFailed": "{plugin} फाइल लिहू शकले नाही: {error}",
  "pcode.frameTitle": "{tab}, प्लगइन {plugin} चे एक पान",
  "pcode.frameNote": "हे पान {publisher} यांच्या प्लगइन {plugin} मधून आहे. त्याला इंटरनेट किंवा तुमच्या खात्यापर्यंत पोहोचता येत नाही.",
  "pcode.runsCode": "स्वतःचा कोड सँडबॉक्समध्ये चालवते",
  "pcode.limits": "प्लगइन कोडच्या मर्यादा",
  "pcode.limitsIntro": "प्लगइन कोडच्या प्रत्येक कॉलला ब्राउझर आणि सर्व्हरवर जास्तीत जास्त इतकी मेमरी आणि वेळ मिळते.",
  "pcode.memory": "मेमरी (MB)",
  "pcode.time": "वेळ (सेकंद)",
  "pcode.saveLimits": "मर्यादा जतन करा",
  "pcode.saved": "जतन झाले.",
  "pcode.installIntro": ".msplugin फाइल अपलोड करा. MobSimLab ती तपासते आणि स्थापित करण्यापूर्वी ती काय जोडते ते दाखवते. प्लगइन वाहतूक प्रकार, साधने, पॅरामीटर आणि स्रोत जोडू शकतात आणि स्वतःचा कोड (गणना, आयात, निर्यात आणि टॅब पाने) इंटरनेटशिवाय सँडबॉक्समध्ये चालवू शकतात.",
} satisfies PluginCodeMessages;
