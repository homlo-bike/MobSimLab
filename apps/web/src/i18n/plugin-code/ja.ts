import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (ja). */
export const pluginCodeJa = {
  "pcode.title": "プラグインの計算",
  "pcode.intro":
    "インストール済みプラグインの計算です。ブラウザー内のサンドボックスで実行され、インターネットや他のプロジェクトにはアクセスできません。",
  "pcode.by": "{plugin} · {publisher}",
  "pcode.run": "計算",
  "pcode.running": "計算中…",
  "pcode.failed": "{plugin} は計算できませんでした: {error}",
  "pcode.noRows": "行がありません。",
  "pcode.log": "プラグインのログ（{count} 行）",
  "pcode.import": "{label} をインポート（{plugin}）",
  "pcode.export": "{label} としてダウンロード（{plugin}）",
  "pcode.importFailed": "{plugin} はファイルを読み込めませんでした: {error}",
  "pcode.exportFailed": "{plugin} はファイルを書き出せませんでした: {error}",
  "pcode.frameTitle": "{tab}（{plugin} プラグインのページ）",
  "pcode.frameNote":
    "このページは {publisher} の {plugin} プラグインのものです。インターネットやあなたのアカウントにはアクセスできません。",
  "pcode.runsCode": "独自のコードをサンドボックスで実行",
  "pcode.limits": "プラグインコードの制限",
  "pcode.limitsIntro":
    "プラグインコードの呼び出しごとに、ブラウザーとサーバーで最大この量のメモリと時間が割り当てられます。",
  "pcode.memory": "メモリ（MB）",
  "pcode.time": "時間（秒）",
  "pcode.saveLimits": "制限を保存",
  "pcode.saved": "保存しました。",
  "pcode.installIntro":
    ".msplugin ファイルをアップロードしてください。MobSimLab がファイルを確認し、インストール前に追加内容を表示します。プラグインは交通手段、ツール、パラメーター、出典を追加でき、独自のコード（計算、インポート、エクスポート、タブページ）をインターネットにアクセスできないサンドボックスで実行できます。",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "1 ピクセルあたり約 0.3〜1 m の航空写真。Esri では ArcGIS Location Platform アカウントの ArcGIS API キーと利用規約への同意が必要です。タイルはこの MobSimLab を経由するため、ブラウザーにキーは渡らず、タイルも保存されません。",
  "esri.key": "ArcGIS API キー",
  "esri.accept": "この MobSimLab について Esri の利用規約に同意します",
  "esri.terms": "Esri の規約",
  "esri.save": "キーを保存",
  "esri.remove": "キーを削除",
  "esri.saved":
    "末尾 {end} のキーを {name} が {date} に保存しました。地図のレイヤー切り替えで Esri World Imagery を選べます。",
  "esri.none": "キーが保存されていないため、Esri World Imagery は表示されません。",
} satisfies PluginCodeMessages;
