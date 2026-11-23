import type { AdviceMessages } from "./en";

/** Advice messages (vi). */
export const adviceVi = {
  "advice.title": "Điều cần cải thiện",
  "advice.intro":
    "Các vấn đề lần chạy này phát hiện, nghiêm trọng nhất trước, và việc bạn có thể làm với từng vấn đề.",
  "advice.none": "Không có gì cần cải thiện: lần chạy này không thấy điểm nghẽn hay vấn đề nào.",
  "advice.show": "Hiện trên bản đồ",
  "advice.more": "Còn {n} mục không hiển thị.",
  "advice.severity.problem": "Vấn đề",
  "advice.severity.warning": "Cảnh báo",
  "advice.crowdMap": "Hiện trên bản đồ mức đầy của phương tiện (giờ đông nhất của mỗi tuyến)",
  "advice.cap.stopped": "{line}: lần chạy đã dừng: {problem}",
  "advice.cap.stoppedFix": "Sửa lỗi này trong công cụ đường sắt, rồi chạy lại kiểm tra.",
  "advice.cap.unplaced": "{line}: chuyến không xếp được lên đường ray: {n}",
  "advice.cap.unplacedFix":
    "Chạy tuyến thưa hơn trong khoảng này, hoặc cho tàu thêm chỗ ở nơi chúng gặp nhau: thêm đường ga hoặc đường chuyển ở {terminal}, hoặc một điểm tránh trên đường đơn.",
  "advice.cap.terminal":
    "{line}: ga cuối {terminal} là điểm nghẽn, bị chiếm {share} giờ đông nhất (giới hạn {limit})",
  "advice.cap.terminalFix":
    "Tàu chiếm đường ga quá lâu. Rút ngắn quay đầu (dừng ngắn hơn, hoặc một lái tàu chờ ở mỗi đầu), thêm một đường ga, hoặc dời đường chuyển gần sân ga hơn để tàu giải phóng sớm hơn.",
  "advice.cap.section":
    "{line}: đoạn ray {section} là điểm nghẽn, bị chiếm {share} giờ đông nhất (giới hạn {limit})",
  "advice.cap.sectionFix":
    "Tàu chiếm đoạn này lâu hơn mọi đoạn khác. Tốc độ cao hơn qua đoạn giúp giải phóng sớm hơn; nếu không, hãy chạy ít tàu hơn ở đây.",
  "advice.cap.sectionPlatform":
    "Đoạn này là đường ga: tàu chiếm nó suốt thời gian đứng ở sân ga. Dừng ngắn hơn ở đó, hoặc thêm đường ga thứ hai cho hướng này, giúp tàu sau vào sớm hơn.",
  "advice.cap.sectionSwitches":
    "Đoạn này là khu ghi: tàu chiếm nó trong khi lộ trình qua các ghi được lập và giải phóng. Ghi có tốc độ rẽ cao hơn, hoặc đặt ghi sao cho hai hướng không cắt nhau, giúp giải phóng sớm hơn.",
  "advice.cap.signalAdd":
    "Đoạn khu gian này dài {length} m, nhưng ở {speed} km/h một phân khu chỉ cần {block} m. Thêm một tín hiệu phân khu ở khoảng {at} m trên đường ray {track}, để tàu sau có thể vào nửa đầu sớm hơn.",
  "advice.cap.signalShort":
    "Đoạn này dài {length} m, ngắn hơn hai phân khu {block} m ở {speed} km/h, nên thêm tín hiệu sẽ để lại quá ít chỗ để dừng. Tàu có thể chạy sát nhau hơn với tín hiệu trong buồng lái (CBTC hoặc ETCS cấp 2), hoặc với tốc độ thấp hơn ở đây.",
  "advice.cap.sectionCab":
    "Với tín hiệu trong buồng lái, tàu đã chạy cách nhau một quãng hãm ({block} m ở {speed} km/h); khoảng cách không do tín hiệu quyết định. Tốc độ cao hơn trong đoạn, hoặc ít tàu hơn, giúp giải phóng sớm hơn.",
  "advice.cap.sectionSight":
    "Tàu điện ở đây chạy theo quan sát, nên khoảng cách không do tín hiệu quyết định. Dừng ngắn hơn ở gần đó, hoặc đường riêng tách khỏi giao thông đường phố, giúp giải phóng sớm hơn.",
  "advice.cap.nearNote": "Vẫn chạy được, nhưng gần như không còn chỗ để thêm tàu.",
  "advice.cap.pileUp": "{line}: trễ tích tụ và cuối khoảng vẫn còn trung bình {late}",
  "advice.cap.pileUpFix":
    "Thêm thời gian hồi phục ở ga cuối, hoặc chạy thưa hơn một chút, để một tàu trễ không giữ chân tàu sau.",
  "advice.cap.full": "{line}: phương tiện đầy {share} từ {from} đến {to}, {time}",
  "advice.cap.fullMore":
    "{left} người bị bỏ lại trong khoảng này. Đường ray cho phép tối đa {n} tàu mỗi giờ mỗi hướng: chạy dày hơn, hoặc dùng tàu dài hơn.",
  "advice.cap.fullLonger":
    "{left} người bị bỏ lại trong khoảng này. Chạy dày hơn nếu đường ray cho phép, hoặc dùng phương tiện dài hơn.",
  "advice.cap.streetPileUp": "{line}: trễ tích tụ trên đường và cuối cùng vẫn còn {late}",
  "advice.cap.streetPileUpFix":
    "Dành thêm thời gian cho một vòng hoặc nghỉ lâu hơn ở điểm cuối, để phương tiện bắt kịp; làn riêng ở nơi gặp giao thông giúp nhiều nhất.",
  "advice.road.cannotRun": "{line} không chạy được",
  "advice.road.cannotRunFix": "{problem}. Sửa tuyến trong Tạo → Tuyến đường phố, rồi chạy lại.",
  "advice.road.late": "{line}: chỉ {share} chuyến khởi hành đúng giờ (gợi ý khi dưới {limit})",
  "advice.road.mostlySignals":
    "Mỗi chuyến mất {signals} phút ở đèn đỏ và {traffic} phút trong dòng xe, nên phần lớn ở các đèn tín hiệu liệt kê ở đây.",
  "advice.road.mostlyTraffic":
    "Mỗi chuyến mất {traffic} phút trong dòng xe và {signals} phút ở đèn đỏ, nên phần lớn ở các con đường liệt kê ở đây.",
  "advice.road.moreTime":
    "Một vòng mất {run} phút so với {planned} phút dự kiến: lên kế hoạch thêm thời gian chạy, hoặc thêm một xe.",
  "advice.road.bunched": "{line}: {share} chuyến khởi hành bị dồn",
  "advice.road.bunchedFix":
    "Các xe đuổi kịp nhau. Giữ xe ở điểm cuối theo biểu đồ, cho nghỉ lâu hơn ở đó, hoặc cho tuyến làn riêng ở nơi nó mất thời gian.",
  "advice.road.ranOut": "{line}: xe hết điện: {n}",
  "advice.road.ranOutFix": "Dùng pin lớn hơn, sạc ở điểm cuối, hoặc đổi xe trong ngày.",
  "advice.road.stuck": "{line}: xe bị kẹt từ 5 phút trở lên: {n}",
  "advice.road.stuckFix":
    "Kiểm tra thiết lập đường và đèn tín hiệu tại chỗ này trong thẻ GIS: có thể thiếu một hướng rẽ, hoặc dòng xe chặn nút giao.",
  "advice.road.notBack": "{line}: xe chưa về bãi lúc kết thúc: {n}",
  "advice.road.notBackFix": "Kiểm tra lộ trình giữa tuyến và bãi xe, hoặc để thêm thời gian sau chuyến cuối.",
  "advice.road.unnamedStreet": "một con đường không tên",
  "advice.road.unnamedJunction": "một nút giao",
  "advice.road.spot.signal": "Đèn đỏ trên {place}: mất tổng cộng {min} phút ({lines})",
  "advice.road.spot.signalFix":
    "Các tuyến chờ ở đây lâu hơn bất kỳ nơi nào khác. Hãy đề nghị ưu tiên cho chúng ở đèn này, hoặc chu kỳ đèn phù hợp. Mô phỏng đường bộ chưa mô hình hóa ưu tiên, nên chưa thể cho thấy lợi ích.",
  "advice.road.spot.street": "Dòng xe trên {place}: mất tổng cộng {min} phút ({lines})",
  "advice.road.spot.streetFix":
    "Cho các tuyến làn riêng trên đường này (thẻ GIS, thiết lập đường: làn xe buýt), hoặc cho chúng đi đường khác.",
  "advice.road.spot.junction": "Đứng trong {place}: mất tổng cộng {min} phút ({lines})",
  "advice.road.spot.junctionFix":
    "Xe đứng trong nút giao này, chờ rẽ hoặc chờ lối ra thông. Làn riêng tới đó, hoặc pha rẽ riêng ở đèn, sẽ giúp ích.",
} satisfies AdviceMessages;
