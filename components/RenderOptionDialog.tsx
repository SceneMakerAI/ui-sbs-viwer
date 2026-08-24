"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Clapperboard, Loader2 } from "lucide-react";
import {
  forgetTicket,
  isActive,
  postRender,
  readTicket,
  rememberTicket,
  useTicket,
} from "@/lib/client/queue";

/**
 * 렌더 옵션 다이얼로그 — 하이라이트 영상 만들기 버튼이 여는 창.
 *
 * 범퍼는 **편성 폼이 아니라 여기서** 정한다(PAGES.md §10). 범퍼는 어떤 장면을 고를지와 무관한
 * 출력 옵션이라, 편성 폼에 두면 편성 결과가 달라지는 것처럼 읽힌다.
 * 기본값은 On — worker-render 자체 기본값과 같다.
 *
 * 여는 버튼의 문구·모양은 호출부가 정한다(2026-08-24) — 이 버튼은 재생 방식 전환 묶음 안에서
 * `하이라이트 영상 없음` 자리를 대신하므로, 그 묶음의 칸 모양을 그대로 써야 한다.
 *
 * 2026-08-24 큐 전환 — 확인을 누르면 **렌더 레인에 들어간다**(편성 레인과 별개, 동시 1건).
 * 접수 응답은 "만들기 시작했다"가 아니라 "대기열에 들어갔다"는 뜻이라, 순서를 기다리는 동안은
 * 버튼 자리에 **대기 순번**을 보여준다(그 사이 `render_status` 는 아직 1 이 아니라 화면이
 * "만드는 중"으로 바뀌지 않는다). 티켓은 편성별로 브라우저에 남겨 새로고침에도 이어 보인다.
 * 한 편성에 하이라이트 하나 — 같은 편성을 다시 넣으면 서버가 기존 티켓을 돌려준다.
 */
