"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { BUDGET_OPTIONS, DEFAULT_BUDGET_SEC } from "@/lib/domain/budget";
import {
  cancelTicket,
  forgetTicket,
  isActive,
  postCompose,
  readTicket,
  rememberTicket,
  useQueue,
  useTicket,
} from "@/lib/client/queue";

const EXAMPLES = ["삼진 모음", "이닝별 하이라이트 장면들", "역전 장면만", "홈런 장면", "득점 장면"];

/**
 * 편성 폼 — 요청을 **큐에 넣고** 순번·진행을 보여준다(PAGES.md §5).
 *
 * 2026-08-24 큐 전환: 예전에는 409 `COMPOSE_BUSY` 를 받고 5초마다 스스로 재시도해 대기열을
 * 흉내 냈다. 이제 접수는 **항상 성공(202 + 티켓)** 이고, 대기 순번은 서버가 알려준다.
 * 티켓은 브라우저에 남겨(`lib/client/queue.ts`) 새로고침·재접속에도 진행이 이어 보인다.
 */
export default function ComposeForm({ vId }: { vId: number }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // `null` 은 "없음"(상한 미적용) — 0 이나 -1 같은 표식 대신 그대로 null 을 보낸다.
  const [budgetSec, setBudgetSec] = useState<number | null>(DEFAULT_BUDGET_SEC);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const queue = useQueue();
  const { ticket, gone } = useTicket(ticketId);
  const pushed = useRef(false);

  // 새로고침·재접속 복구 — 이 영상에 걸어 둔 요청이 있으면 이어서 보여준다.
  useEffect(() => {
    const saved = readTicket("compose", vId);
    if (saved) setTicketId(saved);
  }, [vId]);

  // 결말 처리 — 성공이면 결과로 보내고, 그 밖은 문구로 남긴다.
  useEffect(() => {
    if (!ticket || isActive(ticket)) return;
    forgetTicket("compose", vId); // 끝난 티켓을 다음 방문까지 들고 있을 이유가 없다
    if (ticket.state === "done" && ticket.outcome !== "empty" && ticket.compId && !pushed.current) {
      pushed.current = true;
      router.push(`/c/${ticket.compId}`);
    }
  }, [ticket, router, vId]);

  const submit = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    const res = await postCompose({ vId, query: query.trim(), budgetSec });
    setSubmitting(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    pushed.current = false;
    rememberTicket("compose", vId, res.ticket.ticketId);
    setTicketId(res.ticket.ticketId);
  }, [budgetSec, query, vId]);

  const cancel = useCallback(async () => {
    if (!ticketId) return;
    const ok = await cancelTicket(ticketId);
    if (!ok) return; // 이미 시작됐다 — 그대로 진행을 보여준다
    forgetTicket("compose", vId);
    setTicketId(null);
  }, [ticketId, vId]);

  const lane = queue?.compose;
  const waiting = isActive(ticket);
  const full = Boolean(lane?.full) && !waiting;
  const disabled = waiting || submitting || full || query.trim().length < 2;

  // 내 요청이 없을 때만 큐 상황을 알린다 — 내 요청이 있으면 그 순번이 더 정확한 정보다.
  const laneBusy = !waiting && Boolean(lane && (lane.running || lane.waiting > 0));

  return (
    <div className="rounded-lg border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-lg font-bold">어떤 장면을 모아볼까요?</h2>
      <p className="mt-2 text-sm text-text-secondary">
        보고 싶은 장면을 문장으로 적어주세요. 경기 전체에서 해당 장면만 찾아 하나의 영상으로 만들어 드립니다.
      </p>

      {/* 대기열이 가득 차면 접수 자체가 거절된다(503) — 누르기 전에 알린다. */}
      {full && (
        <p className="mt-4 rounded border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
          대기 중인 요청이 {lane?.waiting}건입니다. 5~10분 뒤에 다시 시도해 주세요.
        </p>
      )}

      {!full && laneBusy && (
        <p className="mt-4 flex items-center gap-2 rounded border border-brand-blue/30 bg-brand-blue-soft px-3 py-2.5 text-sm text-brand-blue">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          {lane?.running ? "다른 요청을 처리하고 있습니다." : ""}
          {lane && lane.waiting > 0 ? ` 대기 ${lane.waiting}건.` : ""} 지금 요청하면 순서대로 시작됩니다.
        </p>
      )}

      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        rows={2}
        maxLength={200}
        disabled={waiting}
        placeholder="예) 이닝별 하이라이트 장면들"
        aria-label="편성할 장면 설명"
        className="mt-4 w-full resize-none rounded border border-line bg-surface-alt px-4 py-3 text-sm outline-none focus:border-brand-blue disabled:opacity-60"
      />

      <p className="mt-4 text-xs text-text-muted">이런 것도 만들 수 있어요</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={waiting}
            onClick={() => setQuery(ex)}
            className="rounded-full border border-line px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {/* 이제 budget 은 실제로 지켜지는 상한이다 — 넘치는 만큼 중요도가 낮은 클립부터
              버린다(덜어내기 전용, lib/domain/budget.ts). 모자라면 모자란 대로 나온다. */}
          <p className="text-xs text-text-muted">최대 길이</p>
          <div className="mt-1.5 inline-flex rounded border border-line p-1">
            {BUDGET_OPTIONS.map((o) => (
              <button
                key={o.label}
                type="button"
                disabled={waiting}
                onClick={() => setBudgetSec(o.sec)}
                aria-pressed={budgetSec === o.sec}
                className={`rounded px-4 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                  budgetSec === o.sec
                    ? "bg-ink font-bold text-on-dark"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 max-w-[15rem] text-xs text-text-muted">
            {budgetSec === null
              ? "상한 없이 고른 장면을 모두 담습니다."
              : "넘으면 덜 중요한 장면부터 빠집니다. 짧게 나올 수도 있습니다."}
          </p>
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={submit}
          className="inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded bg-brand-blue px-6 py-3 text-sm font-bold text-on-dark transition-colors hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {!waiting && !submitting ? (
            <>
              <Sparkles className="h-4 w-4" aria-hidden />
              클립 편성하기
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {ticket?.state === "running" ? "편성 중" : "대기 중"}
            </>
          )}
        </button>
      </div>

      {/* 내 요청의 순번·진행 — 서버가 알려주는 값 그대로다. */}
      {waiting && ticket && (
        <div className="mt-4 rounded border border-line bg-surface-alt p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">
                {ticket.state === "pending"
                  ? `대기 ${ticket.position ?? 1}번째`
                  : (ticket.step ?? "편성을 시작하는 중")}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {ticket.state === "pending"
                  ? "앞의 요청이 끝나면 자동으로 시작됩니다. 이 페이지를 닫아도 요청은 남아 있습니다."
                  : "질의에 맞는 장면을 고릅니다. 보통 몇 분 걸리며, 끝나면 결과 화면으로 이동합니다."}
              </p>
            </div>
            {/* 취소는 대기 중에만 — 시작된 작업은 agent·워커에 취소 계약이 없다(PAGES.md §5). */}
            {ticket.state === "pending" && (
              <button
                type="button"
                onClick={cancel}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-3 py-1.5 text-xs font-bold text-text-secondary transition-colors hover:text-text-primary"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                취소
              </button>
            )}
          </div>
        </div>
      )}

      {/* 끝난 요청의 결말 — 성공은 결과 화면으로 넘어가므로 여기 남지 않는다. */}
      {ticket && !isActive(ticket) && ticket.state !== "canceled" && (
        <p className="mt-4 rounded border border-line bg-surface-alt px-3 py-2.5 text-sm text-text-secondary">
          {ticket.outcome === "empty"
            ? "조건에 맞는 장면을 찾지 못했습니다. 질의를 바꿔 다시 시도해 보세요."
            : (ticket.error ?? "편성이 끝났습니다.")}
        </p>
      )}

      {gone && !ticket && (
        <p className="mt-4 rounded border border-line bg-surface-alt px-3 py-2.5 text-sm text-text-secondary">
          진행 정보를 찾을 수 없습니다. 편성 목록에서 결과를 확인해 주세요.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>
      )}
    </div>
  );
}
