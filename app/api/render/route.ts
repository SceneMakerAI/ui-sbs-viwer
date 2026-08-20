import { NextResponse } from "next/server";
import { z } from "zod";
import { AgentError, BusyError, requestRender } from "@/lib/server/compose-agent";
import { getCompose } from "@/lib/server/composes";
import { createLogger } from "@/lib/server/log";

const log = createLogger("api/render");

const Body = z.object({
  compId: z.number().int().positive(),
  bumper: z.boolean(),
});

/**
 * 렌더 요청 — 사용자가 렌더 옵션 다이얼로그에서 확인을 누른 경우에만 호출된다.
 * **재생 시점에는 절대 호출하지 않는다**(PAGES.md §8).
 *
 * worker-render 는 상시 가동이 아니라 502 가 정상적으로 발생할 수 있다.
 * 실패해도 편성은 남으므로, 사용자에게는 "다시 시도" 로 안내한다.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const { compId, bumper } = parsed.data;

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

  try {
    await requestRender(compId, bumper);
    log.info("렌더 완료", { compId, bumper });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BusyError) {
      return NextResponse.json(
        { code: "COMPOSE_BUSY", error: "다른 요청을 처리하고 있습니다. 잠시 후 다시 시도해 주세요." },
        { status: 409 },
      );
    }
    if (e instanceof AgentError) {
      // agent-compose 쪽 중복 차단이 들어오면 이 코드가 온다(REQUEST_agent-compose.md).
      if (e.code === "COMPOSE_ALREADY_RENDERED") {
        return NextResponse.json(
          { code: "ALREADY_RENDERED", error: "이미 만들어진 영상이 있습니다." },
          { status: 409 },
        );
      }
      log.error("렌더 실패", { compId, status: e.status, code: e.code });
      return NextResponse.json(
        { error: "지금은 영상을 만들 수 없습니다. 잠시 후 다시 시도해 주세요." },
        { status: 502 },
      );
    }
    log.error("렌더 오류", { compId, message: String(e) });
    return NextResponse.json({ error: "영상 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
