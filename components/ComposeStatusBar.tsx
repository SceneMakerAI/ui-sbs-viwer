"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { type Ticket, useQueue } from "@/lib/client/queue";

/**
 * 전역 진행 바 — **화면을 떠나도 진행이 보이게** 한다.
 *
 * 상태의 정본은 서버 큐(`GET /api/queue`)다. 어느 페이지에서든 같은 값을 읽으므로,
 * 편성 폼을 떠나도 "지금 어디까지 됐는지"를 잃지 않는다.
 *
 * 2026-08-24 큐 전환으로 **레인이 둘**이 됐다(편성·렌더, 각 동시 1건). 두 작업은 동시에 돌 수
 * 있으므로 줄도 둘까지 보여준다. 남이 돌린 작업도 보이는 게 맞다 — 그동안 내 요청은 뒤에 선다.
 */

/** 완료 알림은 한 번 닫으면 다시 뜨지 않는다 — 새로고침 후에도 유지. */
const DISMISS_KEY = "sbs.composeBar.dismissed";
/** 완료 알림을 띄우는 시간 창(ms). 큐는 최근 30건을 들고 있어서, 없으면 옛 결과가 계속 뜬다. */
const NOTICE_WINDOW_MS = 10 * 60 * 1000;

function recentlyFinished(t: Ticket | undefined): Ticket | null {
  if (!t?.finishedAt) return null;
  return Date.now() - new Date(t.finishedAt).getTime() < NOTICE_WINDOW_MS ? t : null;
}

export default function ComposeStatusBar() {
  const queue = useQueue();
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    try {
      setDismissed(JSON.parse(sessionStorage.getItem(DISMISS_KEY) ?? "[]"));
    } catch {
      /* 형식이 깨졌으면 그냥 처음부터 — 표시용이라 손해가 없다 */
    }
  }, []);

  const close = (ticketId: string) => {
    const next = [...dismissed, ticketId].slice(-20);
    setDismissed(next);
    try {
      sessionStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* 무시 */
    }
  };

  if (!queue) return null;

  const composeRun = queue.compose.running;
  const renderRun = queue.render.running;
  const composeDone = recentlyFinished(queue.compose.finished[0]);
  const renderDone = recentlyFinished(queue.render.finished[0]);

  const rows: React.ReactNode[] = [];

  if (composeRun) {
    rows.push(
      <Row key="compose-run" spinning>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-bold text-brand-blue">클립 편성 중</span>
          {composeRun.step && <span className="text-text-secondary"> · {composeRun.step}</span>}
          {queue.compose.waiting > 0 && (
            <span className="text-text-muted"> · 대기 {queue.compose.waiting}건</span>
          )}
        </span>
        {/* 진행 중에는 결과 페이지가 없다 — 대신 요청한 영상으로 돌아갈 길을 준다. */}
        {composeRun.vId > 0 && (
          <Action href={`/v/${composeRun.vId}`}>영상 보기</Action>
        )}
      </Row>,
    );
  } else if (composeDone && !dismissed.includes(composeDone.ticketId)) {
    rows.push(
      <Row key="compose-done" done={composeDone.state === "done" && composeDone.outcome !== "empty"}>
        {composeDone.state === "done" && composeDone.outcome !== "empty" && composeDone.compId ? (
          <>
            <span className="min-w-0 flex-1 truncate font-bold text-brand-blue">클립 편성이 끝났습니다</span>
            <Action href={`/c/${composeDone.compId}`} onClick={() => close(composeDone.ticketId)}>
              결과 보기
            </Action>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-text-secondary">
            {composeDone.outcome === "empty"
              ? "조건에 맞는 장면을 찾지 못했습니다. 질의를 바꿔 다시 시도해 보세요."
              : (composeDone.error ?? "편성에 실패했습니다. 다시 시도해 주세요.")}
          </span>
        )}
        <Close onClick={() => close(composeDone.ticketId)} />
      </Row>,
    );
  }

  if (renderRun) {
    rows.push(
      <Row key="render-run" spinning>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-bold text-brand-blue">클립 영상 만드는 중</span>
          {renderRun.compId != null && <span className="text-text-secondary"> · 편성 #{renderRun.compId}</span>}
          {queue.render.waiting > 0 && (
            <span className="text-text-muted"> · 대기 {queue.render.waiting}건</span>
          )}
        </span>
        {renderRun.compId != null && <Action href={`/c/${renderRun.compId}`}>편성 보기</Action>}
      </Row>,
    );
  } else if (renderDone && !dismissed.includes(renderDone.ticketId)) {
    rows.push(
      <Row key="render-done" done={renderDone.state === "done"}>
        {renderDone.state === "done" ? (
          <>
            <span className="min-w-0 flex-1 truncate font-bold text-brand-blue">클립 영상이 준비됐습니다</span>
            {renderDone.compId != null && (
              <Action href={`/c/${renderDone.compId}`} onClick={() => close(renderDone.ticketId)}>
                보러 가기
              </Action>
            )}
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-text-secondary">
            {renderDone.error ?? "클립 영상을 만들지 못했습니다. 다시 시도해 주세요."}
          </span>
        )}
        <Close onClick={() => close(renderDone.ticketId)} />
      </Row>,
    );
  }

  if (rows.length === 0) return null;

  return (
    <div className="sticky top-0 z-40 border-b border-line bg-surface-alt">
      <div className="mx-auto max-w-[1280px] divide-y divide-line px-4 sm:px-6">{rows}</div>
    </div>
  );
}

function Row({
  children,
  spinning,
  done,
}: {
  children: React.ReactNode;
  spinning?: boolean;
  done?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 text-sm">
      {spinning ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-blue" aria-hidden />
      ) : done ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-blue" aria-hidden />
      ) : (
        <span className="h-4 w-4 shrink-0" aria-hidden />
      )}
      {children}
    </div>
  );
}

function Action({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} onClick={onClick} className="shrink-0 font-bold text-brand-blue hover:underline">
      {children}
    </Link>
  );
}

function Close({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="알림 닫기"
      className="shrink-0 rounded p-1 text-text-muted hover:text-text-primary"
    >
      <X className="h-4 w-4" aria-hidden />
    </button>
  );
}
