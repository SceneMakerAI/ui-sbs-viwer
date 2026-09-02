/**
 * 렌더 진행/완료 판정용 `t_compose` 읽기 — **큐의 렌더 레인 전용**.
 *
 * ⚠️ 2026-09-02 스키마 교체 — 근거 컬럼이 사라졌다.
 *   · 예전: `render_status`(1/0/-1) + `render_datetime`.
 *   · 지금: **`status_code` 하나**. 4050=렌더링 중 · 4000=완료 · 4950/4960=렌더 실패.
 *
 * 왜 별도 모듈인가:
 *   · 렌더는 agent-compose 가 워커에 접수만 하고 202 를 돌려준다. 완료 사실은 agent 의
 *     백그라운드 폴러가 `status_code` 에 기록한다(PAGES.md §10). UI 서버는 쓰기 권한이
 *     없으므로(sm_viewer = SELECT 전용) **이 컬럼을 읽는 것이 진행 상황을 아는 길**이다.
 *   · 목록·상세용 조회(`composes.ts`)는 `is_sbs` 조인으로 노출 대상을 걸러낸다. 여기서는
 *     반대로 **걸러내지 않는다** — 워커를 점유한 렌더가 SBS 뷰어의 것이 아니어도
 *     "지금 렌더 워커가 바쁘다"는 사실은 같기 때문이다(기동 시 슬롯 복원에 쓴다).
 *
 * ⚠️ **`status_code=4000` 은 "mp4 가 있다"가 아니다** — 편성만 끝난 것과 렌더까지 끝난 것이
 * 같은 코드다(실측 2026-09-02). 그래서 "이미 만들어져 있는가"는 여기서 답할 수 없고
 * S3 존재 확인이 필요하다(`queue.ts` 의 `dispatchRender` 참조). 이 모듈이 답하는 것은
 * **"지금 돌고 있는가 / 방금 실패했는가"** 까지다.
 *
 * ⚠️ 편성의 키는 `(v_id, comp_id)` 복합키다 — comp_id 만으로 조회하면 다른 영상의 편성을 집는다.
 *
 * server-only.
 */
import "server-only";
import type { RowDataPacket } from "mysql2";
import { query } from "./db";
import { CODE } from "@/lib/domain/status";

export interface RenderState {
  compId: number;
  vId: number;
  /** `t_compose.status_code` — 4050=렌더링 중 · 4000=완료 · 4950/4960=렌더 실패. */
  statusCode: number;
}

interface Row extends RowDataPacket {
  comp_id: number;
  v_id: number;
  status_code: number;
}

/** 렌더 진행 중을 뜻하는 코드인가. */
export function isRendering(statusCode: number): boolean {
  return statusCode === CODE.COMPOSE_RENDERING;
}

/** 렌더가 실패로 끝난 코드인가(편성 자체는 살아 있다 — 렌더만 다시 요청하면 된다). */
export function isRenderFailed(statusCode: number): boolean {
  return statusCode === CODE.COMPOSE_ERROR_RENDER || statusCode === CODE.COMPOSE_ERROR_STAMP;
}

/** 편성 1건의 상태 — 큐의 감시 루프가 5초마다 부른다(같은 사설망 DB, 1행 조회). */
export async function readRenderState(vId: number, compId: number): Promise<RenderState | null> {
  const rows = await query<Row>(
    `SELECT comp_id, v_id, status_code
       FROM t_compose
      WHERE v_id = ? AND comp_id = ?`,
    [vId, compId],
  );
  const r = rows[0];
  if (!r) return null;
  return { compId: Number(r.comp_id), vId: Number(r.v_id), statusCode: Number(r.status_code) };
}

/**
 * 지금 워커를 점유하고 있을 렌더 1건 — **서버 기동 시 슬롯 복원**에 쓴다.
 *
 * 대기열은 메모리에만 있어서 재시작하면 사라진다(결정 2026-08-24). 그래도 진행 중이던
 * 렌더는 워커에서 계속 도는데, 그걸 모르면 큐가 곧바로 다음 렌더를 접수해 워커 큐에
 * 겹쳐 쌓인다. `status_code=4050` 은 프로세스 메모리와 달리 재기동에도 남으므로
 * 이 한 줄이 복원 근거가 된다.
 *
 * 여러 건이 4050 으로 남아 있을 수 있다(과거 고아 행). 슬롯은 하나라 **가장 최근 것만** 집는다 —
 * 나머지 고아는 agent 의 `_reconcile` 이 다음 요청 때 워커에 물어 정정한다.
 * **워커 응답이 없으면 정정하지 않고 막는 쪽을 택한다** — 진행 중일지도 모르는 렌더를
 * 끝난 것으로 단정해 워커에 겹쳐 넣는 쪽이 더 나쁘다(방침 출처: 998be44).
 */
export async function findRunningRender(): Promise<{ compId: number; vId: number } | null> {
  const rows = await query<Row>(
    `SELECT comp_id, v_id, status_code
       FROM t_compose
      WHERE status_code = ?
      ORDER BY reg_datetime DESC, v_id DESC, comp_id DESC
      LIMIT 1`,
    [CODE.COMPOSE_RENDERING],
  );
  const r = rows[0];
  return r ? { compId: Number(r.comp_id), vId: Number(r.v_id) } : null;
}
