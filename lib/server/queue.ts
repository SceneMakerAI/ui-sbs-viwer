/**
 * 요청 대기열 — **편성 레인 / 렌더 레인, 각 동시 1건**.
 *
 * 왜 큐인가(2026-08-24 결정, PAGES.md §5 갱신):
 *   예전 구조는 모듈 전역 잠금 1개 + 클라이언트 재시도였다. 그래서
 *   1) 렌더는 접수(202)만 잠금 안에서 하고 곧 풀려 **실제 GPU 작업이 겹쳤고**,
 *   2) 대기자가 서버에 존재하지 않아(각 브라우저가 5초마다 재시도) **순번을 말할 수 없었다**.
 *   요청을 서버가 들고 있으면 둘 다 해결된다 — 접수는 즉시 202(티켓 발급), 실행은 순서대로.
 *
 * 왜 레인을 둘로 나누는가:
 *   편성은 agent-compose 의 LLM 경로, 렌더는 worker-render 의 인코딩 경로다. **상대가 다른
 *   서비스**라 10분짜리 렌더가 편성 전체를 막을 이유가 없다. 각 레인이 독립적으로 1건씩
 *   돌아 "편성 1건 + 렌더 1건"이 최대 동시 실행이다.
 *   (worker-render 자체도 1건씩 처리한다 — agent 의 렌더 상태에 `accepted(큐 대기)` 가
 *    있다: `agent-compose/src/render/client.py`. 우리 큐의 몫은 순번 가시화·1:1 강제·중복 차단.)
 *
 * 편성 1건 : 하이라이트 1건 규칙:
 *   렌더 레인은 **`vId:compId` 쌍**을 중복 키로 쓴다(2026-09-02 — comp_id 가 영상 안에서만
 *   유일해져 단독으로는 키가 못 된다. compId 만 쓰면 서로 다른 영상의 "편성 #1" 이 한 건으로
 *   합쳐진다). 같은 편성을 두 번 넣으려 하면 새 항목을
 *   만들지 않고 **기존 티켓을 그대로 돌려준다**(멱등). 이미 만들어진 편성은 라우트가
 *   접수 전에 걸러내고, 대기 중에 만들어져 버린 경우는 실행 직전 재확인이 잡는다.
 *
 * ⚠️ **단일 프로세스 전제.** 상태가 프로세스 메모리에 있다. PM2 클러스터·다중 인스턴스로
 *   띄우면 큐가 프로세스마다 따로 생겨 무력해진다(DEPLOY_GUIDE.md — systemd 단일 프로세스 고정).
 * ⚠️ **재시작하면 대기분은 사라진다**(결정 2026-08-24 — 메모리 전용). 진행 중이던 렌더는
 *   `t_compose.status_code=4050` 으로 복원한다(`ensureAdopted`). 진행 중이던 편성은 agent 에
 *   "도는 잡 목록" 엔드포인트가 없어 복원할 수 없다 — 결과는 DB 에 남으므로 편성 목록에서 보인다.
 *
 * server-only.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { createLogger } from "./log";
import { CODE } from "@/lib/domain/status";
import {
  AgentError,
  COMPOSE_TIMEOUT_MS,
  RENDER_TIMEOUT_MS,
  acceptRender,
  pollJob,
  startComposeJob,
} from "./compose-agent";
import { findComposeSince } from "./composes";
import { findRunningRender, isRenderFailed, isRendering, readRenderState } from "./render-status";
import { exists, renderKey } from "./s3";

const log = createLogger("queue");

/* ── 상수 ───────────────────────────────────────────────────────── */

/** 진행 중 항목 감시 주기(ms). agent 는 사설망, DB 도 사설망이라 조회 비용이 사실상 없다. */
const WATCH_MS = 5_000;

/**
 * 레인별 **대기 상한**(진행 중 1건 제외). 도달하면 접수를 거절한다 —
 * 라우트가 503 `QUEUE_FULL` 로 바꿔 "5~10분 뒤에 다시" 안내를 띄운다.
 * 무한정 받아두면 순번이 의미를 잃고(1시간 뒤 시작) 사용자는 실패로 오해한다.
 */
