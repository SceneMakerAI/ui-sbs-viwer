import { NextResponse } from "next/server";
import { z } from "zod";
import {
  QueueFullError,
  composeCompatState,
  enqueueCompose,
  PENDING_MAX,
} from "@/lib/server/queue";
import { getVideo } from "@/lib/server/videos";
import { isComposable } from "@/lib/domain/status";
import { createLogger } from "@/lib/server/log";

const log = createLogger("api/compose");

/**
 * 길이는 화면의 5/10/15분·없음(lib/domain/budget.ts)과 1:1. 그 밖의 값은 받지 않는다.
 * "없음"은 `null` — agent 로 그대로 넘겨 절단을 걸지 않는다.
 *
 * ⚠️ 이 인자는 2026-08-24 하루 사이에 **폐기됐다가 되살아났다**(agent-compose 94b58dc → 0d95b9f).
 * 지금은 `budget_sec` 이라는 이름의 **덜어내기 전용 상한**이다 — 자세한 건 budget.ts.
 *
 * 렌더 인자는 받지 않는다(2026-08-24) — **편성 요청은 편성만 한다.** 영상은 결과 화면에서
 * `POST /api/render`(범퍼 선택 포함)로 따로 만든다. 원샷 경로를 화면에서 없앤 결정이다.
 */
const Body = z.object({
  vId: z.number().int().positive(),
  query: z.string().trim().min(2).max(200),
  budgetSec: z.union([z.literal(300), z.literal(600), z.literal(900), z.null()]),
});

/**
 * ⚠️ **하위 호환 뷰**(deprecated). 큐 도입 전 화면(전역 진행 바)이 쓰던 `{busy, since, job}` 모양을
 * 유지한다. 신규 화면은 **`GET /api/queue`** 를 써야 한다 — 대기 순번·렌더 레인은 여기 안 보인다.
 */
export async function GET() {
  return NextResponse.json(composeCompatState());
}

/**
 * 편성 접수 — **항상 받는다**(2026-08-24 큐 전환).
 *
 * 예전에는 처리 중이면 409 `COMPOSE_BUSY` 로 거절하고 클라이언트가 5초마다 재시도해
 * 대기열처럼 보이게 했다. 그 구조는 서버가 대기자를 모르니 순번을 말할 수 없었고, 탭을
 * 닫으면 요청이 사라졌다. 이제 서버 큐(`lib/server/queue.ts`)가 요청을 들고 순서대로 보낸다.
 *   → 응답은 **202 + 티켓**이다. 진행은 `GET /api/queue` 또는 `GET /api/queue/ticket/{id}` 로 본다.
 *   → 거절은 대기열 포화(503 `QUEUE_FULL`)뿐이다.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const { vId, query, budgetSec } = parsed.data;

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
    const ticket = enqueueCompose({ vId, query, budgetSec });
    return NextResponse.json(ticket, { status: 202 });
  } catch (e) {
    if (e instanceof QueueFullError) {
      // 실패가 아니라 "지금은 너무 붐빈다"다 — 화면은 재시도 시각을 안내한다.
      log.warn("대기열 포화 — 접수 거절", { vId, max: PENDING_MAX });
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
    log.error("편성 접수 오류", { vId, message: String(e) });
    return NextResponse.json({ error: "편성 요청 중 오류가 발생했습니다." }, { status: 500 });
  }
}
