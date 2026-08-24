import { NextResponse } from "next/server";
import { cancelTicket, findTicket } from "@/lib/server/queue";

/**
 * 티켓 1건 조회 — 브라우저가 보관한 `ticketId` 로 "내 요청"의 순번·진행을 본다.
 *
 * 404 는 "그런 요청이 없다"가 아니라 **"서버가 더는 기억하지 않는다"**일 수 있다:
 * 최근 완료 보관(레인별 30건)에서 밀려났거나, 서버가 재시작됐거나.
 * 편성 결과 자체는 `t_compose` 에 남으므로 화면은 편성 목록으로 안내한다.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const item = findTicket(ticketId);
  if (!item) {
    return NextResponse.json(
      {
        code: "TICKET_NOT_FOUND",
        error: "요청 정보를 찾을 수 없습니다. 편성 목록에서 결과를 확인해 주세요.",
      },
      { status: 404 },
    );
  }
  return NextResponse.json(item);
}

/**
 * 대기 중 요청 취소.
 *
 * **진행 중인 요청은 취소하지 않는다** — agent·워커에 취소 계약이 없어서, 취소했다고
 * 말한 뒤에도 GPU 는 계속 돈다. 거짓 상태를 만드는 쪽을 막는 결정이다(409 로 답한다).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const res = cancelTicket(ticketId);
  if (res.ok) return NextResponse.json(res.item);
  const status = res.item ? 409 : 404;
  return NextResponse.json({ error: res.reason, ...(res.item ? { item: res.item } : {}) }, { status });
}
