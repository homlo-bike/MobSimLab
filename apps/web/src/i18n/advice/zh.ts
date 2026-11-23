import type { AdviceMessages } from "./en";

/** Advice messages (zh). */
export const adviceZh = {
  "advice.title": "需要改进的地方",
  "advice.intro": "本次运行发现的问题，按严重程度排序，并给出各自的应对办法。",
  "advice.none": "无需改进：本次运行未发现瓶颈或问题。",
  "advice.show": "在地图上显示",
  "advice.more": "另有 {n} 条未显示。",
  "advice.severity.problem": "问题",
  "advice.severity.warning": "警告",
  "advice.crowdMap": "在地图上显示车辆满载程度（各线路最繁忙的一小时）",
  "advice.cap.stopped": "{line}：运行已停止：{problem}",
  "advice.cap.stoppedFix": "请在铁路工具中修正，然后重新运行测试。",
  "advice.cap.unplaced": "{line}：无法排进线路的车次：{n}",
  "advice.cap.unplacedFix":
    "在此时段降低该线路的发车频率，或在列车交会处留出更多空间：在 {terminal} 增加站台线或渡线，或在单线区段设置会让站。",
  "advice.cap.terminal": "{line}：终点站 {terminal} 是瓶颈，最繁忙一小时内占用 {share}（上限 {limit}）",
  "advice.cap.terminalFix":
    "列车占用其站台线时间过长。缩短折返（缩短停留时间，或在两端各安排一名等候的司机），增加一条站台线，或把渡线移近站台，使列车更早出清。",
  "advice.cap.section": "{line}：线路区段 {section} 是瓶颈，最繁忙一小时内占用 {share}（上限 {limit}）",
  "advice.cap.sectionFix":
    "列车占用该区段的时间比其他任何区段都长。提高通过该区段的速度可让列车更早出清；否则请减少此处的列车。",
  "advice.cap.sectionPlatform":
    "该区段是站台线：列车停靠站台期间一直占用。缩短停站时间，或为该方向增设第二条站台线，可让下一列车更早进站。",
  "advice.cap.sectionSwitches":
    "该区段是道岔区：列车在其经道岔的进路建立和解锁期间占用。采用侧向速度更高的道岔，或布置道岔使上下行不相交叉，可让它更早空出。",
  "advice.cap.signalAdd":
    "该区间段长 {length} m，而在 {speed} km/h 下一个闭塞分区只需 {block} m。在线路 {track} 约 {at} m 处增设一架闭塞信号机，让下一列车能更早进入前半段。",
  "advice.cap.signalShort":
    "该区段长 {length} m，不足 {speed} km/h 下两个 {block} m 的闭塞分区，再加信号机会使停车距离不足。采用车载信号（CBTC 或 ETCS 2 级）或降低此处速度，列车可追踪得更近。",
  "advice.cap.sectionCab":
    "在车载信号下列车已按制动距离追踪（{speed} km/h 时 {block} m），间隔不由信号机决定。提高区段速度或减少列车可让它更早空出。",
  "advice.cap.sectionSight":
    "有轨电车在此目视行车，间隔不由信号决定。缩短附近的停站时间，或采用与道路交通分隔的专用轨道，可让它更早空出。",
  "advice.cap.nearNote": "目前仍可运行，但已几乎没有加车的余地。",
  "advice.cap.pileUp": "{line}：延误不断累积，时段结束时平均仍有 {late}",
  "advice.cap.pileUpFix": "在终点站增加恢复时间，或略微降低发车频率，避免一列晚点的列车拖住下一列。",
  "advice.cap.full": "{line}：从 {from} 到 {to} 车辆满载率 {share}，{time}",
  "advice.cap.fullMore":
    "该时段共有 {left} 人上不了车。线路每方向每小时最多可开行 {n} 列：提高频率，或使用更长的列车。",
  "advice.cap.fullLonger": "该时段共有 {left} 人上不了车。如线路允许请提高频率，或使用更长的车辆。",
  "advice.cap.streetPileUp": "{line}：道路上延误不断累积，最后仍有 {late}",
  "advice.cap.streetPileUpFix":
    "为一个周转留出更多时间，或在终点站延长停留，让车辆能追回延误；在与交通相遇处设置专用车道最有效。",
  "advice.road.cannotRun": "{line} 无法运行",
  "advice.road.cannotRunFix": "{problem}。请在 创建 → 道路线路 中修正线路，然后重新运行。",
  "advice.road.late": "{line}：仅 {share} 的发车准点（低于 {limit} 时给出建议）",
  "advice.road.mostlySignals":
    "每趟在红灯前损失 {signals} 分钟，在车流中损失 {traffic} 分钟，因此主要损失在此处列出的信号灯。",
  "advice.road.mostlyTraffic":
    "每趟在车流中损失 {traffic} 分钟，在红灯前损失 {signals} 分钟，因此主要损失在此处列出的街道。",
  "advice.road.moreTime": "周转用时 {run} 分钟，计划为 {planned} 分钟：请计划更多运行时间，或增加一辆车。",
  "advice.road.bunched": "{line}：{share} 的发车出现串车",
  "advice.road.bunchedFix":
    "车辆相互追上。请在终点站按时刻表扣车，延长那里的停留时间，或在线路损失时间的地方给它专用车道。",
  "advice.road.ranOut": "{line}：电量耗尽的车辆：{n}",
  "advice.road.ranOutFix": "使用更大的电池，在终点站充电，或在白天更换车辆。",
  "advice.road.stuck": "{line}：被困 5 分钟或以上的车辆：{n}",
  "advice.road.stuckFix": "请在 GIS 选项卡中检查此处的街道设置和信号灯：可能缺少某个转向，或交通堵塞了路口。",
  "advice.road.notBack": "{line}：结束时未回到车场的车辆：{n}",
  "advice.road.notBackFix": "请检查线路与其车场之间的路径，或在末班之后留出更多时间。",
  "advice.road.unnamedStreet": "一条无名街道",
  "advice.road.unnamedJunction": "一个路口",
  "advice.road.spot.signal": "红灯（{place}）：共损失 {min} 分钟（{lines}）",
  "advice.road.spot.signalFix":
    "线路在这里等待的时间比任何地方都长。请为它们申请此信号灯的优先，或适合它们的配时。道路仿真尚未模拟优先，因此无法显示收益。",
  "advice.road.spot.street": "车流（{place}）：共损失 {min} 分钟（{lines}）",
  "advice.road.spot.streetFix":
    "在这条街上给线路专用车道（GIS 选项卡，街道设置：公交专用道），或让它们改走另一条街。",
  "advice.road.spot.junction": "停滞（{place}）：共损失 {min} 分钟（{lines}）",
  "advice.road.spot.junctionFix":
    "车辆停在这个路口内，等待转弯或出口放行。设置通往路口的专用车道，或在信号灯上单设转向相位，会有帮助。",
} satisfies AdviceMessages;
