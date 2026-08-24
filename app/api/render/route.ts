import { NextResponse } from "next/server";
import { z } from "zod";
import {
  QueueFullError,
  enqueueRender,
  ensureAdopted,
  findRenderTicket,
} from "@/lib/server/queue";
import { getCompose } from "@/lib/server/composes";
import { createLogger } from "@/lib/server/log";

const log = createLogger("api/render");

const Body = z.object({
  compId: z.number().int().positive(),
  bumper: z.boolean(),
});

/**
 * 렌더 **접수** — 사용자가 렌더 옵션 다이얼로그에서 확인을 누른 경우에만 호출된다.
 * **재생 시점에는 절대 호출하지 않는다**(PAGES.md §8).
 *
 * ⚠️ 2026-08-24 큐 전환 — 이 라우트는 이제 agent 를 직접 부르지 않고 **렌더 레인에 넣는다**
 * (편성 레인과 별개, 각 동시 1건). 응답 202 는 "만들기 시작했다"도 아니고
 * **"대기열에 들어갔다"**는 뜻이다. 진행은 `GET /api/queue/ticket/{id}` 로 본다.
 *
 * 편성 1건 : 하이라이트 1건 — 같은 `compId` 를 다시 넣으면 새 작업을 만들지 않고
 * **기존 티켓을 그대로 돌려준다**(`dedup: true`). 완료 판정의 정본은 `t_compose` 다.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const { compId, bumper } = parsed.data;

  // 재시작 전에 시작된 렌더가 있으면 슬롯을 먼저 되돌린다 — 워커에 겹쳐 넣지 않기 위해.
  await ensureAdopted();

  // 노출 대상 편성인지 재검증(getCompose 가 is_sbs 조인으로 걸러낸다).
  const compose = await getCompose(compId);
  if (!compose) return NextResponse.json({ error: "편성을 찾을 수 없습니다." }, { status: 404 });

  if (compose.renderedAt) {
    return NextResponse.json(
      { code: "ALREADY_RENDERED", error: "이미 만들어진 영상이 있습니다." },
      { status: 409 },
    );
  }
  if (compose.status !== "ok" || compose.clipCount === 0) {
    return NextResponse.json(
      { error: "클립이 없는 편성은 영상으로 만들 수 없습니다." },
      { status: 409 },
    );
  }
  // 진행 중 중복 — 우리 큐가 그 작업을 들고 있으면 티켓을 돌려주는 게 맞다(에러가 아니다).
  if (compose.renderStatus === 1) {
    const queued = findRenderTicket(compId);
    if (queued) return NextResponse.json({ ...queued, dedup: true }, { status: 202 });
    // 큐 밖에서 돌고 있다(다른 경로 접수 등) — agent 도 같은 이유로 막는다.
    return NextResponse.json(
      { code: "RENDER_IN_PROGRESS", error: "이미 영상을 만들고 있습니다. 잠시 후 이 화면에서 확인해 주세요." },
      { status: 409 },
    );
  }

  try {
    const ticket = enqueueRender({ compId, vId: compose.vId, bumper });
    log.info("렌더 접수", { compId, bumper, ticketId: ticket.ticketId, dedup: ticket.dedup });
    return NextResponse.json(ticket, { status: 202 });
  } catch (e) {
    if (e instanceof QueueFullError) {
      log.warn("렌더 대기열 포화 — 접수 거절", { compId, max: e.max });
      return NextResponse.json(
        {
          code: "QUEUE_FULL",
          error: "대기 중인 요청이 많습니다. 5~10분 뒤에 다시 시도해 주세요.",
          max: e.max,
          retryAfterSec: e.retryAfterSec,
        },
        { status: 503, headers: { "Retry-After": String(e.retryAfterSec) } },
      );
    }
    log.error("렌더 접수 오류", { compId, message: String(e) });
    return NextResponse.json({ error: "영상 생성 요청 중 오류가 발생했습니다." }, { status: 500 });
  }
}
