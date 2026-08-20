/**
 * 상태코드(`t_video.status_code` / `t_code`) 도메인 상수·판정.
 *
 * ⚠️ `t_code` 의 문구를 **그대로 화면에 내지 않는다**(PAGES.md §2-2).
 *   · "하이라이트" 는 쓰지 않기로 했는데 t_code 4000/4050 에 남아 있다.
 *   · 2000(STT 완료)·3000(장면 분석 완료) 의 name 이 둘 다 "장면 분석 완료" 로 겹친다.
 *   · "자막 추출", "전광판" 같은 내부 파이프라인 용어가 노출된다.
 *   → 단계 표기는 아래 상수로 **우리가 소유**하고, t_code 의 세부 문구를 쓸 때는 sanitize 를 거친다.
 *
 * 클라이언트 컴포넌트에서도 import 하므로 server-only 를 붙이지 않는다(상수·순수함수만 둘 것).
 */

/** 파이프라인 4단계 — 화면 표기(내부 명칭 비노출). 순서 고정. */
export const PIPELINE_STAGES = [
  { key: "upload", label: "업로드", summary: "영상이 저장소에 등록" },
  { key: "audio", label: "오디오 분석", summary: "청각 정보 분석" },
  { key: "vision", label: "시각 분석", summary: "시각 정보 분석" },
  { key: "compose", label: "클립 편성", summary: "질의에 맞는 장면 편성" },
] as const;

export type StageKey = (typeof PIPELINE_STAGES)[number]["key"];
export type StageState = "done" | "active" | "error" | "pending";

/** 코드대 → 단계. -1(ERROR)·미상은 null. */
export function stageOf(code: number | null | undefined): StageKey | null {
  if (code == null || code < 1000) return null;
  if (code < 2000) return "upload";
  if (code < 3000) return "audio";
  if (code < 4000) return "vision";
  if (code < 5000) return "compose";
  return null;
}

/** 대(帶)의 기준값(1000·2000·…)을 돌려준다. 1000 단위 내림. */
function band(code: number): number {
  return Math.floor(code / 1000) * 1000;
}

/** 해당 코드가 그 대(帶)의 **완료** 코드인가. (예: 2000, 3000) */
export function isBandComplete(code: number | null | undefined): boolean {
  return code != null && code >= 1000 && code % 1000 === 0;
}

/**
 * 에러/경고 코드인가.
 * t_code 규약상 x9xx 가 에러·경고대다. `result` 컬럼(-1)만으로는 부족하다 —
 * 2900번대 경고들은 result=0 으로 들어가 있어 "정상 완료"와 구분되지 않는다.
 */
export function isErrorCode(code: number | null | undefined): boolean {
  return code != null && code >= 1000 && code % 1000 >= 900;
}

/**
 * 분석이 끝나 **편성 가능한** 영상인가.
 *
 * 장면 발행(3000)까지 왔으면 편성할 수 있다. 편성/렌더대(4000~)의 실패는 **재시도 가능한 실패**라
 * 편성을 막지 않는다 — 질의를 바꾸면 성공할 수 있고, 렌더 실패는 편성과 무관하다.
 * 예외는 4910(발행본 없음): 장면이 없다는 뜻이라 편성 자체가 불가능하다.
 */
export function isComposable(code: number | null | undefined): boolean {
  if (code == null || code < 3000) return false;
  if (code === CODE.COMPOSE_ERROR_SOURCE) return false;
  if (isErrorCode(code)) return code >= 4000; // 2xxx·3xxx 에러는 분석이 안 끝난 것
  return true;
}

/** 지금 무언가 처리 중인가(진행 코드). 완료·에러가 아닌 코드는 진행 중으로 본다. */
export function isRunning(code: number | null | undefined): boolean {
  return code != null && code >= 1000 && !isBandComplete(code) && !isErrorCode(code);
}

/** 4단계 각각의 상태를 판정한다 — 진행 패널·배지 공용. */
export function stageStates(code: number | null | undefined): Record<StageKey, StageState> {
  const out: Record<StageKey, StageState> = {
    upload: "pending", audio: "pending", vision: "pending", compose: "pending",
  };
  if (code == null || code < 1000) return out;

  const current = stageOf(code);
  if (!current) return out;

  const order: StageKey[] = ["upload", "audio", "vision", "compose"];
  const idx = order.indexOf(current);

  // 현재 대 이전 단계는 모두 완료로 본다(코드가 그 대를 지나왔다는 뜻).
  for (let i = 0; i < idx; i++) out[order[i]] = "done";

  if (isErrorCode(code)) out[current] = "error";
  else if (isBandComplete(code)) out[current] = "done";
  else out[current] = "active";

  return out;
}

/**
 * t_code 문구에서 **대외 표기 금지어**를 걸러낸다.
 * 화면에 t_code 의 name/description 을 쓸 때 반드시 통과시킬 것.
 */
const TERM_REWRITES: ReadonlyArray<[RegExp, string]> = [
  [/하이라이트/g, "클립"],
  [/자막을?\s*받아쓰/g, "대사를 정리하"],
  [/받아쓰기/g, "대사 정리"],
  [/자막/g, "대사"],
  [/전광판/g, "화면 정보"],
  [/comment\s*를?\s*확인하세요\.?/g, "담당자에게 문의해 주세요."],
];

export function sanitizeCodeText(text: string | null | undefined): string {
  if (!text) return "";
  return TERM_REWRITES.reduce((s, [re, to]) => s.replace(re, to), text);
}

/** 대(帶) 단위 완료 코드 상수 — 매직넘버 방지. */
export const CODE = {
  UPLOAD_OK: 1000,
  STT_OK: 2000,
  VISION_OK: 3000,
  COMPOSE_OK: 4000,
  COMPOSE_EMPTY: 4001,
  COMPOSE_RENDERING: 4050,
  /** 발행된 장면이 없어 편성 자체가 불가능. */
  COMPOSE_ERROR_SOURCE: 4910,
  COMPOSE_ERROR_RENDER: 4950,
} as const;

export { band };
