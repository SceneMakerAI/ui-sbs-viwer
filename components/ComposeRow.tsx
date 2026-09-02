import Link from "next/link";
import { ChevronRight } from "lucide-react";
import Thumb from "./Thumb";
import { formatDate, formatDuration } from "@/lib/format";
import { composeBadge } from "@/lib/domain/compose-state";
import type { Compose } from "@/lib/types";

export default function ComposeRow({ compose, showVideo = false }: { compose: Compose; showVideo?: boolean }) {
  const badge = composeBadge(compose);

  return (
    <Link
      href={`/v/${compose.vId}/c/${compose.compId}`}
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
        className={`hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-bold sm:inline-block ${badge.tone}`}
      >
        {badge.text}
      </span>

      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
    </Link>
  );
}
