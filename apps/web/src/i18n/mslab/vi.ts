import type { MslabMessages } from "./en";

/** .mslab project file messages (vi). */
export const mslabVi = {
  "menu.saveMslab": "Lưu thành tệp .mslab",
  "home.openMslab": "Mở tệp .mslab",
  "home.openingMslab": "Đang mở tệp…",
  "home.openedMslab": "Đã mở “{name}” thành dự án mới.",
  "home.leftOut": "Không đưa vào: {list}",
  "mslab.body":
    "Lưu bản vẽ, tùy chọn, kịch bản và plugin của dự án trong một tệp mà bạn có thể mở lại trên bất kỳ MobSimLab nào.",
  "mslab.runs": "Kèm các lần chạy mô phỏng đã lưu (tệp sẽ lớn hơn)",
  "mslab.map":
    "Kèm dữ liệu bản đồ cho trình xem tĩnh: đường phố, công trình, dân số và số liệu quốc gia của khu vực dự án (tệp lớn hơn; có thể mất vài phút)",
  "static.empty":
    "Trang này chưa có dự án nào. Hãy đặt tệp .mslab vào thư mục projects rồi chạy tools/add-projects.mjs.",
  "mslab.save": "Lưu tệp",
} satisfies MslabMessages;