export const PENDING_MAX = 20;
/** 큐가 가득 찼을 때 안내할 재시도 간격(초) — 편성 1건이 1~3분이라 5분이면 몇 건은 빠진다. */
export const RETRY_AFTER_SEC = 300;

/** 끝난 항목 보관 수(레인별). 결과를 잃지 않으려고 잠깐 들고 있는 것 — 이력의 정본은 DB 다. */
const FINISHED_MAX = 30;

/**
 * 렌더 접수 직후 유예(ms). 직전 실패(4950)가 남아 있는 편성을 다시 렌더하면 agent 가
 * 4050 으로 덮기 전에 우리가 4950 을 먼저 읽어 **방금 시작한 렌더를 실패로 단정**할 수 있다.
 * 그래서 진행(4050)을 한 번이라도 본 뒤에만 종결 값을 신뢰하고, 그 전에는 이 시간까지 기다린다.
 */
const RENDER_GRACE_MS = 30_000;

/* ── 자료 구조 ──────────────────────────────────────────────────── */

export type QueueKind = "compose" | "render";
export type ItemState = "pending" | "running" | "done" | "error" | "canceled";

export interface QueueItem {
  ticketId: string;
  kind: QueueKind;
  state: ItemState;
  /** 화면 표기용 짧은 제목 — 편성은 질의, 렌더는 "편성 #12 영상 생성". */
  label: string;
  vId: number;
  /** 이 항목이 가리키는 편성. 렌더는 접수 시점부터, 편성은 끝난 뒤에 채워진다. */
  compId?: number;
  query?: string;
  budgetSec?: number | null;
  bumper?: boolean;
  /** agent 잡 id — 편성이 실제로 접수된 뒤에 생긴다. */
  jobId?: string;
  /** 진행 문구(마지막이 현재 단계). */
  progress: string[];
  /** 편성이 끝난 방식 — `empty` 는 실패가 아니라 "맞는 장면이 없음"이다. */
  outcome?: "ok" | "empty";
  error?: string;
  /** 서버 재시작 전에 시작돼 DB 로 복원한 항목(요청자를 알 수 없다). */
  adopted?: boolean;
  /** 렌더 진행(`status_code=4050`)을 한 번이라도 관측했는가 — 유예 판정용. */
  observedRunning?: boolean;
  /** 렌더 접수(agent 202)가 끝난 시각. 유예는 이 시각부터 센다 — tickRender 주석 참조. */
  acceptedAt?: number;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

interface Lane {
  kind: QueueKind;
  running: QueueItem | null;
  pending: QueueItem[];
  /** 최근 완료(최신이 앞). */
  finished: QueueItem[];
  timer: ReturnType<typeof setInterval> | null;
  /** 감시 tick 중복 진입 방지 — 조회가 주기보다 오래 걸릴 수 있다. */
  ticking: boolean;
  /** 마지막 빗장. 감시가 결말을 못 봤을 때 슬롯을 되돌린다. */
  ttlMs: number;
}

function newLane(kind: QueueKind, ttlMs: number): Lane {
  return { kind, running: null, pending: [], finished: [], timer: null, ticking: false, ttlMs };
}

const lanes: Record<QueueKind, Lane> = {
  // 편성 TTL — agent 의 전송 타임아웃(기본 25분)에 여유 1분.
  compose: newLane("compose", COMPOSE_TIMEOUT_MS + 60_000),
  // 렌더 TTL — agent 의 렌더 감시 타임아웃(기본 11분)에 여유 1분.
  render: newLane("render", RENDER_TIMEOUT_MS + 60_000),
};

/** 티켓 → 항목(대기·진행·최근 완료). 완료 보관에서 밀려나면 함께 지운다. */
const index = new Map<string, QueueItem>();

function newTicket(): string {
  return `t_${randomBytes(8).toString("hex")}`;
}

/** 대기열이 가득 찼다. 라우트가 503 `QUEUE_FULL` 로 변환한다. */
export class QueueFullError extends Error {
  constructor(
    readonly kind: QueueKind,
    readonly max: number,
    readonly retryAfterSec: number = RETRY_AFTER_SEC,
  ) {
    super("대기열이 가득 찼습니다.");
    this.name = "QueueFullError";
  }
}

/* ── 외부 표현(뷰) ──────────────────────────────────────────────── */

export interface ItemView {
  ticketId: string;
  kind: QueueKind;
  state: ItemState;
  label: string;
  vId: number;
  compId?: number;
  jobId?: string;
  progress: string[];
  /** 현재 단계 문구(진행 중일 때만). */
  step?: string;
  outcome?: "ok" | "empty";
  error?: string;
  /** 0 = 진행 중 · 1 이상 = 앞에 남은 건수 + 1 · null = 이미 끝남. */
  position: number | null;
  /** 서버 재시작 전 요청이라 요청자를 알 수 없는 항목. */
  adopted?: boolean;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface LaneView {
  kind: QueueKind;
  running: ItemView | null;
  pending: ItemView[];
  finished: ItemView[];
  /** 대기 건수(진행 중 제외). */
  waiting: number;
  /** 대기 상한. */
  max: number;
  /** 상한 도달 — UI 는 버튼을 막고 "5~10분 뒤에 다시" 안내를 띄운다. */
  full: boolean;
}

function position(item: QueueItem): number | null {
  if (item.state === "running") return 0;
  if (item.state !== "pending") return null;
  const i = lanes[item.kind].pending.indexOf(item);
  return i < 0 ? null : i + 1;
}

function view(item: QueueItem): ItemView {
  return {
    ticketId: item.ticketId,
    kind: item.kind,
    state: item.state,
    label: item.label,
    vId: item.vId,
    ...(item.compId != null ? { compId: item.compId } : {}),
    ...(item.jobId ? { jobId: item.jobId } : {}),
    progress: item.progress,
    ...(item.state === "running" && item.progress.length > 0
      ? { step: item.progress[item.progress.length - 1] }
      : {}),
    ...(item.outcome ? { outcome: item.outcome } : {}),
    ...(item.error ? { error: item.error } : {}),
    position: position(item),
    ...(item.adopted ? { adopted: true } : {}),
    enqueuedAt: new Date(item.enqueuedAt).toISOString(),
    ...(item.startedAt ? { startedAt: new Date(item.startedAt).toISOString() } : {}),
    ...(item.finishedAt ? { finishedAt: new Date(item.finishedAt).toISOString() } : {}),
  };
}

function laneView(lane: Lane): LaneView {
  return {
    kind: lane.kind,
    running: lane.running ? view(lane.running) : null,
    pending: lane.pending.map(view),
    finished: lane.finished.map(view),
    waiting: lane.pending.length,
    max: PENDING_MAX,
    full: lane.pending.length >= PENDING_MAX,
  };
}

/** 큐 전체 스냅샷 — `GET /api/queue` 가 그대로 돌려준다. */
export function queueSnapshot(): { compose: LaneView; render: LaneView; at: string } {
  return {
    compose: laneView(lanes.compose),
    render: laneView(lanes.render),
    at: new Date().toISOString(),
  };
}

/* ── 접수 ───────────────────────────────────────────────────────── */

function admit(lane: Lane, item: QueueItem): ItemView {
  if (lane.pending.length >= PENDING_MAX) throw new QueueFullError(lane.kind, PENDING_MAX);
  lane.pending.push(item);
  index.set(item.ticketId, item);
  // 자리가 비어 있으면 이 호출 안에서(첫 await 전에) running 으로 올라간다 —
  // 그래서 아래 view() 의 position 이 0 으로 나온다. 붐빌 때는 대기 순번이 나온다.
  void pump(lane);
  log.info("접수", {
    kind: item.kind, ticketId: item.ticketId, vId: item.vId,
    compId: item.compId, waiting: lane.pending.length,
  });
  return view(item);
}

/** 편성 접수 — 항상 티켓을 발급한다(거절은 대기열 포화뿐). */
export function enqueueCompose(p: {
  vId: number;
  query: string;
  budgetSec: number | null;
}): ItemView {
  return admit(lanes.compose, {
    ticketId: newTicket(),
    kind: "compose",
    state: "pending",
    label: p.query,
    vId: p.vId,
    query: p.query,
    budgetSec: p.budgetSec,
    progress: [],
    enqueuedAt: Date.now(),
  });
}

/**
 * 렌더 접수 — 같은 **편성(`vId`+`compId`)** 이 이미 큐에 있으면 **새로 만들지 않고 그 티켓을
 * 돌려준다**(편성 1 : 하이라이트 1). `dedup:true` 로 그 사실을 알린다.
 */
export function enqueueRender(p: {
  compId: number;
  vId: number;
  bumper: boolean;
}): ItemView & { dedup: boolean } {
  const existing = findRenderItem(p.vId, p.compId);
  if (existing) return { ...view(existing), dedup: true };

  return {
    ...admit(lanes.render, {
      ticketId: newTicket(),
      kind: "render",
      state: "pending",
      label: `편성 #${p.compId} 영상 생성`,
      vId: p.vId,
      compId: p.compId,
      bumper: p.bumper,
      progress: [],
      enqueuedAt: Date.now(),
    }),
    dedup: false,
  };
}

/**
 * 렌더 레인에서 이 편성의 대기·진행 항목을 찾는다(완료분은 보지 않는다).
 * ⚠️ `vId` 를 같이 비교해야 한다 — comp_id 만 보면 다른 영상의 같은 번호 편성과 겹친다.
 */
function findRenderItem(vId: number, compId: number): QueueItem | null {
  const lane = lanes.render;
  const same = (i: QueueItem) => i.vId === vId && i.compId === compId;
  if (lane.running && same(lane.running)) return lane.running;
  return lane.pending.find(same) ?? null;
}

/** 이 편성의 렌더가 지금 큐에 있는지 — 라우트가 멱등 응답을 만들 때 쓴다. */
export function findRenderTicket(vId: number, compId: number): ItemView | null {
  const item = findRenderItem(vId, compId);
  return item ? view(item) : null;
}

/* ── 조회 · 취소 ────────────────────────────────────────────────── */

export function findTicket(ticketId: string): ItemView | null {
  const item = index.get(ticketId);
  return item ? view(item) : null;
}

/** agent 잡 id 로 찾는다 — 구 폴링 경로(`GET /api/compose/[jobId]`) 호환용. */
export function findByJobId(jobId: string): ItemView | null {
  for (const item of index.values()) if (item.jobId === jobId) return view(item);
  return null;
}

/**
 * 대기 중 항목 취소. **진행 중인 항목은 취소하지 않는다** — agent·워커에 취소 계약이 없어
 * "취소했다"고 말한 뒤에도 GPU 는 계속 돌기 때문이다(거짓말이 되는 쪽을 막는다).
 */
export function cancelTicket(ticketId: string): { ok: boolean; reason?: string; item?: ItemView } {
  const item = index.get(ticketId);
  if (!item) return { ok: false, reason: "요청을 찾을 수 없습니다." };
  if (item.state === "running") {
    return { ok: false, reason: "이미 시작된 요청은 취소할 수 없습니다.", item: view(item) };
  }
  if (item.state !== "pending") return { ok: false, reason: "이미 끝난 요청입니다.", item: view(item) };

  const lane = lanes[item.kind];
  const i = lane.pending.indexOf(item);
  if (i >= 0) lane.pending.splice(i, 1);
  item.state = "canceled";
  item.finishedAt = Date.now();
  archive(lane, item);
  log.info("취소", { kind: item.kind, ticketId });
  return { ok: true, item: view(item) };
}

/**
 * 구 `GET /api/compose` 응답 모양(`{busy, since, job}`) — 전역 진행 바가 아직 이걸 쓴다.
 * **신규 화면은 `GET /api/queue` 를 쓴다.** 큐 도입 전 UI 가 죽지 않게 남긴 호환 뷰다.
 */
export function composeCompatState(): {
  busy: boolean;
  since: string | null;
  waiting: number;
  job: {
    jobId: string;
    vId: number;
    status: "running" | "ok" | "empty" | "error";
    progress: string[];
    compId?: number;
    error?: string;
    at: string;
  } | null;
} {
  const lane = lanes.compose;
  const item = lane.running ?? lane.finished[0] ?? null;
  const status = !item
    ? null
    : item.state === "pending" || item.state === "running"
      ? "running"
      : item.state === "done"
        ? (item.outcome === "empty" ? "empty" : "ok")
        : "error";

  return {
    busy: lane.running !== null,
    since: lane.running?.startedAt ? new Date(lane.running.startedAt).toISOString() : null,
    waiting: lane.pending.length,
    job:
      item && status
        ? {
            // 잡 id 가 아직 없으면(접수 대기) 티켓 id 로 대신한다 — 표시용 키다.
            jobId: item.jobId ?? item.ticketId,
            vId: item.vId,
            status,
            progress: item.progress,
            ...(item.compId != null ? { compId: item.compId } : {}),
            ...(item.error ? { error: item.error } : {}),
            at: new Date(item.finishedAt ?? item.startedAt ?? item.enqueuedAt).toISOString(),
          }
        : null,
  };
}

/* ── 실행 ───────────────────────────────────────────────────────── */

/**
 * 슬롯이 비면 다음 항목을 올린다.
 *
 * 앞부분(선점)은 **동기**다 — `lane.running` 검사와 대입 사이에 `await` 가 없어야 두 요청이
 * 같은 슬롯을 잡지 못한다. Node 단일 스레드 전제에서 이게 잠금 역할을 한다.
 */
async function pump(lane: Lane): Promise<void> {
  if (lane.running) return;
  const next = lane.pending.shift();
  if (!next) {
    stopWatch(lane);
    return;
  }
  lane.running = next;
  next.state = "running";
  next.startedAt = Date.now();
  startWatch(lane);

  try {
    if (next.kind === "compose") await dispatchCompose(next);
    else await dispatchRender(lane, next);
  } catch (e) {
    // 접수 실패의 이유(agent 4xx·접속 불가·타임아웃)는 사용자가 할 수 있는 일을 바꾸지 않는다 —
    // 한 문구로 안내하고 원인은 로그에 남긴다.
    const msg = "요청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    log.error("접수 실패", {
      kind: next.kind, ticketId: next.ticketId, vId: next.vId,
      compId: next.compId, message: String(e),
    });
    finish(lane, next, "error", { error: msg });
  }
}

