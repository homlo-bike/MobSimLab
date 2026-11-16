import type { MslabMessages } from "./en";

/** .mslab project file messages (ko). */
export const mslabKo = {
  "menu.saveMslab": ".mslab 파일로 저장",
  "home.openMslab": ".mslab 파일 열기",
  "home.openingMslab": "파일을 여는 중…",
  "home.openedMslab": "“{name}”을(를) 새 프로젝트로 열었습니다.",
  "home.leftOut": "가져오지 않음: {list}",
  "mslab.body":
    "프로젝트의 도면, 환경설정, 시나리오, 플러그인을 하나의 파일로 저장합니다. 어느 MobSimLab에서나 다시 열 수 있습니다.",
  "mslab.runs": "저장된 시뮬레이션 실행 포함 (파일이 커집니다)",
  "mslab.map":
    "정적 뷰어용 지도 데이터 포함: 프로젝트 지역의 도로, 건물, 인구 및 국가 수치 (파일이 커지며 몇 분 걸릴 수 있음)",
  "static.empty":
    "이 사이트에는 아직 프로젝트가 없습니다. .mslab 파일을 projects 폴더에 넣고 tools/add-projects.mjs를 실행하세요.",
  "mslab.save": "파일 저장",
} satisfies MslabMessages;
