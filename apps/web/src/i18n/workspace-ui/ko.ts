import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (ko). */
export const workspaceUiKo = {
  "checks.menu": "검사",
  "checks.menuCount": "검사: 오류 {errors}개, 경고 {warnings}개",
  "checks.title": "모든 모드의 검사",
  "checks.none":
    "아직 검사할 항목이 없습니다. 노선, 철도 또는 차고지를 그리면 검사 결과가 여기에 표시됩니다.",
  "checks.lastOpened": "마지막으로 열었을 때 기준",
  "checks.streetLine": "도로 노선 · {name}",
  "checks.railway": "철도",
  "checks.depot": "차고지 · {name}",
  "undo.undo": "실행 취소",
  "undo.redo": "다시 실행",
  "tour.checks.title": "검사",
  "tour.checks.body":
    "종 모양 버튼은 모든 모드의 검사를 오류부터 보여 줍니다: 도로 노선, 철도, 차고지, 플러그인 노선. 하나를 선택하면 위치를 보여 줍니다.",
  "settings.serverTab": "서버",
  "settings.server.local":
    "MobSimLab이 이 컴퓨터에서 실행 중입니다. 대신 이 앱을 백그라운드에서 실행되는 MobSimLab 서버(예: Docker 서버)에 연결할 수 있습니다.",
  "settings.server.address": "서버 주소",
  "settings.server.connect": "연결",
  "settings.server.note":
    "앱이 서버를 확인하고 전환하기 전에 묻습니다. 이 컴퓨터의 프로젝트는 여기에 남습니다. .mslab 파일로 저장하여 옮기세요. 앱 설정(⌘, 또는 Ctrl+,)에서 되돌릴 수 있습니다.",
} satisfies WorkspaceUiMessages;
