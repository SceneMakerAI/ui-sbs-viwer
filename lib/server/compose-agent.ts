/**
 * agent-compose(sm-api-01) **중계 전용** 클라이언트.
 *
 * ⚠️ 2026-08-24 개편 — 동시 처리 제어는 이 파일에서 **빠졌다**.
 * 예전에는 여기 모듈 전역 잠금 1개가 "편성·렌더 통틀어 1건"을 지켰다. 그런데
 *   · 렌더는 접수(202)만 잠금 안에서 하고 곧 풀려서, 실제 GPU 작업이 겹쳤고
 *   · 대기자가 서버에 존재하지 않아(클라이언트가 각자 재시도) 순번을 말할 수 없었다.
 * 그래서 대기열을 `lib/server/queue.ts` 로 옮기고(편성 레인·렌더 레인 각 1건),
 * 이 파일은 **HTTP 계약만** 책임진다 — 상태를 갖지 않는다.
 *
 * server-only.
 */
import "server-only";
import { sanitizeCodeText } from "@/lib/domain/status";

function baseUrl(): string {
  const u = process.env.COMPOSE_BASE_URL;
  if (!u) throw new Error("COMPOSE_BASE_URL 환경변수 누락 — .env.local 확인");
  return u.replace(/\/+$/, "");
}

/**
 * 편성 1건이 걸릴 수 있는 최대 시간(ms) — 큐의 마지막 빗장(TTL) 계산에 쓴다.
 * agent-compose 가 `select_clips` thinking 가드를 900초, 전송 타임아웃을 1200초로
 * 두고 있고 재선곡(retry_select)까지 돌 수 있다(0d95b9f).
 */
export const COMPOSE_TIMEOUT_MS = Number(process.env.COMPOSE_TIMEOUT_MS ?? 1_500_000);
/** 렌더 1건이 걸릴 수 있는 최대 시간(ms) — 같은 용도. */
export const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 660_000);

/* ── 진행 단계 표기 ──────────────────────────────────────────────── */

/**
 * agent-compose 그래프 노드명 → 화면 문구.
 * 내부 노드명을 그대로 노출하지 않는다(PAGES.md §2-2).
 *
 * ⚠️ **정본은 agent-compose `src/flow/graph.py` 의 `add_node()` 목록**이다. 표를 못
 * 따라가면 미매핑 노드가 sanitizeCodeText 로 새어 원문이 화면에 뜬다 — 실제로 그랬다.
 * 노드가 바뀔 때마다 이 표를 같이 고친다(agent-compose CLAUDE.md 에도 같은 경고가 있다).
 *
 * 2026-08-24 갱신 — 플로우가 "선곡 + 경계" 둘로 좁혀지면서 채점(score_match)·0점 제외
 * (drop_unmatched)·순서(order_clips)·예산 채우기(fill_budget)가 **폐기**됐고, 경계 보정이
 * `set_bounds`/`refine_bounds` 하나에서 끝(refine_end_bound)·시작(refine_start_bound)
 * 둘로 갈렸다. `finish` 는 신규 마감 노드다 — 예산 절단이 같은 날 되살아났지만 별도
 * 노드가 아니라 `finish` 안의 순수 계산이라 진행 표기는 늘어나지 않는다.
 * `render` 는 그래프 노드가 아니라 원샷(render=true) 때 API 가 progress 에 덧붙이는 값이다.
 */
const NODE_LABEL: Record<string, string> = {
  rephrase_query: "질의 이해하는 중",
  retrieve_evidence: "장면 자료 모으는 중",
  select_clips: "장면 고르는 중",
  retry_select: "선곡 다듬는 중",
  refine_end_bound: "클립 끝 정하는 중",
  refine_start_bound: "클립 시작 정하는 중",
  finish: "편성 마무리 중",
  end_empty: "맞는 장면을 찾지 못함",
  // 원샷을 쓰지 않으므로 편성 잡에서는 더 이상 오지 않는다 — agent 계약이 남아 있어 표기만 유지.
  render: "영상 만드는 중",
};

export function progressLabel(node: string): string {
  return NODE_LABEL[node] ?? sanitizeCodeText(node);
}

/* ── HTTP 헬퍼 ──────────────────────────────────────────────────── */

async function request<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}/api/v1${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...init.headers },
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = (body as { detail?: unknown } | null)?.detail;
      throw new AgentError(res.status, detail ?? body);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

/** agent-compose 가 4xx/5xx 로 답했을 때. `detail.code` 로 분기한다. */
export class AgentError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(`agent-compose ${status}`);
    this.name = "AgentError";
  }

  /** agent 가 준 오류 코드(COMPOSE_NOT_FOUND 등). */
  get code(): string | null {
    const d = this.detail;
    return typeof d === "object" && d !== null && "code" in d ? String((d as { code: unknown }).code) : null;
  }
}

