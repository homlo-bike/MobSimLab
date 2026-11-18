import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (hi). */
export const workspaceUiHi = {
  "checks.menu": "जाँचें",
  "checks.menuCount": "जाँचें: {errors} त्रुटियाँ, {warnings} चेतावनियाँ",
  "checks.title": "सभी मोड की जाँचें",
  "checks.none": "अभी जाँचने को कुछ नहीं है। कोई लाइन, रेलवे या डिपो बनाइए, उसकी जाँचें यहाँ दिखेंगी।",
  "checks.lastOpened": "पिछली बार खोलने के समय जैसी",
  "checks.streetLine": "सड़क लाइन · {name}",
  "checks.railway": "रेलवे",
  "checks.depot": "डिपो · {name}",
  "undo.undo": "पूर्ववत करें",
  "undo.redo": "फिर से करें",
  "tour.checks.title": "जाँचें",
  "tour.checks.body":
    "घंटी सभी मोड की जाँचें दिखाती है, पहले त्रुटियाँ: सड़क लाइनें, रेलवे, डिपो और प्लगइन की लाइनें। कोई एक चुनें और देखें कि वह कहाँ है।",
  "settings.serverTab": "सर्वर",
  "settings.server.local":
    "MobSimLab इस कंप्यूटर पर चल रहा है। इसके बजाय आप इस ऐप को पृष्ठभूमि में चल रहे MobSimLab सर्वर से जोड़ सकते हैं, जैसे Docker सर्वर।",
  "settings.server.address": "सर्वर का पता",
  "settings.server.connect": "जोड़ें",
  "settings.server.note":
    "ऐप सर्वर की जाँच करता है और बदलने से पहले पूछता है। इस कंप्यूटर के प्रोजेक्ट यहीं रहते हैं: उन्हें .mslab फ़ाइलों के रूप में सहेजकर ले जाएँ। आप ऐप की सेटिंग्स (⌘, या Ctrl+,) में वापस जा सकते हैं।",
} satisfies WorkspaceUiMessages;
