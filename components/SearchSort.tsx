import Link from "next/link";
import { Search } from "lucide-react";

/**
 * 검색 입력 + 정렬 전환. 자바스크립트 없이 동작하도록 GET 폼 + 링크로 만든다
 * (정렬은 링크라 현재 검색어를 hidden 이 아니라 쿼리로 물고 간다).
 */
export default function SearchSort({
  q,
  sort,
  sorts,
  keep = {},
  placeholder,
}: {
  q?: string;
  sort: string;
  sorts: { key: string; label: string }[];
  /** 정렬 링크에 유지할 나머지 쿼리. */
  keep?: Record<string, string | undefined>;
  placeholder: string;
}) {
  const sortHref = (key: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) p.set(k, v);
    if (q) p.set("q", q);
    if (key !== sorts[0].key) p.set("sort", key);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <form method="get" className="relative w-full sm:max-w-xs">
        {Object.entries(keep).map(([k, v]) =>
          v ? <input key={k} type="hidden" name={k} value={v} /> : null,
        )}
        {sort !== sorts[0].key && <input type="hidden" name="sort" value={sort} />}
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full rounded border border-line py-2 pr-3 pl-9 text-sm outline-none focus:border-brand-blue"
        />
      </form>

      <div className="flex items-center gap-1 text-sm">
        {sorts.map((s) => (
          <Link
            key={s.key}
            href={sortHref(s.key)}
            aria-current={s.key === sort ? "true" : undefined}
            className={`rounded px-2.5 py-1.5 ${
              s.key === sort ? "font-bold text-text-primary" : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
