import { NextResponse } from "next/server";
import { getCompose } from "@/lib/server/composes";
import { presignGet, renderKey, exists } from "@/lib/server/s3";
import { createLogger } from "@/lib/server/log";

const log = createLogger("api/download");

/**
 * 렌더본 MP4 내려받기(PAGES.md §6) — `/api/clips/{vid}/{compId}/download`
 *
 * ⚠️ 2026-09-02 경로 변경 — `comp_id` 가 영상 안에서만 유일해져(`t_compose` PK 가
 * `(v_id, comp_id)`) 단독으로는 편성을 특정할 수 없다. 예전 `/api/clips/{compId}/download` 는
 * 임의의 영상 편성을 집을 수 있었다.
 *
 * 보안 조치:
 *   · S3 URL 을 화면에 심지 않는다 — 요청 시점에 발급한다.
 *   · v_id·comp_id 는 추측 가능한 정수라 **서버에서 노출 대상 여부를 재검증**한다(is_sbs 조인).
 *   · presigned TTL 은 짧게(S3_PRESIGN_TTL, 기본 10분).
 *   · 파일명은 **서버가 정한다** — 사용자 입력을 반영하지 않는다.
 *   · 200MB+ 라 서버 프록시 대신 presigned 리다이렉트를 쓴다.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ vid: string; compId: string }> },
) {
  const { vid, compId: compIdRaw } = await params;
  const vId = Number(vid);
  const compId = Number(compIdRaw);
  if (!Number.isInteger(vId) || vId <= 0 || !Number.isInteger(compId) || compId <= 0) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const compose = await getCompose(vId, compId);
  if (!compose) return NextResponse.json({ error: "편성을 찾을 수 없습니다." }, { status: 404 });

  const key = renderKey(compose.vId, compose.compId);
  if (!(await exists(key))) {
    return NextResponse.json({ error: "아직 만들어진 영상이 없습니다." }, { status: 404 });
  }

  // 파일명은 서버가 만든다. 영상 제목은 경로 문자·따옴표를 제거해 쓴다.
  const safeTitle = (compose.videoName ?? "clip").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 40);
  const filename = `${safeTitle || "clip"}_${compose.vId}_${compose.compId}.mp4`;

  log.info("내려받기 발급", { vId, compId });
  return NextResponse.redirect(await presignGet(key, filename));
}
