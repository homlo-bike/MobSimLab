import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (ur). */
export const workspaceUiUr = {
  "checks.menu": "جانچیں",
  "checks.menuCount": "جانچیں: {errors} غلطیاں، {warnings} انتباہات",
  "checks.title": "تمام طریقوں کی جانچیں",
  "checks.none": "ابھی جانچنے کو کچھ نہیں۔ کوئی لائن، ریلوے یا ڈپو بنائیں، اس کی جانچیں یہاں نظر آئیں گی۔",
  "checks.lastOpened": "جیسا آخری بار کھولنے پر تھا",
  "checks.streetLine": "سڑک لائن · {name}",
  "checks.railway": "ریلوے",
  "checks.depot": "ڈپو · {name}",
  "undo.undo": "کالعدم کریں",
  "undo.redo": "دوبارہ کریں",
  "tour.checks.title": "جانچیں",
  "tour.checks.body":
    "گھنٹی تمام طریقوں کی جانچیں دکھاتی ہے، پہلے غلطیاں: سڑک لائنیں، ریلوے، ڈپو اور پلگ اِنز کی لائنیں۔ کوئی ایک چنیں تاکہ دیکھ سکیں وہ کہاں ہے۔",
  "settings.serverTab": "سرور",
  "settings.server.local":
    "MobSimLab اس کمپیوٹر پر چل رہا ہے۔ اس کے بجائے آپ اس ایپ کو پس منظر میں چلنے والے MobSimLab سرور سے جوڑ سکتے ہیں، جیسے Docker سرور۔",
  "settings.server.address": "سرور کا پتا",
  "settings.server.connect": "جوڑیں",
  "settings.server.note":
    "ایپ سرور کی جانچ کرتی ہے اور بدلنے سے پہلے پوچھتی ہے۔ اس کمپیوٹر کے پراجیکٹ یہیں رہتے ہیں: انہیں ‎.mslab فائلوں کے طور پر محفوظ کر کے منتقل کریں۔ آپ ایپ کی ترتیبات (⌘, یا Ctrl+,) میں واپس جا سکتے ہیں۔",
} satisfies WorkspaceUiMessages;
