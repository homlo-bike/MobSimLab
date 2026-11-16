import type { GeodataMessages } from "./en";

/** Map data view messages (fa). */
export const geodataFa = {
  "gis.dataView": "داده‌های نقشه",
  "data.title": "داده‌های نقشه",
  "data.intro":
    "OpenStreetMap و ارتفاع برای این پروژه، که همراه پروژه نگه داشته می‌شوند. ابزارهای خیابان، راه‌آهن، ساختمان، آب و زمین به جای پرسیدن هر باره از OpenStreetMap و سرور ارتفاع، این‌ها را می‌خوانند.",
  "data.noArea":
    "اول چیزی در پروژه بکشید: درون‌ریزی مستطیل دور همه چیزهای کشیده‌شده را به‌اضافهٔ یک حاشیه پوشش می‌دهد.",
  "data.area": "محدوده: {area} کیلومتر مربع، مستطیل دور همه چیزهای کشیده‌شده به‌اضافهٔ {buffer} کیلومتر",
  "data.osm": "OpenStreetMap",
  "data.dem": "ارتفاع",
  "data.notImported": "هنوز درون‌ریزی نشده.",
  "data.imported": "درون‌ریزی‌شده در {date}",
  "data.dataDate": "داده‌های {date}",
  "data.outside":
    "نقشه اکنون از محدودهٔ درون‌ریزی‌شده بیرون می‌زند. برای درون‌ریزی محدودهٔ تازه، به‌روزرسانی کنید.",
  "data.method": "گرفتن داده از",
  "data.method.overpass": "Overpass (محدوده‌ها تا {max} کیلومتر مربع)",
  "data.method.geofabrik": "یک منطقهٔ Geofabrik",
  "data.method.upload": "یک فایل ‎.osm.pbf",
  "data.region": "منطقه",
  "data.regionsLoading": "در حال جستجوی مناطق…",
  "data.noRegions": "هیچ منطقهٔ Geofabrik کل محدوده را در بر نمی‌گیرد.",
  "data.planned": "نگه داشتن راه‌های برنامه‌ریزی‌شده (پیشنهادی و در دست ساخت)",
  "data.import": "درون‌ریزی",
  "data.refresh": "به‌روزرسانی",
  "data.chooseFile": "یک فایل ‎.osm.pbf انتخاب کنید (تا {max} مگابایت)",
  "data.cancel": "لغو",
  "data.queued": "در انتظار پایان یک درون‌ریزی دیگر…",
  "data.step.download": "در حال دانلود…",
  "data.step.downloadN": "در حال دانلود {done} از {total}…",
  "data.step.merge": "در حال پیوستن کاشی‌ها…",
  "data.step.extract": "در حال بریدن محدودهٔ پروژه…",
  "data.step.database": "در حال نوشتن در پایگاه داده…",
  "data.failed": "آخرین درون‌ریزی ناموفق بود: {error}",
  "data.cancelled": "آخرین درون‌ریزی لغو شد.",
  "data.counts": "{roads} خیابان، {rails} ریل، {buildings} ساختمان، {stops} ایستگاه",
  "data.demFacts": "Copernicus GLO-30، شبکهٔ {res} متری، ارتفاع با دقت ±{acc} متر",
  "data.demNoData": "{n} خانهٔ ۱ درجه‌ای محدوده دادهٔ ارتفاع ندارند (دریای آزاد).",
  "data.tooLarge":
    "محدوده {area} کیلومتر مربع است، بیش از آنچه Overpass پوشش می‌دهد. یک منطقهٔ Geofabrik انتخاب کنید یا فایلی بارگذاری کنید.",
  "data.readOnly": "مالکان و ویرایشگران می‌توانند داده درون‌ریزی کنند.",
  "data.licence": "© OpenStreetMap contributors, ODbL 1.0",
} satisfies GeodataMessages;
