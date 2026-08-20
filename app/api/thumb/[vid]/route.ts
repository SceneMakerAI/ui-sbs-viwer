import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getThumbSec } from "@/lib/server/composes";
import { DEFAULT_SEC, getThumb } from "@/lib/server/thumbs";
import { isVisible } from "@/lib/server/videos";

/**
 * 영상 썸네일 — `/api/thumb/[vid]?c=<comp_id>`
 *
 * 프레임은 원본에서 뽑아 서버에 캐시한다(lib/server/thumbs.ts). 첫 요청만 ~1초, 이후는 즉시.
 * 실패하면 404 로 답하고 화면은 대체 표시로 넘어간다 — 썸네일 때문에 목록이 깨지면 안 된다.
 *
 * 시각 선택: `c` 가 있으면 그 편성의 첫 클립, 없으면 이 영상 아무 편성의 첫 클립,
 * 그것도 없으면 10분 지점. **0초는 쓰지 않는다** — 중계 오프닝·광고 구간이다.
 */
export async function GET(req: Request, { params }: { params: Promise<{ vid: string }> }) {
  const vId = Number((await params).vid);
  if (!Number.isInteger(vId) || vId <= 0) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  // 노출 대상 영상만 — v_id 는 주소창으로 바꿔 넣을 수 있다.
  if (!(await isVisible(vId))) {
    return NextResponse.json({ error: "영상을 찾을 수 없습니다." }, { status: 404 });
  }

  const compIdRaw = new URL(req.url).searchParams.get("c");
  const compId = compIdRaw && /^\d+$/.test(compIdRaw) ? Number(compIdRaw) : undefined;

  const sec = (await getThumbSec(vId, compId)) ?? DEFAULT_SEC;
  const path = await getThumb(vId, sec);
  if (!path) {
    return NextResponse.json({ error: "썸네일을 만들지 못했습니다." }, { status: 404 });
  }

  const body = await readFile(path);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/jpeg",
      // 같은 영상·같은 지점이면 프레임이 바뀌지 않는다 → 오래 캐시한다.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
