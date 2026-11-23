import type { AdviceMessages } from "./en";

/** Advice messages (ko). */
export const adviceKo = {
  "advice.title": "개선할 점",
  "advice.intro": "이번 실행에서 찾은 문제를 심각한 것부터, 각각 할 수 있는 조치와 함께 보여 줍니다.",
  "advice.none": "개선할 점이 없습니다. 이번 실행에서 병목이나 문제가 발견되지 않았습니다.",
  "advice.show": "지도에 표시",
  "advice.more": "{n}개 더 있음.",
  "advice.severity.problem": "문제",
  "advice.severity.warning": "경고",
  "advice.crowdMap": "차량 혼잡도를 지도에 표시(각 노선의 가장 붐비는 시간)",
  "advice.cap.stopped": "{line}: 실행이 중단되었습니다: {problem}",
  "advice.cap.stoppedFix": "철도 도구에서 수정한 뒤 테스트를 다시 실행하세요.",
  "advice.cap.unplaced": "{line}: 선로에 들어가지 못하는 운행: {n}",
  "advice.cap.unplacedFix":
    "이 시간대에 노선 운행을 줄이거나, 열차가 만나는 곳에 여유를 주세요: {terminal}에 승강장 선로나 건넘선을 늘리거나, 단선 구간에 교행 설비를 두세요.",
  "advice.cap.terminal":
    "{line}: 종착역 {terminal}이(가) 병목이며, 가장 붐비는 시간의 {share} 동안 사용 중입니다(한도 {limit})",
  "advice.cap.terminalFix":
    "열차가 승강장 선로를 너무 오래 점유합니다. 회차를 줄이거나(정차 시간 단축, 또는 양 끝에서 기다리는 기관사), 승강장 선로를 추가하거나, 건넘선을 승강장 가까이 옮겨 열차가 더 빨리 빠지게 하세요.",
  "advice.cap.section":
    "{line}: 선로 구간 {section}이(가) 병목이며, 가장 붐비는 시간의 {share} 동안 사용 중입니다(한도 {limit})",
  "advice.cap.sectionFix":
    "열차가 이 구간을 다른 어떤 구간보다 오래 점유합니다. 구간 내 속도를 높이면 더 빨리 빠질 수 있고, 그렇지 않다면 이곳의 열차를 줄이세요.",
  "advice.cap.sectionPlatform":
    "이 구간은 승강장 선로로, 열차가 승강장에 서 있는 동안 점유합니다. 정차 시간을 줄이거나 이 방향에 두 번째 승강장 선로를 두면 다음 열차가 더 일찍 들어옵니다.",
  "advice.cap.sectionSwitches":
    "이 구간은 분기기 구역으로, 분기기를 지나는 진로가 설정되고 해제되는 동안 열차가 점유합니다. 분기 측 속도가 높은 분기기나 두 방향이 서로 교차하지 않도록 놓은 분기기가 더 빨리 비웁니다.",
  "advice.cap.signalAdd":
    "이 역간 구간은 {length} m인데, {speed} km/h에서 폐색 구간은 {block} m면 됩니다. 선로 {track}의 약 {at} m 지점에 폐색 신호기를 추가하면 다음 열차가 앞쪽 절반에 더 일찍 들어갈 수 있습니다.",
  "advice.cap.signalShort":
    "이 구간은 {length} m로, {speed} km/h에서 {block} m 폐색 구간 두 개보다 짧아 신호기를 더 두면 정지할 거리가 부족합니다. 차상 신호(CBTC 또는 ETCS 레벨 2)나 이곳의 속도를 낮추면 열차가 더 가깝게 따라갈 수 있습니다.",
  "advice.cap.sectionCab":
    "차상 신호에서는 열차가 이미 제동 거리({speed} km/h에서 {block} m) 간격으로 따라가며, 신호기가 간격을 정하지 않습니다. 구간 속도를 높이거나 열차를 줄이면 더 빨리 비워집니다.",
  "advice.cap.sectionSight":
    "이곳에서는 노면전차가 목측 운전을 하므로 신호가 간격을 정하지 않습니다. 근처 정류장의 정차를 줄이거나 도로 교통과 분리된 전용 궤도를 두면 더 빨리 비워집니다.",
  "advice.cap.nearNote": "아직 운영되지만 열차를 추가할 여유가 거의 없습니다.",
  "advice.cap.pileUp": "{line}: 지연이 누적되어 시간대가 끝날 때도 평균 {late} 남아 있습니다",
  "advice.cap.pileUpFix":
    "종착역에 회복 시간을 더하거나 운행을 조금 줄여, 늦은 열차가 다음 열차를 붙잡지 않게 하세요.",
  "advice.cap.full": "{line}: {from}에서 {to}까지 차량 혼잡도 {share}, {time}",
  "advice.cap.fullMore":
    "이 시간대에 {left}명이 타지 못하고 남습니다. 선로는 방향별 시간당 최대 {n}회 운행을 허용합니다. 더 자주 운행하거나 더 긴 열차를 쓰세요.",
  "advice.cap.fullLonger":
    "이 시간대에 {left}명이 타지 못하고 남습니다. 선로가 허용하면 더 자주 운행하거나 더 긴 차량을 쓰세요.",
  "advice.cap.streetPileUp": "{line}: 도로에서 지연이 누적되어 마지막에도 {late} 남아 있습니다",
  "advice.cap.streetPileUpFix":
    "한 바퀴에 시간을 더 주거나 종점 대기 시간을 늘려 차량이 지연을 만회하게 하세요. 교통과 만나는 곳의 전용 차로가 가장 효과적입니다.",
  "advice.road.cannotRun": "{line}을(를) 운행할 수 없었습니다",
  "advice.road.cannotRunFix": "{problem}. 만들기 → 도로 노선에서 노선을 고친 뒤 다시 실행하세요.",
  "advice.road.late": "{line}: 정시 출발이 {share}뿐입니다({limit} 미만이면 조언)",
  "advice.road.mostlySignals":
    "운행마다 빨간불에서 {signals}분, 교통 속에서 {traffic}분을 잃으므로 대부분 여기 나열된 신호등에서입니다.",
  "advice.road.mostlyTraffic":
    "운행마다 교통 속에서 {traffic}분, 빨간불에서 {signals}분을 잃으므로 대부분 여기 나열된 도로에서입니다.",
  "advice.road.moreTime":
    "한 바퀴에 계획된 {planned}분 대신 {run}분이 걸렸습니다. 운행 시간을 더 잡거나 차량을 한 대 추가하세요.",
  "advice.road.bunched": "{line}: 출발의 {share}가 몰려서 옵니다",
  "advice.road.bunchedFix":
    "차량들이 서로 따라잡습니다. 종점에서 시간표대로 대기시키거나, 그곳의 대기 시간을 늘리거나, 시간을 잃는 곳에 노선 전용 차로를 주세요.",
  "advice.road.ranOut": "{line}: 충전이 바닥난 차량: {n}",
  "advice.road.ranOutFix": "더 큰 배터리를 쓰거나, 종점에서 충전하거나, 낮 동안 차량을 교체하세요.",
  "advice.road.stuck": "{line}: 5분 이상 갇힌 차량: {n}",
  "advice.road.stuckFix":
    "GIS 탭에서 이곳의 도로 설정과 신호등을 확인하세요. 회전이 빠져 있거나 교통이 교차로를 막고 있을 수 있습니다.",
  "advice.road.notBack": "{line}: 종료 시 차고로 돌아오지 않은 차량: {n}",
  "advice.road.notBackFix": "노선과 차고 사이의 경로를 확인하거나, 마지막 운행 뒤 시간을 더 주세요.",
  "advice.road.unnamedStreet": "이름 없는 도로",
  "advice.road.unnamedJunction": "교차로",
  "advice.road.spot.signal": "빨간불({place}): 총 {min}분 손실({lines})",
  "advice.road.spot.signalFix":
    "노선들이 다른 어느 곳보다 여기서 오래 기다립니다. 이 신호에서 우선 신호나 노선에 맞는 신호 시간을 요청하세요. 도로 시뮬레이션은 아직 우선 신호를 모델링하지 않아 효과를 보여 줄 수 없습니다.",
  "advice.road.spot.street": "교통({place}): 총 {min}분 손실({lines})",
  "advice.road.spot.streetFix":
    "이 도로에서 노선에 전용 차로를 주거나(GIS 탭, 도로 설정: 버스 차로) 다른 도로로 다니게 하세요.",
  "advice.road.spot.junction": "정지({place}): 총 {min}분 손실({lines})",
  "advice.road.spot.junctionFix":
    "차량이 이 교차로 안에서 회전하거나 출구가 비기를 기다리며 서 있습니다. 교차로까지의 전용 차로나 신호의 별도 회전 현시가 도움이 됩니다.",
} satisfies AdviceMessages;
