"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Clapperboard, Loader2 } from "lucide-react";

/**
 * 렌더 옵션 다이얼로그 — `[이 편성으로 렌더하기]`가 여는 창.
 *
 * 범퍼는 **편성 폼이 아니라 여기서** 정한다(PAGES.md §10). 범퍼는 어떤 장면을 고를지와 무관한
 * 출력 옵션이라, 편성 폼에 두면 편성 결과가 달라지는 것처럼 읽힌다.
 * 기본값은 On — worker-render 자체 기본값과 같다.
 */
export default function RenderOptionDialog({
  compId,
  clipCount,
  defaultBumper,
  /** 이닝 그룹이 하나뿐이면 범퍼가 들어갈 자리가 없다. */
  bumperAvailable,
}: {
  compId: number;
  clipCount: number;
  defaultBumper: boolean;
  bumperAvailable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bumper, setBumper] = useState(defaultBumper);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compId, bumper: bumperAvailable && bumper }),
      });
      const j = await r.json().catch(() => ({}));

      if (r.status === 409 && (j.code === "ALREADY_RENDERED" || j.code === "RENDER_IN_PROGRESS")) {
        // 다른 창에서 먼저 시작·완료한 경우다 — 사용자 잘못이 아니므로 그냥 새로고침해
        // 현재 상태(만드는 중 / 준비됨)를 보여준다.
        setOpen(false);
        router.refresh();
        return;
      }
      if (!r.ok) {
        setError(j.error ?? "영상을 만들지 못했습니다.");
        return;
      }
      // ⚠️ 접수됐을 뿐 아직 만들어지지 않았다 — agent-compose 는 202 로 받고 완료를
      // 백그라운드에서 확인해 render_status·render_datetime 에 기록한다(2026-08-24).
      // 새로고침하면 render_status=1 이라 화면이 "만들고 있습니다"로 바뀐다.
      setOpen(false);
      router.refresh();
    } catch {
      setError("영상 생성 중 오류가 발생했습니다.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-2 rounded bg-brand-blue px-4 py-3 text-sm font-bold text-on-dark transition-colors hover:bg-brand-blue-hover"
      >
        <Clapperboard className="h-4 w-4" aria-hidden />이 편성으로 하이라이트 만들기
      </button>

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

            <div className="mt-6 flex items-center gap-3 rounded bg-surface-alt p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">이닝 사이에 범퍼 넣기</p>
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
