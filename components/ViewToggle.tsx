import Link from "next/link";
import { Layers, List } from "lucide-react";

/**
 * 편성 클립 목록의 보기 전환 — **영상 묶어 보기(기본) / 클립만 보기**.
 *
 * 상태를 URL 에 둔다(기본 모드는 파라미터 없음, 전환했을 때만 `?view=flat`) —
 * 새로고침·뒤로가기·링크 공유에도 보기 모드가 남는다.
 *
 * 정렬은 링크에 싣지 않는다. 두 모드의 정렬 기준이 다르기 때문이다(그룹: 최근 편성순 …,
 * 클립: 최신순 …). 모드를 바꾸면 정렬·페이지는 각 모드의 기본으로 돌아간다.
 */
export default function ViewToggle({ view, q }: { view: "grouped" | "flat"; q?: string }) {
  const href = (v: "grouped" | "flat") => {
    const p = new URLSearchParams();
    if (v === "flat") p.set("view", "flat");
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  const seg = (active: boolean) =>
    `flex items-center gap-1.5 rounded px-3.5 py-2 text-sm transition-colors ${
      active ? "bg-ink font-bold text-on-dark" : "text-text-secondary hover:text-text-primary"
    }`;

  return (
    <div
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface-alt p-1"
      role="group"
      aria-label="보기 방식"
    >
      <Link href={href("grouped")} aria-current={view === "grouped" ? "true" : undefined} className={seg(view === "grouped")}>
        <Layers className="h-3.5 w-3.5" aria-hidden />
        영상 묶어 보기
      </Link>
      <Link href={href("flat")} aria-current={view === "flat" ? "true" : undefined} className={seg(view === "flat")}>
        <List className="h-3.5 w-3.5" aria-hidden />
        클립만 보기
      </Link>
    </div>
  );
}
