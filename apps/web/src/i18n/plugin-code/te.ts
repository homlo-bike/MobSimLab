import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (te). */
export const pluginCodeTe = {
  "pcode.title": "ప్లగిన్ గణనలు",
  "pcode.intro":
    "ఇన్‌స్టాల్ చేసిన ప్లగిన్‌ల గణనలు. ఇవి మీ బ్రౌజర్‌లో ఒక శాండ్‌బాక్స్‌లో నడుస్తాయి, ఇంటర్నెట్ లేదా ఇతర ప్రాజెక్టులకు ప్రవేశం లేకుండా.",
  "pcode.by": "{plugin} · {publisher} నుండి",
  "pcode.run": "లెక్కించు",
  "pcode.running": "లెక్కిస్తోంది…",
  "pcode.failed": "{plugin} లెక్కించలేకపోయింది: {error}",
  "pcode.noRows": "వరుసలు లేవు.",
  "pcode.log": "ప్లగిన్ లాగ్ ({count} పంక్తులు)",
  "pcode.import": "{label} దిగుమతి చేయి ({plugin})",
  "pcode.export": "{label}గా డౌన్‌లోడ్ చేయి ({plugin})",
  "pcode.importFailed": "{plugin} ఫైల్‌ను చదవలేకపోయింది: {error}",
  "pcode.exportFailed": "{plugin} ఫైల్‌ను రాయలేకపోయింది: {error}",
  "pcode.frameTitle": "{tab}, {plugin} ప్లగిన్ యొక్క ఒక పేజీ",
  "pcode.frameNote":
    "ఈ పేజీ {publisher} యొక్క {plugin} ప్లగిన్ నుండి వచ్చింది. ఇది ఇంటర్నెట్‌ను లేదా మీ ఖాతాను చేరలేదు.",
  "pcode.runsCode": "తన సొంత కోడ్‌ను శాండ్‌బాక్స్‌లో నడుపుతుంది",
  "pcode.limits": "ప్లగిన్ కోడ్ పరిమితులు",
  "pcode.limitsIntro":
    "ప్లగిన్ కోడ్ యొక్క ప్రతి పిలుపుకు బ్రౌజర్‌లో మరియు సర్వర్‌లో గరిష్టంగా ఇంత మెమరీ, సమయం లభిస్తుంది.",
  "pcode.memory": "మెమరీ (MB)",
  "pcode.time": "సమయం (సెకన్లు)",
  "pcode.saveLimits": "పరిమితులను సేవ్ చేయి",
  "pcode.saved": "సేవ్ అయింది.",
  "pcode.installIntro":
    ".msplugin ఫైల్‌ను అప్‌లోడ్ చేయండి. MobSimLab దాన్ని తనిఖీ చేసి, ఇన్‌స్టాల్ చేసే ముందు అది ఏమి జోడిస్తుందో చూపుతుంది. ప్లగిన్‌లు రవాణా విధానాలు, సాధనాలు, పారామితులు, మూలాలు జోడించగలవు మరియు తమ సొంత కోడ్‌ను (గణనలు, దిగుమతులు, ఎగుమతులు, ట్యాబ్ పేజీలు) ఇంటర్నెట్ లేని శాండ్‌బాక్స్‌లో నడపగలవు.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "పిక్సెల్‌కు సుమారు 0.3 నుండి 1 మీ. వైమానిక చిత్రాలు. Esri కి ArcGIS Location Platform ఖాతా నుండి ArcGIS API కీ మరియు దాని నిబంధనల అంగీకారం అవసరం. టైల్స్ ఈ MobSimLab ద్వారా వస్తాయి, కాబట్టి బ్రౌజర్లు కీని ఎప్పుడూ చూడవు, టైల్స్ నిల్వ చేయబడవు.",
  "esri.key": "ArcGIS API కీ",
  "esri.accept": "ఈ MobSimLab కోసం Esri వినియోగ నిబంధనలను అంగీకరిస్తున్నాను",
  "esri.terms": "Esri నిబంధనలు",
  "esri.save": "కీని సేవ్ చేయండి",
  "esri.remove": "కీని తీసివేయండి",
  "esri.saved":
    "{end} తో ముగిసే కీని {name} {date} న సేవ్ చేశారు. మ్యాప్ లేయర్ నియంత్రణలో Esri World Imagery అందుబాటులో ఉంది.",
  "esri.none": "కీ సేవ్ కాలేదు: Esri World Imagery అందించబడదు.",
} satisfies PluginCodeMessages;
