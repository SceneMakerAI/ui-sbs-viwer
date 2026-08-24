"use client";

/**
 * 대기열 클라이언트 — 큐 API(`/api/queue`)를 화면에서 쓰기 좋게 감싼다.
 *
 * 서버가 요청을 들고 순서대로 보낸다(PAGES.md §5). 화면이 할 일은 셋뿐이다:
 *   1) 접수하고 **티켓을 받아 보관**한다(브라우저 localStorage — 로그인이 없어 이게 유일한 "내 것" 표시).
 *   2) 티켓을 폴링해 **순번·진행**을 보여준다. 탭을 닫았다 와도 티켓만 있으면 이어서 보인다.
 *   3) 큐가 가득 차면(`full`) 접수를 막고 **"5~10분 뒤에 다시"** 를 안내한다.
 *
 * 폴링 타이머는 훅이 정리한다 — 화면을 떠난 뒤에도 타이머가 살아 요청을 보내던 옛 문제를 막는다.
 */
import { useEffect, useState } from "react";

export type QueueKind = "compose" | "render";
export type ItemState = "pending" | "running" | "done" | "error" | "canceled";

export interface Ticket {
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
  /** 편성이 끝난 방식 — `empty` 는 실패가 아니라 "맞는 장면이 없음". */
  outcome?: "ok" | "empty";
  error?: string;
  /** 0 = 진행 중 · 1 이상 = 대기 순번 · null = 끝남. */
  position: number | null;
  /** 서버 재시작 전 요청이라 요청자를 알 수 없는 항목. */
  adopted?: boolean;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface Lane {
  kind: QueueKind;
  running: Ticket | null;
  pending: Ticket[];
  finished: Ticket[];
  waiting: number;
  max: number;
  full: boolean;
}

export interface QueueState {
  compose: Lane;
  render: Lane;
  at: string;
}

/** 폴링 주기(ms). 편성은 1~3분, 렌더는 몇 분 걸리는 작업이라 3초면 충분하다. */
export const POLL_MS = 3000;

export function isActive(t: Ticket | null | undefined): boolean {
  return t?.state === "pending" || t?.state === "running";
}

/* ── 티켓 보관 ──────────────────────────────────────────────────── */

/**
 * 티켓은 **대상별로** 따로 기억한다 — 영상 A 를 편성해 두고 영상 B 로 옮겼을 때
 * B 의 폼에 A 의 진행이 뜨면 안 된다.
 */
function key(kind: QueueKind, target: number): string {
  return `sbs.ticket.${kind}.${target}`;
}

export function rememberTicket(kind: QueueKind, target: number, ticketId: string): void {
  try {
    localStorage.setItem(key(kind, target), ticketId);
  } catch {
    /* 사생활 모드 등 — 보관 못 해도 이번 화면에서는 그대로 보인다 */
  }
}

export function readTicket(kind: QueueKind, target: number): string | null {
  try {
    return localStorage.getItem(key(kind, target));
  } catch {
    return null;
  }
}

export function forgetTicket(kind: QueueKind, target: number): void {
  try {
    localStorage.removeItem(key(kind, target));
  } catch {
    /* 무시 */
  }
}

/* ── 접수 ───────────────────────────────────────────────────────── */

export type SubmitResult =
  | { ok: true; ticket: Ticket & { dedup?: boolean } }
  /** 대기열 포화 — 실패가 아니라 "지금은 붐빈다". 화면은 재시도 시각을 안내한다. */
  | { ok: false; full: true; code: "QUEUE_FULL"; error: string; retryAfterSec: number }
  | { ok: false; full: false; error: string; code?: string };

async function post(url: string, body: unknown): Promise<SubmitResult> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // 게이트웨이(nginx)가 끼어들면 본문이 HTML 이라 JSON 파싱이 터진다 —
    // 그때도 상태 코드로 상황을 구분해야 해서 파싱 실패를 삼킨다.
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;

    if (r.status === 503 && j.code === "QUEUE_FULL") {
      return {
        ok: false,
        full: true,
        code: "QUEUE_FULL",
        error:
          typeof j.error === "string"
            ? j.error
            : "대기 중인 요청이 많습니다. 5~10분 뒤에 다시 시도해 주세요.",
        retryAfterSec: typeof j.retryAfterSec === "number" ? j.retryAfterSec : 300,
      };
    }
    if (!r.ok) {
      return {
        ok: false,
        full: false,
        error: typeof j.error === "string" ? j.error : "요청에 실패했습니다.",
        ...(typeof j.code === "string" ? { code: j.code } : {}),
      };
    }
    return { ok: true, ticket: j as unknown as Ticket & { dedup?: boolean } };
  } catch {
    return { ok: false, full: false, error: "요청 중 오류가 발생했습니다." };
  }
}

export function postCompose(p: {
  vId: number;
  query: string;
  budgetSec: number | null;
}): Promise<SubmitResult> {
  return post("/api/compose", p);
}

export function postRender(p: { compId: number; bumper: boolean }): Promise<SubmitResult> {
  return post("/api/render", p);
}

/** 대기 중 요청 취소. 진행 중이면 서버가 409 로 거절한다(취소 계약이 없다). */
export async function cancelTicket(ticketId: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/queue/ticket/${ticketId}`, { method: "DELETE" });
    return r.ok;
  } catch {
    return false;
  }
}

/* ── 폴링 훅 ────────────────────────────────────────────────────── */

/** 큐 전체 — 전역 진행 바와 편성 폼이 같은 값을 본다. */
export function useQueue(pollMs: number = POLL_MS): QueueState | null {
  const [state, setState] = useState<QueueState | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/queue", { cache: "no-store" });
        const j = (await r.json()) as QueueState;
        if (alive) setState(j);
      } catch {
        /* 표시용이라 실패는 무시한다 — 다음 주기에 다시 본다 */
      }
    };
    void tick();
    const t = setInterval(() => void tick(), pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pollMs]);

  return state;
}

/**
 * 티켓 1건. 끝나면 폴링을 멈춘다.
 *
 * `gone` 은 **서버가 더는 기억하지 않는다**는 뜻이다(완료 보관에서 밀려남·서버 재시작).
 * 요청이 없었다는 뜻이 아니다 — 결과는 DB 에 남으므로 화면은 편성 목록으로 안내한다.
 */
export function useTicket(
  ticketId: string | null,
  pollMs: number = POLL_MS,
): { ticket: Ticket | null; gone: boolean } {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    setTicket(null);
    setGone(false);
    if (!ticketId) return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const r = await fetch(`/api/queue/ticket/${ticketId}`, { cache: "no-store" });
        if (!alive) return;
        if (r.status === 404) {
          setGone(true);
          return; // 더 물어볼 게 없다
        }
        const j = (await r.json()) as Ticket;
        setTicket(j);
        if (j.state === "pending" || j.state === "running") {
          timer = setTimeout(() => void tick(), pollMs);
        }
      } catch {
        if (alive) timer = setTimeout(() => void tick(), pollMs); // 일시 오류는 다음 주기
      }
    };

    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [ticketId, pollMs]);

  return { ticket, gone };
}
