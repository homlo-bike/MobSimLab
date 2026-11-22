<p align="center">
  <img src="docs/images/logo.svg" alt="شعار MobSimLab" width="120" height="120">
</p>

<h1 align="center">MobSimLab</h1>

<p align="center" dir="rtl">Mobility Simulator Lab: تخطيط النقل العام ومحاكاته واختباره.</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.pt.md">Português</a> ·
  <a href="README.zh.md">中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <b>العربية</b> ·
  <a href="README.hi.md">हिन्दी</a>
</p>

<div dir="rtl">

> هذه ترجمة. عند وجود أي اختلاف يُعتمد [ملف README الإنجليزي](README.md). الوثائق المرتبطة باللغة الإنجليزية.

MobSimLab تطبيق ويب مفتوح المصدر يُستضاف ذاتيًا، لتخطيط النقل العام وتحليلات نظم المعلومات الجغرافية ومحاكاة التشغيل. ارسم خطوط الحافلات والترام والمترو والقطارات على بيانات حقيقية للشوارع والتضاريس، واختبر هل تلتزم بمواعيدها وتستوعب ركابها، واعرف كم تكلّف وماذا تحقق وهل يستحق المشروع التنفيذ.

![أداة خطوط الشوارع: خط حافلات سريعة مرسوم على الشوارع، مع طوله ومحطاته وزمن دورته وعدد المركبات اللازمة وموثوقيته في اللوحة الجانبية](docs/images/street-line-editor.png)

## ماذا يفعل

**رسم الشبكة**

- **خطوط الشوارع**: خطوط الحافلات والحافلات السريعة (BRT) وحافلات الترولي والحافلات بين المدن، مسارها على شوارع OpenStreetMap. [الدليل](docs/user/street-line-tool.md)
- **السكك الحديدية**: الترام والقطار الخفيف والمترو وقطارات الضواحي والإقليمية وبين المدن والسريعة، مع المحطات والقضبان والتحويلات والتقاطعات، وكلها بمقياس حقيقي. [الدليل](docs/user/railway-tool.md)
- **المركبات والأسطول**: فهرس مركبات موثّق المصادر، إضافة إلى مركبات المشروع الخاصة وقائمة مركباته الفردية. [الدليل](docs/user/vehicles-and-fleet.md)

**اختبارها**

- **المحاكي**: هل تتسع القضبان لخطوط السكك الحديدية، وهل تلتزم القطارات والحافلات بالمواعيد، وهل تتلاشى التأخيرات الصغيرة، وهل يتسع الجميع في المركبات؟ [الدليل](docs/user/simulator.md)
- **محاكاة الطرق**: تسير خطوط الشوارع وسط حركة المرور باستخدام Eclipse SUMO، من مستودعاتها وإليها، مع إمكانية إعادة العرض. [الدليل](docs/user/road-simulation.md)
- **تشغيل متعدد السنوات**: كل سنة محاكاة (10 افتراضيًا، وحتى 60) تُشغَّل حسب نوع اليوم (يوم عمل، السبت، الأحد، عطلة رسمية) وفق تقويم المشروع ومناخه. [ADR-0020](docs/adr/0020-multi-year-day-types.md)
- **مخطط الرحلات**: زمن الرحلة من الباب إلى الباب من A إلى B على مدار اليوم. [الدليل](docs/user/journey-planner.md)

**تحليلها**

- **المخطط**: الخطوط كخريطة شبكة وكخرائط شريطية لكل خط، مع التصدير إلى SVG أو PNG أو PDF. [الدليل](docs/user/schematic.md)
- **نظم المعلومات الجغرافية**: كيفية تقاسم الشوارع، وتغطية المشي والمسافات بين المحطات، والسكان، والمناطق، وخريطة الضوضاء. [الشوارع](docs/user/gis-streets.md)، [المشي](docs/user/gis-walk.md)، [السكان](docs/user/gis-population.md)، [المناطق](docs/user/gis-regions.md)
- **الجداول**: أرقام الشبكة والأسطول، وجداول المواعيد مع مناوبات المركبات (تنزيل CSV وPDF وGTFS)، والتكاليف، والمنافع، وإيرادات الأجرة، ومقارنة السيناريوهات. [الشبكة](docs/user/network-tables.md)، [التكاليف](docs/user/cost-tables.md)، [المنافع](docs/user/benefit-tables.md)، [الأجرة](docs/user/fare-revenue.md)
- **نموذج الطلب**: توقع ليوم العمل من أربع مراحل (توليد الرحلات، وتوزيعها، واختيار الوسيلة، والتحميل على الشبكة) باستخدام AequilibraE. [الدليل](docs/user/demand-model.md)
- **التقييم**: صافي القيمة الحالية الاقتصادية والمالية، ومعدلات العائد، ونسبة المنفعة إلى التكلفة، والتحليل متعدد المعايير، وتحليل الحساسية، ونطاقات مونت كارلو. [الدليل](docs/user/appraisal.md)

