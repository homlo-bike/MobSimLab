import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (mr). */
export const workspaceUiMr = {
  "checks.menu": "तपासण्या",
  "checks.menuCount": "तपासण्या: {errors} त्रुटी, {warnings} इशारे",
  "checks.title": "सर्व मोडच्या तपासण्या",
  "checks.none":
    "अजून तपासण्यासारखे काही नाही. एखादी लाइन, रेल्वे किंवा डेपो काढा, त्याच्या तपासण्या इथे दिसतील.",
  "checks.lastOpened": "शेवटच्या वेळी उघडले तेव्हासारख्या",
  "checks.streetLine": "रस्ता लाइन · {name}",
  "checks.railway": "रेल्वे",
  "checks.depot": "डेपो · {name}",
  "undo.undo": "पूर्ववत करा",
  "undo.redo": "पुन्हा करा",
  "tour.checks.title": "तपासण्या",
  "tour.checks.body":
    "घंटा सर्व मोडच्या तपासण्या दाखवते, आधी त्रुटी: रस्ता लाइन, रेल्वे, डेपो आणि प्लगइनच्या लाइन. ती कुठे आहे ते पाहण्यासाठी एक निवडा.",
  "settings.serverTab": "सर्व्हर",
  "settings.pluginsTab": "प्लगइन",
  "settings.server.local":
    "MobSimLab या संगणकावर चालत आहे. त्याऐवजी तुम्ही हे ॲप पार्श्वभूमीत चालणाऱ्या MobSimLab सर्व्हरशी जोडू शकता, उदा. Docker सर्व्हर.",
  "settings.server.address": "सर्व्हरचा पत्ता",
  "settings.server.connect": "जोडा",
  "settings.server.note":
    "ॲप सर्व्हर तपासते आणि बदलण्यापूर्वी विचारते. या संगणकावरील प्रकल्प इथेच राहतात: ते .mslab फाइल म्हणून जतन करून हलवा. ॲपच्या सेटिंग्जमध्ये (⌘, किंवा Ctrl+,) तुम्ही परत जाऊ शकता.",
  "settings.plugins.intro":
    "या MobSimLab साठी प्लगइन इन्स्टॉल करा. मग प्रत्येक प्रकल्प ते आपल्या प्रकल्प प्राधान्यांमध्ये चालू किंवा बंद करतो.",
} satisfies WorkspaceUiMessages;