/* ── API ────────────────────────────────────────────────────────── */

export interface StartComposeParams {
  vId: number;
  query: string;
  /**
   * 상한 초. 사용자가 고른 "최대 N분" — agent 는 이 값을 넘는 만큼 중요도 낮은 클립부터 버린다.
   * `null` 은 화면의 "없음" — 상한 없이 고른 장면을 다 담는다(agent 쪽 기본값과 같다).
   */
  budgetSec: number | null;
}

/**
 * 편성 잡 접수 — 202 의 job_id 를 돌려준다.
 *
 * **호출자는 큐(`lib/server/queue.ts`)뿐이다.** 라우트에서 직접 부르면 동시 1건 보장이
 * 깨진다 — agent-compose 쪽은 동시 접수에 아무 제한이 없다(`src/api/compose.py` 는
 * BackgroundTasks 로 무제한 수용).
 */
export async function startComposeJob(p: StartComposeParams): Promise<{ jobId: string }> {
  const res = await request<{ job_id: string }>(
    "/compose",
    {
      method: "POST",
      body: JSON.stringify({
        v_id: p.vId,
        query: p.query,
        budget_sec: p.budgetSec,
        // ⚠️ 필드명은 `budget` 이 아니라 **`budget_sec`** 이다 — 2026-08-24 에 인자가
        // 되살아나면서 이름도 바뀌었다(agent 0d95b9f). 구 이름으로 보내면 pydantic 이
        // 조용히 버려서 절단이 통째로 안 걸린다(에러도 안 난다).
        // **원샷은 쓰지 않는다**(2026-08-24 결정) — 편성 요청은 편성만 하고, 영상은
        // 결과 화면의 렌더(범퍼 선택 포함)로 따로 만든다. agent 기본값도 false 지만
        // 계약을 눈에 보이게 두려고 명시한다. bumper 는 렌더 인자라 보내지 않는다.
        render: false,
      }),
    },
    30_000,
  );
  return { jobId: res.job_id };
}

export interface JobStatus {
  status: "running" | "ok" | "empty" | "error";
  progress: string[];
  compId?: number;
  error?: string;
}

/**
 * 편성 잡 조회 — 부수 효과가 없다(상태 보관은 큐가 한다).
 *
 * agent 의 잡 캐시는 인메모리라 서비스 재시작·캐시 정리 뒤에는 404 가 된다. 그렇다고
 * 편성이 사라진 건 아니다 — 결과의 정본은 `t_compose` 다. 404 의 해석(DB 로 결말 판정)은
 * 큐의 감시 루프가 맡는다.
 */
export async function pollJob(jobId: string): Promise<JobStatus> {
  const job = await request<{
    status: string; progress?: string[]; comp_id?: number; error?: string;
  }>(`/compose/${jobId}`, { method: "GET" }, 15_000);

  return {
    status: job.status as JobStatus["status"],
    progress: (job.progress ?? []).map(progressLabel),
    compId: job.comp_id,
    error: job.error,
  };
}

/** 렌더 **접수** 요청의 타임아웃(ms) — 완주가 아니라 202 를 받는 데 걸리는 시간이다. */
const RENDER_ACCEPT_TIMEOUT_MS = 60_000;

/**
 * 렌더 **접수**(비동기). 완료를 기다리지 않는다.
 *
 * ⚠️ 2026-08-24 계약 — 단독 `POST /api/v1/render` 는 워커에 `sync_yn=false` 로 접수만
 * 하고 **202 {status:"accepted"}** 를 즉시 돌려준다. 완료는 agent-compose 의 백그라운드
 * 폴러가 확인해 `t_compose.render_datetime`·`render_status` 에 기록한다.
 *   → 이 함수가 돌아온 것은 "영상이 만들어졌다"가 아니라 "만들기 시작했다"는 뜻이다.
 *     완료 판정은 큐가 DB(`render_status`)를 보고 한다(`lib/server/render-status.ts`).
 *
 * 중복 차단·완료 스탬프는 agent-compose 가 소유한다(409 COMPOSE_ALREADY_RENDERED /
 * RENDER_IN_PROGRESS). UI 서버가 대신 UPDATE 하지 않는다 — DB 계정을 SELECT 전용으로
 * 유지하는 게 결정 사항이다.
 *
 * **호출자는 큐뿐이다** — 편성 1건 : 하이라이트 1건 규칙을 큐의 중복 키가 지킨다.
 */
export async function acceptRender(compId: number, bumper: boolean): Promise<unknown> {
  return request(
    "/render",
    { method: "POST", body: JSON.stringify({ comp_id: compId, bumper }) },
    RENDER_ACCEPT_TIMEOUT_MS,
  );
}
