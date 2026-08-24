"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import Thumb from "./Thumb";
import { composeBadge } from "@/lib/domain/compose-state";
import { formatDate, formatDuration, formatTimecode } from "@/lib/format";
import type { Compose, VideoGroup } from "@/lib/types";

/**
 * 영상 묶어 보기 — 영상 행을 펼치면 그 영상의 편성 클립을 **캐러셀**로 넘겨 본다.
 *
 * 규칙(확정 2026-08-24, PAGES.md §2-3):
 *   · 펼침은 한 번에 하나(아코디언). 다른 영상을 누르면 앞의 것이 접힌다.
 *   · **카드를 누르면 곧바로 재생 화면(`/c/[cid]`)으로 간다.** 선택 상태를 따로 두지 않는다 —
 *     초안에는 "선택 후 [재생] 버튼"이 있었으나 한 번 더 누르게 만들 이유가 없어 걷어냈다.
 *     그래서 카드는 버튼이 아니라 **링크**다(새 탭으로 열기·주소 복사가 그대로 된다).
 *   · 화살표는 순수 스크롤 컨트롤이다 — 한 번에 한 화면씩 밀고, 양 끝에서 비활성.
 *     카드에 포커스가 있을 때 ← → 로도 밀 수 있다. 트랙패드 가로 스와이프도 그대로 먹는다.
 *   · 편성 삭제는 이 화면에 두지 않는다.
 *   · 모바일 폭에서는 캐러셀을 쓰지 않고 세로 목록으로 되돌린다(화살표 없음).
 *
 * 데이터는 페이지가 한 번에 받아 온다(`listComposesByVideos`) — 펼치기는 표시 전환일 뿐
 * 요청이 아니다. 그래서 화살표를 눌러도 네트워크가 오가지 않는다.
 */
