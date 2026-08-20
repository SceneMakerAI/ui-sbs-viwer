/**
 * 편성 1건의 표시 상태 — 목록 배지와 상세 화면이 **같은 판정**을 쓰도록 한 곳에 둔다.
 *
 * 우선순위(2026-08-20 확정):
 *   1단계 `t_compose.status`        클립 편성 자체가 끝났는가 — 진행 중·실패·장면 없음이면 여기서 끝.
 *   2단계 `t_compose.render_status` 편성이 `ok` 로 끝난 뒤에야 영상(렌더) 상태를 말한다.
 *
 * 순서를 지키는 이유: 편성이 아직 도는 중인데 렌더 컬럼이 비어 있다고 "클립 편성 완료"라고
 * 말하면 거짓이 된다. 영상 상태는 **클립이 확정된 뒤에만** 의미가 있다.
 *
 * 판정은 `t_compose` 컬럼만 본다 — S3 조회 없이 DB 한 번이다.
 * 클라이언트 컴포넌트에서도 import 하므로 server-only 를 붙이지 않는다.
 */
import type { Compose } from "@/lib/types";

export type ComposePhase =
  | "composing" // 클립 편성 중
  | "compose_failed" // 클립 편성 실패
  | "empty" // 조건에 맞는 장면 없음
  | "composed" // 편성 완료, 영상은 만든 적 없음
  | "rendering" // 영상 만드는 중
  | "ready" // 영상 준비됨
  | "render_failed"; // 영상 생성 실패

/** `t_compose.status` 중 "편성이 아직 끝나지 않았다"는 값들. */
const COMPOSE_RUNNING = new Set(["running", "pending", "progress", "processing"]);
/** `t_compose.status` 중 "편성이 실패했다"는 값들. */
const COMPOSE_FAILED = new Set(["error", "fail", "failed"]);

export function composePhase(compose: Compose): ComposePhase {
  // ── 1단계: 클립 편성 상태 ──
  const status = compose.status?.toLowerCase() ?? "";
  if (COMPOSE_RUNNING.has(status)) return "composing";
  if (COMPOSE_FAILED.has(status)) return "compose_failed";
  if (status === "empty" || compose.clipCount === 0) return "empty";

  // ── 2단계: 영상(렌더) 상태 — 값 규약은 t_code.result 와 같다(1=진행 중, 0=성공, -1=실패) ──
  switch (compose.renderStatus) {
    case 0:
      return "ready";
    case 1:
      return "rendering";
    case -1:
      return "render_failed";
    default:
      // NULL = 영상을 만든 적 없음. 컬럼이 생기기 전에 렌더된 옛 편성은 완료 시각으로 구제한다.
      return compose.renderedAt !== null ? "ready" : "composed";
  }
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

export function composeBadge(compose: Compose): { phase: ComposePhase; text: string; tone: string } {
  const phase = composePhase(compose);
  return { phase, text: LABEL[phase], tone: TONE[phase] };
}
