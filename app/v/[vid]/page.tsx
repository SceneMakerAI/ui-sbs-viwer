import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import ComposeForm from "@/components/ComposeForm";
import ComposeRow from "@/components/ComposeRow";
import PipelinePanel from "@/components/PipelinePanel";
import StatusBadge from "@/components/StatusBadge";
import { isComposable, isErrorCode } from "@/lib/domain/status";
import { formatDate, formatDuration } from "@/lib/format";
import { listComposes } from "@/lib/server/composes";
import { getVideo } from "@/lib/server/videos";

export const dynamic = "force-dynamic";

export default async function VideoDetailPage({ params }: { params: Promise<{ vid: string }> }) {
  const vId = Number((await params).vid);
  if (!Number.isInteger(vId) || vId <= 0) notFound();

  // 노출 대상이 아니면 404 — "권한 없음"이 아니라 존재하지 않는 것으로 다룬다.
  const video = await getVideo(vId);
  if (!video) notFound();

  const { items: composes } = await listComposes({ vId, limit: 20 });
  const composable = isComposable(video.statusCode);
  const failed = isErrorCode(video.statusCode);

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/videos"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        분석 완료 영상
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{video.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
            <span>{formatDate(video.regDatetime)}</span>
            {video.cateName && (
              <>
                <span aria-hidden>|</span>
                <span>{video.cateName}</span>
              </>
            )}
            {video.playTime > 0 && (
              <>
                <span aria-hidden>|</span>
                <span>{formatDuration(video.playTime)}</span>
              </>
            )}
          </p>
        </div>
        <StatusBadge code={video.statusCode} label={video.statusName || undefined} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          {composable ? (
            <>
              {/* 직전 편성이 실패한 상태 — 다시 시도할 수 있으므로 폼은 막지 않고 사유만 알린다. */}
              {failed && (
                <p className="rounded border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
                  {video.statusDesc || "직전 편성이 실패했습니다."} 질의를 바꿔 다시 시도할 수 있습니다.
                </p>
              )}
              <ComposeForm vId={vId} />
            </>
          ) : (
            <div className="rounded-lg border border-line bg-surface-alt p-6">
              <h2 className="text-lg font-bold">분석이 끝나면 편성할 수 있습니다</h2>
              <p className="mt-2 text-sm text-text-secondary">
                {video.statusDesc || "지금은 영상을 분석하고 있습니다. 완료되면 장면을 골라 편성할 수 있습니다."}
              </p>
            </div>
          )}

          <section>
            <h2 className="mb-3 text-lg font-bold">편성 클립</h2>
            {composes.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface-alt p-8 text-center text-sm text-text-secondary">
                아직 이 영상으로 만든 편성이 없습니다.
              </p>
            ) : (
              <div className="space-y-2">
                {composes.map((c) => (
                  <ComposeRow key={c.compId} compose={c} />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside>
          <PipelinePanel statusCode={video.statusCode} />
        </aside>
      </div>
    </div>
  );
}
