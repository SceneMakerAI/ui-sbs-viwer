import Link from "next/link";
import { ChevronRight } from "lucide-react";
import Thumb from "./Thumb";
import { formatDate, formatDuration } from "@/lib/format";
import type { Compose } from "@/lib/types";

/**
 * 편성 1건 행. `renderedAt` 유무로 "영상 준비됨 / 준비 중"을 판정한다 —
 * S3 목록 조회 없이 DB 한 번으로 끝난다(PAGES.md §10).
 */
export default function ComposeRow({ compose, showVideo = false }: { compose: Compose; showVideo?: boolean }) {
  const ready = compose.renderedAt !== null;

  return (
    <Link
      href={`/c/${compose.compId}`}
      className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3 transition-colors hover:border-brand-blue sm:gap-4"
    >
      <Thumb
        vId={compose.vId}
        compId={compose.compId}
        alt=""
        className="aspect-video w-24 shrink-0 rounded sm:w-32"
      />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{compose.query}</span>
        <span className="mt-1 block truncate text-xs text-text-muted">
          {showVideo && compose.videoName ? `${compose.videoName} · ` : ""}
          클립 {compose.clipCount}개 · {formatDuration(compose.duration)} · {formatDate(compose.regDatetime)}
        </span>
      </span>

      <span
        className={`hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-bold sm:inline-block ${
          ready ? "bg-brand-blue-soft text-brand-blue" : "bg-surface-alt text-text-muted"
        }`}
      >
        {ready ? "영상 준비됨" : "준비 중"}
      </span>

      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
    </Link>
  );
}
