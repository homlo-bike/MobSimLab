import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (vi). */
export const workspaceUiVi = {
  "checks.menu": "Kiểm tra",
  "checks.menuCount": "Kiểm tra: {errors} lỗi, {warnings} cảnh báo",
  "checks.title": "Kiểm tra của mọi phương thức",
  "checks.none":
    "Chưa có gì để kiểm tra. Hãy vẽ một tuyến, đường sắt hoặc depot, kết quả kiểm tra sẽ hiện ở đây.",
  "checks.lastOpened": "như lần mở gần nhất",
  "checks.streetLine": "Tuyến đường bộ · {name}",
  "checks.railway": "Đường sắt",
  "checks.depot": "Depot · {name}",
  "undo.undo": "Hoàn tác",
  "undo.redo": "Làm lại",
  "tour.checks.title": "Kiểm tra",
  "tour.checks.body":
    "Chiếc chuông liệt kê kiểm tra của mọi phương thức, lỗi trước: tuyến đường bộ, đường sắt, depot và tuyến của plugin. Chọn một mục để xem vị trí.",
  "settings.serverTab": "Máy chủ",
  "settings.server.local":
    "MobSimLab đang chạy trên máy tính này. Thay vào đó, bạn có thể kết nối ứng dụng với một máy chủ MobSimLab chạy nền, chẳng hạn máy chủ Docker.",
  "settings.server.address": "Địa chỉ máy chủ",
  "settings.server.connect": "Kết nối",
  "settings.server.note":
    "Ứng dụng kiểm tra máy chủ và hỏi trước khi chuyển. Các dự án trên máy tính này vẫn ở đây: hãy chuyển chúng bằng cách lưu thành tệp .mslab. Bạn có thể chuyển lại trong Cài đặt của ứng dụng (⌘, hoặc Ctrl+,).",
} satisfies WorkspaceUiMessages;
