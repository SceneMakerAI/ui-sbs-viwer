import { NextResponse } from "next/server";
import { ensureAdopted, queueSnapshot } from "@/lib/server/queue";

/**
 * 대기열 현황 — **실시간 표시의 유일한 근거**.
 *
 * 응답: `{compose: Lane, render: Lane, at}`,
 *   Lane = `{kind, running, pending[], finished[], waiting, max, full}`
 *   항목 = `{ticketId, kind, state, label, vId, compId?, progress[], step?, outcome?, error?,
 *            position, adopted?, enqueuedAt, startedAt?, finishedAt?}`
 *   · `position` 0 = 진행 중, 1 이상 = 대기 순번, null = 끝난 항목
 *   · `full` 이면 접수가 거절된다(503 QUEUE_FULL) — 화면은 버튼을 미리 막고
 *     "5~10분 뒤에 다시" 를 안내한다.
 *
 * 누가 요청했는지는 알 수 없다 — 로그인이 없다(PAGES.md §9). 그래서 이 목록은 **공용**이고,
 * "내 요청"은 브라우저가 보관한 `ticketId` 로만 식별한다.
 * 완료 이력의 정본은 큐가 아니라 `t_compose`(편성 클립 목록)다 — `finished` 는 최근 몇 건의
 * 결말을 화면에 전하기 위한 임시 보관이다.
 *
 * 폴링 주기는 3~5초를 권한다(agent·DB 모두 사설망 조회라 비용이 낮다).
 */
export async function GET() {
  await ensureAdopted();
  return NextResponse.json(queueSnapshot());
}
