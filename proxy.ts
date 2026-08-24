import { NextResponse, type NextRequest } from "next/server";

/**
 * 접근 통제 자리 (Next 16 의 `proxy` 규약 — 구 `middleware`).
 *
 * 현재 1차 통제는 **IP 제한**(보안 그룹 / nginx allow)이라 여기서는 통과시킨다(PAGES.md §9).
 * 로그인을 붙일 때 이 파일에 세션 검사를 넣으면 되도록 **자리만 잡아둔다** —
 * 나중에 페이지마다 흩어 넣지 않기 위해서다.
 *
 * ⚠️ 고객사 IP 대역을 확보하기 전에 외부 오픈이 필요해지면 로그인을 1순위로 되돌린다.
 */
export default function proxy(req: NextRequest) {
  // 데모 기간 대시보드(/) 임시 비활성화 — 진입 시 분석 완료 영상 목록으로 보낸다.
  // 되돌릴 때 이 블록만 지우면 된다 (Header.tsx 의 MENU 주석도 함께).
  if (req.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/videos", req.url));
  }
  return NextResponse.next();
}

export const config = {
  // 정적 자산과 이미지 최적화 경로는 검사 대상에서 제외한다.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
