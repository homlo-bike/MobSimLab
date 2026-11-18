import type { pluginAdminEn } from "./en";

/** 日本語: messages of the Plugins tab of Administration. */
export const pluginAdminJa: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro":
    "この MobSimLab のプラグインです。ここでオフにしたプラグインはすべてのプロジェクトでオフになります。",
  "padmin.publishers": "発行元と制限",
  "padmin.configure": "設定",
  "padmin.configureName": "{name} を設定",
  "padmin.useName": "この MobSimLab で {name} を使う",
  "padmin.offEverywhere": "すべてのプロジェクトでオフ",
  "padmin.needsKey": "API キーが必要です",
  "padmin.accept": "変更を適用",
  "padmin.services": "このプラグインが使うサービス",
  "padmin.nothingToSet":
    "このプラグインには設定項目がありません。各プロジェクトがプロジェクト設定でオン・オフします。",
  "padmin.versions": "インストール済みのバージョン",
  "padmin.undo": "元に戻す",
  "padmin.removedOnAccept": "変更を適用するとキーが削除されます。",
  "padmin.changedOnAccept": "変更を適用すると反映されます。",
  "padmin.keyReplace": "保存済みのキーを置き換える新しいキーを入力",
  "padmin.esriTermsFirst": "キーを保存するには Esri の利用規約に同意してください。",
  "padmin.offByAdmin": "管理者がこの MobSimLab でオフにしました。",
};