**المشاركة والتوسيع**

- **المشاريع**: شارك مشروعًا مع آخرين، أو اجعله عامًا لكل من سجّل الدخول إلى النسخة، أو احفظه كملف `.mslab`. [ملفات المشروع](docs/user/project-files.md)
- **العارض الثابت**: موقع ويب بلا خادم يعرض المشاريع المحفوظة للقراءة فقط، جاهز لـ Cloudflare Pages. [الدليل](docs/user/static-viewer.md)
- **الإضافات**: تضيف الإضافات المرفقة التلفريك والعبّارات والحافلات حسب الطلب ودراجات الشحن والطاقة والانبعاثات واستيراد GTFS وتصديره وخريطة الضوضاء؛ ويمكن للمسؤولين تثبيت المزيد، وتعمل داخل بيئة معزولة. [الإضافات المرفقة](plugins/README.md)، [كتابة الإضافات](docs/plugins/README.md)
- **وكلاء الذكاء الاصطناعي**: اربط Claude أو أي تطبيق MCP آخر لبناء السيناريوهات وفحصها وفق قاعدة المشي 15 دقيقة. [الدليل](docs/user/ai-agents.md)
- **32 لغة** في التطبيق.

## لقطات الشاشة

| | |
|---|---|
| ![خريطة شبكة تخطيطية بخطوط المترو والقطار الإقليمي والحافلات ومناطق التعرفة ورموز المحطات](docs/images/schematic-network-map.png) | ![جداول المواعيد مع مناوبات المركبات لكل خط ومواعيد انطلاق خط حافلات يوم الأحد](docs/images/timetables.png) |
| **المخطط**: خريطة الشبكة، مع الخرائط الشريطية والتصدير إلى SVG وPNG وPDF | **جداول المواعيد**: مناوبات المركبات ومواعيد الانطلاق حسب نوع اليوم |
| ![ملخص التقييم مع صافي القيمة الحالية ونسبة المنفعة إلى التكلفة ومعدل العائد والمنافع مقابل التكاليف وتوزيع مونت كارلو](docs/images/appraisal.png) | ![خريطة تغطية المشي: بُعد مساكن السكان عن أقرب محطة، من الأخضر إلى الأحمر](docs/images/walk-coverage.png) |
| **التقييم**: هل يستحق المشروع التنفيذ، وما مدى الثقة في النتيجة؟ | **تغطية المشي**: من يسكن على مسافة مشي قصيرة من محطة |
| ![خريطة ضوضاء بمستويات L_den على امتداد خط والمباني المجاورة له](docs/images/noise-map.png) | |
| **خريطة الضوضاء**: L_den وL_night من الخدمة المخططة، مع حجب المباني والتضاريس | |

## البدء السريع

</div>

```bash
deploy/scripts/init-secrets          # random secrets in deploy/secrets (never committed)
cp .env.example .env                 # set MOBSIMLAB_VERSION, MOBSIMLAB_PUBLIC_URL and the OIDC provider
docker compose pull                  # ready-made image from ghcr.io, nothing to build
docker compose up -d                 # two containers: mobsimlab and postgres
open http://localhost:8080
```

<div dir="rtl">

ينشر كل إصدار صورة جاهزة لخوادم Intel/AMD وARM على `ghcr.io/homlo-bike/mobsimlab`، موسومة برقم الإصدار فقط (مثل `2026.11.1-alpha`؛ لا يوجد وسم `latest`). اضبط هذا الإصدار في `MOBSIMLAB_VERSION` داخل `.env` قبل السحب؛ وللتحديث غيّره إلى الإصدار الأحدث وشغّل `docker compose pull && docker compose up -d`. لبناء الصورة بنفسك من هذا المستودع شغّل `docker compose up -d --build`.

تُنشأ الإصدارات بدفع وسم إصدار (`git tag -s v2026.11.1-alpha -m "MobSimLab 2026.11.1-alpha" && git push origin v2026.11.1-alpha`)؛ ويقوم سير العمل **Release image** ببناء الصورة واختبارها سريعًا ونشرها.

### تسجيل الدخول والإعداد الأول

