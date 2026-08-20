import Link from "next/link";
import Pagination from "@/components/Pagination";
import SearchSort from "@/components/SearchSort";
import VideoCard from "@/components/VideoCard";
import { listUsedCategories, listVideos, type VideoSort } from "@/lib/server/videos";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

const SORTS = [
  { key: "recent", label: "최신순" },
  { key: "name", label: "이름순" },
  { key: "duration", label: "긴 영상순" },
];

export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; cate?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const sort = (SORTS.some((s) => s.key === sp.sort) ? sp.sort : "recent") as VideoSort;
  const cateId = sp.cate ? Number(sp.cate) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [categories, { items, total }] = await Promise.all([
    listUsedCategories(),
    listVideos({ q, sort, cateId: Number.isFinite(cateId) ? cateId : undefined, limit: PAGE_SIZE, offset }),
  ]);

  const keep = { cate: sp.cate, sort: sort !== "recent" ? sort : undefined };
  const tabHref = (id?: number) => {
    const p = new URLSearchParams();
    if (id) p.set("cate", String(id));
    if (q) p.set("q", q);
    if (sort !== "recent") p.set("sort", sort);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">업로드 영상</h1>
        <p className="mt-2 text-sm text-text-secondary">
          분석이 끝난 영상을 골라 원하는 장면을 클립으로 편성할 수 있습니다.
        </p>
      </div>

      {categories.length > 0 && (
        <nav className="flex flex-wrap items-center gap-2 border-b border-line pb-3" aria-label="카테고리">
          <Link
            href={tabHref()}
            aria-current={!cateId ? "true" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm ${
              !cateId ? "bg-ink font-bold text-on-dark" : "bg-surface-alt text-text-secondary hover:text-text-primary"
            }`}
          >
            전체
          </Link>
          {categories.map((c) => (
            <Link
              key={c.cateId}
              href={tabHref(c.cateId)}
              aria-current={cateId === c.cateId ? "true" : undefined}
              className={`rounded-full px-3 py-1.5 text-sm ${
                cateId === c.cateId
                  ? "bg-ink font-bold text-on-dark"
                  : "bg-surface-alt text-text-secondary hover:text-text-primary"
              }`}
            >
              {c.cateName} <span className="text-text-muted">{c.count}</span>
            </Link>
          ))}
        </nav>
      )}

      <SearchSort q={q} sort={sort} sorts={SORTS} keep={{ cate: sp.cate }} placeholder="영상 제목 검색" />

      {items.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface-alt p-10 text-center text-sm text-text-secondary">
          {q ? `"${q}" 에 해당하는 영상이 없습니다.` : "아직 등록된 영상이 없습니다."}
        </p>
      ) : (
        <>
          <p className="text-sm text-text-muted">전체 {total}건</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((v) => (
              <VideoCard key={v.vId} video={v} />
            ))}
          </div>
          <Pagination total={total} limit={PAGE_SIZE} offset={offset} params={{ ...keep, q }} />
        </>
      )}
    </div>
  );
}
