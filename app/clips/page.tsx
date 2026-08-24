import ClipGroupList from "@/components/ClipGroupList";
import ComposeRow from "@/components/ComposeRow";
import NewComposeDialog from "@/components/NewComposeDialog";
import Pagination from "@/components/Pagination";
import SearchSort from "@/components/SearchSort";
import ViewToggle from "@/components/ViewToggle";
import {
  GROUP_COMPOSE_MAX,
  listComposes,
  listComposesByVideos,
  listVideoGroups,
  type ComposeSort,
  type GroupSort,
} from "@/lib/server/composes";
import { listVideos } from "@/lib/server/videos";

export const dynamic = "force-dynamic";

/** 두 모드 모두 한 페이지 15건 — 그룹 모드는 영상 15개, 클립만 보기는 편성 15건. */
const PAGE_SIZE = 15;

/** 클립만 보기(전환 상태)의 정렬. */
const FLAT_SORTS = [
  { key: "recent", label: "최신순" },
  { key: "duration", label: "긴 영상순" },
  { key: "clips", label: "클립 많은순" },
];

/** 영상 묶어 보기(기본)의 정렬 — 목록의 단위가 영상이라 기준이 다르다. */
const GROUP_SORTS = [
  { key: "recent", label: "최근 편성순" },
  { key: "video", label: "영상 최신순" },
  { key: "composes", label: "편성 많은순" },
];

export default async function ClipsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; page?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  // 기본은 영상 묶어 보기(2026-08-24 결정). `?view=flat` 일 때만 클립만 보기.
  const flat = sp.view === "flat";
  const sorts = flat ? FLAT_SORTS : GROUP_SORTS;
  const sort = sorts.some((s) => s.key === sp.sort) ? sp.sort! : sorts[0].key;
  const keep = { view: flat ? "flat" : undefined };

  const videos = await listVideos({ limit: 50 });

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">편성 클립</h1>
          <p className="mt-2 text-sm text-text-secondary">
            {flat
              ? "질의로 만든 편성 목록입니다. 클릭하면 결과를 재생합니다."
              : "영상별로 묶어 봅니다. 영상을 누르면 그 영상의 편성 클립을 넘겨 보며 고를 수 있습니다."}
          </p>
        </div>
        <NewComposeDialog videos={videos.items} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ViewToggle view={flat ? "flat" : "grouped"} q={q} />
      </div>

      <SearchSort
        q={q}
        sort={sort}
        sorts={sorts}
        keep={keep}
        placeholder="질의·영상 제목 검색"
      />

      {flat ? (
        <FlatList q={q} sort={sort as ComposeSort} offset={offset} keep={keep} />
      ) : (
        <GroupedList q={q} sort={sort as GroupSort} offset={offset} keep={keep} />
      )}
    </div>
  );
}

/** 클립만 보기 — 편성이 목록의 단위(종전 동작). */
async function FlatList({
  q,
  sort,
  offset,
  keep,
}: {
  q?: string;
  sort: ComposeSort;
  offset: number;
  keep: Record<string, string | undefined>;
}) {
  const { items, total } = await listComposes({ q, sort, limit: PAGE_SIZE, offset });

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface-alt p-10 text-center text-sm text-text-secondary">
        {q ? `"${q}" 에 해당하는 편성이 없습니다.` : "아직 편성한 클립이 없습니다."}
      </p>
    );
  }

  return (
    <>
      <p className="text-sm text-text-muted">전체 {total}건</p>
      <div className="space-y-2">
        {items.map((c) => (
          <ComposeRow key={c.compId} compose={c} showVideo />
        ))}
      </div>
      <Pagination
        total={total}
        limit={PAGE_SIZE}
        offset={offset}
        params={{ ...keep, q, sort: sort !== FLAT_SORTS[0].key ? sort : undefined }}
      />
    </>
  );
}

/**
 * 영상 묶어 보기 — 영상이 목록의 단위이고, 그 안의 편성은 캐러셀로 넘겨 본다.
 *
 * 편성은 이 페이지의 영상 15개 몫을 **한 번에** 받아 클라이언트로 넘긴다(영상당
 * `GROUP_COMPOSE_MAX` 상한). 펼치기가 요청이 아니라 표시 전환이 되도록 하는 선택이다.
 */
async function GroupedList({
  q,
  sort,
  offset,
  keep,
}: {
  q?: string;
  sort: GroupSort;
  offset: number;
  keep: Record<string, string | undefined>;
}) {
  const { items, total } = await listVideoGroups({ q, sort, limit: PAGE_SIZE, offset });
  const composes = await listComposesByVideos(
    items.map((g) => g.vId),
    q,
  );
  const composeTotal = items.reduce((n, g) => n + g.matchCount, 0);

  return (
    <>
      {items.length > 0 && (
        <p className="text-sm text-text-muted">
          영상 {total}개
          {composeTotal > 0 ? ` · 이 페이지의 편성 ${composeTotal}건` : ""}
        </p>
      )}
      <ClipGroupList groups={items} composes={composes} q={q} perVideoMax={GROUP_COMPOSE_MAX} />
      <Pagination
        total={total}
        limit={PAGE_SIZE}
        offset={offset}
        params={{ ...keep, q, sort: sort !== GROUP_SORTS[0].key ? sort : undefined }}
      />
    </>
  );
}
