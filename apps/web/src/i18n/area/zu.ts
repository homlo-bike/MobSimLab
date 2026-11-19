import type { AreaMessages } from "./en";

/** Project area messages (zu). */
export const areaZu = {
  "aw.title": "Indawo yephrojekthi",
  "aw.editing": "Ihlela indawo ka-{name}",
  "aw.search": "Sesha indawo ukuze uhambise imephu, njenge-Homs",
  "aw.tools": "Amathuluzi okudweba",
  "aw.draw": "Dweba i-polygon",
  "aw.edit": "Hlela amaphoyinti",
  "aw.pan": "Hambisa",
  "aw.hint.draw":
    "Chofoza ukuze wengeze amakhona. Chofoza ikhona lokuqala noma ucindezele u-Enter ukuze uvale i-polygon. U-Backspace ususa ikhona lokugcina.",
  "aw.hint.edit":
    "Chofoza i-polygon ukuze uyikhethe. Hudula ikhona ukuze ulihambise, hudula iphoyinti eliphakathi ukuze wengeze ikhona, chofoza kabili ikhona ukuze ulisuse.",
  "aw.hint.pan": "Hudula ukuze uhambise imephu. Chofoza i-polygon ukuze uyikhethe.",
  "aw.statArea": "Ubukhulu",
  "aw.statDownload": "Ukulanda okulinganisiwe",
  "aw.mb": "{mb} MB",
  "aw.limit": "Umkhawulo {mb} MB",
  "aw.overLimit":
    "Le ndawo inedatha yemephu engaphezu kwe-{mb} MB iphrojekthi engaba nayo. Yenze ibe ncane, noma usethe ama-polygon aseduze nemizila abe imigwaqo emikhulu nezitimela kuphela.",
  "aw.polygons": "Ama-polygon",
  "aw.empty":
    "Awekho ama-polygon okwamanje. Dweba eyodwa uzungeze indawo ngayinye iphrojekthi ehlanganisa yona, neyodwa encane eduze komzila ngamunye ophakathi kwamadolobha.",
  "aw.detail.full": "Ephelele",
  "aw.detail.main": "Imigwaqo emikhulu nezitimela kuphela",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "Igama",
  "aw.detail": "Izinga lemininingwane",
  "aw.fullHelp":
    "Imigwaqo, izindlela, izakhiwo, izikole nezibhedlela, inani labantu ngamamitha ayi-100, ubume bomhlaba.",
  "aw.mainHelp":
    "Imigwaqo emikhulu enejubane, imigwaqo emikhulu neyokuqala, izitimela, ubume bomhlaba, inani labantu nge-km 1. Azikho izakhiwo: dweba amadolobha asemzileni njengaPhelele ukuze uthole imephu yomsindo nokufinyelela ngezinyawo.",
  "aw.delete": "Susa i-polygon",
  "aw.newName": "Indawo {n}",
  "aw.save": "Londoloza indawo",
  "aw.confirm.title": "Landa idatha yemephu yezingxenye ezintsha?",
  "aw.confirm.body":
    "Ezintsha noma ezishintshiwe: {list}. Zidinga cishe u-{mb} MB. Izingxenye ezisusiwe azisasetshenziswa. Akukho okulandwayo uze uqinisekise.",
  "aw.confirm.item": "{name} ({detail}, {area} km²)",
  "aw.confirm.back": "Buyela emephini",
  "aw.confirm.save": "Londoloza bese ulanda u-{mb} MB",
  "aw.select": "Khetha indawo",
  "aw.selectHint": "Dweba imingcele yephrojekthi emephini. Idatha yemephu ilandwa ngaphakathi kwayo kuphela.",
  "aw.change": "Shintsha indawo",
  "aw.download": "cishe u-{mb} MB wedatha yemephu",
  "aw.outline": "Uhlaka lwendawo yephrojekthi",
  "aw.prefsIntro":
    "Ama-polygon adwetshwe azungeze iphrojekthi. Idatha yemephu ilandwa ngaphakathi kwawo kuphela, ngezinga lemininingwane le-polygon ngayinye.",
  "aw.dataFrom": "Idatha yemephu ka-{date}",
  "aw.noData": "Idatha yemephu ayikalandwa",
  "aw.editArea": "Hlela indawo",
  "aw.drawArea": "Dweba indawo",
  "aw.refresh": "Vuselela idatha yemephu",
  "aw.refreshHelp":
    "Ukuvuselela kulanda idatha ye-OpenStreetMap yamanje yendawo efanayo; kuze kube yilapho uhlelo lugcina usuku lwedatha yalo.",
  "aw.none": "Ayikho indawo yephrojekthi okwamanje. Dweba eyodwa ukuze amathuluzi abe nedatha yemephu.",
  "aw.saved": "Indawo ilondoloziwe.",
  "aw.data.noArea": "Qala ngokudweba indawo yephrojekthi kokuthandayo kwephrojekthi: ukungenisa kuyayimboza.",
  "aw.data.area": "Indawo yephrojekthi: {names}. Ukungenisa kumboza unxande oyizungezile, {area} km².",
  "aw.pop.none": "Ayikho indawo yephrojekthi okwamanje. Yidwebe kokuthandayo kwephrojekthi.",
  "aw.pop.box": "Unxande ozungeze indawo yephrojekthi: {km2} km².",
  "aw.tiles.one": "ithayela lemephu elingu-{count}",
  "aw.tiles.other": "amathayela emephu angu-{count}",
  "aw.count.one": "i-polygon engu-{count}",
  "aw.count.other": "ama-polygon angu-{count}",
  "aw.out.title": "Landa idatha yemephu ngaphandle kwendawo yephrojekthi?",
  "aw.out.note":
    "Isifunda {name} sidlulela ngaphandle kwendawo yephrojekthi. Ingxenye yaso engaphandle idinga idatha entsha yemephu.",
  "aw.out.part": "Ingxenye engaphandle",
  "aw.out.km2": "cishe ku-{km2} km²",
  "aw.out.detail": "Izinga lemininingwane lengxenye engaphandle",
  "aw.out.overLimit":
    "Uma kunaso, indawo yephrojekthi inedatha yemephu engaphezu kwe-{mb} MB ephrojekthi engaba nayo. Khetha imigwaqo emikhulu nezitimela kuphela, noma wenze indawo ibe ncane kokuncanyelwayo kwephrojekthi.",
  "aw.out.adds":
    "Ukulanda kwengeza isifunda endaweni yephrojekthi njengepholigoni entsha, ongayihlela kamuva efasiteleni lendawo.",
  "aw.out.keep": "Gcina isifunda, ungalandi",
  "aw.out.download": "Landa u-{mb} MB",
  "aw.out.downloading": "Iyalanda…",
} satisfies AreaMessages;
