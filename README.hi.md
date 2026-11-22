<p align="center">
  <img src="docs/images/logo.svg" alt="MobSimLab का लोगो" width="120" height="120">
</p>

<h1 align="center">MobSimLab</h1>

<p align="center">Mobility Simulator Lab: सार्वजनिक परिवहन की योजना, सिमुलेशन और परीक्षण।</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.pt.md">Português</a> ·
  <a href="README.zh.md">中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ar.md">العربية</a> ·
  <b>हिन्दी</b>
</p>

> यह एक अनुवाद है। किसी अंतर की स्थिति में [अंग्रेज़ी README](README.md) मान्य है। लिंक किए गए दस्तावेज़ अंग्रेज़ी में हैं।

MobSimLab सार्वजनिक परिवहन योजना, GIS विश्लेषण और संचालन सिमुलेशन के लिए एक ओपन-सोर्स, सेल्फ-होस्टेड वेब ऐप है। असली सड़क और भू-भाग डेटा पर बस, ट्राम, मेट्रो और रेल लाइनें बनाइए, जाँचिए कि वे समय पर चलती हैं और उनमें सब यात्री समा जाते हैं या नहीं, और देखिए कि उनकी लागत क्या है, उनसे क्या लाभ है और परियोजना करने लायक है या नहीं।

![सड़क लाइन टूल: सड़कों पर बनी एक BRT लाइन, साइड पैनल में उसकी लंबाई, स्टॉप, चक्र समय, ज़रूरी वाहन और विश्वसनीयता](docs/images/street-line-editor.png)

## यह क्या करता है

**नेटवर्क बनाइए**

- **सड़क लाइनें**: OpenStreetMap की सड़कों पर बस, BRT, ट्रॉलीबस और इंटरसिटी बस लाइनें। [गाइड](docs/user/street-line-tool.md)
- **रेलवे**: ट्राम, लाइट रेल, मेट्रो, उपनगरीय, क्षेत्रीय, इंटरसिटी और हाई-स्पीड लाइनें, स्टेशनों, पटरियों, कांटों और क्रॉसिंग के साथ, सब सही पैमाने पर। [गाइड](docs/user/railway-tool.md)
- **वाहन और बेड़ा**: स्रोतों सहित वाहन कैटलॉग, साथ में परियोजना के अपने वाहन और उसके अलग-अलग वाहनों की सूची। [गाइड](docs/user/vehicles-and-fleet.md)

**परीक्षण कीजिए**

- **सिम्युलेटर**: क्या रेल लाइनें पटरियों पर फिट होती हैं, क्या ट्रेनें और बसें समय पर चलती हैं, क्या छोटी देरी अपने-आप ख़त्म हो जाती है, और क्या सब वाहनों में समा जाते हैं? [गाइड](docs/user/simulator.md)
- **सड़क सिमुलेशन**: Eclipse SUMO के साथ सड़क लाइनें ट्रैफ़िक में चलती हैं, डिपो से निकलकर वापस आने तक, रीप्ले के साथ। [गाइड](docs/user/road-simulation.md)
- **बहु-वर्षीय रन**: हर सिमुलेशन वर्ष (डिफ़ॉल्ट 10, अधिकतम 60) दिन के प्रकार (कार्यदिवस, शनिवार, रविवार, सार्वजनिक अवकाश) के अनुसार, परियोजना के कैलेंडर और जलवायु के साथ चलता है। [ADR-0020](docs/adr/0020-multi-year-day-types.md)
- **यात्रा योजनाकार**: पूरे दिन A से B तक घर से गंतव्य तक का समय। [गाइड](docs/user/journey-planner.md)

**विश्लेषण कीजिए**

- **योजनाबद्ध नक्शा**: लाइनों का नेटवर्क मैप और हर लाइन का स्ट्रिप मैप, SVG, PNG या PDF में निर्यात। [गाइड](docs/user/schematic.md)
- **GIS**: सड़कों का बँटवारा, पैदल कवरेज और स्टॉप की दूरी, जनसंख्या, क्षेत्र और शोर का नक्शा। [सड़कें](docs/user/gis-streets.md), [पैदल](docs/user/gis-walk.md), [जनसंख्या](docs/user/gis-population.md), [क्षेत्र](docs/user/gis-regions.md)
- **तालिकाएँ**: नेटवर्क और बेड़े के आँकड़े, वाहन ब्लॉक सहित समय-सारणी (CSV, PDF और GTFS डाउनलोड), लागत, लाभ, किराया आय और परिदृश्यों की तुलना। [नेटवर्क](docs/user/network-tables.md), [लागत](docs/user/cost-tables.md), [लाभ](docs/user/benefit-tables.md), [किराया](docs/user/fare-revenue.md)
- **माँग मॉडल**: AequilibraE के साथ कार्यदिवस का चार-चरणीय पूर्वानुमान (यात्रा उत्पादन, वितरण, साधन चयन और असाइनमेंट)। [गाइड](docs/user/demand-model.md)
- **मूल्यांकन**: आर्थिक और वित्तीय शुद्ध वर्तमान मूल्य, प्रतिफल दरें, लाभ-लागत अनुपात, बहु-मानदंड विश्लेषण, संवेदनशीलता और मोंटे कार्लो सीमाएँ। [गाइड](docs/user/appraisal.md)

