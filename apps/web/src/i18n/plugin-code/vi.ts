import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (vi). */
export const pluginCodeVi = {
  "pcode.title": "Tính toán của plugin",
  "pcode.intro":
    "Các phép tính của plugin đã cài. Chúng chạy trong hộp cát trên trình duyệt của bạn, không truy cập được internet hay dự án khác.",
  "pcode.by": "{plugin} · của {publisher}",
  "pcode.run": "Tính",
  "pcode.running": "Đang tính…",
  "pcode.failed": "{plugin} không tính được: {error}",
  "pcode.noRows": "Không có hàng.",
  "pcode.log": "Nhật ký plugin ({count} dòng)",
  "pcode.import": "Nhập {label} ({plugin})",
  "pcode.export": "Tải xuống dạng {label} ({plugin})",
  "pcode.importFailed": "{plugin} không đọc được tệp: {error}",
  "pcode.exportFailed": "{plugin} không ghi được tệp: {error}",
  "pcode.frameTitle": "{tab}, một trang của plugin {plugin}",
  "pcode.frameNote":
    "Trang này đến từ plugin {plugin} của {publisher}. Nó không truy cập được internet hay tài khoản của bạn.",
  "pcode.runsCode": "Chạy mã riêng trong hộp cát",
  "pcode.limits": "Giới hạn cho mã plugin",
  "pcode.limitsIntro":
    "Mỗi lần gọi mã của plugin được tối đa chừng này bộ nhớ và thời gian, trên trình duyệt và trên máy chủ.",
  "pcode.memory": "Bộ nhớ (MB)",
  "pcode.time": "Thời gian (giây)",
  "pcode.saveLimits": "Lưu giới hạn",
  "pcode.saved": "Đã lưu.",
  "pcode.installIntro":
    "Tải lên tệp .msplugin. MobSimLab kiểm tra tệp và cho biết nó thêm gì trước khi cài. Plugin có thể thêm phương thức, công cụ, tham số và nguồn, và chạy mã riêng (tính toán, nhập, xuất và trang thẻ) trong hộp cát không có internet.",
} satisfies PluginCodeMessages;
