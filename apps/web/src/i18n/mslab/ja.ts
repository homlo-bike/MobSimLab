import type { MslabMessages } from "./en";

/** .mslab project file messages (ja). */
export const mslabJa = {
  "menu.saveMslab": ".mslab ファイルとして保存",
  "home.openMslab": ".mslab ファイルを開く",
  "home.openingMslab": "ファイルを開いています…",
  "home.openedMslab": "「{name}」を新しいプロジェクトとして開きました。",
  "home.leftOut": "取り込まれなかったもの：{list}",
  "mslab.body":
    "プロジェクトの図面、設定、シナリオ、プラグインを 1 つのファイルに保存します。どの MobSimLab でも開き直せます。",
  "mslab.runs": "保存済みのシミュレーション実行も含める（ファイルが大きくなります）",
  "mslab.map":
    "静的ビューア用の地図データを含める：プロジェクト区域の道路、建物、人口、国の数値（ファイルが大きくなり、数分かかることがあります）",
  "static.empty":
    "このサイトにはまだプロジェクトがありません。.mslab ファイルを projects フォルダーに置き、tools/add-projects.mjs を実行してください。",
  "mslab.save": "ファイルを保存",
} satisfies MslabMessages;
