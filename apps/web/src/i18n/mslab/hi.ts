import type { MslabMessages } from "./en";

/** .mslab project file messages (hi). */
export const mslabHi = {
  "menu.saveMslab": ".mslab फ़ाइल के रूप में सहेजें",
  "home.openMslab": ".mslab फ़ाइल खोलें",
  "home.openingMslab": "फ़ाइल खुल रही है…",
  "home.openedMslab": "“{name}” को नई परियोजना के रूप में खोला गया।",
  "home.leftOut": "शामिल नहीं किया गया: {list}",
  "mslab.body":
    "परियोजना के चित्र, प्राथमिकताएँ, परिदृश्य और प्लगइन एक फ़ाइल में सहेजता है, जिसे आप किसी भी MobSimLab में फिर से खोल सकते हैं।",
  "mslab.runs": "सहेजे गए सिमुलेशन रन भी शामिल करें (फ़ाइल बड़ी होगी)",
  "mslab.map":
    "स्थिर व्यूअर के लिए मानचित्र डेटा शामिल करें: परियोजना क्षेत्र की सड़कें, इमारतें, जनसंख्या और देश के आँकड़े (फ़ाइल बड़ी होगी; कुछ मिनट लग सकते हैं)",
  "static.empty":
    "इस साइट में अभी कोई परियोजना नहीं है। .mslab फ़ाइलें इसके projects फ़ोल्डर में रखें और tools/add-projects.mjs चलाएँ।",
  "mslab.save": "फ़ाइल सहेजें",
} satisfies MslabMessages;
