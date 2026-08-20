"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import RenderOptionDialog from "./RenderOptionDialog";
import { formatDuration, formatInning, formatScoreWithTeams, formatTimecode, type Teams } from "@/lib/format";
import type { Clip, Compose } from "@/lib/types";

type Mode = "source" | "render";

/**
 * 편성 결과 재생 — 한 페이지에서 두 가지 재생 방식을 전환한다(PAGES.md §1-D).
 *   · 원본 구간 재생: 원본 영상을 클립 구간으로 시킹. **렌더 없이도 즉시 확인 가능.**
 *   · 렌더 영상: 이어붙인 MP4. 렌더본이 없으면 비활성.
 *
 * 클립 클릭 → 구간 이동은 **원본 모드에서만** 의미가 있다.
 * 렌더본은 이미 한 편으로 이어붙어 있어 이동이 필요 없다.
 */
export default function ClipPlayer({
  compose,
  clips,
  teams,
  sourceUrl,
  renderUrl,
}: {
  compose: Compose;
  clips: Clip[];
  teams: Teams | null;
  sourceUrl: string | null;
  renderUrl: string | null;
}) {
  const [mode, setMode] = useState<Mode>(renderUrl ? "render" : "source");
  const [activeSeq, setActiveSeq] = useState<number | null>(null);
  const [renderDuration, setRenderDuration] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const url = mode === "render" ? renderUrl : sourceUrl;

  /**
   * 렌더 영상에서 각 클립이 **몇 초 지점부터** 시작하는지.
   *
   * 렌더본은 클립을 순서대로 이어붙인 것이라 누적 길이가 곧 시작 지점이다.
   * 다만 이닝이 바뀌는 자리에 범퍼가 들어갈 수 있어 그만큼 밀린다 — 범퍼 길이는 DB 에 없으므로
   * **실제 영상 길이와 클립 합계의 차이**를 이닝 경계 수로 나눠 되찾는다.
   * (범퍼 없이 렌더된 경우 차이가 0 이라 그대로 누적합이 된다. 실측 comp 14: 42클립 합계 1018초 = 영상 1018초.)
   */
  const renderOffsets = useMemo(() => {
    const durations = clips.map((c) => c.end - c.start);
    const clipSum = durations.reduce((a, b) => a + b, 0);

    const boundaries = clips.reduce(
      (n, c, i) => (i > 0 && c.inning !== clips[i - 1].inning ? n + 1 : n),
      0,
    );
    const extra = renderDuration != null ? Math.max(0, renderDuration - clipSum) : 0;
    // 차이가 1초 미만이면 인코딩 오차로 보고 무시한다.
    const gap = boundaries > 0 && extra >= 1 ? extra / boundaries : 0;

    let at = 0;
    return clips.map((c, i) => {
      if (i > 0 && c.inning !== clips[i - 1].inning) at += gap;
      const start = at;
      at += durations[i];
      return { seq: c.seq, start, end: at };
    });
  }, [clips, renderDuration]);

  // 원본 모드에서 클립을 고르면 해당 구간으로 이동한다.
  useEffect(() => {
    if (mode !== "source" || activeSeq == null) return;
    const clip = clips.find((c) => c.seq === activeSeq);
    const el = videoRef.current;
    if (!clip || !el) return;
    el.currentTime = clip.start;
    void el.play().catch(() => {
      /* 자동재생이 막히면 사용자가 직접 누르면 된다 */
    });
  }, [activeSeq, clips, mode]);

  /**
   * 원본 모드의 **연속 재생** — 구간 끝에 닿으면 다음 클립으로 넘어간다.
   * 이게 없으면 편성과 무관한 원본이 계속 흘러서, 편성 결과를 확인하는 용도가 안 된다.
   * 마지막 클립이면 멈춘다(렌더 영상과 같은 지점에서 끝나게).
   */
  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;

    // 렌더 영상: 재생 위치로 지금 보고 있는 클립을 역산해 목록에 표시한다.
    if (mode === "render") {
      const cur = renderOffsets.find((o) => v.currentTime >= o.start && v.currentTime < o.end);
      if (cur && cur.seq !== activeSeq) setActiveSeq(cur.seq);
      return;
    }

    if (activeSeq == null) return;
    const el = v;
    const idx = clips.findIndex((c) => c.seq === activeSeq);
    const clip = clips[idx];
    if (!el || !clip || el.currentTime < clip.end) return;

    const next = clips[idx + 1];
    if (next) setActiveSeq(next.seq);
    else el.pause();
  };

  /**
   * 목록에서 클립을 고르면 그 지점으로 이동한다.
   * 원본 모드는 원본의 구간 시작으로, 렌더 모드는 이어붙인 영상 안의 누적 지점으로 간다.
   */
  const handleClipClick = (seq: number) => {
    if (mode === "render") {
      const offset = renderOffsets.find((o) => o.seq === seq);
      const el = videoRef.current;
      if (!offset || !el) return;
      el.currentTime = offset.start;
      void el.play().catch(() => {
        /* 자동재생이 막히면 사용자가 직접 누르면 된다 */
      });
    }
    setActiveSeq(seq);
  };

  /** 클립을 고르지 않은 채 재생을 누르면 첫 클립부터 이어서 본다. */
  const handlePlay = () => {
    if (mode === "source" && activeSeq == null && clips.length > 0) setActiveSeq(clips[0].seq);
  };

  /** 렌더 영상 길이 — 범퍼가 들어갔는지 판정하는 근거(renderOffsets 참고). */
  const handleLoadedMetadata = () => {
    if (mode === "render" && videoRef.current) setRenderDuration(videoRef.current.duration);
  };

  // 재생 중인 클립이 목록 밖으로 밀리면 따라가서 보여준다(42개까지 나온다).
  useEffect(() => {
    if (activeSeq == null) return;
    listRef.current
      ?.querySelector(`[data-seq="${activeSeq}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSeq]);

  /**
   * 사용자가 직접 다른 지점으로 이동하면 연속 재생을 푼다.
   * 안 그러면 구간 밖으로 옮긴 순간 다음 클립으로 튕겨서 재생 위치를 못 옮긴다.
   * (우리가 건 이동은 항상 구간 안이라 그대로 유지된다.)
   */
  const handleSeeked = () => {
    if (mode !== "source" || activeSeq == null) return;
    const el = videoRef.current;
    const clip = clips.find((c) => c.seq === activeSeq);
    if (!el || !clip) return;
    if (el.currentTime < clip.start - 0.5 || el.currentTime > clip.end) setActiveSeq(null);
  };

  const bumperAvailable = new Set(clips.map((c) => c.inning).filter(Boolean)).size > 1;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded border border-line p-1">
            <button
              type="button"
              onClick={() => setMode("source")}
              aria-pressed={mode === "source"}
              className={`rounded px-4 py-1.5 text-sm transition-colors ${
                mode === "source" ? "bg-ink font-bold text-on-dark" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              원본 구간 재생
            </button>
            <button
              type="button"
              disabled={!renderUrl}
              onClick={() => setMode("render")}
              aria-pressed={mode === "render"}
              className={`rounded px-4 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "render" ? "bg-ink font-bold text-on-dark" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {/* "렌더"는 내부 용어다 — 화면에는 사용자가 아는 말로만 쓴다. */}
              {renderUrl ? "하이라이트 영상" : "하이라이트 영상 없음"}
            </button>
          </div>

          {/* 내려받기는 **렌더 영상 모드에서만** 보인다 — 원본 구간 재생 중에 뜨면
              지금 보고 있는 원본을 받는 것처럼 읽힌다(실제로 받는 건 이어붙인 결과물이다). */}
          {renderUrl && mode === "render" && (
            <a
              href={`/api/clips/${compose.compId}/download`}
              className="ml-auto inline-flex items-center gap-1.5 rounded border border-line px-3 py-2 text-sm font-bold text-text-secondary transition-colors hover:border-brand-blue hover:text-brand-blue"
            >
              <Download className="h-4 w-4" aria-hidden />
              내려받기
            </a>
          )}
        </div>

        <div className="overflow-hidden rounded-lg bg-ink">
          {url ? (
            <video
              ref={videoRef}
              key={mode}
              src={url}
              controls
              playsInline
              onTimeUpdate={handleTimeUpdate}
              onPlay={handlePlay}
              onSeeked={handleSeeked}
              onLoadedMetadata={handleLoadedMetadata}
              className="aspect-video w-full"
            />
          ) : (
            <p className="flex aspect-video items-center justify-center px-6 text-center text-sm text-on-dark-dim">
              재생할 영상을 불러오지 못했습니다.
            </p>
          )}
        </div>

        {mode === "source" && (
          <p className="text-xs text-text-muted">
            원본 영상에서 편성된 구간만 순서대로 이어서 재생합니다. 목록에서 클립을 고르면 그 지점부터 이어집니다.
          </p>
        )}
      </div>

      {/* 클립이 수십 개까지 나온다(실측 42개) → 패널 높이를 **왼쪽 플레이어 열에 맞추고** 목록만 스크롤시킨다.
          데스크톱에서는 내용을 absolute 로 띄워 이 칸이 행 높이를 늘리지 않게 한다 —
          그래야 행 높이를 플레이어 쪽이 정하고, 클립이 몇 개든 옆 높이가 그대로 유지된다. */}
      <aside className="lg:relative">
        <div className="flex flex-col gap-3 lg:absolute lg:inset-0">
          <div className="flex shrink-0 items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold">클립 {clips.length}개</h2>
            <span className="text-xs text-text-muted">{formatDuration(compose.duration)}</span>
          </div>

          <ol ref={listRef} className="max-h-[60vh] min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 lg:max-h-none">
          {clips.map((clip) => {
            const inning = formatInning(clip.inning);
            // 스코어는 팀명과 함께 보여준다 — "2-0" 만으로는 어느 팀 점수인지 알 수 없다.
            const score = formatScoreWithTeams(clip.scoreAfter, teams);
            const scored = clip.scoreBefore !== null && clip.scoreBefore !== clip.scoreAfter;
            const playing = activeSeq === clip.seq;

            return (
              <li key={clip.seq} data-seq={clip.seq}>
                <button
                  type="button"
                  onClick={() => handleClipClick(clip.seq)}
                  aria-current={playing ? "true" : undefined}
                  className={`w-full rounded border p-3 text-left transition-colors hover:border-brand-blue ${
                    playing ? "border-brand-blue bg-brand-blue-soft/40" : "border-line"
                  }`}
                >
                  {/* 이닝·스코어는 여기에만 노출한다(PAGES.md §1-D). */}
                  <span className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-alt text-xs font-bold text-text-secondary">
                      {clip.seq}
                    </span>
                    {inning && <span className="text-sm font-bold">{inning}</span>}
                    {/* 이 클립에서 점수가 움직였으면 눈에 띄게 표시한다. */}
                    {scored && (
                      <span className="rounded bg-brand-blue-soft px-1.5 py-0.5 text-[11px] font-bold text-brand-blue">
                        득점
                      </span>
                    )}
                    <span className="ml-auto text-xs text-text-muted">
                      {formatDuration(clip.end - clip.start)}
                    </span>
                  </span>

                  <span className="mt-1.5 flex items-center justify-between gap-2">
                    {score && (
                      <span className={`text-xs ${scored ? "font-bold text-text-primary" : "text-text-secondary"}`}>
                        {score}
                      </span>
                    )}
                    {mode === "source" && (
                      <span className="ml-auto text-xs whitespace-nowrap text-text-muted">
                        원본 {formatTimecode(clip.start)} ~ {formatTimecode(clip.end)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
          </ol>

          {!renderUrl && compose.status === "ok" && clips.length > 0 && (
            <div className="shrink-0 rounded-lg border border-line p-4">
              {/* 이미 만드는 중이면 버튼을 내린다 — 중복 요청은 GPU 를 두 번 잡을 뿐이다. */}
              {compose.renderStatus === 1 ? (
                <p className="text-xs text-text-secondary">
                  하이라이트 영상을 만들고 있습니다. 완성되면 이 화면에서 볼 수 있습니다.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-xs text-text-secondary">
                    {compose.renderStatus === -1
                      ? "하이라이트 영상을 만들지 못했습니다. 다시 시도할 수 있습니다."
                      : "아직 하이라이트 영상이 없습니다. 하나로 이어붙여 만들면 내려받을 수 있습니다."}
                  </p>
                  <RenderOptionDialog
                    compId={compose.compId}
                    clipCount={clips.length}
                    defaultBumper={compose.bumper}
                    bumperAvailable={bumperAvailable}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
