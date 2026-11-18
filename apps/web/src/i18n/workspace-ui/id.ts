import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (id). */
export const workspaceUiId = {
  "checks.menu": "Pemeriksaan",
  "checks.menuCount": "Pemeriksaan: {errors} galat, {warnings} peringatan",
  "checks.title": "Pemeriksaan semua moda",
  "checks.none":
    "Belum ada yang perlu diperiksa. Gambar jalur, rel, atau depo dan pemeriksaannya akan muncul di sini.",
  "checks.lastOpened": "seperti saat terakhir dibuka",
  "checks.streetLine": "Jalur jalan · {name}",
  "checks.railway": "Rel",
  "checks.depot": "Depo · {name}",
  "undo.undo": "Urungkan",
  "undo.redo": "Ulangi",
  "tour.checks.title": "Pemeriksaan",
  "tour.checks.body":
    "Lonceng menampilkan pemeriksaan semua moda, galat lebih dulu: jalur jalan, rel, depo, dan jalur plugin. Pilih salah satu untuk melihat letaknya.",
  "settings.serverTab": "Server",
  "settings.server.local":
    "MobSimLab berjalan di komputer ini. Sebagai gantinya, Anda dapat menghubungkan aplikasi ini ke server MobSimLab yang berjalan di latar belakang, seperti server Docker.",
  "settings.server.address": "Alamat server",
  "settings.server.connect": "Hubungkan",
  "settings.server.note":
    "Aplikasi memeriksa server dan bertanya sebelum beralih. Proyek di komputer ini tetap di sini: pindahkan dengan menyimpannya sebagai file .mslab. Anda bisa kembali di Pengaturan aplikasi (⌘, atau Ctrl+,).",
} satisfies WorkspaceUiMessages;
