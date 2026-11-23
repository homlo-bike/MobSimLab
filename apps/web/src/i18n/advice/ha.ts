import type { AdviceMessages } from "./en";

/** Advice messages (ha). */
export const adviceHa = {
  "advice.title": "Abin da za a inganta",
  "advice.intro":
    "Matsalolin da wannan gudu ya samu, mafi tsanani da farko, da abin da za ka iya yi game da kowanne.",
  "advice.none": "Babu abin da za a inganta: wannan gudu bai sami wani cunkoso ko matsala ba.",
  "advice.show": "Nuna a taswira",
  "advice.more": "Ƙarin {n} ba a nuna ba.",
  "advice.severity.problem": "Matsala",
  "advice.severity.warning": "Gargaɗi",
  "advice.crowdMap": "Nuna a taswira yadda motoci suka cika (sa'ar da ta fi cunkoso a kowace hanya)",
  "advice.cap.stopped": "{line}: gudun ya tsaya: {problem}",
  "advice.cap.stoppedFix": "Gyara wannan a kayan aikin layin dogo, sannan sake gudanar da gwajin.",
  "advice.cap.unplaced": "{line}: tafiye-tafiyen da ba su dace a kan layi ba: {n}",
  "advice.cap.unplacedFix":
    "Gudanar da hanyar ƙasa da haka a wannan lokaci, ko ka bai wa jiragenta ƙarin wuri inda suke haɗuwa: ƙarin layukan dandamali ko mahaɗa a {terminal}, ko wurin wucewa a kan layi ɗaya.",
  "advice.cap.terminal":
    "{line}: tashar ƙarshe {terminal} ita ce cunkoso, ana amfani da ita {share} na sa'ar da ta fi cunkoso (iyaka {limit})",
  "advice.cap.terminalFix":
    "Jiragen suna riƙe dandamalinta da daɗewa. Rage lokacin juyawa (ɗan tsayawa gajere, ko direba mai jira a kowane ƙarshe), ƙara layin dandamali, ko matsar da mahaɗar kusa da dandamalin domin jirage su bar ta da wuri.",
  "advice.cap.section":
    "{line}: sashen layi {section} shi ne cunkoso, ana amfani da shi {share} na sa'ar da ta fi cunkoso (iyaka {limit})",
  "advice.cap.sectionFix":
    "Jiragen suna riƙe wannan sashe fiye da kowane. Saurin da ya fi a cikinsa zai sa su bar shi da wuri; in ba haka ba, a rage jirage a nan.",
  "advice.cap.sectionPlatform":
    "Wannan sashe layin dandamali ne: jirage suna riƙe shi muddin suna tsaye a dandamali. Gajeren tsayawa a can, ko layin dandamali na biyu don wannan alƙibla, zai bar jirgi na gaba ya shiga da wuri.",
  "advice.cap.sectionSwitches":
    "Wannan sashe yankin canjin hanya ne: jirage suna riƙe shi yayin da ake saita hanyarsu ta cikin canje-canjen kuma a sake ta. Canje-canje masu sauri a reshen karkacewa, ko waɗanda aka sanya don alƙiblolin biyu kada su yanke juna, za su sake shi da wuri.",
  "advice.cap.signalAdd":
    "Wannan sashen layin buɗe tsawonsa m {length} ne, amma block a km/h {speed} yana buƙatar m {block} kawai. Ƙara siginar block kusan m {at} a kan layi {track}, domin jirgi na gaba ya shiga rabin farko da wuri.",
  "advice.cap.signalShort":
    "Wannan sashe tsawonsa m {length} ne, ƙasa da block biyu na m {block} a km/h {speed}, don haka wata sigina za ta bar ɗan wuri kaɗan don tsayawa. Jirage na iya bin juna a kusa da siginar ɗakin direba (CBTC ko ETCS mataki na 2), ko da ƙaramin sauri a nan.",
  "advice.cap.sectionCab":
    "Da siginar ɗakin direba jirage sun riga sun bi juna a nisan birki (m {block} a km/h {speed}); sigina ba su ke ƙayyade tazara ba. Saurin da ya fi a sashen, ko ƙarancin jirage, za su sake shi da wuri.",
  "advice.cap.sectionSight":
    "Tram a nan suna tafiya bisa gani, don haka sigina ba su ke ƙayyade tazara ba. Gajeren tsayawa a kusa, ko layinsu na kansu nesa da cunkoson titi, za su sake shi da wuri.",
  "advice.cap.nearNote": "Har yanzu yana aiki, amma akwai ɗan wuri kaɗan don ƙara jirage.",
  "advice.cap.pileUp":
    "{line}: jinkiri yana taruwa kuma har yanzu matsakaicinsa {late} ne idan lokacin ya ƙare",
  "advice.cap.pileUpFix":
    "Ƙara lokacin farfaɗowa a tashoshin ƙarshe, ko a gudanar da ƙasa kaɗan, domin jirgin da ya jinkirta kada ya riƙe na gaba.",
  "advice.cap.full": "{line}: motoci sun cika {share} daga {from} zuwa {to}, {time}",
  "advice.cap.fullMore":
    "Mutane {left} suna saura a baya a wannan lokaci. Layin yana ba da damar har jirage {n} a sa'a kowace alƙibla: a gudanar da yawa, ko a yi amfani da dogayen jirage.",
  "advice.cap.fullLonger":
    "Mutane {left} suna saura a baya a wannan lokaci. A gudanar da yawa idan layin ya yarda, ko a yi amfani da dogayen motoci.",
  "advice.cap.streetPileUp": "{line}: jinkiri yana taruwa a titi kuma har yanzu {late} ne a ƙarshe",
  "advice.cap.streetPileUpFix":
    "Tsara ƙarin lokaci don zagaye ko dogon hutu a tashoshin ƙarshe, domin motoci su cim ma; layi na musamman inda suke haɗuwa da cunkoso ya fi taimakawa.",
  "advice.road.cannotRun": "{line} ba ta iya gudana ba",
  "advice.road.cannotRunFix": "{problem}. Gyara a Ƙirƙira → Hanyar titi, sannan a sake gudanarwa.",
  "advice.road.late": "{line}: kashi {share} kawai na tashi a kan lokaci (shawara ƙasa da {limit})",
  "advice.road.mostlySignals":
    "Kowace tafiya tana rasa minti {signals} a jan fitila da minti {traffic} a cunkoso, don haka yawanci a fitilun da aka lissafa a nan.",
  "advice.road.mostlyTraffic":
    "Kowace tafiya tana rasa minti {traffic} a cunkoso da minti {signals} a jan fitila, don haka yawanci a titunan da aka lissafa a nan.",
  "advice.road.moreTime":
    "Zagayen ya ɗauki minti {run} maimakon minti {planned} da aka tsara: tsara ƙarin lokacin tafiya, ko ƙara mota ɗaya.",
  "advice.road.bunched": "{line}: kashi {share} na tashi suna zuwa a taru",
  "advice.road.bunchedFix":
    "Motoci suna cim ma juna. Riƙe su a tashoshin ƙarshe bisa jadawali, ba su dogon hutu a can, ko ba hanyar layi na musamman inda take rasa lokaci.",
  "advice.road.ranOut": "{line}: motocin da cajinsu ya ƙare: {n}",
  "advice.road.ranOutFix":
    "Yi amfani da babban baturi, yi caji a tashoshin ƙarshe, ko canza motoci a cikin rana.",
  "advice.road.stuck": "{line}: motocin da suka maƙale minti 5 ko fiye: {n}",
  "advice.road.stuckFix":
    "Duba tsarin titi da fitilun hanya a wannan wuri a shafin GIS: wataƙila juyawa ta ɓace, ko cunkoso yana toshe mahaɗar.",
  "advice.road.notBack": "{line}: motocin da ba su koma ma'ajiya ba a ƙarshe: {n}",
  "advice.road.notBackFix":
    "Duba hanya tsakanin layin da ma'ajiyarsa, ko a bar ƙarin lokaci bayan tafiya ta ƙarshe.",
  "advice.road.unnamedStreet": "titi marar suna",
  "advice.road.unnamedJunction": "mahaɗa",
  "advice.road.spot.signal": "Jan fitila, {place}: jimillar minti {min} sun ɓace ({lines})",
  "advice.road.spot.signalFix":
    "Hanyoyin suna jira a nan fiye da ko'ina. Nemi fifiko a gare su a wannan fitila, ko lokutan fitila da suka dace da su. Kwaikwayon hanya bai kwaikwayi fifiko ba tukuna, don haka ba zai iya nuna riba ba.",
  "advice.road.spot.street": "Cunkoso, {place}: jimillar minti {min} sun ɓace ({lines})",
  "advice.road.spot.streetFix":
    "Ba hanyoyin layi na musamman a wannan titi (shafin GIS, tsarin titi: layin bas), ko a bi da su ta wani titi.",
  "advice.road.spot.junction": "Tsayawa, {place}: jimillar minti {min} sun ɓace ({lines})",
  "advice.road.spot.junctionFix":
    "Motoci suna tsaye a cikin wannan mahaɗa, suna jiran juyawa ko hanyar fita ta buɗe. Layi na musamman har zuwa can, ko matakin juyawa na daban a fitilunta, zai taimaka.",
} satisfies AdviceMessages;
