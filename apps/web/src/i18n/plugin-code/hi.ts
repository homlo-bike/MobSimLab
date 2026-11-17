import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (hi). */
export const pluginCodeHi = {
  "pcode.title": "प्लगइन गणनाएँ",
  "pcode.intro":
    "इंस्टॉल किए गए प्लगइन की गणनाएँ। ये आपके ब्राउज़र में एक सैंडबॉक्स में चलती हैं, इंटरनेट या दूसरी परियोजनाओं तक पहुँच के बिना।",
  "pcode.by": "{plugin} · {publisher} द्वारा",
  "pcode.run": "गणना करें",
  "pcode.running": "गणना हो रही है…",
  "pcode.failed": "{plugin} गणना नहीं कर सका: {error}",
  "pcode.noRows": "कोई पंक्ति नहीं।",
  "pcode.log": "प्लगइन लॉग ({count} पंक्तियाँ)",
  "pcode.import": "{label} आयात करें ({plugin})",
  "pcode.export": "{label} के रूप में डाउनलोड करें ({plugin})",
  "pcode.importFailed": "{plugin} फ़ाइल नहीं पढ़ सका: {error}",
  "pcode.exportFailed": "{plugin} फ़ाइल नहीं लिख सका: {error}",
  "pcode.frameTitle": "{tab}, प्लगइन {plugin} का एक पेज",
  "pcode.frameNote":
    "यह पेज {publisher} के प्लगइन {plugin} से है। यह इंटरनेट या आपके खाते तक नहीं पहुँच सकता।",
  "pcode.runsCode": "अपना कोड सैंडबॉक्स में चलाता है",
  "pcode.limits": "प्लगइन कोड की सीमाएँ",
  "pcode.limitsIntro": "प्लगइन कोड की हर कॉल को ब्राउज़र और सर्वर पर अधिकतम इतनी मेमोरी और समय मिलता है।",
  "pcode.memory": "मेमोरी (MB)",
  "pcode.time": "समय (सेकंड)",
  "pcode.saveLimits": "सीमाएँ सहेजें",
  "pcode.saved": "सहेजा गया।",
  "pcode.installIntro":
    ".msplugin फ़ाइल अपलोड करें। MobSimLab इसे जाँचता है और इंस्टॉल करने से पहले दिखाता है कि यह क्या जोड़ती है। प्लगइन परिवहन साधन, टूल, पैरामीटर और स्रोत जोड़ सकते हैं और अपना कोड (गणनाएँ, आयात, निर्यात और टैब पेज) इंटरनेट के बिना सैंडबॉक्स में चला सकते हैं।",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "लगभग 0.3 से 1 मीटर प्रति पिक्सेल की हवाई तस्वीरें। Esri को ArcGIS Location Platform खाते की ArcGIS API कुंजी और अपनी शर्तों की स्वीकृति चाहिए। टाइलें इसी MobSimLab से होकर आती हैं, इसलिए ब्राउज़र कुंजी कभी नहीं देखते, और टाइलें सहेजी नहीं जातीं।",
  "esri.key": "ArcGIS API कुंजी",
  "esri.accept": "मैं इस MobSimLab के लिए Esri की उपयोग शर्तें स्वीकार करता/करती हूँ",
  "esri.terms": "Esri की शर्तें",
  "esri.save": "कुंजी सहेजें",
  "esri.remove": "कुंजी हटाएँ",
  "esri.saved":
    "{end} पर ख़त्म होने वाली कुंजी {name} ने {date} को सहेजी। Esri World Imagery नक्शे के परत नियंत्रण में उपलब्ध है।",
  "esri.none": "कोई कुंजी सहेजी नहीं गई: Esri World Imagery उपलब्ध नहीं है।",
} satisfies PluginCodeMessages;
