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
 * 렌더 **접수** — 사용자가 렌더 옵션 다이얼로그에서 확인을 누른 경우에만 호출된다.
 * **재생 시점에는 절대 호출하지 않는다**(PAGES.md §8).
 *
 * ⚠️ 2026-08-24 — agent-compose 가 비동기 접수(202)로 바뀌었다. 이 라우트가 200 을
 * 돌려준 것은 "만들어졌다"가 아니라 **"만들기 시작했다"**는 뜻이다. 완료 판정은
 * `t_compose.render_status`·`render_datetime`(agent 가 기록)으로만 한다.
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
  // 진행 중 중복 차단 — 화면은 버튼을 내리지만, 열어 둔 탭이 뒤늦게 눌릴 수 있다.
  // (agent 도 render_status=1 로 막지만, 여기서 걸러야 GPU 로 가는 왕복이 준다.)
  if (compose.renderStatus === 1) {
    return NextResponse.json(
      { code: "RENDER_IN_PROGRESS", error: "이미 영상을 만들고 있습니다. 잠시 후 이 화면에서 확인해 주세요." },
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
    log.info("렌더 접수", { compId, bumper });
    // ok 는 "접수됨"이다 — 완료가 아니다(위 주석).
    return NextResponse.json({ ok: true, accepted: true });
  } catch (e) {
    if (e instanceof BusyError) {
      return NextResponse.json(
        { code: "COMPOSE_BUSY", error: "다른 요청을 처리하고 있습니다. 잠시 후 다시 시도해 주세요." },
        { status: 409 },
      );
    }
    if (e instanceof AgentError) {
      // agent-compose 의 사전 차단 코드들 — 전부 "지금은 안 된다"지만 이유가 달라
      // 한 문구로 뭉치면 기다리면 될 일을 실패로 오해한다(agent src/api/render.py).
      switch (e.code) {
        case "COMPOSE_ALREADY_RENDERED":
          return NextResponse.json(
            { code: "ALREADY_RENDERED", error: "이미 만들어진 영상이 있습니다." },
            { status: 409 },
          );
        case "RENDER_IN_PROGRESS":
          // 다른 창에서 이미 시작했다 — 실패가 아니라 진행 중이다.
          return NextResponse.json(
            { code: "RENDER_IN_PROGRESS", error: "이미 영상을 만들고 있습니다. 잠시 후 이 화면에서 확인해 주세요." },
            { status: 409 },
          );
        case "COMPOSE_NOT_RENDERABLE":
          return NextResponse.json(
            { error: "클립이 없는 편성은 영상으로 만들 수 없습니다." },
            { status: 409 },
          );
        case "COMPOSE_INVALID_INNING":
          // 상류 발행 데이터 결함이라 재시도해도 같은 결과다 — 다시 시도하라고 하지 않는다.
          return NextResponse.json(
            { error: "이 편성은 클립 정보가 온전하지 않아 영상으로 만들 수 없습니다. 다시 편성해 주세요." },
            { status: 422 },
          );
      }
      log.error("렌더 접수 실패", { compId, status: e.status, code: e.code });
      return NextResponse.json(
        { error: "지금은 영상을 만들 수 없습니다. 잠시 후 다시 시도해 주세요." },
        { status: 502 },
      );
    }
    log.error("렌더 오류", { compId, message: String(e) });
    return NextResponse.json({ error: "영상 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
