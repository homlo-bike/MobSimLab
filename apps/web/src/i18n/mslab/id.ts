import type { MslabMessages } from "./en";

/** .mslab project file messages (id). */
export const mslabId = {
  "menu.saveMslab": "Simpan sebagai berkas .mslab",
  "home.openMslab": "Buka berkas .mslab",
  "home.openingMslab": "Membuka berkas…",
  "home.openedMslab": "“{name}” dibuka sebagai proyek baru.",
  "home.leftOut": "Tidak disertakan: {list}",
  "mslab.body":
    "Menyimpan gambar, preferensi, skenario, dan plugin proyek dalam satu berkas yang dapat dibuka lagi di MobSimLab mana pun.",
  "mslab.runs": "Sertakan simulasi yang tersimpan (berkas jadi lebih besar)",
  "mslab.map":
    "Sertakan data peta untuk penampil statis: jalan, bangunan, penduduk, dan angka negara di area proyek (berkas lebih besar; dapat memakan waktu beberapa menit)",
  "static.empty":
    "Situs ini belum memiliki proyek. Letakkan berkas .mslab di folder projects lalu jalankan tools/add-projects.mjs.",
  "mslab.save": "Simpan berkas",
} satisfies MslabMessages;
