import type { AdviceMessages } from "./en";

/** Advice messages (sw). */
export const adviceSw = {
  "advice.title": "Cha kuboresha",
  "advice.intro":
    "Matatizo ambayo mwendesho huu ulipata, kubwa zaidi kwanza, na unachoweza kufanya kwa kila moja.",
  "advice.none": "Hakuna cha kuboresha: mwendesho huu haukupata kizuizi wala tatizo.",
  "advice.show": "Onyesha kwenye ramani",
  "advice.more": "{n} zaidi hazijaonyeshwa.",
  "advice.severity.problem": "Tatizo",
  "advice.severity.warning": "Onyo",
  "advice.crowdMap":
    "Onyesha kwenye ramani jinsi magari yalivyojaa (saa yenye shughuli nyingi zaidi ya kila njia)",
  "advice.cap.stopped": "{line}: mwendesho ulisimama: {problem}",
  "advice.cap.stoppedFix": "Rekebisha hili katika zana ya reli, kisha endesha jaribio tena.",
  "advice.cap.unplaced": "{line}: safari zisizotosha kwenye reli: {n}",
  "advice.cap.unplacedFix":
    "Endesha njia mara chache zaidi katika kipindi hiki, au wape treni zake nafasi zaidi zinapokutana: njia zaidi za jukwaa au vivuko katika {terminal}, au kitanzi cha kupishana kwenye reli moja.",
  "advice.cap.terminal":
    "{line}: kituo cha mwisho {terminal} ndicho kizuizi, kinatumika {share} ya saa yenye shughuli nyingi zaidi (kikomo {limit})",
  "advice.cap.terminalFix":
    "Treni zinashikilia majukwaa yake kwa muda mrefu mno. Fupisha mgeuko (kituo kifupi, au dereva anayesubiri kila upande), ongeza njia ya jukwaa, au sogeza kivuko karibu na majukwaa ili treni zikiache mapema.",
  "advice.cap.section":
    "{line}: sehemu ya reli {section} ndiyo kizuizi, inatumika {share} ya saa yenye shughuli nyingi zaidi (kikomo {limit})",
  "advice.cap.sectionFix":
    "Treni zinashikilia sehemu hii kwa muda mrefu kuliko nyingine yoyote. Kasi kubwa zaidi ndani yake huziwezesha kuiacha mapema; vinginevyo endesha treni chache hapa.",
  "advice.cap.sectionPlatform":
    "Sehemu hii ni njia ya jukwaa: treni huishikilia zikiwa zimesimama jukwaani. Vituo vifupi hapo, au njia ya pili ya jukwaa kwa upande huu, huingiza treni inayofuata mapema.",
  "advice.cap.sectionSwitches":
    "Sehemu hii ni eneo la swichi: treni huishikilia wakati njia yao kupitia swichi inawekwa na kuachiliwa. Swichi zenye kasi kubwa upande wa kugeuka, au swichi zilizowekwa ili pande mbili zisikatane, huiacha wazi mapema.",
  "advice.cap.signalAdd":
    "Sehemu hii ya njia wazi ina urefu wa m {length}, lakini kizuizi (block) kwa km/h {speed} kinahitaji m {block} tu. Ongeza ishara ya kizuizi karibu m {at} kwenye reli {track}, ili treni inayofuata iingie nusu ya kwanza mapema.",
  "advice.cap.signalShort":
    "Sehemu hii ina urefu wa m {length}, chini ya vizuizi viwili vya m {block} kwa km/h {speed}, kwa hivyo ishara nyingine ingeacha nafasi ndogo mno ya kusimama. Treni zinaweza kufuatana karibu zaidi kwa uashiriaji wa kabini (CBTC au ETCS kiwango cha 2), au kwa kasi ndogo hapa.",
  "advice.cap.sectionCab":
    "Kwa uashiriaji wa kabini treni tayari zinafuatana kwa umbali wa kufunga breki (m {block} kwa km/h {speed}); ishara haziamui nafasi. Kasi kubwa zaidi katika sehemu, au treni chache, huiacha wazi mapema.",
  "advice.cap.sectionSight":
    "Tramu hapa huendeshwa kwa kuona, kwa hivyo ishara haziamui nafasi. Vituo vifupi karibu, au njia yao wenyewe mbali na msongamano wa barabarani, huiacha wazi mapema.",
  "advice.cap.nearNote": "Bado inafanya kazi, lakini hakuna nafasi kubwa ya kuongeza treni.",
  "advice.cap.pileUp": "{line}: ucheleweshaji unalimbikizana na bado ni wastani wa {late} kipindi kinapoisha",
  "advice.cap.pileUpFix":
    "Ongeza muda wa kurejesha kwenye vituo vya mwisho, au endesha mara chache kidogo, ili treni iliyochelewa isizuie inayofuata.",
  "advice.cap.full": "{line}: magari yamejaa {share} kutoka {from} hadi {to}, {time}",
  "advice.cap.fullMore":
    "Watu {left} wanabaki nyuma katika kipindi hiki. Reli inaruhusu hadi treni {n} kwa saa kila upande: endesha mara nyingi zaidi, au tumia treni ndefu zaidi.",
  "advice.cap.fullLonger":
    "Watu {left} wanabaki nyuma katika kipindi hiki. Endesha mara nyingi zaidi ikiwa reli inaruhusu, au tumia magari marefu zaidi.",
  "advice.cap.streetPileUp": "{line}: ucheleweshaji unalimbikizana barabarani na bado ni {late} mwishoni",
  "advice.cap.streetPileUpFix":
    "Panga muda zaidi wa mzunguko au mapumziko marefu kwenye vituo vya mwisho, ili magari yafidie; njia maalum mahali yanapokutana na msongamano husaidia zaidi.",
  "advice.road.cannotRun": "{line} haikuweza kuendeshwa",
  "advice.road.cannotRunFix": "{problem}. Rekebisha katika Unda → Njia ya barabarani, kisha endesha tena.",
  "advice.road.late": "{line}: ni {share} tu ya kuondoka kwa wakati (ushauri chini ya {limit})",
  "advice.road.mostlySignals":
    "Kila safari inapoteza dak {signals} kwenye taa nyekundu na dak {traffic} kwenye msongamano, kwa hivyo nyingi kwenye taa zilizoorodheshwa hapa.",
  "advice.road.mostlyTraffic":
    "Kila safari inapoteza dak {traffic} kwenye msongamano na dak {signals} kwenye taa nyekundu, kwa hivyo nyingi kwenye barabara zilizoorodheshwa hapa.",
  "advice.road.moreTime":
    "Mzunguko ulichukua dak {run} badala ya dak {planned} zilizopangwa: panga muda zaidi wa kusafiri, au ongeza gari moja.",
  "advice.road.bunched": "{line}: {share} ya kuondoka huja kwa kurundikana",
  "advice.road.bunchedFix":
    "Magari yanafikiana. Yazuie kwenye vituo vya mwisho kulingana na ratiba, yape mapumziko marefu hapo, au ipe njia njia maalum mahali inapopoteza muda.",
  "advice.road.ranOut": "{line}: magari yaliyoishiwa chaji: {n}",
  "advice.road.ranOutFix":
    "Tumia betri kubwa zaidi, chaji kwenye vituo vya mwisho, au badilisha magari wakati wa mchana.",
  "advice.road.stuck": "{line}: magari yaliyokwama dakika 5 au zaidi: {n}",
  "advice.road.stuckFix":
    "Kagua mpangilio wa barabara na taa za mahali hapa kwenye kichupo cha GIS: huenda mgeuko unakosekana, au msongamano unazuia makutano.",
  "advice.road.notBack": "{line}: magari ambayo hayakurudi bohari mwishoni: {n}",
  "advice.road.notBackFix":
    "Kagua njia kati ya laini na bohari yake, au acha muda zaidi baada ya safari ya mwisho.",
  "advice.road.unnamedStreet": "barabara isiyo na jina",
  "advice.road.unnamedJunction": "makutano",
  "advice.road.spot.signal": "Taa nyekundu, {place}: jumla dak {min} zimepotea ({lines})",
  "advice.road.spot.signalFix":
    "Njia zinasubiri hapa kuliko mahali pengine popote. Ombea kipaumbele kwao kwenye taa hii, au muda wa taa unaowafaa. Uigaji wa barabara bado hauigi kipaumbele, kwa hivyo hauwezi kuonyesha faida.",
  "advice.road.spot.street": "Msongamano, {place}: jumla dak {min} zimepotea ({lines})",
  "advice.road.spot.streetFix":
    "Zipe njia njia maalum kwenye barabara hii (kichupo cha GIS, mpangilio wa barabara: njia ya basi), au zipitishe barabara nyingine.",
  "advice.road.spot.junction": "Kusimama, {place}: jumla dak {min} zimepotea ({lines})",
  "advice.road.spot.junctionFix":
    "Magari husimama ndani ya makutano haya, yakisubiri kugeuka au njia ya kutoka iwe wazi. Njia maalum hadi hapo, au awamu tofauti ya kugeuka kwenye taa zake, husaidia.",
} satisfies AdviceMessages;
