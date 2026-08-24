/**
 * 렌더 진행/완료 판정용 `t_compose` 읽기 — **큐의 렌더 레인 전용**.
 *
 * 왜 별도 모듈인가:
 *   · 렌더는 agent-compose 가 워커에 접수만 하고 202 를 돌려준다. 완료 사실은 agent 의
 *     백그라운드 폴러가 `render_datetime`·`render_status` 에 기록한다(PAGES.md §10).
 *     UI 서버는 쓰기 권한이 없으므로(sm_viewer = SELECT 전용) **이 두 컬럼을 읽는 것이
 *     렌더 완료를 아는 유일한 길**이다.
 *   · 목록·상세용 조회(`composes.ts`)는 `is_sbs` 조인으로 노출 대상을 걸러낸다. 여기서는
 *     반대로 **걸러내지 않는다** — 워커를 점유한 렌더가 SBS 뷰어의 것이 아니어도
 *     "지금 렌더 워커가 바쁘다"는 사실은 같기 때문이다(기동 시 슬롯 복원에 쓴다).
 *
 * 값 규약은 `t_code.result` 와 같다: 1=진행 중, 0=성공, -1=실패, NULL=요청한 적 없음.
 *
 * server-only.
 */
import "server-only";
import type { RowDataPacket } from "mysql2";
import { query } from "./db";

export interface RenderState {
  compId: number;
  vId: number;
  /** 1=진행 중 · 0=성공 · -1=실패 · null=요청 이력 없음 */
  renderStatus: number | null;
  renderedAt: Date | null;
}

interface Row extends RowDataPacket {
  comp_id: number;
  v_id: number;
  render_status: number | null;
  render_datetime: Date | null;
}

/** 편성 1건의 렌더 상태 — 큐의 감시 루프가 5초마다 부른다(같은 사설망 DB, 1행 조회). */
export async function readRenderState(compId: number): Promise<RenderState | null> {
  const rows = await query<Row>(
    `SELECT comp_id, v_id, render_status, render_datetime
       FROM t_compose
      WHERE comp_id = ?`,
    [compId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    compId: Number(r.comp_id),
    vId: Number(r.v_id),
    renderStatus: r.render_status == null ? null : Number(r.render_status),
    renderedAt: r.render_datetime ?? null,
  };
}

/**
 * 지금 워커를 점유하고 있을 렌더 1건 — **서버 기동 시 슬롯 복원**에 쓴다.
 *
 * 대기열은 메모리에만 있어서 재시작하면 사라진다(결정 2026-08-24). 그래도 진행 중이던
 * 렌더는 워커에서 계속 도는데, 그걸 모르면 큐가 곧바로 다음 렌더를 접수해 워커 큐에
 * 겹쳐 쌓인다. `render_status=1` 은 프로세스 메모리와 달리 재기동에도 남으므로
 * (agent `compose_repo.mark_render_started` 주석) 이 한 줄이 복원 근거가 된다.
 *
 * 여러 건이 1로 남아 있을 수 있다(과거 고아 행). 슬롯은 하나라 **가장 최근 것만** 집는다 —
 * 나머지 고아는 agent 의 `_reconcile` 이 다음 요청 때 정정한다.
 */
export async function findRunningRender(): Promise<{ compId: number; vId: number } | null> {
  const rows = await query<Row>(
    `SELECT comp_id, v_id, render_status, render_datetime
       FROM t_compose
      WHERE render_status = 1
      ORDER BY comp_id DESC
      LIMIT 1`,
  );
  const r = rows[0];
  return r ? { compId: Number(r.comp_id), vId: Number(r.v_id) } : null;
}