async function dispatchCompose(item: QueueItem): Promise<void> {
  const { jobId } = await startComposeJob({
    vId: item.vId,
    query: item.query ?? "",
    budgetSec: item.budgetSec ?? null,
  });
  item.jobId = jobId;
  log.info("편성 시작", { ticketId: item.ticketId, vId: item.vId, jobId, budgetSec: item.budgetSec });
}

async function dispatchRender(lane: Lane, item: QueueItem): Promise<void> {
  const compId = item.compId;
  const vId = item.vId;
  if (compId == null) return finish(lane, item, "error", { error: "대상 편성이 없습니다." });

  // 대기하는 동안 상황이 바뀔 수 있다 — 다른 창에서 먼저 만들었거나 이미 돌고 있을 수 있다.
  const cur = await readRenderState(vId, compId);
  if (!cur) return finish(lane, item, "error", { error: "편성을 찾을 수 없습니다." });
  if (isRendering(cur.statusCode)) {
    // 이미 진행 중(다른 경로 접수·재시작 전 요청) — 새로 접수하지 않고 완료만 지켜본다.
    item.observedRunning = true;
    log.info("렌더 감시만 — 이미 진행 중", { ticketId: item.ticketId, vId, compId });
    return;
  }
  // "이미 만들어져 있는가"는 DB 로 알 수 없다 — `status_code=4000` 은 편성 완료와 렌더 완료를
  // 구분하지 못한다(2026-09-02 스키마 교체). 산출물 존재는 S3 가 유일한 근거다.
  if (await exists(renderKey(vId, compId)).catch(() => false)) {
    log.info("렌더 생략 — 이미 만들어져 있음", { ticketId: item.ticketId, vId, compId });
    return finish(lane, item, "done", { outcome: "ok" });
  }

  try {
    await acceptRender(vId, compId, item.bumper ?? true);
    item.acceptedAt = Date.now();
    log.info("렌더 시작", { ticketId: item.ticketId, vId, compId, bumper: item.bumper });
  } catch (e) {
    if (e instanceof AgentError) {
      switch (e.code) {
        case "COMPOSE_ALREADY_RENDERED":
          return finish(lane, item, "done", { outcome: "ok" });
        case "RENDER_IN_PROGRESS":
          // 실패가 아니라 진행 중이다 — 그대로 지켜본다.
          item.observedRunning = true;
          return;
        case "COMPOSE_NOT_RENDERABLE":
          return finish(lane, item, "error", {
            error: "클립이 없는 편성은 영상으로 만들 수 없습니다.",
          });
        case "COMPOSE_INVALID_INNING":
          // 상류 발행 데이터 결함이라 재시도해도 같은 결과다 — 다시 시도하라고 하지 않는다.
          return finish(lane, item, "error", {
            error: "이 편성은 클립 정보가 온전하지 않아 영상으로 만들 수 없습니다. 다시 편성해 주세요.",
          });
      }
    }
    throw e;
  }
}

