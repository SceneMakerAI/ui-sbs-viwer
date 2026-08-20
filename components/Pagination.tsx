import Link from "next/link";

/**
 * 페이지네이션 — 쿼리스트링 기반(서버 컴포넌트에서 그대로 쓸 수 있게 링크만 만든다).
 * 현재 검색·정렬 조건을 유지한 채 offset 만 바꾼다.
 */
export default function Pagination({
  total,
  limit,
  offset,
  params,
}: {
  total: number;
  limit: number;
  offset: number;
  /** 유지할 나머지 쿼리(검색어·정렬·카테고리 등). */
  params: Record<string, string | undefined>;
}) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;

  const current = Math.floor(offset / limit) + 1;
  const href = (page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (page > 1) q.set("page", String(page));
    const s = q.toString();
    return s ? `?${s}` : "?";
  };

  // 현재 페이지 주변만 노출(양옆 2개).
  const from = Math.max(1, current - 2);
  const to = Math.min(pages, current + 2);
  const items = Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <nav className="flex items-center justify-center gap-1 pt-2" aria-label="페이지">
      {current > 1 && (
        <Link href={href(current - 1)} className="rounded px-3 py-2 text-sm text-text-secondary hover:bg-surface-alt">
          이전
        </Link>
      )}
      {items.map((p) => (
        <Link
          key={p}
          href={href(p)}
          aria-current={p === current ? "page" : undefined}
          className={`min-w-9 rounded px-3 py-2 text-center text-sm ${
            p === current ? "bg-ink font-bold text-on-dark" : "text-text-secondary hover:bg-surface-alt"
          }`}
        >
          {p}
        </Link>
      ))}
      {current < pages && (
        <Link href={href(current + 1)} className="rounded px-3 py-2 text-sm text-text-secondary hover:bg-surface-alt">
          다음
        </Link>
      )}
    </nav>
  );
}
