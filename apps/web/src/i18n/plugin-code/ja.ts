import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (ja). */
export const pluginCodeJa = {
  "pcode.title": "プラグインの計算",
  "pcode.intro": "インストール済みプラグインの計算です。ブラウザー内のサンドボックスで実行され、インターネットや他のプロジェクトにはアクセスできません。",
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
  "pcode.frameNote": "このページは {publisher} の {plugin} プラグインのものです。インターネットやあなたのアカウントにはアクセスできません。",
  "pcode.runsCode": "独自のコードをサンドボックスで実行",
  "pcode.limits": "プラグインコードの制限",
  "pcode.limitsIntro": "プラグインコードの呼び出しごとに、ブラウザーとサーバーで最大この量のメモリと時間が割り当てられます。",
  "pcode.memory": "メモリ（MB）",
  "pcode.time": "時間（秒）",
  "pcode.saveLimits": "制限を保存",
  "pcode.saved": "保存しました。",
  "pcode.installIntro": ".msplugin ファイルをアップロードしてください。MobSimLab がファイルを確認し、インストール前に追加内容を表示します。プラグインは交通手段、ツール、パラメーター、出典を追加でき、独自のコード（計算、インポート、エクスポート、タブページ）をインターネットにアクセスできないサンドボックスで実行できます。",
} satisfies PluginCodeMessages;
