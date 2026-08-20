import { NextResponse } from "next/server";
import { AgentError, pollJob } from "@/lib/server/compose-agent";
import { createLogger } from "@/lib/server/log";

const log = createLogger("api/compose/poll");

/**
 * 편성 잡 폴링 중계.
 *
 * 진행 표시 용도로만 쓴다 — 결과의 정본은 `t_compose`(DB)다.
 * agent-compose 의 잡 캐시는 인메모리라 서비스 재시작이면 404 가 되는데,
 * 그렇다고 편성이 사라진 건 아니다(이미 DB 에 저장돼 있다).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

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
