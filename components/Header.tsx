"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 메뉴 4종 — 순서 고정(PAGES.md §2-1-1). `disabled` 는 보이되 못 누르는 항목. */
const MENU = [
  // { href: "/", label: "대시보드" },   // 데모 기간 임시 비활성화 (proxy.ts 에서 /videos 로 리다이렉트)
  { href: "/upload", label: "영상 업로드/분석", disabled: true },   // 업로드 자체가 비활성 전시(PAGES.md §1-F)
  { href: "/videos", label: "분석 완료 영상" },
  { href: "/clips", label: "편성 클립" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="bg-ink text-on-dark">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="block h-5 w-5 rounded-full border-[3px] border-brand-blue" />
          <span className="text-lg font-bold tracking-tight">SceneMaker</span>
        </Link>

        {/* 모바일에서 메뉴 4개가 가로 스크롤된다 — 스크롤바는 숨겨 헤더가 지저분해지지 않게. */}
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] sm:gap-2 [&::-webkit-scrollbar]:hidden">
          {MENU.map((m) => {
            const disabled = "disabled" in m && m.disabled;
            // 비활성 메뉴는 링크가 아니라 문구로 둔다 — 보이기는 하되 눌리지 않게.
            if (disabled) {
              return (
                <span
                  key={m.href}
                  aria-disabled="true"
                  title="준비 중입니다"
                  className="shrink-0 cursor-not-allowed px-3 py-2 text-sm text-on-dark-dim opacity-50 select-none"
                >
                  {m.label}
                </span>
              );
            }

            const active = isActive(pathname, m.href);
            return (
              <Link
                key={m.href}
                href={m.href}
                aria-current={active ? "page" : undefined}
                className={`relative shrink-0 px-3 py-2 text-sm transition-colors ${
                  active ? "font-bold text-on-dark" : "text-on-dark-dim hover:text-on-dark"
                }`}
              >
                {m.label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-px block h-0.5 rounded-full bg-brand-blue" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* 계정 영역 — 로그인은 후순위(PAGES.md §9). 자리만 잡아둔다. */}
      </div>
    </header>
  );
}
