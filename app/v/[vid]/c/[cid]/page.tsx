import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import ClipPlayer from "@/components/ClipPlayer";
import { formatDate, formatDuration } from "@/lib/format";
import { getCompose, getTeams, listClips } from "@/lib/server/composes";
import { composePhase } from "@/lib/domain/compose-state";
import { getVideoDir } from "@/lib/server/videos";
import { exists, presignGet, renderKey, sourceKey } from "@/lib/server/s3";

export const dynamic = "force-dynamic";

/**
 * 편성 상세 — `/v/{vid}/c/{cid}`
 *
 * ⚠️ 2026-09-02 주소 변경 — 예전엔 `/c/{cid}` 였다. `t_compose` 의 PK 가 `(v_id, comp_id)` 로
 * 바뀌면서 comp_id 가 **영상 안에서만** 유일해졌고(실측: comp_id=1 이 6개 영상에 존재),
 * comp_id 하나로는 편성을 특정할 수 없게 됐다. 그래서 영상 하위 경로로 옮겼다 —
 * 주소만 봐도 어느 영상의 편성인지 드러나고, 뒤로 가기가 곧 그 영상 화면이다.
 */
export default async function ComposeResultPage({
  params,
}: {
  params: Promise<{ vid: string; cid: string }>;
}) {
  const { vid, cid } = await params;
  const vId = Number(vid);
  const compId = Number(cid);
  if (!Number.isInteger(vId) || vId <= 0 || !Number.isInteger(compId) || compId <= 0) notFound();

  const compose = await getCompose(vId, compId);
  if (!compose) notFound();

  const [clips, dir, teams] = await Promise.all([
    listClips(vId, compId),
    getVideoDir(vId),
    getTeams(vId),
  ]);

  /**
   * 렌더본 존재 확인 — **S3 가 유일한 근거다.**
   *
   * ⚠️ 2026-09-02 — 예전에는 DB(`render_status`·`render_datetime`)를 정본으로 삼고 S3 를
   * 보조로 썼는데, 그 두 컬럼이 **삭제**됐다. 남은 `status_code` 의 4000 은 편성 완료와
   * 렌더 완료를 구분하지 못하므로(실측: 렌더된 8건과 안 된 19건이 모두 4000) 상태코드로는
   * 산출물 존재를 말할 수 없다. 그래서 여기서만 S3 를 확인하고, 그 결과를 `composePhase` 에
   * 넘겨 "준비됨" 판정을 완성한다. 목록 화면은 이 확인을 하지 않으므로 "편성 완료"까지만 말한다.
   */
  const key = renderKey(vId, compId);
  const hasRender = await exists(key).catch(() => false);
  const phase = composePhase(compose, hasRender);

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
          {/* 대결 팀명 — 클립별 스코어 표기가 사라지면서(score_* 컬럼 삭제) 팀 정보를 보여 줄
              자리가 여기밖에 없다. 판독이 모자라면 getTeams 가 null 을 돌려 칸이 비워진다. */}
          {teams && (
            <>
              <span className="font-bold text-text-secondary">
                {teams.away} vs {teams.home}
              </span>
              <span aria-hidden>|</span>
            </>
          )}
          <span>클립 {compose.clipCount}개</span>
          <span aria-hidden>|</span>
          <span>{formatDuration(compose.duration)}</span>
          <span aria-hidden>|</span>
          <span>{formatDate(compose.regDatetime)}</span>
        </p>
      </div>

      {/* 클립이 없는 이유는 셋이다 — 아직 편성 중 / 편성 실패 / 조건에 맞는 장면 없음.
          같은 문구로 뭉뚱그리면 기다리면 될 일을 실패로 오해한다(lib/domain/compose-state.ts). */}
      {clips.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface-alt p-10 text-center text-sm text-text-secondary">
          {phase === "composing"
            ? "클립을 편성하고 있습니다. 잠시 후 다시 확인해 주세요."
            : phase === "compose_failed"
              ? "편성에 실패했습니다. 질의를 바꿔 다시 시도해 보세요."
              : "이 편성에는 클립이 없습니다. 질의를 바꿔 다시 편성해 보세요."}
        </p>
      ) : (
        <ClipPlayer
          compose={compose}
          clips={clips}
          phase={phase}
          sourceUrl={sourceUrl}
          renderUrl={renderUrl}
        />
      )}
    </div>
  );
}
