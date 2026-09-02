/**
 * 편성 1건의 표시 상태 — 목록 배지와 상세 화면이 **같은 판정**을 쓰도록 한 곳에 둔다.
 *
 * ⚠️ 2026-09-02 스키마 교체 — 판정 근거가 통째로 바뀌었다.
 *   · 예전: `t_compose.status`(varchar) + `render_status`/`render_datetime` 두 컬럼.
 *   · 지금: **`t_compose.status_code` 하나**(t_code 4000번대). 렌더 컬럼 2개는 **삭제**됐다.
 *
 * 상태코드가 편성·렌더 국면을 모두 들고 있다:
 *   4001         빈 편성(조건에 맞는 장면 없음)
 *   4010~4040    편성 진행(색인·선곡·컷·검수)
 *   4050         렌더링 진행
 *   4900~4920    편성 실패
 *   4950·4960    렌더 실패(편성 자체는 남아 있다 — 렌더만 다시 요청할 수 있다)
 *   4000         완료
 *
 * ⚠️ **4000 은 "mp4 가 있다"는 뜻이 아니다.** t_code 4000 은 편성과 렌더의 공통 종료 코드라
 * "편성만 끝난 것"과 "렌더까지 끝난 것"을 구분하지 못한다(실측 2026-09-02: 렌더된 8건과
 * 렌더 안 된 19건이 **모두 4000**). 그래서 산출물 존재는 **S3 확인이 유일한 근거**이고,
 * `composePhase` 는 그 결과를 `hasRender` 인자로 받는다. 목록처럼 영상마다 S3 를 조회할 수
 * 없는 자리는 인자를 주지 않고 "클립 편성 완료"까지만 말한다 — 없는 근거로 단정하지 않는다.
 *
 * 판정은 `t_compose` 컬럼만 본다 — S3 조회 없이 DB 한 번이다(hasRender 를 주는 상세 화면 제외).
 * 클라이언트 컴포넌트에서도 import 하므로 server-only 를 붙이지 않는다.
 */
import type { Compose } from "@/lib/types";
import { CODE, isErrorCode } from "@/lib/domain/status";

export type ComposePhase =
  | "composing" // 클립 편성 중
  | "compose_failed" // 클립 편성 실패
  | "empty" // 조건에 맞는 장면 없음
  | "composed" // 편성 완료, 영상은 아직 없음(또는 존재 여부를 모름)
  | "rendering" // 영상 만드는 중
  | "ready" // 영상 준비됨 — S3 에 산출물이 있는 것을 확인한 경우에만
  | "render_failed"; // 영상 생성 실패

/**
 * @param hasRender S3 에서 렌더본 존재를 **확인한** 경우에만 true/false 를 준다.
 *                  확인하지 않았으면 생략한다(= 모름 → "ready" 로 올라가지 않는다).
 */
export function composePhase(compose: Compose, hasRender?: boolean): ComposePhase {
  const code = compose.statusCode;

  // ── 실패 — 렌더 실패는 편성 실패와 구분한다(편성은 살아 있어 재렌더만 하면 된다) ──
  if (isErrorCode(code)) {
    return code === CODE.COMPOSE_ERROR_RENDER || code === CODE.COMPOSE_ERROR_STAMP
      ? "render_failed"
      : "compose_failed";
  }

  // ── 진행 — 4050 만 렌더 국면이고 나머지 진행 코드는 편성 국면이다 ──
  if (code === CODE.COMPOSE_RENDERING) return "rendering";
  if (code !== CODE.COMPOSE_OK && code !== CODE.COMPOSE_EMPTY) return "composing";

  // ── 종료 ──
  if (code === CODE.COMPOSE_EMPTY || compose.clipCount === 0) return "empty";
  // 4000 은 편성 완료까지만 보장한다. 산출물은 확인된 경우에만 "준비됨"이다.
  return hasRender ? "ready" : "composed";
}

/**
 * 영상 쪽 문구에는 **"클립 영상"** 이라고 붙인다 — 그냥 "영상"이라고 하면
 * 편성 결과물이 아니라 원본 경기 영상으로 읽힌다.
 */
const LABEL: Record<ComposePhase, string> = {
  composing: "클립 편성 중",
  compose_failed: "클립 편성 실패",
  empty: "장면 없음",
  composed: "클립 편성 완료",
  rendering: "클립 영상 준비 중",
  ready: "클립 영상 준비됨",
  render_failed: "클립 영상 생성 실패",
};

const TONE: Record<ComposePhase, string> = {
  composing: "bg-brand-blue-soft text-brand-blue",
  compose_failed: "bg-danger-soft text-danger",
  empty: "bg-surface-alt text-text-muted",
  composed: "bg-surface-alt text-text-secondary",
  rendering: "bg-brand-blue-soft text-brand-blue",
  ready: "bg-brand-blue-soft text-brand-blue",
  render_failed: "bg-danger-soft text-danger",
};

export function composeBadge(
  compose: Compose,
  hasRender?: boolean,
): { phase: ComposePhase; text: string; tone: string } {
  const phase = composePhase(compose, hasRender);
  return { phase, text: LABEL[phase], tone: TONE[phase] };
}
