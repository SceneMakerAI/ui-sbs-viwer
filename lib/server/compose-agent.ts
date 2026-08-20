/**
 * agent-compose(sm-api-01) 중계 + **동시 처리 1건 잠금**.
 *
 * 잠금 설계(PAGES.md §5):
 *   · UI 서버 **전역 1건**. 클라이언트별이 아니다 — 여러 PC 에서 붙어도 GPU 는 하나다.
 *   · 대기열을 두지 않는다. 이미 잡혀 있으면 **즉시 409(COMPOSE_BUSY)** 로 거절하고,
 *     클라이언트가 배너를 띄운 채 주기적으로 재시도해 대기열처럼 보이게 한다.
 *   · ⚠️ **단일 프로세스 전제.** PM2 클러스터·다중 인스턴스로 띄우면 이 잠금은 무력하다
 *     (배포는 systemd 단일 프로세스로 고정 — DEPLOY_GUIDE.md).
 *   · 잠금은 반드시 finally 에서 해제하고, 비정상 상황 대비로 획득 시각 기준 자동 만료를 둔다.
 *
 * server-only.
 */
import "server-only";
import { createLogger } from "./log";
import { sanitizeCodeText } from "@/lib/domain/status";

const log = createLogger("compose-agent");

function baseUrl(): string {
  const u = process.env.COMPOSE_BASE_URL;
  if (!u) throw new Error("COMPOSE_BASE_URL 환경변수 누락 — .env.local 확인");
  return u.replace(/\/+$/, "");
}

/* ── 동시 처리 1건 잠금 ─────────────────────────────────────────── */

interface Lock {
  jobId: string;
  vId: number;
  since: number;
}

let lock: Lock | null = null;

/**
 * 잠금 자동 만료(ms) — 잡이 어떤 이유로든 해제를 못 하고 죽었을 때의 안전장치.
 * 원샷(편성→렌더)은 두 단계를 연달아 도므로 **합**에 여유를 더한다.
 */
const LOCK_TTL_MS =
  Number(process.env.COMPOSE_TIMEOUT_MS ?? 600_000) +
  Number(process.env.RENDER_TIMEOUT_MS ?? 660_000) +
  60_000;

function activeLock(): Lock | null {
  if (lock && Date.now() - lock.since > LOCK_TTL_MS) {
    log.warn("편성 잠금 자동 만료 — 강제 해제", { jobId: lock.jobId, vId: lock.vId });
    lock = null;
  }
  return lock;
}

/** 지금 편성이 진행 중인가 — `GET /api/compose/busy` 용. */
export function busyState(): { busy: boolean; since: string | null } {
  const l = activeLock();
  return { busy: l !== null, since: l ? new Date(l.since).toISOString() : null };
}

export function releaseLock(jobId: string): void {
  if (lock?.jobId === jobId) lock = null;
}

/** 편성이 진행 중이라 요청을 받을 수 없을 때 던진다. 라우트가 409 로 변환한다. */
export class BusyError extends Error {
  constructor() {
    super("다른 요청을 처리하고 있습니다.");
    this.name = "BusyError";
  }
}

/* ── 진행 단계 표기 ──────────────────────────────────────────────── */

/**
 * agent-compose 그래프 노드명 → 화면 문구.
 * 내부 노드명을 그대로 노출하지 않는다(PAGES.md §2-2).
 */
const NODE_LABEL: Record<string, string> = {
  retrieve: "장면 자료 모으는 중",
  plan: "장면 고르는 중",
  feedback: "선곡 다듬는 중",
  cutrank: "클립 구간 정하는 중",
  route: "클립 구간 정하는 중",
  backfill: "길이 채우는 중",
  endfix: "끝맺음 정리하는 중",
  verify: "편성 검수 중",
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
  /** 상한 초. 사용자가 고른 "최대 N분". */
  budgetSec: number;
  /** 이닝 사이 범퍼 — 이어지는 렌더에 쓰인다. */
  bumper: boolean;
}

/** 편성 접수 — 잠금을 잡고 202 의 job_id 를 돌려준다. 이미 처리 중이면 BusyError. */
export async function startCompose(p: StartComposeParams): Promise<{ jobId: string }> {
  if (activeLock()) throw new BusyError();

  // 잠금을 먼저 선점한다 — 접수 요청이 오가는 동안 다른 클라이언트가 끼어들지 못하게.
  const placeholder = `pending-${Date.now()}`;
  lock = { jobId: placeholder, vId: p.vId, since: Date.now() };

  try {
    const res = await request<{ job_id: string }>(
      "/compose",
      {
        method: "POST",
        body: JSON.stringify({
          v_id: p.vId,
          query: p.query,
          budget: p.budgetSec,
          // 원샷 — 편성이 ok 면 이어서 렌더까지 간다. 잡 폴링으로 진행이 보이므로
          // 브라우저가 동기 응답을 기다리지 않는다(렌더 단독 호출의 약점을 피한다).
          render: true,
          bumper: p.bumper,
        }),
      },
      30_000,
    );
    lock = { jobId: res.job_id, vId: p.vId, since: Date.now() };
    log.info("편성 접수", { vId: p.vId, jobId: res.job_id, budgetSec: p.budgetSec, bumper: p.bumper });
    return { jobId: res.job_id };
  } catch (e) {
    lock = null; // 접수 자체가 실패했으면 잠글 이유가 없다
    throw e;
  }
}

export interface JobStatus {
  status: "running" | "ok" | "empty" | "error";
  progress: string[];
  compId?: number;
  error?: string;
}

/** 잡 폴링. 완료(성공·실패)면 잠금을 해제한다. */
export async function pollJob(jobId: string): Promise<JobStatus> {
  const job = await request<{
    status: string; progress?: string[]; comp_id?: number; error?: string;
  }>(`/compose/${jobId}`, { method: "GET" }, 15_000);

  const status = job.status as JobStatus["status"];
  if (status !== "running") {
    releaseLock(jobId);
    log.info("편성 종료", { jobId, status, compId: job.comp_id });
  }

  return {
    status,
    progress: (job.progress ?? []).map(progressLabel),
    compId: job.comp_id,
    error: job.error,
  };
}

/**
 * 렌더 요청(동기). worker-render 가 떠 있을 때만 성공한다.
 *
 * ⚠️ `render_datetime` 기록과 중복 차단(409 COMPOSE_ALREADY_RENDERED)은
 * **agent-compose 쪽 구현이 들어와야** 동작한다(REQUEST_agent-compose.md).
 * 그 전까지는 성공해도 DB 에 스탬프가 남지 않으므로, 화면은 응답 성공을 낙관적으로 반영한다.
 * UI 서버가 대신 UPDATE 하지 않는다 — DB 계정을 SELECT 전용으로 유지하는 게 결정 사항이다.
 */
export async function requestRender(compId: number, bumper: boolean): Promise<unknown> {
  // 렌더도 GPU 를 쓰고 최대 11분을 잡아먹는다 — 편성과 같은 잠금을 공유해 전역 1건으로 묶는다.
  // (§5 의 취지가 GPU 보호인데, 정작 더 무거운 쪽이 렌더다.)
  if (activeLock()) throw new BusyError();

  const jobId = `render-${compId}-${Date.now()}`;
  lock = { jobId, vId: compId, since: Date.now() };
  try {
    return await request(
      "/render",
      { method: "POST", body: JSON.stringify({ comp_id: compId, bumper }) },
      Number(process.env.RENDER_TIMEOUT_MS ?? 660_000),
    );
  } finally {
    releaseLock(jobId);
  }
}
