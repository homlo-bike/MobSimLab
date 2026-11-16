import type { PluginKey } from "../plugins";

/** Plugin messages (zu). */
export const pluginsZu = {
  "admin.plugins": "Ama-plugin",
  "plugins.title": "Ama-plugin",
  "plugins.intro":
    "Ama-plugin engeza izindlela zokuthutha, amathuluzi nezibalo. Vula lawo asetshenziswa yile phrojekthi; uma ucisha elilodwa, amathuluzi alo ayafihlwa futhi okudwetshiwe kuyagcinwa.",
  "plugins.bundled": "Iza ne-MobSimLab",
  "plugins.by": "Ngu-{publisher}",
  "plugins.versionN": "Inguqulo {version}",
  "plugins.adds": "Yengeza: {list}",
  "plugins.uses": "Isebenzisa: {list}",
  "plugins.parameters": "Amanani okucabanga angu-{count}",
  "plugins.missing":
    "Inguqulo {version} isusiwe kule MobSimLab. Khetha enye inguqulo ukuze uyisebenzise futhi.",
  "plugins.versionOf": "Inguqulo ka-{name}",
  "plugins.useIn": "Sebenzisa u-{name} kule phrojekthi",
  "plugins.ownerOnly": "Umnikazi wephrojekthi kuphela ongavula noma acishe ama-plugin.",
  "plugins.perm.readNetwork": "inethiwekhi yephrojekthi",
  "plugins.perm.readTimetable": "ishejuli",
  "plugins.perm.readFleet": "izimoto nemikhumbi yezimoto",
  "plugins.perm.readGeodata": "idatha yemephu engenisiwe",
  "plugins.perm.readResults": "imiphumela yokulingisa",
  "plugins.perm.writeResults": "igcina imiphumela yayo",
  "plugins.perm.writeScenario": "iphakamisa izinguquko esimweni",
  "plugins.installTitle": "Faka i-plugin",
  "plugins.installIntro":
    "Layisha ifayela le-.msplugin. I-MobSimLab iyalihlola futhi ikhombise ukuthi lengezani ngaphambi kokulifaka. Ama-plugin afakiwe angengeza izindlela, amathuluzi, amapharamitha nemithombo; lawo anekhodi yawo azofika kamuva.",
  "plugins.choose": "Khetha ifayela le-.msplugin",
  "plugins.problems": "Le plugin ayikwazi ukufakwa:",
  "plugins.install": "Faka",
  "plugins.installed": "Ama-plugin afakiwe",
  "plugins.none": "Alikho i-plugin efakiwe okwamanje.",
  "plugins.removeOne": "Susa u-{name} {version}",
  "plugins.inProjects": "Isetshenziswa kumaphrojekthi angu-{count}",
  "plugins.bundledTitle": "Eza ne-MobSimLab",
  "plugins.keys": "Abashicileli abathembekile",
  "plugins.keysIntro":
    "I-plugin ifakwa kuphela uma umshicileli wayo eyisayine ngesinye salezi zihluthulelo (ECDSA P-256 noma Ed25519, PEM).",
  "plugins.noKeys": "Azikho izihluthulelo ezithembekile okwamanje.",
  "plugins.removeKey": "Yeka ukuthemba u-{name}",
  "plugins.addKey": "Engeza isihluthulelo",
  "plugins.keyName": "Igama lomshicileli",
  "plugins.keyPem": "Isihluthulelo somphakathi",
  "plugins.allowUnsigned": "Vumela ama-plugin angasayiniwe (imodi yokuthuthukisa, abanikazi kuphela)",
  "plugins.signedBy": "Isayinwe ngu-{name}",
  "plugins.untrusted": "Isayinwe ngesihluthulelo esingathenjwa yilesi sistimu",
  "plugins.unsigned": "Ayisayiniwe",
  "plugins.licences": "Amalayisensi: ikhodi {code}, idatha {data}",
  "plugins.removeConfirm":
    "U-{name} uvuliwe kumaphrojekthi angu-{count}. Ususe noma kunjalo? Uzocishwa lapho futhi imidwebo izogcinwa.",
} satisfies Record<PluginKey, string>;
