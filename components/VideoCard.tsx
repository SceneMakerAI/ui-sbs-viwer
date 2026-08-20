import Link from "next/link";
import { Play } from "lucide-react";
import Thumb from "./Thumb";
import StatusBadge from "./StatusBadge";
import { formatDate, formatDuration } from "@/lib/format";
import type { Video } from "@/lib/types";

/**
 * 영상 카드 — 16:9 썸네일 + 제목 + 메타.
 * 썸네일은 원본에서 프레임을 뽑아 캐시한다(`/api/thumb` · lib/server/thumbs.ts).
 */
export default function VideoCard({ video }: { video: Video }) {
  return (
    <Link
      href={`/v/${video.vId}`}
      className="group block overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:border-brand-blue"
    >
      <div className="relative aspect-video">
        <Thumb vId={video.vId} alt="" className="h-full w-full" />
        {/* play_time 은 파이프라인이 채우지 않아 0 인 경우가 많다 — 없으면 아예 표시하지 않는다. */}
        {video.playTime > 0 && (
          <span className="absolute right-2 bottom-2 rounded bg-ink/80 px-1.5 py-0.5 text-xs font-medium text-on-dark">
            {formatDuration(video.playTime)}
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-ink/40 opacity-0 transition-opacity group-hover:opacity-100">
          <Play className="h-10 w-10 text-on-dark" aria-hidden />
        </span>
      </div>

      <div className="space-y-2 p-3">
        <h3 className="line-clamp-2 text-sm font-bold leading-snug">{video.name}</h3>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span>{formatDate(video.regDatetime)}</span>
          {video.cateName && (
            <>
              <span aria-hidden>·</span>
              <span>{video.cateName}</span>
            </>
          )}
          {video.composeCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>편성 {video.composeCount}건</span>
            </>
          )}
        </div>
        {/* 카드에서는 단계를 숨기고 업로드 중/완료로만 말한다 — 자세한 단계는 상세 화면에서. */}
        <StatusBadge code={video.statusCode} variant="simple" />
      </div>
    </Link>
  );
}
