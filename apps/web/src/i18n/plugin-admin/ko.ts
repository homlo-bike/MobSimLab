import type { pluginAdminEn } from "./en";

/** 한국어: messages of the Plugins tab of Administration. */
export const pluginAdminKo: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro": "이 MobSimLab의 플러그인입니다. 여기서 끈 플러그인은 모든 프로젝트에서 꺼집니다.",
  "padmin.publishers": "게시자 및 제한",
  "padmin.configure": "설정",
  "padmin.configureName": "{name} 설정",
  "padmin.useName": "이 MobSimLab에서 {name} 사용",
  "padmin.offEverywhere": "모든 프로젝트에서 꺼짐",
  "padmin.needsKey": "API 키가 필요합니다",
  "padmin.accept": "변경 사항 적용",
  "padmin.services": "이 플러그인이 사용하는 서비스",
  "padmin.nothingToSet":
    "이 플러그인은 설정할 항목이 없습니다. 각 프로젝트가 프로젝트 환경설정에서 켜거나 끕니다.",
  "padmin.versions": "설치된 버전",
  "padmin.undo": "실행 취소",
  "padmin.removedOnAccept": "변경 사항을 적용하면 키가 삭제됩니다.",
  "padmin.changedOnAccept": "변경 사항을 적용하면 바뀝니다.",
  "padmin.keyReplace": "저장된 키를 바꿀 새 키를 입력하세요",
  "padmin.esriTermsFirst": "키를 저장하려면 Esri 이용 약관에 동의하세요.",
  "padmin.offByAdmin": "관리자가 이 MobSimLab에서 껐습니다.",
};
