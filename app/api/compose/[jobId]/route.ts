import { NextResponse } from "next/server";
import { findByJobId } from "@/lib/server/queue";
import { AgentError, pollJob } from "@/lib/server/compose-agent";
import { createLogger } from "@/lib/server/log";

const log = createLogger("api/compose/poll");

/**
 * ⚠️ **하위 호환 경로**(deprecated). 편성 잡 폴링 — 큐 도입 전 편성 폼이 쓰던 주소다.
 * 신규 화면은 **`GET /api/queue/ticket/{ticketId}`** 를 쓴다(대기 순번이 여기엔 없다).
 *
 * 진행 표시 용도로만 쓴다 — 결과의 정본은 `t_compose`(DB)다.
 * 큐가 이미 그 잡을 감시하고 있으므로 **큐의 상태를 먼저 돌려준다**. 큐가 모르는 잡(재시작
 * 이전 요청 등)은 agent 에 직접 물어본다.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  const item = findByJobId(jobId);
  if (item) {
    const status =
      item.state === "pending" || item.state === "running"
        ? "running"
        : item.state === "done"
          ? (item.outcome === "empty" ? "empty" : "ok")
          : "error";
    return NextResponse.json({
      status,
      progress: item.progress,
      ...(item.compId != null ? { compId: item.compId } : {}),
      ...(item.error ? { error: item.error } : {}),
      // 큐에서만 알 수 있는 정보 — 구 화면은 무시해도 된다.
      ticketId: item.ticketId,
      position: item.position,
    });
  }

  try {
    return NextResponse.json(await pollJob(jobId));
  } catch (e) {
    if (e instanceof AgentError && e.status === 404) {
      return NextResponse.json(
        { code: "JOB_NOT_FOUND", error: "진행 정보를 찾을 수 없습니다. 편성 목록에서 결과를 확인해 주세요." },
        { status: 404 },
      );
    }
    log.error("잡 폴링 실패", { jobId, message: String(e) });
    return NextResponse.json({ error: "진행 상황을 가져오지 못했습니다." }, { status: 502 });
  }
}
