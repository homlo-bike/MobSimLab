import type { AdviceMessages } from "./en";

/** Advice messages (zu). */
export const adviceZu = {
  "advice.title": "Okufanele kuthuthukiswe",
  "advice.intro": "Izinkinga lokhu kuqhuba okuzitholile, enkulu kakhulu kuqala, nokuthi ungenzani ngayinye.",
  "advice.none": "Akukho okufanele kuthuthukiswe: lokhu kuqhuba akutholanga sivimbo noma nkinga.",
  "advice.show": "Bonisa emephini",
  "advice.more": "Ezinye ezingu-{n} azibonisiwe.",
  "advice.severity.problem": "Inkinga",
  "advice.severity.warning": "Isexwayiso",
  "advice.crowdMap":
    "Bonisa emephini ukuthi izimoto zigcwele kangakanani (ihora elimatasa kakhulu lomzila ngamunye)",
  "advice.cap.stopped": "{line}: ukuqhuba kumile: {problem}",
  "advice.cap.stoppedFix": "Lungisa lokhu ethuluzini lesitimela, bese uphinda uqhuba ukuhlola.",
  "advice.cap.unplaced": "{line}: uhambo olungangeni kujantshi: {n}",
  "advice.cap.unplacedFix":
    "Qhuba umzila kancane kulesi sikhathi, noma unike izitimela zawo isikhala esengeziwe lapho zihlangana khona: imizila yeplatifomu eyengeziwe noma iziphambano e-{terminal}, noma indawo yokudlula kujantshi owodwa.",
  "advice.cap.terminal":
    "{line}: isiteshi sokugcina {terminal} siyisivimbo, sisetshenziswa u-{share} wehora elimatasa kakhulu (umkhawulo {limit})",
  "advice.cap.terminalFix":
    "Izitimela zibamba amaplatifomu aso isikhathi eside kakhulu. Nciphisa ukuphenduka (ukuma okufushane, noma umshayeli olinda ekugcineni ngakunye), engeza umzila weplatifomu, noma usondeze isiphambano kumaplatifomu ukuze izitimela zisishiye ngokushesha.",
  "advice.cap.section":
    "{line}: ingxenye kajantshi {section} iyisivimbo, isetshenziswa u-{share} wehora elimatasa kakhulu (umkhawulo {limit})",
  "advice.cap.sectionFix":
    "Izitimela zibamba le ngxenye isikhathi eside kunanoma iyiphi enye. Isivinini esiphezulu kuyo sizenza ziyishiye ngokushesha; uma kungenjalo, qhuba izitimela ezimbalwa lapha.",
  "advice.cap.sectionPlatform":
    "Le ngxenye ingumzila weplatifomu: izitimela ziyibamba ngesikhathi zimile eplatifomu. Ukuma okufushane lapho, noma umzila weplatifomu wesibili walolu hlangothi, kungenisa isitimela esilandelayo ngokushesha.",
  "advice.cap.sectionSwitches":
    "Le ngxenye iyindawo yokushintsha: izitimela ziyibamba ngesikhathi indlela yazo edlula ezishintshweni isethwa futhi ikhululwa. Izishintsho ezinesivinini esiphezulu egatsheni eliphambukayo, noma ezibekwe ukuze izinhlangothi zombili zingaphambani, ziyikhulula ngokushesha.",
  "advice.cap.signalAdd":
    "Le ngxenye yomugqa ovulekile ingamamitha angu-{length}, kodwa ibhulokhi ngo-{speed} km/h idinga amamitha angu-{block} kuphela. Engeza isignali yebhulokhi cishe ku-{at} m kujantshi {track}, ukuze isitimela esilandelayo singene engxenyeni yokuqala ngokushesha.",
  "advice.cap.signalShort":
    "Le ngxenye ingamamitha angu-{length}, ngaphansi kwamabhulokhi amabili angu-{block} m ngo-{speed} km/h, ngakho enye isignali ingashiya isikhala esincane kakhulu sokuma. Izitimela zingalandelana eduze ngokusignalisha kwekhabhi (CBTC noma ETCS izinga 2), noma ngesivinini esiphansi lapha.",
  "advice.cap.sectionCab":
    "Ngokusignalisha kwekhabhi izitimela sezivele zilandelana ebangeni lokubhuleka ({block} m ngo-{speed} km/h); amasignali awanqumi isikhala. Isivinini esiphezulu kule ngxenye, noma izitimela ezimbalwa, kuyikhulula ngokushesha.",
  "advice.cap.sectionSight":
    "Amathilamu lapha ahamba ngokubona, ngakho amasignali awanqumi isikhala. Ukuma okufushane eduze, noma ujantshi wawo kude nomgwaqo, kuyikhulula ngokushesha.",
  "advice.cap.nearNote": "Kusasebenza, kodwa sincane isikhala sokwengeza izitimela.",
  "advice.cap.pileUp":
    "{line}: ukubambezeleka kuyanqwabelana futhi kusengu-{late} ngokwesilinganiso uma isikhathi siphela",
  "advice.cap.pileUpFix":
    "Engeza isikhathi sokululama eziteshini zokugcina, noma uqhube kancane kancane, ukuze isitimela esibambezelekile singabambi esilandelayo.",
  "advice.cap.full": "{line}: izimoto zigcwele u-{share} kusuka ku-{from} kuya ku-{to}, {time}",
  "advice.cap.fullMore":
    "Abantu abangu-{left} basala ngemuva kulesi sikhathi. Ujantshi uvumela izitimela ezifika ku-{n} ngehora ohlangothini ngalunye: qhuba kaningi, noma usebenzise izitimela ezinde.",
  "advice.cap.fullLonger":
    "Abantu abangu-{left} basala ngemuva kulesi sikhathi. Qhuba kaningi uma ujantshi uvuma, noma usebenzise izimoto ezinde.",
  "advice.cap.streetPileUp":
    "{line}: ukubambezeleka kuyanqwabelana emgwaqweni futhi kusengu-{late} ekugcineni",
  "advice.cap.streetPileUpFix":
    "Hlela isikhathi esengeziwe sokuzungeza noma ikhefu elide ezitobhini zokugcina, ukuze izimoto zibambe; umzila wazo lapho zihlangana nomgwaqo uyasiza kakhulu.",
  "advice.road.cannotRun": "{line} ayikwazanga ukuqhuba",
  "advice.road.cannotRunFix": "{problem}. Lungisa ku-Dala → Umzila womgwaqo, bese uphinda uqhuba.",
  "advice.road.late": "{line}: u-{share} kuphela wokuhamba ngesikhathi (iseluleko ngaphansi kuka-{limit})",
  "advice.road.mostlySignals":
    "Uhambo ngalunye lulahlekelwa imizuzu engu-{signals} emarobhothini abomvu nemizuzu engu-{traffic} emgwaqweni, ngakho iningi lako emarobhothini abalwe lapha.",
  "advice.road.mostlyTraffic":
    "Uhambo ngalunye lulahlekelwa imizuzu engu-{traffic} emgwaqweni nemizuzu engu-{signals} emarobhothini abomvu, ngakho iningi lako emigwaqweni ebalwe lapha.",
  "advice.road.moreTime":
    "Ukuzungeza kuthathe imizuzu engu-{run} esikhundleni semizuzu engu-{planned} ehleliwe: hlela isikhathi sokuhamba esengeziwe, noma wengeze imoto.",
  "advice.road.bunched": "{line}: u-{share} wokuhamba ufika uqoqene",
  "advice.road.bunchedFix":
    "Izimoto ziyabambana. Zibambe ezitobhini zokugcina ngokwesheduli, uzinike ikhefu elide lapho, noma unike umzila umzila wawo lapho ulahlekelwa isikhathi khona.",
  "advice.road.ranOut": "{line}: izimoto eziphelelwe amandla: {n}",
  "advice.road.ranOutFix":
    "Sebenzisa ibhethri elikhulu, shaja ezitobhini zokugcina, noma ushintshe izimoto emini.",
  "advice.road.stuck": "{line}: izimoto ezibambeke imizuzu engu-5 noma ngaphezulu: {n}",
  "advice.road.stuckFix":
    "Hlola ukuhlelwa komgwaqo namarobhothi kule ndawo kuthebhu ye-GIS: kungenzeka kushoda ukujika, noma umgwaqo uvala isiphambano.",
  "advice.road.notBack": "{line}: izimoto ezingabuyelanga edepho ekugcineni: {n}",
  "advice.road.notBackFix":
    "Hlola indlela phakathi komzila nedepho yawo, noma unikeze isikhathi esengeziwe ngemuva kohambo lokugcina.",
  "advice.road.unnamedStreet": "umgwaqo ongenagama",
  "advice.road.unnamedJunction": "isiphambano",
  "advice.road.spot.signal": "Irobhothi elibomvu, {place}: kulahleke imizuzu engu-{min} sekukonke ({lines})",
  "advice.road.spot.signalFix":
    "Imizila ilinda lapha isikhathi eside kunanoma kuphi. Cela ukuthi inikwe okubalulekile kuleli robhothi, noma izikhathi zerobhothi ezifanele yona. Ukulingisa umgwaqo akukakukhombisi okubalulekile, ngakho akukwazi ukubonisa inzuzo.",
  "advice.road.spot.street": "Umgwaqo, {place}: kulahleke imizuzu engu-{min} sekukonke ({lines})",
  "advice.road.spot.streetFix":
    "Nika imizila umzila wayo kulo mgwaqo (ithebhu ye-GIS, ukuhlelwa komgwaqo: umzila webhasi), noma uyidlulise komunye umgwaqo.",
  "advice.road.spot.junction": "Ukuma, {place}: kulahleke imizuzu engu-{min} sekukonke ({lines})",
  "advice.road.spot.junctionFix":
    "Izimoto zima ngaphakathi kwalesi siphambano, zilinde ukujika noma ukuthi indlela yokuphuma ivuleke. Umzila wazo kuze kube lapho, noma isigaba sokujika esehlukile emarobhothini, kuyasiza.",
} satisfies AdviceMessages;
