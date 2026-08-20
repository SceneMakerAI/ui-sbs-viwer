import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import ClipPlayer from "@/components/ClipPlayer";
import { formatDate, formatDuration } from "@/lib/format";
import { getCompose, getTeams, listClips } from "@/lib/server/composes";
import { getVideoDir } from "@/lib/server/videos";
import { exists, presignGet, renderKey, sourceKey } from "@/lib/server/s3";

export const dynamic = "force-dynamic";

export default async function ComposeResultPage({ params }: { params: Promise<{ cid: string }> }) {
  const compId = Number((await params).cid);
  if (!Number.isInteger(compId) || compId <= 0) notFound();

  const compose = await getCompose(compId);
  if (!compose) notFound();

  const [clips, dir, teams] = await Promise.all([
    listClips(compId),
    getVideoDir(compose.vId),
    getTeams(compose.vId),
  ]);

  // 렌더본 존재 확인 — DB 의 render_datetime 이 정본이지만, agent-compose 쪽 기록 구현이
  // 들어오기 전까지는 스탬프가 비어 있을 수 있어 S3 로도 확인한다(REQUEST_agent-compose.md).
  const key = renderKey(compose.vId, compose.compId);
  const hasRender = compose.renderedAt !== null || (await exists(key));

  const [renderUrl, sourceUrl] = await Promise.all([
    hasRender ? presignGet(key) : Promise.resolve(null),
    dir ? presignGet(sourceKey(dir)) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href={`/v/${compose.vId}`}
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {compose.videoName ?? "영상"}
      </Link>

      <div className="mt-3 mb-6 border-b border-line pb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{compose.query}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
          <span>클립 {compose.clipCount}개</span>
          <span aria-hidden>|</span>
          <span>{formatDuration(compose.duration)}</span>
          <span aria-hidden>|</span>
          <span>{formatDate(compose.regDatetime)}</span>
        </p>
      </div>

      {clips.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface-alt p-10 text-center text-sm text-text-secondary">
          이 편성에는 클립이 없습니다. 질의를 바꿔 다시 편성해 보세요.
        </p>
      ) : (
        <ClipPlayer compose={compose} clips={clips} teams={teams} sourceUrl={sourceUrl} renderUrl={renderUrl} />
      )}
    </div>
  );
}