**साझा कीजिए और बढ़ाइए**

- **परियोजनाएँ**: किसी परियोजना को दूसरों के साथ साझा कीजिए, इंस्टेंस में साइन इन किए सभी लोगों के लिए सार्वजनिक कीजिए, या `.mslab` फ़ाइल के रूप में सहेजिए। [परियोजना फ़ाइलें](docs/user/project-files.md)
- **स्टैटिक व्यूअर**: बिना सर्वर वाली वेबसाइट जो सहेजी गई परियोजनाएँ केवल पढ़ने के लिए दिखाती है, Cloudflare Pages के लिए तैयार। [गाइड](docs/user/static-viewer.md)
- **प्लगइन**: साथ आने वाले प्लगइन केबल कार, फ़ेरी, ऑन-डिमांड बस, कार्गो बाइक, ऊर्जा और उत्सर्जन, GTFS आयात और निर्यात तथा शोर का नक्शा जोड़ते हैं; एडमिन और प्लगइन इंस्टॉल कर सकते हैं, जो सैंडबॉक्स में चलते हैं। [साथ आने वाले प्लगइन](plugins/README.md), [प्लगइन लिखना](docs/plugins/README.md)
- **AI एजेंट**: Claude या कोई अन्य MCP ऐप जोड़कर परिदृश्य बनाइए और उन्हें 15 मिनट पैदल नियम पर जाँचिए। [गाइड](docs/user/ai-agents.md)
- ऐप में **32 भाषाएँ**।

## स्क्रीनशॉट

| | |
|---|---|
| ![मेट्रो, क्षेत्रीय रेल और बस लाइनों, किराया क्षेत्रों और स्टेशन चिह्नों वाला योजनाबद्ध नेटवर्क मैप](docs/images/schematic-network-map.png) | ![हर लाइन के वाहन ब्लॉक और रविवार को एक बस लाइन के प्रस्थान समय दिखाती समय-सारणी](docs/images/timetables.png) |
| **योजनाबद्ध नक्शा**: नेटवर्क मैप, स्ट्रिप मैप और SVG, PNG व PDF निर्यात के साथ | **समय-सारणी**: दिन के प्रकार के अनुसार वाहन ब्लॉक और प्रस्थान |
| ![शुद्ध वर्तमान मूल्य, लाभ-लागत अनुपात, प्रतिफल दर, लागत के मुक़ाबले लाभ और मोंटे कार्लो फैलाव वाला मूल्यांकन सारांश](docs/images/appraisal.png) | ![GIS पैदल कवरेज मैप: निवासी स्टॉप से कितनी दूर रहते हैं, हरे से लाल तक](docs/images/walk-coverage.png) |
| **मूल्यांकन**: क्या परियोजना करने लायक है, और परिणाम कितना पक्का है | **पैदल कवरेज**: कौन स्टॉप से थोड़ी पैदल दूरी पर रहता है |
| ![एक लाइन के साथ L_den स्तर और उसके पास की इमारतें दिखाता शोर का नक्शा](docs/images/noise-map.png) | |
| **शोर का नक्शा**: नियोजित सेवा से L_den और L_night, इमारतों और भू-भाग की आड़ के साथ | |

## जल्दी शुरू करें

```bash
deploy/scripts/init-secrets          # random secrets in deploy/secrets (never committed)
cp .env.example .env                 # set MOBSIMLAB_VERSION, MOBSIMLAB_PUBLIC_URL and the OIDC provider
docker compose pull                  # ready-made image from ghcr.io, nothing to build
docker compose up -d                 # two containers: mobsimlab and postgres
open http://localhost:8080
```

हर रिलीज़ Intel/AMD और ARM सर्वरों के लिए तैयार इमेज `ghcr.io/homlo-bike/mobsimlab` पर प्रकाशित करती है, केवल उसके संस्करण के टैग के साथ (जैसे `2026.11.1-alpha`; कोई `latest` टैग नहीं है)। पुल करने से पहले `.env` में यह संस्करण `MOBSIMLAB_VERSION` के रूप में सेट करें; अपडेट करने के लिए इसे नए संस्करण में बदलें और `docker compose pull && docker compose up -d` चलाएँ। इस रिपॉज़िटरी से इमेज ख़ुद बनाने के लिए `docker compose up -d --build` चलाएँ।

रिलीज़ एक संस्करण टैग पुश करके बनती है (`git tag -s v2026.11.1-alpha -m "MobSimLab 2026.11.1-alpha" && git push origin v2026.11.1-alpha`); **Release image** वर्कफ़्लो इमेज बनाता है, उसका स्मोक टेस्ट करता है और उसे प्रकाशित करता है।

### साइन इन और पहला सेटअप

