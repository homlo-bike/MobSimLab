import type { AreaMessages } from "./en";

/** Project area messages (ja). */
export const areaJa = {
  "aw.title": "プロジェクト範囲",
  "aw.editing": "{name} の範囲を編集中",
  "aw.search": "地図を移動する場所を検索（例: ホムス）",
  "aw.tools": "描画ツール",
  "aw.draw": "ポリゴンを描く",
  "aw.edit": "頂点を編集",
  "aw.pan": "移動",
  "aw.hint.draw":
    "クリックで頂点を追加します。最初の頂点をクリックするか Enter キーでポリゴンを閉じます。Backspace キーで最後の頂点を取り消します。",
  "aw.hint.edit":
    "ポリゴンをクリックして選択します。頂点をドラッグして移動、中点をドラッグして頂点を追加、頂点をダブルクリックして削除します。",
  "aw.hint.pan": "ドラッグで地図を移動します。ポリゴンをクリックして選択します。",
  "aw.statArea": "面積",
  "aw.statDownload": "推定ダウンロード量",
  "aw.mb": "{mb} MB",
  "aw.limit": "上限 {mb} MB",
  "aw.overLimit":
    "この範囲の地図データは、1 プロジェクトの上限 {mb} MB を超えています。範囲を小さくするか、路線沿いのポリゴンを「幹線道路と鉄道のみ」にしてください。",
  "aw.polygons": "ポリゴン",
  "aw.empty":
    "ポリゴンはまだありません。プロジェクトが対象とする各地点を囲むポリゴンと、各都市間路線に沿った細長いポリゴンを描いてください。",
  "aw.detail.full": "すべて",
  "aw.detail.main": "幹線道路と鉄道のみ",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "名前",
  "aw.detail": "詳細度",
  "aw.fullHelp": "街路、小道、建物、学校と病院、100 m 単位の人口、地形。",
  "aw.mainHelp":
    "高速道路、主要幹線道路、鉄道、地形、1 km 単位の人口。建物は含みません。騒音マップと徒歩アクセスのため、沿線の町は「すべて」で描いてください。",
  "aw.delete": "ポリゴンを削除",
  "aw.newName": "範囲 {n}",
  "aw.save": "範囲を保存",
  "aw.confirm.title": "新しい部分の地図データをダウンロードしますか？",
  "aw.confirm.body":
    "新規または変更: {list}。約 {mb} MB 必要です。削除した部分は使われなくなります。確定するまで何もダウンロードしません。",
  "aw.confirm.item": "{name}（{detail}、{area} km²）",
  "aw.confirm.back": "地図に戻る",
  "aw.confirm.save": "保存して {mb} MB をダウンロード",
  "aw.select": "範囲を選択",
  "aw.selectHint": "地図上にプロジェクトの境界を描きます。地図データはその内側だけダウンロードします。",
  "aw.change": "範囲を変更",
  "aw.download": "地図データ約 {mb} MB",
  "aw.outline": "プロジェクト範囲の輪郭",
  "aw.prefsIntro":
    "プロジェクトの周りに描いたポリゴンです。地図データはその内側だけ、各ポリゴンの詳細度でダウンロードします。",
  "aw.dataFrom": "{date} の地図データ",
  "aw.noData": "地図データは未ダウンロード",
  "aw.editArea": "範囲を編集",
  "aw.drawArea": "範囲を描く",
  "aw.refresh": "地図データを更新",
  "aw.refreshHelp":
    "更新すると、同じ範囲の最新の OpenStreetMap データをダウンロードします。それまで計画はデータの日付を保ちます。",
  "aw.none": "プロジェクト範囲はまだありません。ツールが地図データを使えるよう、範囲を描いてください。",
  "aw.saved": "範囲を保存しました。",
  "aw.data.noArea":
    "まずプロジェクト設定でプロジェクト範囲を描いてください。インポートはその範囲を対象にします。",
  "aw.data.area": "プロジェクト範囲: {names}。インポートはそれを囲む矩形（{area} km²）を対象にします。",
  "aw.pop.none": "プロジェクト範囲はまだありません。プロジェクト設定で描いてください。",
  "aw.pop.box": "プロジェクト範囲を囲む矩形: {km2} km²。",
  "aw.tiles.other": "地図タイル {count} 枚",
  "aw.count.other": "ポリゴン {count} 個",
} satisfies AreaMessages;
