import ComposeRow from "@/components/ComposeRow";
import NewComposeDialog from "@/components/NewComposeDialog";
import Pagination from "@/components/Pagination";
import SearchSort from "@/components/SearchSort";
import { listComposes, type ComposeSort } from "@/lib/server/composes";
import { listVideos } from "@/lib/server/videos";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;

const SORTS = [
  { key: "recent", label: "최신순" },
  { key: "duration", label: "긴 영상순" },
  { key: "clips", label: "클립 많은순" },
];

export default async function ClipsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const sort = (SORTS.some((s) => s.key === sp.sort) ? sp.sort : "recent") as ComposeSort;
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [{ items, total }, videos] = await Promise.all([
    listComposes({ q, sort, limit: PAGE_SIZE, offset }),
    listVideos({ limit: 50 }),
  ]);

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">편성 클립</h1>
          <p className="mt-2 text-sm text-text-secondary">
            질의로 만든 편성 목록입니다. 클릭하면 결과를 재생합니다.
          </p>
        </div>
        <NewComposeDialog videos={videos.items} />
      </div>

      <SearchSort q={q} sort={sort} sorts={SORTS} placeholder="질의·영상 제목 검색" />

      {items.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface-alt p-10 text-center text-sm text-text-secondary">
          {q ? `"${q}" 에 해당하는 편성이 없습니다.` : "아직 편성한 클립이 없습니다."}
        </p>
      ) : (
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
            params={{ q, sort: sort !== "recent" ? sort : undefined }}
          />
        </>
      )}
    </div>
  );
}
