import type { GeodataMessages } from "./en";

/** Map data view messages (te). */
export const geodataTe = {
  "gis.dataView": "మ్యాప్ డేటా",
  "data.title": "మ్యాప్ డేటా",
  "data.intro":
    "ఈ ప్రాజెక్ట్ కోసం OpenStreetMap మరియు ఎత్తు, ప్రాజెక్ట్‌తో పాటు ఉంచబడతాయి. వీధి, రైల్వే, భవనం, నీరు మరియు భూభాగ సాధనాలు ప్రతిసారీ OpenStreetMap మరియు ఎత్తు సర్వర్‌ను అడగకుండా వీటిని చదువుతాయి.",
  "data.noArea":
    "ముందుగా ప్రాజెక్ట్‌లో ఏదైనా గీయండి: దిగుమతి గీసిన అన్నింటి చుట్టూ ఉన్న దీర్ఘచతురస్రాన్ని మరియు అదనపు అంచును కవర్ చేస్తుంది.",
  "data.area": "ప్రాంతం: {area} చ.కి.మీ, గీసిన అన్నింటి చుట్టూ దీర్ఘచతురస్రం మరియు {buffer} కి.మీ",
  "data.osm": "OpenStreetMap",
  "data.dem": "ఎత్తు",
  "data.notImported": "ఇంకా దిగుమతి కాలేదు.",
  "data.imported": "దిగుమతి {date}",
  "data.dataDate": "{date} నాటి డేటా",
  "data.outside":
    "గీత ఇప్పుడు దిగుమతి చేసిన ప్రాంతం దాటి వెళ్తుంది. కొత్త ప్రాంతాన్ని దిగుమతి చేయడానికి రిఫ్రెష్ చేయండి.",
  "data.method": "డేటా ఇక్కడి నుండి తీసుకోండి",
  "data.method.overpass": "Overpass ({max} చ.కి.మీ వరకు ప్రాంతాలు)",
  "data.method.geofabrik": "ఒక Geofabrik ప్రాంతం",
  "data.method.upload": "ఒక .osm.pbf ఫైల్",
  "data.region": "ప్రాంతం",
  "data.regionsLoading": "ప్రాంతాలు వెతుకుతోంది…",
  "data.noRegions": "ఏ Geofabrik ప్రాంతమూ మొత్తం ప్రాంతాన్ని కలిగి లేదు.",
  "data.planned": "ప్రణాళికలోని రోడ్లను ఉంచండి (ప్రతిపాదిత మరియు నిర్మాణంలో)",
  "data.import": "దిగుమతి చేయండి",
  "data.refresh": "రిఫ్రెష్ చేయండి",
  "data.chooseFile": "ఒక .osm.pbf ఫైల్ ఎంచుకోండి ({max} MB వరకు)",
  "data.cancel": "రద్దు చేయండి",
  "data.queued": "మరో దిగుమతి పూర్తయ్యే వరకు వేచి ఉంది…",
  "data.step.download": "డౌన్‌లోడ్ అవుతోంది…",
  "data.step.downloadN": "డౌన్‌లోడ్ {done} / {total}…",
  "data.step.merge": "టైల్స్ కలుపుతోంది…",
  "data.step.extract": "ప్రాజెక్ట్ ప్రాంతాన్ని కత్తిరిస్తోంది…",
  "data.step.database": "డేటాబేస్‌లో రాస్తోంది…",
  "data.failed": "చివరి దిగుమతి విఫలమైంది: {error}",
  "data.cancelled": "చివరి దిగుమతి రద్దు చేయబడింది.",
  "data.counts": "{roads} వీధులు, {rails} రైలు మార్గాలు, {buildings} భవనాలు, {stops} స్టాప్‌లు",
  "data.demFacts": "Copernicus GLO-30, {res} మీ గ్రిడ్, ఎత్తులు ±{acc} మీ ఖచ్చితత్వంతో",
  "data.demNoData": "ప్రాంతంలోని 1° గడుల్లో {n}కి ఎత్తు డేటా లేదు (బహిరంగ సముద్రం).",
  "data.tooLarge":
    "ప్రాంతం {area} చ.కి.మీ, Overpass పరిధి కంటే ఎక్కువ. ఒక Geofabrik ప్రాంతాన్ని ఎంచుకోండి లేదా ఫైల్‌ను అప్‌లోడ్ చేయండి.",
  "data.readOnly": "యజమానులు మరియు ఎడిటర్లు డేటాను దిగుమతి చేయగలరు.",
  "data.licence": "© OpenStreetMap contributors, ODbL 1.0",
} satisfies GeodataMessages;
