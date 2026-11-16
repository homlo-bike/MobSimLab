import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (ig). */
export const pluginCodeIg = {
  "pcode.title": "Ngụkọ plugin",
  "pcode.intro":
    "Ngụkọ nke plugin ndị etinyere. Ha na-arụ ọrụ n'ebe nchekwa dịpụrụ adịpụ na ihe nchọgharị gị, na-enweghị ohere ịntanetị ma ọ bụ ọrụ ndị ọzọ.",
  "pcode.by": "{plugin} · site n'aka {publisher}",
  "pcode.run": "Gụọ",
  "pcode.running": "Ọ na-agụ…",
  "pcode.failed": "{plugin} enweghị ike ịgụ: {error}",
  "pcode.noRows": "Enweghị ahịrị.",
  "pcode.log": "Ndekọ plugin (ahịrị {count})",
  "pcode.import": "Bubata {label} ({plugin})",
  "pcode.export": "Budata dị ka {label} ({plugin})",
  "pcode.importFailed": "{plugin} enweghị ike ịgụ faịlụ ahụ: {error}",
  "pcode.exportFailed": "{plugin} enweghị ike ide faịlụ ahụ: {error}",
  "pcode.frameTitle": "{tab}, peeji nke plugin {plugin}",
  "pcode.frameNote":
    "Peeji a si na plugin {plugin} nke {publisher}. Ọ pụghị iru ịntanetị ma ọ bụ akaụntụ gị.",
  "pcode.runsCode": "Na-arụ koodu nke ya n'ebe dịpụrụ adịpụ",
  "pcode.limits": "Oke maka koodu plugin",
  "pcode.limitsIntro":
    "Oku ọ bụla nke koodu plugin na-enweta ebe nchekwa na oge na-agaghị karịa nke a, na ihe nchọgharị na na sava.",
  "pcode.memory": "Ebe nchekwa (MB)",
  "pcode.time": "Oge (sekọnd)",
  "pcode.saveLimits": "Chekwaa oke",
  "pcode.saved": "Echekwala.",
  "pcode.installIntro":
    "Bulite faịlụ .msplugin. MobSimLab na-enyocha ya ma gosi ihe ọ na-agbakwunye tupu ịtinye ya. Plugin nwere ike ịgbakwunye ụzọ njem, ngwaọrụ, paramita na isi mmalite, ma rụọ koodu nke ha (ngụkọ, mbubata, mbupụ na peeji taabụ) n'ebe dịpụrụ adịpụ na-enweghị ịntanetị.",
} satisfies PluginCodeMessages;
