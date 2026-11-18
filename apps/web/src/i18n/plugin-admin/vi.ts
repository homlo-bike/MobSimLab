import type { pluginAdminEn } from "./en";

/** Tiếng Việt: messages of the Plugins tab of Administration. */
export const pluginAdminVi: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro": "Các plugin của MobSimLab này. Plugin bạn tắt ở đây sẽ tắt trong mọi dự án.",
  "padmin.publishers": "Nhà phát hành và giới hạn",
  "padmin.configure": "Cấu hình",
  "padmin.configureName": "Cấu hình {name}",
  "padmin.useName": "Dùng {name} trên MobSimLab này",
  "padmin.offEverywhere": "Tắt trong mọi dự án",
  "padmin.needsKey": "Cần khóa API",
  "padmin.accept": "Chấp nhận thay đổi",
  "padmin.services": "Các dịch vụ plugin này sử dụng",
  "padmin.nothingToSet":
    "Plugin này không có gì để thiết lập. Mỗi dự án bật hoặc tắt nó trong Tùy chọn dự án.",
  "padmin.versions": "Các phiên bản đã cài",
  "padmin.undo": "Hoàn tác",
  "padmin.removedOnAccept": "Khóa sẽ bị xóa khi bạn chấp nhận thay đổi.",
  "padmin.changedOnAccept": "Sẽ thay đổi khi bạn chấp nhận thay đổi.",
  "padmin.keyReplace": "Nhập khóa mới để thay khóa đã lưu",
  "padmin.esriTermsFirst": "Hãy chấp nhận điều khoản sử dụng của Esri để lưu khóa.",
  "padmin.offByAdmin": "Quản trị viên đã tắt plugin này cho MobSimLab này.",
};
