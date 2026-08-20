import Link from "next/link";
import { ChevronRight } from "lucide-react";
import Thumb from "./Thumb";
import { formatDate, formatDuration } from "@/lib/format";
import type { Compose } from "@/lib/types";

/**
 * 편성 1건 행. 배지는 `t_compose.render_status` 로 판정한다 — S3 조회 없이 DB 한 번이다.
 *
 * `render_datetime` 만 보던 시절에는 "만든 적 없음 · 만드는 중 · 만들다 실패"가 전부 NULL 로
 * 뭉쳐 셋 다 "준비 중"으로 보였다. 그래서 상태 컬럼을 따로 뒀다(sql/t_compose_render_status.sql).
 *
 * 편성 자체가 실패하면 `t_compose` 에 행이 생기지 않으므로 이 목록에는 나타나지 않는다 —
 * 편성 실패는 영상 상세의 상태 안내가 맡는다.
 */
function badgeOf(compose: Compose): { text: string; tone: string } {
  // 편성은 됐지만 조건에 맞는 장면이 없던 경우. 에러가 아니라 "결과 없음"이다.
  if (compose.status === "empty" || compose.clipCount === 0) {
    return { text: "장면 없음", tone: "bg-surface-alt text-text-muted" };
  }
  // 값 규약은 t_code.result 와 같다 — 1=진행 중, 0=성공, -1=실패.
  switch (compose.renderStatus) {
    case 0:
      return { text: "영상 준비됨", tone: "bg-brand-blue-soft text-brand-blue" };
    case 1:
      return { text: "영상 준비 중", tone: "bg-brand-blue-soft text-brand-blue" };
    case -1:
      return { text: "영상 생성 실패", tone: "bg-danger-soft text-danger" };
    default:
      // NULL = 영상을 만든 적 없음. 컬럼이 채워지기 전에 렌더된 옛 편성은 시각으로 구제한다.
      return compose.renderedAt !== null
        ? { text: "영상 준비됨", tone: "bg-brand-blue-soft text-brand-blue" }
        : { text: "클립 편성 완료", tone: "bg-surface-alt text-text-secondary" };
  }
}

export default function ComposeRow({ compose, showVideo = false }: { compose: Compose; showVideo?: boolean }) {
  const badge = badgeOf(compose);

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
        className={`hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-bold sm:inline-block ${badge.tone}`}
      >
        {badge.text}
      </span>

      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
    </Link>
  );
}
