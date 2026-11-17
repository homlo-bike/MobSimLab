import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (ko). */
export const pluginCodeKo = {
  "pcode.title": "플러그인 계산",
  "pcode.intro":
    "설치된 플러그인의 계산입니다. 브라우저의 샌드박스에서 실행되며 인터넷이나 다른 프로젝트에 접근할 수 없습니다.",
  "pcode.by": "{plugin} · {publisher}",
  "pcode.run": "계산",
  "pcode.running": "계산 중…",
  "pcode.failed": "{plugin}이(가) 계산하지 못했습니다: {error}",
  "pcode.noRows": "행이 없습니다.",
  "pcode.log": "플러그인 로그({count}줄)",
  "pcode.import": "{label} 가져오기({plugin})",
  "pcode.export": "{label}(으)로 다운로드({plugin})",
  "pcode.importFailed": "{plugin}이(가) 파일을 읽지 못했습니다: {error}",
  "pcode.exportFailed": "{plugin}이(가) 파일을 쓰지 못했습니다: {error}",
  "pcode.frameTitle": "{tab}, {plugin} 플러그인의 페이지",
  "pcode.frameNote":
    "이 페이지는 {publisher}의 {plugin} 플러그인에서 제공됩니다. 인터넷이나 계정에 접근할 수 없습니다.",
  "pcode.runsCode": "자체 코드를 샌드박스에서 실행",
  "pcode.limits": "플러그인 코드 제한",
  "pcode.limitsIntro":
    "플러그인 코드를 호출할 때마다 브라우저와 서버에서 최대 이만큼의 메모리와 시간을 사용합니다.",
  "pcode.memory": "메모리(MB)",
  "pcode.time": "시간(초)",
  "pcode.saveLimits": "제한 저장",
  "pcode.saved": "저장했습니다.",
  "pcode.installIntro":
    ".msplugin 파일을 업로드하세요. MobSimLab이 파일을 확인하고 설치 전에 추가되는 내용을 보여 줍니다. 플러그인은 교통수단, 도구, 매개변수, 출처를 추가할 수 있으며 자체 코드(계산, 가져오기, 내보내기, 탭 페이지)를 인터넷이 없는 샌드박스에서 실행할 수 있습니다.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "픽셀당 약 0.3~1m의 항공사진입니다. Esri는 ArcGIS Location Platform 계정의 ArcGIS API 키와 약관 동의가 필요합니다. 타일은 이 MobSimLab을 거쳐 오므로 브라우저는 키를 볼 수 없고, 타일은 저장되지 않습니다.",
  "esri.key": "ArcGIS API 키",
  "esri.accept": "이 MobSimLab에 대해 Esri 이용 약관에 동의합니다",
  "esri.terms": "Esri 약관",
  "esri.save": "키 저장",
  "esri.remove": "키 삭제",
  "esri.saved":
    "{end}(으)로 끝나는 키를 {name}님이 {date}에 저장했습니다. 지도 레이어 선택에서 Esri World Imagery를 쓸 수 있습니다.",
  "esri.none": "저장된 키가 없어 Esri World Imagery를 제공하지 않습니다.",
} satisfies PluginCodeMessages;
