"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import RenderOptionDialog from "./RenderOptionDialog";
import { formatDuration, formatInning, formatTimecode } from "@/lib/format";
import type { ComposePhase } from "@/lib/domain/compose-state";
import type { Clip, Compose } from "@/lib/types";

type Mode = "source" | "render";

/**
 * 편성 결과 재생 — 한 페이지에서 두 가지 재생 방식을 전환한다(PAGES.md §1-D).
 *   · 원본 구간 재생: 원본 영상을 클립 구간으로 시킹. **렌더 없이도 즉시 확인 가능.**
 *   · 렌더 영상: 이어붙인 MP4. 렌더본이 없으면 비활성.
 *
 * 클립 클릭 → 구간 이동은 **원본 모드에서만** 의미가 있다.
 * 렌더본은 이미 한 편으로 이어붙어 있어 이동이 필요 없다.
 *
 * ⚠️ 2026-09-02 — 클립별 **스코어 표기가 사라졌다.** 근거였던 `t_compose_clip.score_before`·
 * `score_after` 컬럼이 삭제됐기 때문이다. 그 자리에는 같은 스키마 교체로 새로 생긴
 * `tags`(전광판 사건 태그)를 쓴다 — "득점" 배지도 스코어 변화 대신 이 태그로 판정한다.
 *
 * 상태 판정(`phase`)은 서버가 넘겨준다 — "준비됨" 은 S3 확인이 필요해서 클라이언트가
 * 스스로 알 수 없다(lib/domain/compose-state.ts).
 */
export default function ClipPlayer({
  compose,
  clips,
  phase,
  sourceUrl,
  renderUrl,
}: {
  compose: Compose;
  clips: Clip[];
  phase: ComposePhase;
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
   * 다만 범퍼가 들어가면 그만큼 밀린다 — 범퍼 길이는 DB 에 없으므로
   * **실제 영상 길이와 클립 합계의 차이**를 범퍼 개수로 나눠 되찾는다.
   *
   * ⚠️ 범퍼는 이닝이 **바뀌는 자리**가 아니라 **각 이닝 그룹 맨 앞**에 붙는다 — 첫 그룹 앞에도
   * 하나 붙는다(worker-render `lib/svc/compose.py:to_media_parts`, 2026-08-24 소스 확인).
   * 그래서 나누는 수는 경계 수(그룹−1)가 아니라 **그룹 수**이고, 첫 클립도 범퍼만큼 밀린다.
   * 예전 계산은 경계 수로 나눠서 첫 범퍼를 통째로 놓쳤고, 이닝이 하나뿐인 편성은 아예
   * 보정이 0 이었다(그래서 렌더본에서 클립을 누르면 범퍼 길이만큼 어긋났다).
   * (범퍼 없이 렌더된 경우 차이가 0 이라 그대로 누적합이 된다. 실측 comp 14: 42클립 합계 1018초 = 영상 1018초.)
   */
  const renderOffsets = useMemo(() => {
    const durations = clips.map((c) => c.end - c.start);
    const clipSum = durations.reduce((a, b) => a + b, 0);

    // 그룹 = 이닝이 바뀌는 지점마다 새로 시작한다. 첫 클립도 그룹의 시작이다.
    const isGroupStart = (i: number) => i === 0 || clips[i].inning !== clips[i - 1].inning;
    const groups = clips.reduce((n, _c, i) => (isGroupStart(i) ? n + 1 : n), 0);
    const extra = renderDuration != null ? Math.max(0, renderDuration - clipSum) : 0;
    // 차이가 1초 미만이면 인코딩 오차로 보고 무시한다.
    const gap = groups > 0 && extra >= 1 ? extra / groups : 0;

    let at = 0;
    return clips.map((c, i) => {
      if (isGroupStart(i)) at += gap;
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

  /**
   * 하이라이트 영상을 만들 수 있는 편성인가 — 빈 편성·편성 실패는 이어붙일 것이 없다.
   * 렌더만 실패한 편성(`render_failed`)은 클립이 멀쩡하므로 다시 만들 수 있다.
   */
  const canRender = (phase === "composed" || phase === "render_failed") && clips.length > 0;

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
            {/* "렌더"는 내부 용어다 — 화면에는 사용자가 아는 말로만 쓴다.
                영상이 없을 때 이 칸은 **죽은 버튼이 아니라 만들기 버튼**이다(2026-08-24) —
                예전엔 여기 "하이라이트 영상 없음"(비활성)을 두고 오른쪽 아래에 안내문+버튼을
                따로 뒀는데, 같은 말을 두 곳에서 하고 누를 곳은 멀리 있었다. */}
            {renderUrl ? (
              <button
                type="button"
                onClick={() => setMode("render")}
                aria-pressed={mode === "render"}
                className={`rounded px-4 py-1.5 text-sm transition-colors ${
                  mode === "render" ? "bg-ink font-bold text-on-dark" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                하이라이트 영상
              </button>
            ) : phase === "rendering" ? (
              // 이미 만드는 중이면 누를 수 없다 — 중복 요청은 GPU 를 두 번 잡을 뿐이다.
              <span className="flex items-center gap-1.5 rounded px-4 py-1.5 text-sm text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                하이라이트 영상 만드는 중
              </span>
            ) : canRender ? (
              <RenderOptionDialog
                vId={compose.vId}
                compId={compose.compId}
                clipCount={clips.length}
                defaultBumper={compose.bumper}
                label={phase === "render_failed" ? "하이라이트 영상 다시 만들기" : "하이라이트 영상으로 만들기"}
                className="flex items-center gap-1.5 rounded px-4 py-1.5 text-sm font-bold text-brand-blue transition-colors hover:bg-brand-blue-soft"
              />
            ) : (
              <span className="rounded px-4 py-1.5 text-sm text-text-muted opacity-60">
                하이라이트 영상 없음
              </span>
            )}
          </div>

          {/* 내려받기는 **렌더 영상 모드에서만** 보인다 — 원본 구간 재생 중에 뜨면
              지금 보고 있는 원본을 받는 것처럼 읽힌다(실제로 받는 건 이어붙인 결과물이다). */}
          {renderUrl && mode === "render" && (
            <a
              href={`/api/clips/${compose.vId}/${compose.compId}/download`}
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
            // 사건 태그(전광판 판독 사본) — 예전 스코어 자리를 대신한다. 콤마 구분 문자열이다.
            const tags = (clip.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
            /**
             * "득점" 배지 — 예전엔 `score_before !== score_after`(스코어가 실제로 움직였는가)로
             * 판정했으나 그 두 컬럼이 삭제됐다. 지금은 태그·라벨의 득점성 어휘로 대신한다.
             * ⚠️ 근사치다: 득점 사실이 아니라 **득점으로 읽히는 표기가 붙었는가**를 본다.
             * `적시타`(주자를 불러들인 안타)는 `labels` 쪽에 붙으므로 둘 다 훑어야 한다 —
             * 태그만 보면 "안타+적시타" 인 실제 득점 클립을 놓친다(v203 편성 4 실측).
             */
            const scored = [...tags, ...(clip.labels ?? "").split(",")].some((t) =>
              /득점|홈런|적시타/.test(t),
            );
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
                    {tags.length > 0 && (
                      <span className="flex min-w-0 flex-wrap items-center gap-1">
                        {tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-surface-alt px-1.5 py-0.5 text-[11px] text-text-secondary"
                          >
                            {t}
                          </span>
                        ))}
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

        </div>
      </aside>
    </div>
  );
}