export default function RenderOptionDialog({
  compId,
  clipCount,
  defaultBumper,
  /** 이닝 그룹이 하나뿐이면 범퍼가 들어갈 자리가 없다. */
  bumperAvailable,
  label = "이 편성으로 하이라이트 만들기",
  className = "inline-flex w-full items-center justify-center gap-2 rounded bg-brand-blue px-4 py-3 text-sm font-bold text-on-dark transition-colors hover:bg-brand-blue-hover",
}: {
  compId: number;
  clipCount: number;
  defaultBumper: boolean;
  bumperAvailable: boolean;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bumper, setBumper] = useState(defaultBumper);
  const [running, setRunning] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const { ticket } = useTicket(ticketId);
  const refreshed = useRef(false);
  /** "범퍼"가 무슨 말인지 모르는 사람이 많다 — 물음표를 눌러 예시 영상을 보여준다. */
  const [help, setHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 새로고침·재접속 복구 — 이 편성에 걸어 둔 요청이 있으면 이어서 보여준다.
  useEffect(() => {
    const saved = readTicket("render", compId);
    if (saved) setTicketId(saved);
  }, [compId]);

  // 끝났으면 화면을 새로 읽는다 — 완료 판정의 정본은 `t_compose`(render_status·render_datetime)라
  // 서버 컴포넌트를 다시 그려야 "준비됨"으로 바뀐다.
  useEffect(() => {
    if (!ticket || isActive(ticket)) return;
    forgetTicket("render", compId);
    if (!refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [ticket, compId, router]);

  const run = async () => {
    setRunning(true);
    setError(null);
    const res = await postRender({ compId, bumper: bumperAvailable && bumper });
    setRunning(false);

    if (!res.ok) {
      if (res.code === "ALREADY_RENDERED" || res.code === "RENDER_IN_PROGRESS") {
        // 다른 창에서 먼저 시작·완료한 경우다 — 사용자 잘못이 아니므로 그냥 새로고침해
        // 현재 상태(만드는 중 / 준비됨)를 보여준다.
        setOpen(false);
        router.refresh();
        return;
      }
      // 대기열 포화(503)도 여기로 온다 — 문구에 "5~10분 뒤" 안내가 들어 있다.
      setError(res.error);
      return;
    }
    // 접수됐을 뿐 아직 만들어지지 않았다. 순번은 티켓으로 따라간다.
    refreshed.current = false;
    rememberTicket("render", compId, res.ticket.ticketId);
    setTicketId(res.ticket.ticketId);
    setOpen(false);
  };

  return (
    <>
      {isActive(ticket) && ticket ? (
        <p
          aria-live="polite"
          className="inline-flex w-full items-center justify-center gap-2 rounded border border-line px-4 py-3 text-sm text-text-secondary"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          {ticket.state === "pending"
            ? `영상 만들기 대기 ${ticket.position ?? 1}번째`
            : "하이라이트 영상을 만들고 있습니다"}
        </p>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={className}>
          <Clapperboard className="h-4 w-4" aria-hidden />
          {label}
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="render-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !running) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-lg bg-surface p-7">
            <h2 id="render-title" className="text-lg font-bold">
              하이라이트 영상 만들기
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              편성한 {clipCount}개 클립을 하나의 하이라이트 영상으로 이어붙입니다. 완성까지 몇 분 정도
              걸리며, 만드는 동안 이 화면을 닫아도 됩니다.
            </p>

            <div className="mt-6 rounded bg-surface-alt p-4">
              <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  이닝 사이에 범퍼 넣기
                  <button
                    type="button"
                    onClick={() => setHelp((v) => !v)}
                    aria-expanded={help}
                    aria-controls="bumper-help"
                    aria-label="범퍼가 무엇인지 예시로 보기"
                    className="flex h-4 w-4 items-center justify-center rounded-full border border-text-muted text-[10px] font-bold text-text-muted transition-colors hover:border-brand-blue hover:text-brand-blue"
                  >
                    ?
                  </button>
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  {bumperAvailable
                    ? "이닝이 바뀔 때 짧은 전환 영상을 넣습니다."
                    : "이닝이 하나뿐이라 범퍼가 들어갈 자리가 없습니다."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={bumperAvailable && bumper}
                aria-label="이닝 사이에 범퍼 넣기"
                disabled={!bumperAvailable || running}
                onClick={() => setBumper((v) => !v)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                  bumperAvailable && bumper ? "bg-brand-blue" : "bg-line"
                }`}
              >
                <span
                  className={`absolute top-0.5 block h-5 w-5 rounded-full bg-surface transition-all ${
                    bumperAvailable && bumper ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
              </div>

              {/* 예시 영상 — 말로 설명하는 것보다 2초짜리 실물을 한 번 보는 게 빠르다.
                  원본은 solbox-208:/stg/vod/scenemaker/inning_bumper/inning_bumper_01_bot.mp4 이고,
                  미리보기용으로 640px·무음으로 줄여 public/ 에 넣었다(약 190KB). */}
              {help && (
                <div id="bumper-help" className="mt-4 border-t border-line pt-4">
                  <video
                    src="/inning-bumper-preview.mp4"
                    autoPlay
                    loop
                    muted
                    playsInline
                    aria-label="이닝 범퍼 예시 영상"
                    className="aspect-video w-full rounded bg-ink"
                  />
                  <p className="mt-2 text-xs leading-relaxed text-text-muted">
                    이닝이 바뀌는 자리에 위와 같은 <b>2초짜리 전환 영상</b>이 들어갑니다. 어느 이닝으로
                    넘어가는지 알려 줘서, 장면이 갑자기 튀는 느낌을 줄여 줍니다. (예시는 1회말 범퍼이며
                    실제로는 해당 이닝에 맞는 것이 들어갑니다.)
                  </p>
                </div>
              )}
            </div>

            {error && (
              <p className="mt-4 rounded border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
                {error}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={running}
                onClick={() => setOpen(false)}
                className="rounded border border-line px-5 py-3 text-sm font-bold text-text-secondary disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={running}
                onClick={run}
                className="inline-flex items-center gap-2 rounded bg-brand-blue px-5 py-3 text-sm font-bold text-on-dark transition-colors hover:bg-brand-blue-hover disabled:opacity-60"
              >
                {running ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    요청하는 중
                  </>
                ) : (
                  <>
                    <Clapperboard className="h-4 w-4" aria-hidden />
                    하이라이트 만들기
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