export default function ClipGroupList({
  groups,
  composes,
  q,
  perVideoMax,
}: {
  groups: VideoGroup[];
  /** v_id → 편성 목록(최신순). 영상당 `perVideoMax` 까지만 담겨 온다. */
  composes: Record<number, Compose[]>;
  q?: string;
  perVideoMax: number;
}) {
  // 처음 들어오면 **전부 접힌 상태**다(2026-08-24) — 목록은 목록으로 먼저 보이는 게 맞고,
  // 하나를 미리 펼쳐 두면 그 영상이 특별해 보이는 데다 첫 화면이 길어진다.
  const [openVid, setOpenVid] = useState<number | null>(null);
  /** 모바일 세로 목록에서 접힌 뒷부분을 펼친 영상들. */
  const [showAll, setShowAll] = useState<Record<number, boolean>>({});
  /** 화살표 활성 판정용 — 스트립이 양 끝에 닿았는지. */
  const [edges, setEdges] = useState<Record<number, { start: boolean; end: boolean }>>({});

  const stripRefs = useRef(new Map<number, HTMLDivElement>());

  const listOf = useCallback((vId: number) => composes[vId] ?? [], [composes]);

  const measure = useCallback((vId: number, el: HTMLDivElement | null) => {
    if (!el) return;
    const start = el.scrollLeft <= 1;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setEdges((s) =>
      s[vId]?.start === start && s[vId]?.end === end ? s : { ...s, [vId]: { start, end } },
    );
  }, []);

  // 펼친 직후에도 화살표 상태가 맞아야 한다(카드가 한 화면에 다 들어가면 둘 다 비활성).
  useEffect(() => {
    if (openVid != null) measure(openVid, stripRefs.current.get(openVid) ?? null);
  }, [openVid, measure]);

  /** 한 화면씩 민다 — 카드 하나만 움직이면 넘기는 느낌이 안 난다. */
  const scrollByPage = (vId: number, dir: 1 | -1) => {
    const el = stripRefs.current.get(vId);
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth - 60, 200), behavior: "smooth" });
  };

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface-alt p-10 text-center text-sm text-text-secondary">
        {q ? `"${q}" 에 해당하는 영상이 없습니다.` : "아직 편성할 영상이 없습니다."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const list = listOf(g.vId);
        const open = openVid === g.vId;
        const panelId = `clip-group-${g.vId}`;
        const capped = g.matchCount > list.length;
        const edge = edges[g.vId] ?? { start: true, end: false };

        return (
          <div
            key={g.vId}
            className={`overflow-hidden rounded-lg border bg-surface transition-colors ${
              open ? "border-brand-blue" : "border-line hover:border-brand-blue/50"
            }`}
          >
            <button
              type="button"
              onClick={() => setOpenVid(open ? null : g.vId)}
              aria-expanded={open}
              aria-controls={panelId}
              className="flex w-full items-center gap-3 p-3 text-left sm:gap-4"
            >
              <Thumb vId={g.vId} alt="" className="aspect-video w-24 shrink-0 rounded sm:w-40" />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold sm:text-[15px]">{g.name}</span>
                <span className="mt-1 block truncate text-xs text-text-muted">
                  {/* play_time 이 0 인 영상이 있다 — 그때 "-" 를 끼워 넣지 않고 칸을 지운다. */}
                  {[formatDate(g.regDatetime), g.playTime > 0 ? formatDuration(g.playTime) : null, g.cateName]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      g.composeCount > 0
                        ? "bg-brand-blue-soft text-brand-blue"
                        : "bg-surface-alt text-text-secondary"
                    }`}
                  >
                    편성 {g.composeCount}건
                  </span>
                  <span className="text-xs text-text-muted">
                    {g.composeCount === 0
                      ? "아직 편성한 클립이 없습니다"
                      : `클립 영상 ${g.readyCount}건 준비됨`}
                  </span>
                  {q && g.matchCount < g.composeCount && (
                    <span className="text-xs text-text-muted">· {g.matchCount}건 일치</span>
                  )}
                </span>
              </span>

              <ChevronDown
                className={`h-4 w-4 shrink-0 transition-transform ${
                  open ? "rotate-180 text-brand-blue" : "text-text-muted"
                }`}
                aria-hidden
              />
            </button>

            {open && (
              <div id={panelId} className="border-t border-line bg-surface-alt p-4">
                {list.length === 0 ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-bold">
                        {g.composeCount === 0
                          ? "이 영상에는 아직 편성한 클립이 없습니다"
                          : `"${q}" 에 맞는 편성이 이 영상에는 없습니다`}
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        {g.composeCount === 0
                          ? "질의를 적어 첫 편성을 만들면 여기에 카드로 쌓입니다."
                          : `이 영상의 편성 ${g.composeCount}건은 검색어와 맞지 않습니다.`}
                      </p>
                    </div>
                    <Link
                      href={`/v/${g.vId}`}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded bg-brand-blue px-4 py-2.5 text-sm font-bold text-on-dark hover:bg-brand-blue-hover"
                    >
                      <Sparkles className="h-4 w-4" aria-hidden />
                      이 영상으로 편성하기
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold">
                        이 영상의 편성 클립 {g.matchCount}건
                        <span className="hidden text-text-secondary sm:inline"> — 누르면 바로 재생됩니다</span>
                      </p>
                      {capped && (
                        <p className="shrink-0 text-xs text-text-muted">최근 {perVideoMax}건</p>
                      )}
                    </div>

                    {/* 데스크톱 — 캐러셀. 카드가 링크라 스트립은 스크롤 컨테이너일 뿐이다. */}
                    <div className="mt-3 hidden items-center gap-3 sm:flex">
                      <ArrowButton
                        dir="prev"
                        disabled={edge.start}
                        onClick={() => scrollByPage(g.vId, -1)}
                      />
                      <div
                        ref={(el) => {
                          if (el) {
                            stripRefs.current.set(g.vId, el);
                            measure(g.vId, el);
                          } else {
                            stripRefs.current.delete(g.vId);
                          }
                        }}
                        onScroll={(e) => measure(g.vId, e.currentTarget)}
                        onKeyDown={(e) => {
                          // 카드에 포커스가 있을 때 ← → 로 넘긴다(포커스 이동은 Tab 이 한다).
                          if (e.key === "ArrowRight") {
                            e.preventDefault();
                            scrollByPage(g.vId, 1);
                          } else if (e.key === "ArrowLeft") {
                            e.preventDefault();
                            scrollByPage(g.vId, -1);
                          }
                        }}
                        className="flex min-w-0 flex-1 gap-3 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                      >
                        {list.map((c) => (
                          <ClipCard key={c.compId} compose={c} />
                        ))}
                      </div>
                      <ArrowButton
                        dir="next"
                        disabled={edge.end}
                        onClick={() => scrollByPage(g.vId, 1)}
                      />
                    </div>

                    {/* 모바일 — 세로 목록(캐러셀 없음) */}
                    <ul className="mt-3 flex flex-col gap-2 sm:hidden">
                      {(showAll[g.vId] ? list : list.slice(0, 3)).map((c) => (
                        <li key={c.compId}>
                          <ClipRow compose={c} />
                        </li>
                      ))}
                      {list.length > 3 && !showAll[g.vId] && (
                        <li>
                          <button
                            type="button"
                            onClick={() => setShowAll((s) => ({ ...s, [g.vId]: true }))}
                            className="w-full py-2 text-sm font-bold text-brand-blue"
                          >
                            편성 {list.length - 3}건 더 보기
                          </button>
                        </li>
                      )}
                    </ul>

                    <p className="mt-3 hidden text-xs text-text-muted sm:block">
                      카드를 누르면 편성 결과 재생 화면으로 이동합니다 · ← → 로 넘길 수 있습니다
                      {capped && ` · 나머지는 "클립만 보기"에서 볼 수 있습니다`}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ArrowButton({
  dir,
  disabled,
  onClick,
}: {
  dir: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "이전 클립 보기" : "다음 클립 보기"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-text-primary transition-colors hover:border-brand-blue hover:text-brand-blue disabled:cursor-not-allowed disabled:border-line disabled:text-text-muted disabled:opacity-40"
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

/** 캐러셀 카드 1장 — 누르면 그 편성의 재생 화면으로 간다. */
function ClipCard({ compose }: { compose: Compose }) {
  const badge = composeBadge(compose);
  return (
    <Link
      href={`/c/${compose.compId}`}
      className="flex w-[236px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:border-brand-blue focus-visible:border-brand-blue focus-visible:outline-none"
    >
      <span className="relative block">
        <Thumb vId={compose.vId} compId={compose.compId} alt="" className="aspect-video w-full" />
        {compose.duration > 0 && (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-ink/75 px-1.5 py-0.5 text-[11px] font-bold text-on-dark">
            {formatTimecode(compose.duration)}
          </span>
        )}
      </span>
      <span className="block p-2.5">
        <span className="block truncate text-[13px] font-bold">{compose.query}</span>
        <span className="mt-1 block truncate text-[11px] text-text-muted">
          클립 {compose.clipCount}개 · {formatDuration(compose.duration)}
        </span>
        <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.tone}`}>
          {badge.text}
        </span>
      </span>
    </Link>
  );
}

/** 모바일 세로 목록의 한 줄. 카드와 같은 정보를 가로로 눕힌 것. */
function ClipRow({ compose }: { compose: Compose }) {
  const badge = composeBadge(compose);
  return (
    <Link
      href={`/c/${compose.compId}`}
      className="flex w-full items-center gap-2.5 rounded-md border border-line bg-surface p-2 transition-colors hover:border-brand-blue"
    >
      <Thumb vId={compose.vId} compId={compose.compId} alt="" className="aspect-video w-22 shrink-0 rounded" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold">{compose.query}</span>
        <span className="mt-0.5 block truncate text-[11px] text-text-muted">
          클립 {compose.clipCount}개 · {formatDuration(compose.duration)}
        </span>
        <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold ${badge.tone}`}>
          {badge.text}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
    </Link>
  );
}
