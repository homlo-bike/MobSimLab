import type { AreaMessages } from "./en";

/** Project area messages (ko). */
export const areaKo = {
  "aw.title": "프로젝트 구역",
  "aw.editing": "{name} 구역 편집 중",
  "aw.search": "지도를 옮길 장소 검색(예: 홈스)",
  "aw.tools": "그리기 도구",
  "aw.draw": "다각형 그리기",
  "aw.edit": "점 편집",
  "aw.pan": "이동",
  "aw.hint.draw":
    "클릭해 꼭짓점을 추가합니다. 첫 꼭짓점을 클릭하거나 Enter 키를 눌러 다각형을 닫습니다. Backspace 키는 마지막 꼭짓점을 지웁니다.",
  "aw.hint.edit":
    "다각형을 클릭해 선택합니다. 꼭짓점을 끌어 옮기고, 중간점을 끌어 꼭짓점을 추가하고, 꼭짓점을 두 번 클릭해 지웁니다.",
  "aw.hint.pan": "끌어서 지도를 옮깁니다. 다각형을 클릭해 선택합니다.",
  "aw.statArea": "면적",
  "aw.statDownload": "예상 다운로드",
  "aw.mb": "{mb} MB",
  "aw.limit": "한도 {mb} MB",
  "aw.overLimit":
    "이 구역의 지도 데이터가 프로젝트 한도인 {mb} MB를 넘습니다. 구역을 줄이거나, 노선을 따라 그린 다각형을 '간선 도로와 철도만'으로 설정하세요.",
  "aw.polygons": "다각형",
  "aw.empty":
    "아직 다각형이 없습니다. 프로젝트가 다루는 각 장소를 둘러싸는 다각형과 각 도시 간 노선을 따라 좁은 다각형을 그리세요.",
  "aw.detail.full": "전체",
  "aw.detail.main": "간선 도로와 철도만",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "이름",
  "aw.detail": "상세 수준",
  "aw.fullHelp": "도로, 보행로, 건물, 학교와 병원, 100 m 단위 인구, 지형.",
  "aw.mainHelp":
    "고속도로, 주요 간선 도로, 철도, 지형, 1 km 단위 인구. 건물 없음: 소음 지도와 도보 접근을 위해 노선 위 도시는 '전체'로 그리세요.",
  "aw.delete": "다각형 삭제",
  "aw.newName": "구역 {n}",
  "aw.save": "구역 저장",
  "aw.confirm.title": "새 부분의 지도 데이터를 다운로드할까요?",
  "aw.confirm.body":
    "새로 추가되거나 바뀐 부분: {list}. 약 {mb} MB가 필요합니다. 지운 부분은 더 이상 쓰지 않습니다. 확인하기 전에는 아무것도 다운로드하지 않습니다.",
  "aw.confirm.item": "{name}({detail}, {area} km²)",
  "aw.confirm.back": "지도로 돌아가기",
  "aw.confirm.save": "저장하고 {mb} MB 다운로드",
  "aw.select": "구역 선택",
  "aw.selectHint": "지도에 프로젝트 경계를 그립니다. 지도 데이터는 그 안에서만 다운로드합니다.",
  "aw.change": "구역 변경",
  "aw.download": "지도 데이터 약 {mb} MB",
  "aw.outline": "프로젝트 구역 윤곽",
  "aw.prefsIntro":
    "프로젝트 주변에 그린 다각형입니다. 지도 데이터는 그 안에서만, 다각형마다의 상세 수준으로 다운로드합니다.",
  "aw.dataFrom": "{date} 지도 데이터",
  "aw.noData": "지도 데이터를 아직 다운로드하지 않음",
  "aw.editArea": "구역 편집",
  "aw.drawArea": "구역 그리기",
  "aw.refresh": "지도 데이터 새로 고침",
  "aw.refreshHelp":
    "새로 고침은 같은 구역의 현재 OpenStreetMap 데이터를 다운로드합니다. 그때까지 계획은 데이터 날짜를 유지합니다.",
  "aw.none": "아직 프로젝트 구역이 없습니다. 도구가 지도 데이터를 쓸 수 있도록 구역을 그리세요.",
  "aw.saved": "구역을 저장했습니다.",
  "aw.data.noArea": "먼저 프로젝트 환경설정에서 프로젝트 구역을 그리세요. 가져오기는 그 구역을 다룹니다.",
  "aw.data.area": "프로젝트 구역: {names}. 가져오기는 이를 둘러싼 사각형({area} km²)을 다룹니다.",
  "aw.pop.none": "아직 프로젝트 구역이 없습니다. 프로젝트 환경설정에서 그리세요.",
  "aw.pop.box": "프로젝트 구역을 둘러싼 사각형: {km2} km².",
  "aw.tiles.other": "지도 타일 {count}개",
  "aw.count.other": "다각형 {count}개",
} satisfies AreaMessages;
