import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (it). */
export const pluginCodeIt = {
  "pcode.title": "Calcoli dei plugin",
  "pcode.intro": "Calcoli dei plugin installati. Vengono eseguiti in una sandbox nel browser, senza accesso a internet o ad altri progetti.",
  "pcode.by": "{plugin} · di {publisher}",
  "pcode.run": "Calcola",
  "pcode.running": "Calcolo in corso…",
  "pcode.failed": "{plugin} non è riuscito a calcolare: {error}",
  "pcode.noRows": "Nessuna riga.",
  "pcode.log": "Registro del plugin ({count} righe)",
  "pcode.import": "Importa {label} ({plugin})",
  "pcode.export": "Scarica come {label} ({plugin})",
  "pcode.importFailed": "{plugin} non è riuscito a leggere il file: {error}",
  "pcode.exportFailed": "{plugin} non è riuscito a scrivere il file: {error}",
  "pcode.frameTitle": "{tab}, una pagina del plugin {plugin}",
  "pcode.frameNote": "Questa pagina proviene dal plugin {plugin} di {publisher}. Non può accedere a internet né al tuo account.",
  "pcode.runsCode": "Esegue il proprio codice in una sandbox",
  "pcode.limits": "Limiti del codice dei plugin",
  "pcode.limitsIntro": "Ogni chiamata al codice di un plugin riceve al massimo questa memoria e questo tempo, nel browser e sul server.",
  "pcode.memory": "Memoria (MB)",
  "pcode.time": "Tempo (secondi)",
  "pcode.saveLimits": "Salva limiti",
  "pcode.saved": "Salvato.",
  "pcode.installIntro": "Carica un file .msplugin. MobSimLab lo controlla e mostra cosa aggiunge prima di installarlo. I plugin possono aggiungere modi, strumenti, parametri e fonti, ed eseguire il proprio codice (calcoli, importazioni, esportazioni e pagine di scheda) in una sandbox senza accesso a internet.",
} satisfies PluginCodeMessages;
