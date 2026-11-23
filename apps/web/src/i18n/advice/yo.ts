import type { AdviceMessages } from "./en";

/** Advice messages (yo). */
export const adviceYo = {
  "advice.title": "Ohun tí a lè mú dára sí i",
  "advice.intro": "Àwọn ìṣòro tí ìṣiṣẹ́ yìí rí, èyí tó burú jù lọ ní àkọ́kọ́, àti ohun tí o lè ṣe nípa ọ̀kọ̀ọ̀kan.",
  "advice.none": "Kò sí ohun tí a lè mú dára sí i: ìṣiṣẹ́ yìí kò rí ìdènà tàbí ìṣòro kankan.",
  "advice.show": "Fihàn lórí máàpù",
  "advice.more": "{n} mìíràn kò hàn.",
  "advice.severity.problem": "Ìṣòro",
  "advice.severity.warning": "Ìkìlọ̀",
  "advice.crowdMap": "Fihàn lórí máàpù bí àwọn ọkọ̀ ṣe kún tó (wákàtí tó kún jù lọ ti ọ̀nà kọ̀ọ̀kan)",
  "advice.cap.stopped": "{line}: ìṣiṣẹ́ dúró: {problem}",
  "advice.cap.stoppedFix": "Ṣàtúnṣe èyí nínú irinṣẹ́ ojú-irin, lẹ́yìn náà tún ṣe ìdánwò náà.",
  "advice.cap.unplaced": "{line}: àwọn ìrìn tí kò bá ojú-irin mu: {n}",
  "advice.cap.unplacedFix":
    "Jẹ́ kí ọ̀nà náà máa lọ díẹ̀ ní àkókò yìí, tàbí fún àwọn ọkọ̀ ojú-irin rẹ̀ ní àyè púpọ̀ sí i níbi tí wọ́n ti ń pàdé: àwọn ojú-irin pèpéle tàbí ìkọjá púpọ̀ sí i ní {terminal}, tàbí ibi ìkọjá lórí ojú-irin kan ṣoṣo.",
  "advice.cap.terminal":
    "{line}: ibùdó ìparí {terminal} ni ìdènà, a ń lò ó {share} nínú wákàtí tó kún jù lọ (ààlà {limit})",
  "advice.cap.terminalFix":
    "Àwọn ọkọ̀ ojú-irin ń gba pèpéle rẹ̀ pẹ́ jù. Dín ìyípadà kù (ìdúró kúkúrú, tàbí awakọ̀ tó ń dúró ní òpin kọ̀ọ̀kan), fi ojú-irin pèpéle kan kún un, tàbí sún ìkọjá náà súnmọ́ pèpéle kí àwọn ọkọ̀ lè fi í sílẹ̀ kíákíá.",
  "advice.cap.section":
    "{line}: apá ojú-irin {section} ni ìdènà, a ń lò ó {share} nínú wákàtí tó kún jù lọ (ààlà {limit})",
  "advice.cap.sectionFix":
    "Àwọn ọkọ̀ ojú-irin ń gba apá yìí pẹ́ ju èyíkéyìí mìíràn lọ. Ìyára tó ga jù nínú rẹ̀ yóò jẹ́ kí wọ́n fi í sílẹ̀ kíákíá; bí bẹ́ẹ̀ kọ́, dín àwọn ọkọ̀ kù níbí.",
  "advice.cap.sectionPlatform":
    "Apá yìí jẹ́ ojú-irin pèpéle: àwọn ọkọ̀ ń gbà á nígbà tí wọ́n dúró ní pèpéle. Ìdúró kúkúrú níbẹ̀, tàbí ojú-irin pèpéle kejì fún ìhà yìí, yóò jẹ́ kí ọkọ̀ tó kàn wọlé kíákíá.",
  "advice.cap.sectionSwitches":
    "Apá yìí jẹ́ agbègbè ìyípadà-ọ̀nà: àwọn ọkọ̀ ń gbà á nígbà tí a ń ṣètò tí a sì ń tú ọ̀nà wọn kọjá àwọn ìyípadà-ọ̀nà. Ìyípadà-ọ̀nà tó ní ìyára gíga ní ẹ̀ka yíyà, tàbí èyí tí a gbé kalẹ̀ kí àwọn ìhà méjèèjì má gé ara wọn, yóò tú u sílẹ̀ kíákíá.",
  "advice.cap.signalAdd":
    "Apá ọ̀nà gbangba yìí gùn tó m {length}, ṣùgbọ́n block kan ní km/h {speed} nílò m {block} péré. Fi àmì block kan sí nǹkan bí m {at} lórí ojú-irin {track}, kí ọkọ̀ tó kàn lè wọ ìdajì àkọ́kọ́ kíákíá.",
  "advice.cap.signalShort":
    "Apá yìí gùn tó m {length}, kò tó block méjì ti m {block} ní km/h {speed}, nítorí náà àmì mìíràn yóò fi àyè díẹ̀ jù sílẹ̀ fún ìdúró. Àwọn ọkọ̀ lè tẹ̀lé ara wọn ní ìsúnmọ́ pẹ̀lú àmì inú ọkọ̀ (CBTC tàbí ETCS ìpele 2), tàbí pẹ̀lú ìyára tó kéré níbí.",
  "advice.cap.sectionCab":
    "Pẹ̀lú àmì inú ọkọ̀, àwọn ọkọ̀ ti ń tẹ̀lé ara wọn ní ìjìnnà bíréèkì (m {block} ní km/h {speed}); kì í ṣe àwọn àmì ló ń pinnu àlàfo. Ìyára gíga nínú apá náà, tàbí ọkọ̀ díẹ̀, yóò tú u sílẹ̀ kíákíá.",
  "advice.cap.sectionSight":
    "Àwọn tram ń lọ níbí nípa rírí, nítorí náà kì í ṣe àwọn àmì ló ń pinnu àlàfo. Ìdúró kúkúrú nítòsí, tàbí ojú-irin tiwọn tó jìnnà sí ìrìnnà òpópónà, yóò tú u sílẹ̀ kíákíá.",
  "advice.cap.nearNote": "Ó ṣì ń ṣiṣẹ́, ṣùgbọ́n àyè díẹ̀ ló kù láti fi ọkọ̀ kún un.",
  "advice.cap.pileUp": "{line}: ìdádúró ń kó jọ, ó sì ṣì jẹ́ {late} ní àròpín nígbà tí àkókò bá parí",
  "advice.cap.pileUpFix":
    "Fi àkókò ìmúpadàbọ̀sípò kún un ní àwọn ibùdó ìparí, tàbí máa lọ díẹ̀ díẹ̀, kí ọkọ̀ tó pẹ́ má bàa dá èyí tó kàn dúró.",
  "advice.cap.full": "{line}: àwọn ọkọ̀ kún {share} láti {from} sí {to}, {time}",
  "advice.cap.fullMore":
    "Ènìyàn {left} ló ń kù sẹ́yìn ní àkókò yìí. Ojú-irin gba tó ọkọ̀ {n} láàárín wákàtí kan ní ìhà kọ̀ọ̀kan: máa lọ lóòrèkóòrè, tàbí lo ọkọ̀ ojú-irin tó gùn jù.",
  "advice.cap.fullLonger":
    "Ènìyàn {left} ló ń kù sẹ́yìn ní àkókò yìí. Máa lọ lóòrèkóòrè bí ojú-irin bá gbà á, tàbí lo àwọn ọkọ̀ tó gùn jù.",
  "advice.cap.streetPileUp": "{line}: ìdádúró ń kó jọ ní òpópónà, ó sì ṣì jẹ́ {late} ní ìparí",
  "advice.cap.streetPileUpFix":
    "Ṣètò àkókò púpọ̀ sí i fún yíyípo tàbí ìsinmi gígùn ní àwọn ibùdó ìparí, kí àwọn ọkọ̀ lè bá a; ọ̀nà àdáni níbi tí wọ́n ti ń pàdé ìrìnnà ló ń ràn lọ́wọ́ jù.",
  "advice.road.cannotRun": "{line} kò lè ṣiṣẹ́",
  "advice.road.cannotRunFix": "{problem}. Ṣàtúnṣe rẹ̀ ní Ṣẹ̀dá → Ọ̀nà òpópónà, lẹ́yìn náà tún ṣe é.",
  "advice.road.late": "{line}: {share} péré nínú ìgbéra ló wà ní àkókò (ìmọ̀ràn nísàlẹ̀ {limit})",
  "advice.road.mostlySignals":
    "Ìrìn kọ̀ọ̀kan ń pàdánù ìṣẹ́jú {signals} ní iná pupa àti ìṣẹ́jú {traffic} nínú ìrìnnà, nítorí náà èyí tó pọ̀ jù wà ní àwọn iná ìrìnnà tí a kọ síbí.",
  "advice.road.mostlyTraffic":
    "Ìrìn kọ̀ọ̀kan ń pàdánù ìṣẹ́jú {traffic} nínú ìrìnnà àti ìṣẹ́jú {signals} ní iná pupa, nítorí náà èyí tó pọ̀ jù wà ní àwọn òpópónà tí a kọ síbí.",
  "advice.road.moreTime":
    "Yíyípo gba ìṣẹ́jú {run} dípò ìṣẹ́jú {planned} tí a gbèrò: ṣètò àkókò ìrìn púpọ̀ sí i, tàbí fi ọkọ̀ kan kún un.",
  "advice.road.bunched": "{line}: {share} nínú ìgbéra ń dé ní ìkójọpọ̀",
  "advice.road.bunchedFix":
    "Àwọn ọkọ̀ ń bá ara wọn. Dá wọn dúró ní àwọn ibùdó ìparí gẹ́gẹ́ bí àkókò, fún wọn ní ìsinmi gígùn níbẹ̀, tàbí fún ọ̀nà náà ní ọ̀nà àdáni níbi tí ó ti ń pàdánù àkókò.",
  "advice.road.ranOut": "{line}: àwọn ọkọ̀ tí agbára wọn tán: {n}",
  "advice.road.ranOutFix": "Lo bátìrì tó tóbi jù, gba agbára ní àwọn ibùdó ìparí, tàbí pààrọ̀ ọkọ̀ ní ọ̀sán.",
  "advice.road.stuck": "{line}: àwọn ọkọ̀ tó há fún ìṣẹ́jú 5 tàbí jù bẹ́ẹ̀ lọ: {n}",
  "advice.road.stuckFix":
    "Ṣàyẹ̀wò ètò òpópónà àti iná ìrìnnà ní ibí yìí nínú táàbù GIS: ó lè jẹ́ pé ìyíkọ̀ kan kò sí, tàbí ìrìnnà ń dí ìkóríta.",
  "advice.road.notBack": "{line}: àwọn ọkọ̀ tí kò padà sí ibùdó ní ìparí: {n}",
  "advice.road.notBackFix":
    "Ṣàyẹ̀wò ọ̀nà láàárín ọ̀nà-ọkọ̀ náà àti ibùdó rẹ̀, tàbí fi àkókò púpọ̀ sílẹ̀ lẹ́yìn ìrìn ìkẹyìn.",
  "advice.road.unnamedStreet": "òpópónà tí kò ní orúkọ",
  "advice.road.unnamedJunction": "ìkóríta kan",
  "advice.road.spot.signal": "Iná pupa, {place}: ìṣẹ́jú {min} ló sọnù lápapọ̀ ({lines})",
  "advice.road.spot.signalFix":
    "Àwọn ọ̀nà náà ń dúró níbí ju ibikíbi lọ. Béèrè àǹfààní ìṣáájú fún wọn ní iná yìí, tàbí àkókò iná tó bá wọn mu. Ìṣàfarawé ọ̀nà kò tíì ṣàfihàn àǹfààní ìṣáájú, nítorí náà kò lè fi èrè rẹ̀ hàn.",
  "advice.road.spot.street": "Ìrìnnà, {place}: ìṣẹ́jú {min} ló sọnù lápapọ̀ ({lines})",
  "advice.road.spot.streetFix":
    "Fún àwọn ọ̀nà náà ní ọ̀nà àdáni lórí òpópónà yìí (táàbù GIS, ètò òpópónà: ọ̀nà bọ́ọ̀sì), tàbí darí wọn gba òpópónà mìíràn.",
  "advice.road.spot.junction": "Ìdúró, {place}: ìṣẹ́jú {min} ló sọnù lápapọ̀ ({lines})",
  "advice.road.spot.junctionFix":
    "Àwọn ọkọ̀ ń dúró nínú ìkóríta yìí, wọ́n ń dúró láti yíkọ̀ tàbí kí ọ̀nà àbájáde ṣí. Ọ̀nà àdáni títí dé ibẹ̀, tàbí ìpele ìyíkọ̀ ọ̀tọ̀ ní iná rẹ̀, ń ràn lọ́wọ́.",
} satisfies AdviceMessages;