/* ── 감시 ───────────────────────────────────────────────────────── */

function startWatch(lane: Lane): void {
  if (lane.timer) return;
  lane.timer = setInterval(() => void tick(lane), WATCH_MS);
  // 타이머가 프로세스 종료를 붙들지 않게 한다.
  (lane.timer as unknown as { unref?: () => void }).unref?.();
}

function stopWatch(lane: Lane): void {
  if (lane.timer) clearInterval(lane.timer);
  lane.timer = null;
}

async function tick(lane: Lane): Promise<void> {
  if (lane.ticking) return; // 조회가 주기보다 오래 걸릴 때의 중복 진입 방지
  const item = lane.running;
  if (!item) {
    stopWatch(lane);
    return;
  }

  const since = item.startedAt ?? item.enqueuedAt;
  if (Date.now() - since > lane.ttlMs) {
    log.warn("시간 초과 — 슬롯 강제 반납", {
      kind: lane.kind, ticketId: item.ticketId, vId: item.vId, compId: item.compId,
    });
    finish(lane, item, "error", {
      error: "시간 안에 끝나지 않았습니다. 결과는 편성 목록에서 확인해 주세요.",
    });
    return;
  }

  lane.ticking = true;
  try {
    if (item.kind === "compose") await tickCompose(lane, item);
    else await tickRender(lane, item);
  } finally {
    lane.ticking = false;
  }
}

