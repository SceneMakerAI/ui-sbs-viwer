import { NextResponse } from "next/server";
import { z } from "zod";
import { BusyError, busyState, startCompose, AgentError } from "@/lib/server/compose-agent";
import { getVideo } from "@/lib/server/videos";
import { isComposable } from "@/lib/domain/status";
import { createLogger } from "@/lib/server/log";

const log = createLogger("api/compose");

/**
 * 길이는 화면의 5/10/15/20분(lib/domain/budget.ts)과 1:1. 그 밖의 값은 받지 않는다.
 *
 * ⚠️ 이 인자는 2026-08-24 하루 사이에 **폐기됐다가 되살아났다**(agent-compose 94b58dc → 0d95b9f).
 * 지금은 `budget_sec` 이라는 이름의 **덜어내기 전용 상한**이다 — 자세한 건 budget.ts.
 */
const Body = z.object({
  vId: z.number().int().positive(),
  query: z.string().trim().min(2).max(200),
  budgetSec: z.union([z.literal(300), z.literal(600), z.literal(900), z.literal(1200)]),
  /** 편성에 이어 하이라이트 영상까지 한 번에 만들지(원샷). 끄면 편성만 한다. */
  render: z.boolean(),
  bumper: z.boolean(),
});

/** 진행 중 여부만 확인 — 화면 진입 시 배너 표시용(PAGES.md §5). */
export async function GET() {
  return NextResponse.json(busyState());
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const { vId, query, budgetSec, render, bumper } = parsed.data;

  // 노출 대상 영상인지 서버에서 재검증한다 — v_id 는 주소창으로 바꿔 넣을 수 있다.
  const video = await getVideo(vId);
  if (!video) return NextResponse.json({ error: "영상을 찾을 수 없습니다." }, { status: 404 });

  if (!isComposable(video.statusCode)) {
    return NextResponse.json(
      { error: "아직 분석이 끝나지 않은 영상입니다. 분석 완료 후 편성할 수 있습니다." },
      { status: 409 },
    );
  }

  try {
    const { jobId } = await startCompose({ vId, query, budgetSec, render, bumper });
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (e) {
    if (e instanceof BusyError) {
      // 에러가 아니라 "대기" 상태다 — 클라이언트는 배너를 띄우고 재시도한다.
      return NextResponse.json({ code: "COMPOSE_BUSY", ...busyState() }, { status: 409 });
    }
    if (e instanceof AgentError) {
      log.error("편성 접수 실패", { vId, status: e.status, code: e.code });
      return NextResponse.json({ error: "편성 요청을 접수하지 못했습니다." }, { status: 502 });
    }
    log.error("편성 접수 오류", { vId, message: String(e) });
    return NextResponse.json({ error: "편성 요청 중 오류가 발생했습니다." }, { status: 500 });
  }
}
