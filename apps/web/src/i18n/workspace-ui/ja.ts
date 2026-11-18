import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (ja). */
export const workspaceUiJa = {
  "checks.menu": "チェック",
  "checks.menuCount": "チェック：エラー {errors} 件、警告 {warnings} 件",
  "checks.title": "すべてのモードのチェック",
  "checks.none":
    "まだチェックする項目はありません。路線、鉄道、車庫を描くと、そのチェックがここに表示されます。",
  "checks.lastOpened": "最後に開いたときの状態",
  "checks.streetLine": "道路路線 · {name}",
  "checks.railway": "鉄道",
  "checks.depot": "車庫 · {name}",
  "undo.undo": "元に戻す",
  "undo.redo": "やり直す",
  "tour.checks.title": "チェック",
  "tour.checks.body":
    "ベルはすべてのモードのチェックをエラーから順に一覧表示します：道路路線、鉄道、車庫、プラグインの路線。選ぶと場所を表示します。",
  "settings.serverTab": "サーバー",
  "settings.server.local":
    "MobSimLab はこのコンピューターで動作しています。代わりに、このアプリをバックグラウンドで動く MobSimLab サーバー（Docker サーバーなど）に接続できます。",
  "settings.server.address": "サーバーのアドレス",
  "settings.server.connect": "接続",
  "settings.server.note":
    "アプリはサーバーを確認し、切り替える前に確認を求めます。このコンピューターのプロジェクトはここに残ります。.mslab ファイルとして保存して移してください。アプリの設定（⌘, または Ctrl+,）で元に戻せます。",
} satisfies WorkspaceUiMessages;