async function tickCompose(lane: Lane, item: QueueItem): Promise<void> {
  if (!item.jobId) return; // 접수 응답을 아직 못 받았다

  try {
    const st = await pollJob(item.jobId);
    item.progress = st.progress;
    if (st.status === "running") return;
    if (st.status === "ok") {
      return finish(lane, item, "done", { outcome: "ok", compId: st.compId });
    }
    if (st.status === "empty") {
      // 실패가 아니다 — 조건에 맞는 장면이 없었을 뿐이다.
      return finish(lane, item, "done", { outcome: "empty", compId: st.compId });
    }
    return finish(lane, item, "error", {
      error: st.error ?? "편성에 실패했습니다. 질의를 바꿔 다시 시도해 주세요.",
    });
  } catch (e) {
    if (e instanceof AgentError && e.status === 404) {
      // 잡 캐시가 사라졌으면(인메모리) agent 는 더 알려줄 게 없다 — DB 로 결말을 판정한다.
      // 편성이 성공했다면 t_compose 에 행이 남아 있다. 없으면 실패로 본다
      // (이 시점엔 agent 가 잡을 모르니 "아직 진행 중"일 수는 없다).
      const compId = await findComposeSince(
        item.vId,
        new Date(item.startedAt ?? item.enqueuedAt),
      ).catch(() => null);
      log.warn("잡 조회 불가 — DB 로 결말 판정", { ticketId: item.ticketId, vId: item.vId, compId });
      return compId != null
        ? finish(lane, item, "done", { outcome: "ok", compId })
        : finish(lane, item, "error", { error: "편성이 중단됐습니다. 다시 시도해 주세요." });
    }
    // 일시적 오류(타임아웃 등)는 다음 주기에 다시 본다. 그래도 안 되면 TTL 이 받아준다.
    log.warn("편성 감시 실패 — 다음 주기에 재시도", { ticketId: item.ticketId, message: String(e) });
  }
}

