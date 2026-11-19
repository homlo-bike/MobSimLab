import type { AreaMessages } from "./en";

/** Project area messages (id). */
export const areaId = {
  "aw.title": "Area proyek",
  "aw.editing": "Mengedit area {name}",
  "aw.search": "Cari tempat untuk menggeser peta, misalnya Homs",
  "aw.tools": "Alat gambar",
  "aw.draw": "Gambar poligon",
  "aw.edit": "Edit titik",
  "aw.pan": "Geser",
  "aw.hint.draw":
    "Klik untuk menambah sudut. Klik sudut pertama atau tekan Enter untuk menutup poligon. Backspace menghapus sudut terakhir.",
  "aw.hint.edit":
    "Klik poligon untuk memilihnya. Seret sudut untuk memindahkannya, seret titik tengah untuk menambah sudut, klik dua kali sudut untuk menghapusnya.",
  "aw.hint.pan": "Seret untuk menggeser peta. Klik poligon untuk memilihnya.",
  "aw.statArea": "Luas",
  "aw.statDownload": "Perkiraan unduhan",
  "aw.mb": "{mb} MB",
  "aw.limit": "Batas {mb} MB",
  "aw.overLimit":
    "Area ini memuat data peta lebih dari {mb} MB yang boleh dimiliki proyek. Perkecil, atau atur poligon di sepanjang rute ke jalan utama dan rel saja.",
  "aw.polygons": "Poligon",
  "aw.empty":
    "Belum ada poligon. Gambar satu di sekitar setiap tempat yang dicakup proyek, dan satu yang sempit di sepanjang setiap rute antarkota.",
  "aw.detail.full": "Lengkap",
  "aw.detail.main": "Jalan utama dan rel saja",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "Nama",
  "aw.detail": "Tingkat detail",
  "aw.fullHelp": "Jalan, jalur, bangunan, sekolah dan rumah sakit, penduduk per 100 m, medan.",
  "aw.mainHelp":
    "Jalan tol, jalan arteri dan utama, rel, medan, penduduk per 1 km. Tanpa bangunan: gambar kota di sepanjang rute sebagai Lengkap untuk peta kebisingan dan akses jalan kaki.",
  "aw.delete": "Hapus poligon",
  "aw.newName": "Area {n}",
  "aw.save": "Simpan area",
  "aw.confirm.title": "Unduh data peta untuk bagian baru?",
  "aw.confirm.body":
    "Baru atau diubah: {list}. Butuh sekitar {mb} MB. Bagian yang dihapus tidak dipakai lagi. Tidak ada yang diunduh sampai Anda mengonfirmasi.",
  "aw.confirm.item": "{name} ({detail}, {area} km²)",
  "aw.confirm.back": "Kembali ke peta",
  "aw.confirm.save": "Simpan dan unduh {mb} MB",
  "aw.select": "Pilih area",
  "aw.selectHint": "Gambar batas proyek di peta. Data peta hanya diunduh di dalamnya.",
  "aw.change": "Ubah area",
  "aw.download": "sekitar {mb} MB data peta",
  "aw.outline": "Garis luar area proyek",
  "aw.prefsIntro":
    "Poligon yang digambar di sekitar proyek. Data peta hanya diunduh di dalamnya, dengan tingkat detail tiap poligon.",
  "aw.dataFrom": "Data peta per {date}",
  "aw.noData": "Data peta belum diunduh",
  "aw.editArea": "Edit area",
  "aw.drawArea": "Gambar area",
  "aw.refresh": "Perbarui data peta",
  "aw.refreshHelp":
    "Perbarui mengunduh data OpenStreetMap terkini untuk area yang sama; sampai saat itu rencana mempertahankan tanggal datanya.",
  "aw.none": "Belum ada area proyek. Gambar satu agar alat-alat memiliki data peta.",
  "aw.saved": "Area disimpan.",
  "aw.data.noArea": "Gambar dulu area proyek di Preferensi proyek: impor mencakupnya.",
  "aw.data.area": "Area proyek: {names}. Impor mencakup persegi panjang di sekitarnya, {area} km².",
  "aw.pop.none": "Belum ada area proyek. Gambar di Preferensi proyek.",
  "aw.pop.box": "Persegi panjang di sekitar area proyek: {km2} km².",
  "aw.tiles.other": "{count} petak peta",
  "aw.count.other": "{count} poligon",
} satisfies AreaMessages;
