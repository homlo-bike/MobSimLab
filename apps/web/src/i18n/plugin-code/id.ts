import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (id). */
export const pluginCodeId = {
  "pcode.title": "Perhitungan plugin",
  "pcode.intro":
    "Perhitungan dari plugin yang terpasang. Berjalan di sandbox di peramban Anda, tanpa akses ke internet atau proyek lain.",
  "pcode.by": "{plugin} · oleh {publisher}",
  "pcode.run": "Hitung",
  "pcode.running": "Menghitung…",
  "pcode.failed": "{plugin} tidak dapat menghitung: {error}",
  "pcode.noRows": "Tidak ada baris.",
  "pcode.log": "Log plugin ({count} baris)",
  "pcode.import": "Impor {label} ({plugin})",
  "pcode.export": "Unduh sebagai {label} ({plugin})",
  "pcode.importFailed": "{plugin} tidak dapat membaca berkas: {error}",
  "pcode.exportFailed": "{plugin} tidak dapat menulis berkas: {error}",
  "pcode.frameTitle": "{tab}, halaman dari plugin {plugin}",
  "pcode.frameNote":
    "Halaman ini berasal dari plugin {plugin} oleh {publisher}. Halaman ini tidak dapat menjangkau internet atau akun Anda.",
  "pcode.runsCode": "Menjalankan kodenya sendiri di sandbox",
  "pcode.limits": "Batas kode plugin",
  "pcode.limitsIntro":
    "Setiap panggilan kode plugin mendapat paling banyak memori dan waktu sebesar ini, di peramban dan di server.",
  "pcode.memory": "Memori (MB)",
  "pcode.time": "Waktu (detik)",
  "pcode.saveLimits": "Simpan batas",
  "pcode.saved": "Tersimpan.",
  "pcode.installIntro":
    "Unggah berkas .msplugin. MobSimLab memeriksanya dan menunjukkan apa yang ditambahkannya sebelum Anda memasangnya. Plugin dapat menambahkan moda, alat, parameter, dan sumber, serta menjalankan kodenya sendiri (perhitungan, impor, ekspor, dan halaman tab) di sandbox tanpa akses internet.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "Foto udara sekitar 0,3 hingga 1 m per piksel. Esri memerlukan kunci API ArcGIS dari akun ArcGIS Location Platform dan persetujuan atas ketentuannya. Ubin melewati MobSimLab ini, jadi peramban tidak pernah melihat kuncinya, dan ubin tidak disimpan.",
  "esri.key": "Kunci API ArcGIS",
  "esri.accept": "Saya menerima ketentuan penggunaan Esri untuk MobSimLab ini",
  "esri.terms": "Ketentuan Esri",
  "esri.save": "Simpan kunci",
  "esri.remove": "Hapus kunci",
  "esri.saved":
    "Kunci berakhiran {end} disimpan oleh {name} pada {date}. Esri World Imagery tersedia di pilihan lapisan peta.",
  "esri.none": "Belum ada kunci tersimpan: Esri World Imagery tidak ditawarkan.",
} satisfies PluginCodeMessages;