MobSimLab में कोई स्थानीय पासवर्ड नहीं है; लोग किसी OpenID Connect प्रदाता (Keycloak, Authentik, Entra ID, Google आदि) से साइन इन करते हैं।

1. अपने प्रदाता के पास MobSimLab को वेब ऐप्लिकेशन के रूप में पंजीकृत करें। रीडायरेक्ट URI: `<MOBSIMLAB_PUBLIC_URL>/api/auth/callback`। लॉगआउट के बाद रीडायरेक्ट URI: `<MOBSIMLAB_PUBLIC_URL>/`।
2. जारीकर्ता URL और क्लाइंट ID को `.env` में डालें (`MOBSIMLAB_OIDC_ISSUER`, `MOBSIMLAB_OIDC_CLIENT_ID`)। अगर प्रदाता ने क्लाइंट सीक्रेट दिया है, तो उसे `deploy/secrets/oidc_client_secret` में पेस्ट करें।
3. स्टैक शुरू करें। इंस्टेंस **सेटअप मोड** में शुरू होता है: पहला साइन इन करने वाला व्यक्ति **Owner** बनता है, और जब तक Owner **Finish setup** नहीं दबाता, बाकी सबको मना कर दिया जाता है। यह पहला व्यक्ति कौन हो, यह तय करने के लिए `MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL` (प्रदाता द्वारा सत्यापित ई-मेल) या `MOBSIMLAB_BOOTSTRAP_OWNER_SUBJECT` सेट करें।
4. सेटअप के बाद नए उपयोगकर्ता मंज़ूरी का इंतज़ार करते हैं (स्वतः पंजीकरण डिफ़ॉल्ट रूप से बंद है)। Owner और Admin खाता मेन्यू में **Administration** के तहत यह संभालते हैं: लोगों को मंज़ूर या अस्वीकार करना, भूमिकाएँ बदलना (Restricted खाते को हटाए बिना निलंबित करता है), साइन-अप नियम तय करना (स्वतः पंजीकरण, अनुमत ई-मेल डोमेन और IdP समूह) और IdP समूहों को भूमिकाओं से जोड़ना। केवल Owner ही Owner या Admin बना सकता है, और आख़िरी Owner को हटाया नहीं जा सकता।
5. TLS रिवर्स प्रॉक्सी के पीछे, `MOBSIMLAB_TRUSTED_PROXIES` को प्रॉक्सी के पते पर सेट करें ताकि साइन-इन दर सीमाएँ (डिफ़ॉल्ट रूप से प्रति क्लाइंट प्रति मिनट 10) और ऑडिट रिकॉर्ड असली क्लाइंट पता देखें।

**AI एजेंट:** Owner, Admin और Editor `<MOBSIMLAB_PUBLIC_URL>/mcp` पर Claude या कोई अन्य MCP ऐप जोड़ सकते हैं। इंस्टेंस AI ऐप से HTTPS पर पहुँच योग्य होना चाहिए, और `MOBSIMLAB_PUBLIC_URL` वही पता होना चाहिए जो ऐप इस्तेमाल करता है। देखें [docs/user/ai-agents.md](docs/user/ai-agents.md)।

**स्टैटिक व्यूअर:** `pnpm build:static` केवल पढ़ने वाली वेबसाइट बनाता है। देखें [docs/user/static-viewer.md](docs/user/static-viewer.md)।

Owner खाता खो गया? `docker compose exec mobsimlab /app/bin/mobsimlab admin reset-owner` चलाएँ। यह मौजूदा Owner को Admin बना देता है, उन्हें साइन आउट करता है, इंस्टेंस को सेटअप मोड में लौटाता है और इस कार्रवाई को ऑडिट लॉग में दर्ज करता है।

## दस्तावेज़

- [आर्किटेक्चर](docs/architecture/README.md), [परखी गई धारणाएँ](docs/architecture/00-challenged-assumptions.md) और [आर्किटेक्चर निर्णय रिकॉर्ड](docs/adr/README.md)
- स्पाइक रिपोर्ट: [S1 को-सिमुलेशन](docs/spikes/s1-cosimulation.md), [S2 रेल कर्नेल प्रदर्शन](docs/spikes/s2-rail-kernel-performance.md), [S3 OSM आयात](docs/spikes/s3-osm-import.md)

## योगदान

पहले [CONTRIBUTING.md](CONTRIBUTING.md) पढ़ें और [आचार संहिता](CODE_OF_CONDUCT.md) का पालन करें। सुरक्षा समस्याओं की रिपोर्ट [SECURITY.md](SECURITY.md) में बताए तरीक़े से करें। [ACCESSIBILITY.md](ACCESSIBILITY.md) में सुलभता का लक्ष्य और ज्ञात सीमाएँ दी गई हैं।

## लाइसेंस

कोड [GNU Affero General Public License v3.0 या बाद के संस्करण](LICENSE) के तहत है। वाहन कैटलॉग, धारणा लाइब्रेरी और दस्तावेज़ CC BY 4.0 के तहत हैं।
