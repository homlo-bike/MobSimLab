import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (te). */
export const workspaceUiTe = {
  "checks.menu": "తనిఖీలు",
  "checks.menuCount": "తనిఖీలు: {errors} లోపాలు, {warnings} హెచ్చరికలు",
  "checks.title": "అన్ని మోడ్‌ల తనిఖీలు",
  "checks.none":
    "ఇంకా తనిఖీ చేయడానికి ఏమీ లేదు. ఒక లైన్, రైల్వే లేదా డిపో గీయండి, దాని తనిఖీలు ఇక్కడ కనిపిస్తాయి.",
  "checks.lastOpened": "చివరిసారి తెరిచినప్పటిలా",
  "checks.streetLine": "వీధి లైన్ · {name}",
  "checks.railway": "రైల్వే",
  "checks.depot": "డిపో · {name}",
  "undo.undo": "రద్దుచేయి",
  "undo.redo": "మళ్లీ చేయి",
  "tour.checks.title": "తనిఖీలు",
  "tour.checks.body":
    "గంట అన్ని మోడ్‌ల తనిఖీలను చూపుతుంది, ముందుగా లోపాలు: వీధి లైన్‌లు, రైల్వే, డిపోలు మరియు ప్లగిన్‌ల లైన్‌లు. అది ఎక్కడ ఉందో చూడటానికి ఒకదాన్ని ఎంచుకోండి.",
  "settings.serverTab": "సర్వర్",
  "settings.pluginsTab": "ప్లగిన్‌లు",
  "settings.server.local":
    "MobSimLab ఈ కంప్యూటర్‌లో నడుస్తోంది. దానికి బదులుగా ఈ యాప్‌ను నేపథ్యంలో నడిచే MobSimLab సర్వర్‌కు, ఉదా. Docker సర్వర్‌కు కనెక్ట్ చేయవచ్చు.",
  "settings.server.address": "సర్వర్ చిరునామా",
  "settings.server.connect": "కనెక్ట్ చేయి",
  "settings.server.note":
    "యాప్ సర్వర్‌ను తనిఖీ చేసి, మారే ముందు అడుగుతుంది. ఈ కంప్యూటర్‌లోని ప్రాజెక్ట్‌లు ఇక్కడే ఉంటాయి: వాటిని .mslab ఫైల్‌లుగా సేవ్ చేసి తరలించండి. యాప్ సెట్టింగ్‌లలో (⌘, లేదా Ctrl+,) తిరిగి మారవచ్చు.",
  "settings.plugins.intro":
    "ఈ MobSimLab కోసం ప్లగిన్‌లను ఇన్‌స్టాల్ చేయండి. ఆ తర్వాత ప్రతి ప్రాజెక్ట్ వాటిని తన ప్రాజెక్ట్ ప్రాధాన్యతలలో ఆన్ లేదా ఆఫ్ చేస్తుంది.",
} satisfies WorkspaceUiMessages;
