"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, X } from "lucide-react";

/**
 * 전역 편성 진행 바 — **화면을 떠나도 진행이 보이게** 한다.
 *
 * 편성은 원래부터 백그라운드 작업이다(agent-compose 가 202 로 접수, 서버가 감시).
 * 그런데 진행 표시가 편성 폼 안에만 있어서, 다른 페이지로 가면 "지금 어디까지 됐는지"를
 * 잃었다. 상태의 정본은 서버(`GET /api/compose` 의 `job`)이므로 어느 페이지에서든 같은 값을 읽는다.
 *
 * 동시 처리는 전역 1건이라(PAGES.md §5) 바도 하나면 충분하다.
 * 다른 사람이 돌린 편성도 보이는 게 맞다 — 어차피 그동안 내 요청은 대기해야 한다.
 */

const POLL_MS = 5000;

interface Job {
  jobId: string;
  vId: number;
  status: "running" | "ok" | "empty" | "error";
  progress: string[];
  compId?: number;
  error?: string;
}

/** 완료 알림은 한 번 닫으면 다시 뜨지 않는다 — 새로고침 후에도 유지. */
const DISMISS_KEY = "sbs.composeBar.dismissed";

export default function ComposeStatusBar() {
  const [job, setJob] = useState<Job | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY));
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/compose", { cache: "no-store" });
        const j = await r.json();
        if (alive) setJob(j.job ?? null);
      } catch {
        /* 표시용이라 실패는 무시한다 — 다음 주기에 다시 본다 */
      }
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!job) return null;

  const running = job.status === "running";
  if (!running && dismissed === job.jobId) return null;

  const step = job.progress.at(-1);
  const close = () => {
    sessionStorage.setItem(DISMISS_KEY, job.jobId);
    setDismissed(job.jobId);
  };

  return (
    <div className="sticky top-0 z-40 border-b border-line bg-surface-alt">
      <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-2.5 text-sm sm:px-6">
        {running ? (
          <>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-blue" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-bold text-brand-blue">클립 편성 중</span>
              {step && <span className="text-text-secondary"> · {step}</span>}
            </span>
            {/* 진행 중에도 결과 페이지는 없다 — 대신 요청한 영상으로 돌아갈 길을 준다. */}
            {job.vId > 0 && (
              <Link href={`/v/${job.vId}`} className="shrink-0 font-bold text-brand-blue hover:underline">
                영상 보기
              </Link>
            )}
          </>
        ) : job.status === "ok" && job.compId ? (
          <>
            <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-blue" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-bold text-brand-blue">클립 편성이 끝났습니다</span>
            <Link
              href={`/c/${job.compId}`}
              onClick={close}
              className="shrink-0 font-bold text-brand-blue hover:underline"
            >
              결과 보기
            </Link>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-text-secondary">
            {job.status === "empty"
              ? "조건에 맞는 장면을 찾지 못했습니다. 질의를 바꿔 다시 시도해 보세요."
              : (job.error ?? "편성에 실패했습니다. 다시 시도해 주세요.")}
          </span>
        )}

        {!running && (
          <button
            type="button"
            onClick={close}
            aria-label="알림 닫기"
            className="shrink-0 rounded p-1 text-text-muted hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
