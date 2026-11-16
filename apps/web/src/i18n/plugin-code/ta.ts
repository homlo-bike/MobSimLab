import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (ta). */
export const pluginCodeTa = {
  "pcode.title": "செருகுநிரல் கணக்கீடுகள்",
  "pcode.intro":
    "நிறுவப்பட்ட செருகுநிரல்களின் கணக்கீடுகள். இவை உங்கள் உலாவியில் ஒரு தனிமைச் சூழலில் இயங்குகின்றன, இணையம் அல்லது பிற திட்டங்களுக்கு அணுகல் இல்லாமல்.",
  "pcode.by": "{plugin} · {publisher} வழங்கியது",
  "pcode.run": "கணக்கிடு",
  "pcode.running": "கணக்கிடுகிறது…",
  "pcode.failed": "{plugin} கணக்கிட முடியவில்லை: {error}",
  "pcode.noRows": "வரிசைகள் இல்லை.",
  "pcode.log": "செருகுநிரல் பதிவு ({count} வரிகள்)",
  "pcode.import": "{label} இறக்குமதி ({plugin})",
  "pcode.export": "{label} ஆகப் பதிவிறக்கு ({plugin})",
  "pcode.importFailed": "{plugin} கோப்பைப் படிக்க முடியவில்லை: {error}",
  "pcode.exportFailed": "{plugin} கோப்பை எழுத முடியவில்லை: {error}",
  "pcode.frameTitle": "{tab}, {plugin} செருகுநிரலின் ஒரு பக்கம்",
  "pcode.frameNote":
    "இந்தப் பக்கம் {publisher} வழங்கிய {plugin} செருகுநிரலிலிருந்து வருகிறது. இது இணையத்தையோ உங்கள் கணக்கையோ அணுக முடியாது.",
  "pcode.runsCode": "தன் சொந்தக் குறியீட்டைத் தனிமைச் சூழலில் இயக்குகிறது",
  "pcode.limits": "செருகுநிரல் குறியீட்டின் வரம்புகள்",
  "pcode.limitsIntro":
    "செருகுநிரல் குறியீட்டின் ஒவ்வொரு அழைப்பும் உலாவியிலும் சேவையகத்திலும் அதிகபட்சம் இவ்வளவு நினைவகமும் நேரமும் பெறும்.",
  "pcode.memory": "நினைவகம் (MB)",
  "pcode.time": "நேரம் (விநாடிகள்)",
  "pcode.saveLimits": "வரம்புகளைச் சேமி",
  "pcode.saved": "சேமிக்கப்பட்டது.",
  "pcode.installIntro":
    ".msplugin கோப்பைப் பதிவேற்றவும். MobSimLab அதைச் சரிபார்த்து, நிறுவும் முன் அது எதைச் சேர்க்கிறது என்று காட்டும். செருகுநிரல்கள் போக்குவரத்து முறைகள், கருவிகள், அளவுருக்கள், மூலங்களைச் சேர்க்கலாம்; தங்கள் சொந்தக் குறியீட்டை (கணக்கீடுகள், இறக்குமதி, ஏற்றுமதி, தாவல் பக்கங்கள்) இணையம் இல்லாத தனிமைச் சூழலில் இயக்கலாம்.",
} satisfies PluginCodeMessages;
