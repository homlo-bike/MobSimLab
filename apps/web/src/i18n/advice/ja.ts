import type { AdviceMessages } from "./en";

/** Advice messages (ja). */
export const adviceJa = {
  "advice.title": "改善すべき点",
  "advice.intro": "この実行で見つかった問題を深刻なものから順に、それぞれにできることとあわせて示します。",
  "advice.none": "改善すべき点はありません。この実行ではボトルネックも問題も見つかりませんでした。",
  "advice.show": "地図で表示",
  "advice.more": "ほかに {n} 件あります。",
  "advice.severity.problem": "問題",
  "advice.severity.warning": "警告",
  "advice.crowdMap": "車両の混雑を地図に表示（各路線の最混雑時間帯）",
  "advice.cap.stopped": "{line}：実行が停止しました：{problem}",
  "advice.cap.stoppedFix": "鉄道ツールで修正してから、テストをもう一度実行してください。",
  "advice.cap.unplaced": "{line}：線路に収まらない便：{n}",
  "advice.cap.unplacedFix":
    "この時間帯の運行本数を減らすか、列車が出会う場所に余裕を持たせてください。{terminal} の番線や渡り線を増やす、または単線区間に行き違い設備を設けます。",
  "advice.cap.terminal":
    "{line}：終端駅 {terminal} がボトルネックで、最混雑時間帯の {share} が使用中です（上限 {limit}）",
  "advice.cap.terminalFix":
    "列車がホームの線路を長く占有しすぎています。折り返しを短くする（停車時間の短縮、または両端で待機する運転士）、ホームの線路を増やす、または渡り線をホームに近づけて列車が早く抜けられるようにしてください。",
  "advice.cap.section":
    "{line}：線路区間 {section} がボトルネックで、最混雑時間帯の {share} が使用中です（上限 {limit}）",
  "advice.cap.sectionFix":
    "列車はこの区間をほかのどの区間よりも長く占有しています。区間内の速度を上げれば早く抜けられます。そうでなければ、ここを通る列車を減らしてください。",
  "advice.cap.sectionPlatform":
    "この区間はホームの線路で、列車は停車中ずっと占有します。停車時間を短くするか、この方向に 2 本目のホームの線路を設ければ、次の列車が早く入れます。",
  "advice.cap.sectionSwitches":
    "この区間は分岐器の区域で、分岐器を通る進路が設定・解除される間、列車が占有します。分岐側の速度が高い分岐器にするか、上下方向が交差しない配置にすると、早く空きます。",
  "advice.cap.signalAdd":
    "この駅間区間は {length} m ありますが、{speed} km/h で必要な閉そく長は {block} m だけです。線路 {track} の約 {at} m の位置に閉そく信号機を追加すれば、次の列車が前半部分に早く進入できます。",
  "advice.cap.signalShort":
    "この区間は {length} m で、{speed} km/h での閉そく長 {block} m の 2 区間分に満たないため、信号機を追加すると停止に必要な距離が足りなくなります。車内信号（CBTC または ETCS レベル 2）か、ここでの速度を下げることで、列車の間隔を詰められます。",
  "advice.cap.sectionCab":
    "車内信号では列車はすでにブレーキ距離（{speed} km/h で {block} m）の間隔で続行しており、信号機が間隔を決めているわけではありません。区間内の速度を上げるか列車を減らすと、早く空きます。",
  "advice.cap.sectionSight":
    "ここでは路面電車は目視運転のため、信号が間隔を決めていません。近くの停留所での停車を短くするか、道路交通から分離した専用軌道にすると、早く空きます。",
  "advice.cap.nearNote": "まだ成り立っていますが、列車を増やす余裕はほとんどありません。",
  "advice.cap.pileUp": "{line}：遅れが積み重なり、時間帯の終わりにも平均 {late} 残っています",
  "advice.cap.pileUpFix":
    "終端駅に回復時間を加えるか、運行本数を少し減らして、遅れた列車が次の列車を足止めしないようにしてください。",
  "advice.cap.full": "{line}：{from} から {to} までの乗車率が {share}、{time}",
  "advice.cap.fullMore":
    "この時間帯に {left} 人が乗れずに残されます。線路は片方向 1 時間あたり最大 {n} 本まで対応できます。本数を増やすか、編成を長くしてください。",
  "advice.cap.fullLonger":
    "この時間帯に {left} 人が乗れずに残されます。線路が許せば本数を増やすか、長い車両を使ってください。",
  "advice.cap.streetPileUp": "{line}：道路上で遅れが積み重なり、最後にも {late} 残っています",
  "advice.cap.streetPileUpFix":
    "一周の時間を多めに取るか、終点での折り返し時間を長くして、車両が遅れを取り戻せるようにしてください。交通と出会う場所での専用レーンが最も効果的です。",
  "advice.road.cannotRun": "{line} は運行できませんでした",
  "advice.road.cannotRunFix": "{problem}。作成 → 道路路線 で路線を修正してから、もう一度実行してください。",
  "advice.road.late": "{line}：定時の発車は {share} だけです（{limit} 未満で助言）",
  "advice.road.mostlySignals":
    "1 便あたり赤信号で {signals} 分、交通で {traffic} 分を失っています。つまり大半はここに挙げた信号機です。",
  "advice.road.mostlyTraffic":
    "1 便あたり交通で {traffic} 分、赤信号で {signals} 分を失っています。つまり大半はここに挙げた道路です。",
  "advice.road.moreTime":
    "一周に計画の {planned} 分に対して {run} 分かかりました。走行時間を多めに計画するか、車両を 1 台追加してください。",
  "advice.road.bunched": "{line}：発車の {share} が団子運転です",
  "advice.road.bunchedFix":
    "車両が互いに追いついています。終点で時刻表どおりに待たせる、そこでの折り返し時間を長くする、または時間を失う場所で路線に専用レーンを与えてください。",
  "advice.road.ranOut": "{line}：充電が切れた車両：{n}",
  "advice.road.ranOutFix": "大きなバッテリーを使う、終点で充電する、または日中に車両を入れ替えてください。",
  "advice.road.stuck": "{line}：5 分以上立ち往生した車両：{n}",
  "advice.road.stuckFix":
    "GIS タブでこの場所の道路設定と信号機を確認してください。右左折が欠けているか、交通が交差点をふさいでいる可能性があります。",
  "advice.road.notBack": "{line}：終了時に車庫へ戻っていない車両：{n}",
  "advice.road.notBackFix": "路線と車庫の間の経路を確認するか、最終便のあとに時間を多めに取ってください。",
  "advice.road.unnamedStreet": "名前のない道路",
  "advice.road.unnamedJunction": "交差点",
  "advice.road.spot.signal": "赤信号（{place}）：合計 {min} 分の損失（{lines}）",
  "advice.road.spot.signalFix":
    "路線はここでほかのどこよりも長く待っています。この信号での優先、または路線に合った信号時間を求めてください。道路シミュレーションはまだ優先を再現しないため、効果は示せません。",
  "advice.road.spot.street": "交通（{place}）：合計 {min} 分の損失（{lines}）",
  "advice.road.spot.streetFix":
    "この道路で路線に専用レーンを与える（GIS タブ、道路設定：バスレーン）か、別の道路を通してください。",
  "advice.road.spot.junction": "停止（{place}）：合計 {min} 分の損失（{lines}）",
  "advice.road.spot.junctionFix":
    "車両がこの交差点内で、右左折待ちや出口が空くのを待って止まっています。交差点までの専用レーンや、信号での右左折専用現示が有効です。",
} satisfies AdviceMessages;