لا يستخدم MobSimLab كلمات مرور محلية؛ يسجّل المستخدمون الدخول عبر مزوّد OpenID Connect (مثل Keycloak وAuthentik وEntra ID وGoogle وغيرها).

1. سجّل MobSimLab لدى مزوّدك كتطبيق ويب. عنوان إعادة التوجيه: `<MOBSIMLAB_PUBLIC_URL>/api/auth/callback`. عنوان إعادة التوجيه بعد الخروج: `<MOBSIMLAB_PUBLIC_URL>/`.
2. ضع عنوان المُصدِر ومعرّف العميل في `.env` (`MOBSIMLAB_OIDC_ISSUER`، `MOBSIMLAB_OIDC_CLIENT_ID`). إذا أعطاك المزوّد سرّ عميل، فالصقه في `deploy/secrets/oidc_client_secret`.
3. شغّل الحاويات. تبدأ النسخة في **وضع الإعداد**: أول شخص يسجّل الدخول يصبح **Owner**، ويُرفض الجميع حتى يضغط الـ Owner على **Finish setup**. لتحديد هذا الشخص الأول، اضبط `MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL` (بريد إلكتروني تحقق منه المزوّد) أو `MOBSIMLAB_BOOTSTRAP_OWNER_SUBJECT`.
4. بعد الإعداد ينتظر المستخدمون الجدد الموافقة (التسجيل التلقائي معطّل افتراضيًا). يتولى الـ Owners والـ Admins ذلك من **Administration** في قائمة الحساب: قبول الأشخاص أو رفضهم، وتغيير الأدوار (Restricted يعلّق الحساب دون حذفه)، وضبط قواعد التسجيل (التسجيل التلقائي ونطاقات البريد ومجموعات IdP المسموح بها)، وربط مجموعات IdP بالأدوار. لا يستطيع إنشاء Owners أو Admins إلا Owner، ولا يمكن إزالة آخر Owner.
5. خلف وكيل عكسي يستخدم TLS، اضبط `MOBSIMLAB_TRUSTED_PROXIES` على عنوان الوكيل كي ترى حدود محاولات تسجيل الدخول (10 في الدقيقة لكل عميل افتراضيًا) وسجلات التدقيق عنوان العميل الحقيقي.

**وكلاء الذكاء الاصطناعي:** يمكن للـ Owners والـ Admins والـ Editors ربط Claude أو تطبيق MCP آخر على `<MOBSIMLAB_PUBLIC_URL>/mcp`. يجب أن تكون النسخة قابلة للوصول عبر HTTPS من تطبيق الذكاء الاصطناعي، وأن يكون `MOBSIMLAB_PUBLIC_URL` هو العنوان الذي يستخدمه التطبيق. راجع [docs/user/ai-agents.md](docs/user/ai-agents.md).

**العارض الثابت:** يبني `pnpm build:static` موقع القراءة فقط. راجع [docs/user/static-viewer.md](docs/user/static-viewer.md).

فقدت حساب الـ Owner؟ شغّل `docker compose exec mobsimlab /app/bin/mobsimlab admin reset-owner`. يخفّض هذا الأمر الـ Owner الحالي إلى Admin، ويسجّل خروجه، ويعيد النسخة إلى وضع الإعداد، ويسجّل العملية في سجل التدقيق.

## الوثائق

- [البنية](docs/architecture/README.md)، [الافتراضات التي خضعت للمراجعة](docs/architecture/00-challenged-assumptions.md)، [سجلات القرارات المعمارية](docs/adr/README.md)
- تقارير إثبات المفهوم: [S1 المحاكاة المشتركة](docs/spikes/s1-cosimulation.md)، [S2 أداء نواة السكك الحديدية](docs/spikes/s2-rail-kernel-performance.md)، [S3 استيراد OSM](docs/spikes/s3-osm-import.md)

## المساهمة

اقرأ أولًا [CONTRIBUTING.md](CONTRIBUTING.md) والتزم [بمدونة السلوك](CODE_OF_CONDUCT.md). أبلغ عن مشكلات الأمان كما هو موضح في [SECURITY.md](SECURITY.md). يعرض [ACCESSIBILITY.md](ACCESSIBILITY.md) هدف إمكانية الوصول والقيود المعروفة.

## الترخيص

الشيفرة مرخّصة بموجب [GNU Affero General Public License الإصدار 3.0 أو أحدث](LICENSE). فهرس المركبات ومكتبة الافتراضات والوثائق مرخّصة بموجب CC BY 4.0.

</div>
