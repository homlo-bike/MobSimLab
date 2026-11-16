import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (ur). */
export const pluginCodeUr = {
  "pcode.title": "پلگ اِن حسابات",
  "pcode.intro":
    "انسٹال شدہ پلگ اِنز کے حسابات۔ یہ آپ کے براؤزر میں ایک الگ تھلگ ماحول میں چلتے ہیں، انٹرنیٹ یا دوسرے منصوبوں تک رسائی کے بغیر۔",
  "pcode.by": "{plugin} · از {publisher}",
  "pcode.run": "حساب کریں",
  "pcode.running": "حساب ہو رہا ہے…",
  "pcode.failed": "{plugin} حساب نہیں کر سکا: {error}",
  "pcode.noRows": "کوئی قطار نہیں۔",
  "pcode.log": "پلگ اِن لاگ ({count} سطریں)",
  "pcode.import": "{label} درآمد کریں ({plugin})",
  "pcode.export": "{label} کے طور پر ڈاؤن لوڈ کریں ({plugin})",
  "pcode.importFailed": "{plugin} فائل نہیں پڑھ سکا: {error}",
  "pcode.exportFailed": "{plugin} فائل نہیں لکھ سکا: {error}",
  "pcode.frameTitle": "{tab}، پلگ اِن {plugin} کا ایک صفحہ",
  "pcode.frameNote":
    "یہ صفحہ {publisher} کے پلگ اِن {plugin} سے ہے۔ یہ انٹرنیٹ یا آپ کے اکاؤنٹ تک نہیں پہنچ سکتا۔",
  "pcode.runsCode": "اپنا کوڈ الگ تھلگ ماحول میں چلاتا ہے",
  "pcode.limits": "پلگ اِن کوڈ کی حدیں",
  "pcode.limitsIntro":
    "پلگ اِن کوڈ کی ہر کال کو براؤزر اور سرور پر زیادہ سے زیادہ اتنی میموری اور وقت ملتا ہے۔",
  "pcode.memory": "میموری (MB)",
  "pcode.time": "وقت (سیکنڈ)",
  "pcode.saveLimits": "حدیں محفوظ کریں",
  "pcode.saved": "محفوظ ہو گیا۔",
  "pcode.installIntro":
    "‎.msplugin فائل اپ لوڈ کریں۔ MobSimLab اسے جانچتا ہے اور انسٹال سے پہلے دکھاتا ہے کہ یہ کیا شامل کرتی ہے۔ پلگ اِنز نقل و حمل کے طریقے، اوزار، پیرامیٹر اور ماخذ شامل کر سکتے ہیں اور اپنا کوڈ (حسابات، درآمد، برآمد اور ٹیب صفحات) انٹرنیٹ کے بغیر الگ تھلگ ماحول میں چلا سکتے ہیں۔",
} satisfies PluginCodeMessages;
