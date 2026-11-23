import type { AdviceMessages } from "./en";

/** Advice messages (id). */
export const adviceId = {
  "advice.title": "Yang perlu diperbaiki",
  "advice.intro":
    "Masalah yang ditemukan simulasi ini, yang paling berat lebih dulu, dan apa yang bisa Anda lakukan untuk masing-masing.",
  "advice.none": "Tidak ada yang perlu diperbaiki: simulasi ini tidak menemukan hambatan atau masalah.",
  "advice.show": "Tampilkan di peta",
  "advice.more": "{n} lagi tidak ditampilkan.",
  "advice.severity.problem": "Masalah",
  "advice.severity.warning": "Peringatan",
  "advice.crowdMap": "Tampilkan di peta seberapa penuh kendaraan (jam tersibuk setiap jalur)",
  "advice.cap.stopped": "{line}: simulasi berhenti: {problem}",
  "advice.cap.stoppedFix": "Perbaiki ini di alat perkeretaapian, lalu jalankan uji lagi.",
  "advice.cap.unplaced": "{line}: perjalanan yang tidak muat di jalur: {n}",
  "advice.cap.unplacedFix":
    "Jalankan jalur lebih jarang pada periode ini, atau beri keretanya lebih banyak ruang di tempat mereka bertemu: lebih banyak jalur peron atau wesel penghubung di {terminal}, atau tempat persilangan di jalur tunggal.",
  "advice.cap.terminal":
    "{line}: terminal {terminal} adalah hambatan, terpakai {share} dari jam tersibuk (batas {limit})",
  "advice.cap.terminalFix":
    "Kereta menempati peronnya terlalu lama. Persingkat putar balik (berhenti lebih singkat, atau masinis yang menunggu di tiap ujung), tambah satu jalur peron, atau dekatkan wesel penghubung ke peron agar kereta lebih cepat mengosongkannya.",
  "advice.cap.section":
    "{line}: petak jalur {section} adalah hambatan, terpakai {share} dari jam tersibuk (batas {limit})",
  "advice.cap.sectionFix":
    "Kereta menempati petak ini lebih lama daripada petak lain. Kecepatan lebih tinggi di dalamnya membuat kereta lebih cepat mengosongkannya; jika tidak, jalankan lebih sedikit kereta di sini.",
  "advice.cap.sectionPlatform":
    "Petak ini adalah jalur peron: kereta menempatinya selama berhenti di peron. Henti yang lebih singkat di sana, atau jalur peron kedua untuk arah ini, membuat kereta berikutnya masuk lebih cepat.",
  "advice.cap.sectionSwitches":
    "Petak ini adalah area wesel: kereta menempatinya selama rute melalui wesel dibentuk dan dilepas. Wesel dengan kecepatan lebih tinggi di sisi belok, atau wesel yang diletakkan sehingga kedua arah tidak saling memotong, mengosongkannya lebih cepat.",
  "advice.cap.signalAdd":
    "Petak lintas ini panjangnya {length} m, padahal satu blok pada {speed} km/jam hanya perlu {block} m. Tambahkan sinyal blok di sekitar {at} m pada jalur {track}, agar kereta berikutnya bisa masuk ke paruh pertama lebih cepat.",
  "advice.cap.signalShort":
    "Petak ini panjangnya {length} m, kurang dari dua blok sepanjang {block} m pada {speed} km/jam, jadi sinyal tambahan akan menyisakan terlalu sedikit ruang untuk berhenti. Kereta bisa mengikuti lebih rapat dengan persinyalan kabin (CBTC atau ETCS level 2), atau dengan kecepatan lebih rendah di sini.",
  "advice.cap.sectionCab":
    "Dengan persinyalan kabin kereta sudah mengikuti pada jarak pengereman ({block} m pada {speed} km/jam); jaraknya tidak ditentukan sinyal. Kecepatan lebih tinggi di petak ini, atau lebih sedikit kereta, mengosongkannya lebih cepat.",
  "advice.cap.sectionSight":
    "Trem di sini berjalan berdasarkan pandangan, jadi jaraknya tidak ditentukan sinyal. Henti yang lebih singkat di sekitar, atau jalur sendiri yang terpisah dari lalu lintas, mengosongkannya lebih cepat.",
  "advice.cap.nearNote": "Masih berjalan, tetapi hampir tidak ada ruang untuk menambah kereta.",
  "advice.cap.pileUp": "{line}: keterlambatan menumpuk dan masih rata-rata {late} saat periode berakhir",
  "advice.cap.pileUpFix":
    "Tambahkan waktu pemulihan di terminal, atau jalankan sedikit lebih jarang, agar kereta yang terlambat tidak menahan kereta berikutnya.",
  "advice.cap.full": "{line}: kendaraan terisi {share} dari {from} ke {to}, {time}",
  "advice.cap.fullMore":
    "{left} orang tertinggal selama periode ini. Jalur memungkinkan hingga {n} kereta per jam per arah: jalankan lebih sering, atau gunakan kereta yang lebih panjang.",
  "advice.cap.fullLonger":
    "{left} orang tertinggal selama periode ini. Jalankan lebih sering jika jalur memungkinkan, atau gunakan kendaraan yang lebih panjang.",
  "advice.cap.streetPileUp": "{line}: keterlambatan menumpuk di jalan dan masih {late} di akhir",
  "advice.cap.streetPileUpFix":
    "Rencanakan waktu lebih lama untuk satu putaran atau jeda lebih panjang di halte akhir, agar kendaraan bisa mengejar; lajur khusus di tempat bertemu lalu lintas paling membantu.",
  "advice.road.cannotRun": "{line} tidak dapat berjalan",
  "advice.road.cannotRunFix": "{problem}. Perbaiki di Buat → Jalur jalan, lalu jalankan lagi.",
  "advice.road.late": "{line}: hanya {share} keberangkatan tepat waktu (saran di bawah {limit})",
  "advice.road.mostlySignals":
    "Setiap perjalanan kehilangan {signals} mnt di lampu merah dan {traffic} mnt di lalu lintas, jadi sebagian besar di lampu lalu lintas yang tercantum di sini.",
  "advice.road.mostlyTraffic":
    "Setiap perjalanan kehilangan {traffic} mnt di lalu lintas dan {signals} mnt di lampu merah, jadi sebagian besar di jalan yang tercantum di sini.",
  "advice.road.moreTime":
    "Satu putaran memakan {run} mnt dibanding {planned} mnt yang direncanakan: rencanakan waktu tempuh lebih lama, atau tambah satu kendaraan.",
  "advice.road.bunched": "{line}: {share} keberangkatan datang menumpuk",
  "advice.road.bunchedFix":
    "Kendaraan saling menyusul. Tahan di halte akhir sesuai jadwal, beri jeda lebih panjang di sana, atau beri jalur lajur khusus di tempat ia kehilangan waktu.",
  "advice.road.ranOut": "{line}: kendaraan yang kehabisan daya: {n}",
  "advice.road.ranOutFix":
    "Gunakan baterai lebih besar, isi daya di halte akhir, atau tukar kendaraan di siang hari.",
  "advice.road.stuck": "{line}: kendaraan terjebak 5 menit atau lebih: {n}",
  "advice.road.stuckFix":
    "Periksa pengaturan jalan dan lampu lalu lintas di tempat ini pada tab GIS: mungkin ada belokan yang hilang, atau lalu lintas menghalangi persimpangan.",
  "advice.road.notBack": "{line}: kendaraan yang belum kembali ke depo di akhir: {n}",
  "advice.road.notBackFix":
    "Periksa rute antara jalur dan deponya, atau beri waktu lebih setelah perjalanan terakhir.",
  "advice.road.unnamedStreet": "jalan tanpa nama",
  "advice.road.unnamedJunction": "sebuah persimpangan",
  "advice.road.spot.signal": "Lampu merah di {place}: total {min} mnt hilang ({lines})",
  "advice.road.spot.signalFix":
    "Jalur-jalur menunggu di sini lebih lama daripada di mana pun. Mintakan prioritas bagi mereka di lampu ini, atau pengaturan waktu lampu yang cocok. Simulasi jalan belum memodelkan prioritas, jadi belum dapat menunjukkan manfaatnya.",
  "advice.road.spot.street": "Lalu lintas di {place}: total {min} mnt hilang ({lines})",
  "advice.road.spot.streetFix":
    "Beri jalur-jalur lajur khusus di jalan ini (tab GIS, pengaturan jalan: lajur bus), atau lewatkan mereka di jalan lain.",
  "advice.road.spot.junction": "Berhenti di {place}: total {min} mnt hilang ({lines})",
  "advice.road.spot.junctionFix":
    "Kendaraan berhenti di dalam persimpangan ini, menunggu belok atau jalan keluar kosong. Lajur khusus hingga ke sana, atau fase belok terpisah pada lampunya, membantu.",
} satisfies AdviceMessages;