async function tickRender(lane: Lane, item: QueueItem): Promise<void> {
  const compId = item.compId;
  const vId = item.vId;
  if (compId == null) return finish(lane, item, "error", { error: "대상 편성이 없습니다." });

  let st;
  try {
    st = await readRenderState(vId, compId);
  } catch (e) {
    // DB 일시 장애 — 다음 주기에 다시 본다.
    log.warn("렌더 감시 실패 — 다음 주기에 재시도", { ticketId: item.ticketId, message: String(e) });
    return;
  }
  if (!st) return finish(lane, item, "error", { error: "편성을 찾을 수 없습니다." });

  if (isRendering(st.statusCode)) {
    item.observedRunning = true;
    return;
  }
  // 4050 → 4000 으로 돌아왔으면 렌더가 끝난 것이다. 다만 **접수 전부터 4000 이었을 수도**
  // 있으므로(4000 은 편성 완료와 렌더 완료를 구분하지 못한다) 진행을 관측했거나 유예가
  // 지난 뒤에만 종결로 읽는다 — 아래 `settled` 검사가 그 역할을 한다.
  const done = st.statusCode === CODE.COMPOSE_OK;

  // 여기부터는 완료(4000) 또는 실패(4950/4960). 아직 종결로 볼 수 없는 두 경우를 먼저 걸러낸다.
  //   · 접수(agent 202)가 아직 안 끝났다 — 접수는 최대 60초까지 걸릴 수 있는데(워커가 느릴 때)
  //     그동안 "접수되지 않았다"고 단정하면 **실제로는 시작될 렌더의 슬롯을 놓아 버린다.**
  //   · 접수 직후라 agent 가 아직 1 을 쓰기 전이다 — 직전 실패값(-1)이 남아 있으면 방금 시작한
  //     렌더를 실패로 읽는다. 그래서 유예는 **접수가 끝난 시각부터** 센다(RENDER_GRACE_MS).
  const settled =
    item.observedRunning ||
    (item.acceptedAt != null && Date.now() - item.acceptedAt > RENDER_GRACE_MS);
  if (!settled) return;

  if (isRenderFailed(st.statusCode)) {
    return finish(lane, item, "error", {
      error: "영상을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
  }
  if (done) {
    // ⚠️ 상태코드만으로 "성공"을 단정하지 않는다 — 4000 은 편성 완료와 렌더 완료를 구분하지
    //    못하므로(2026-09-02) 산출물을 실제로 확인해야 한다. 예전 `render_datetime` 이
    //    해 주던 증명을 S3 가 대신한다. 종결 전환에서 한 번만 부르므로 tick 마다 도는 비용이
    //    아니다. 여기서 확인하지 않으면 "준비됨"이라고 알린 뒤 상세 화면엔 영상이 없다.
    if (await exists(renderKey(vId, compId)).catch(() => false)) {
      return finish(lane, item, "done", { outcome: "ok" });
    }
    log.warn("완료 기록은 있으나 산출물 없음", { ticketId: item.ticketId, vId, compId });
    return finish(lane, item, "error", {
      error: "영상 생성이 끝났다는 기록은 있으나 결과물을 찾지 못했습니다. 다시 시도해 주세요.",
    });
  }

  // 4000·4950 어느 쪽도 아닌 채 유예가 지났다 — 편성 국면 코드로 되돌아가 있다는 뜻이라
  // 렌더 요청이 먹히지 않은 것이다. 감추지 않고 드러낸다.
  return finish(lane, item, "error", {
    error: "영상 생성 요청이 접수되지 않았습니다. 다시 시도해 주세요.",
  });
}

/* ── 종결 ───────────────────────────────────────────────────────── */

function finish(
  lane: Lane,
  item: QueueItem,
  state: Extract<ItemState, "done" | "error">,
  patch: Partial<QueueItem> = {},
): void {
  // 이중 종결 방어 — 감시 tick 이 결말을 본 직후 접수 호출이 늦게 실패로 돌아오는 식으로
  // 같은 항목이 두 번 들어올 수 있다. 그대로 두면 완료 목록에 같은 티켓이 두 번 쌓인다.
  if (item.finishedAt != null) return;

  Object.assign(item, patch);
  item.state = state;
  item.finishedAt = Date.now();

  if (lane.running === item) lane.running = null;
  else {
    const i = lane.pending.indexOf(item);
    if (i >= 0) lane.pending.splice(i, 1);
  }
  archive(lane, item);

  log.info("종료", {
    kind: item.kind, ticketId: item.ticketId, state, outcome: item.outcome,
    vId: item.vId, compId: item.compId,
    elapsedMs: item.finishedAt - (item.startedAt ?? item.enqueuedAt),
  });

  void pump(lane); // 다음 대기 항목 — 없으면 pump 가 감시를 끈다
}

/** 최근 완료 보관 — 상한을 넘으면 오래된 것부터 버리고 티켓 색인에서도 지운다. */
function archive(lane: Lane, item: QueueItem): void {
  lane.finished.unshift(item);
  while (lane.finished.length > FINISHED_MAX) {
    const dropped = lane.finished.pop();
    if (dropped) index.delete(dropped.ticketId);
  }
}

/* ── 기동 시 복원 ───────────────────────────────────────────────── */

let adoptDone = false;
let adoptInFlight: Promise<void> | null = null;

/**
 * 서버 재시작 전에 시작된 렌더를 슬롯으로 되돌린다 — **큐를 만지는 라우트가 먼저 await 한다.**
 * 이걸 건너뛰면 워커가 이미 1건을 돌고 있는데 큐가 다음 렌더를 접수해 워커 큐에 겹쳐 쌓인다.
 *
 * 편성은 복원하지 않는다 — agent 에 "도는 잡 목록" 엔드포인트가 없다(단건 조회만).
 * 그 잡은 끝나면 DB 에 남으니 결과를 잃지는 않는다.
 */
export function ensureAdopted(): Promise<void> {
  if (adoptDone) return Promise.resolve();
  if (!adoptInFlight) {
    adoptInFlight = adopt()
      .catch((e) => log.warn("진행 중 렌더 복원 실패 — 건너뜀", { message: String(e) }))
      .finally(() => {
        adoptDone = true;
        adoptInFlight = null;
      });
  }
  return adoptInFlight;
}

async function adopt(): Promise<void> {
  const lane = lanes.render;
  if (lane.running || lane.pending.length > 0) return; // 이 프로세스가 이미 관리 중
  const r = await findRunningRender();
  if (!r) return;

  const now = Date.now();
  const item: QueueItem = {
    ticketId: newTicket(),
    kind: "render",
    state: "running",
    label: `편성 #${r.compId} 영상 생성`,
    vId: r.vId,
    compId: r.compId,
    progress: [],
    adopted: true,
    observedRunning: true,
    enqueuedAt: now,
    startedAt: now,
  };
  lane.running = item;
  index.set(item.ticketId, item);
  startWatch(lane);
  // 고아 행(재기동으로 감시가 끊긴 채 4050 으로 남은 것)일 수도 있다. 그러면 TTL(약 12분)이
  // 슬롯을 되돌린다 — agent 의 `_reconcile` 이 다음 렌더 요청 때 그 행을 정정한다.
  log.warn("진행 중 렌더 복원", { compId: r.compId, vId: r.vId, ticketId: item.ticketId });
}
