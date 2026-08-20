/**
 * 영상 리포지토리(`t_video`).
 *
 * ⚠️ **노출 범위 강제** — 이 앱이 보여줄 수 있는 영상은 `is_sbs = 1` 뿐이다.
 * 모든 조회에 `SBS_ONLY` 를 붙인다. 단건 조회도 예외 없다(v_id 를 주소창에 찍어 넣는 것으로
 * 다른 영상이 열리면 안 된다). 그리고 이 조건은 **응답에 절대 실리지 않는다** — 컬럼을 select 하지 않는다.
 */
import "server-only";
import { query } from "./db";
import { sanitizeCodeText } from "@/lib/domain/status";
import type { Video } from "@/lib/types";

/** 모든 영상 조회에 강제로 붙는 노출 조건. */
const SBS_ONLY = "v.is_sbs = 1";

/** 목록·상세 공통 select. is_sbs 는 select 하지 않는다. */
const SELECT = `
  SELECT v.v_id, v.name, v.play_time, v.cate_id, v.status_code, v.reg_datetime,
         c.cate_name,
         t.name AS status_name, t.description AS status_desc,
         (SELECT COUNT(*) FROM t_compose cp WHERE cp.v_id = v.v_id) AS compose_cnt
    FROM t_video v
    LEFT JOIN t_category c ON c.cate_id = v.cate_id
    LEFT JOIN t_code     t ON t.code    = v.status_code
`;

interface Row {
  v_id: number;
  name: string;
  play_time: number;
  cate_id: number | null;
  cate_name: string | null;
  status_code: number | null;
  status_name: string | null;
  status_desc: string | null;
  reg_datetime: Date;
  compose_cnt: number;
}

function toVideo(r: Row): Video {
  return {
    vId: r.v_id,
    name: r.name,
    playTime: Number(r.play_time),
    cateId: r.cate_id,
    cateName: r.cate_name,
    statusCode: r.status_code,
    statusName: sanitizeCodeText(r.status_name),
    statusDesc: sanitizeCodeText(r.status_desc),
    regDatetime: r.reg_datetime.toISOString(),
    composeCount: Number(r.compose_cnt),
  };
}

export type VideoSort = "recent" | "name" | "duration";

const ORDER_BY: Record<VideoSort, string> = {
  recent: "v.reg_datetime DESC, v.v_id DESC",
  name: "v.name ASC",
  duration: "v.play_time DESC",
};

export interface ListVideosParams {
  /** 카테고리 필터. 상위 카테고리를 주면 하위까지 포함한다. */
  cateId?: number;
  /** 제목 부분 일치. */
  q?: string;
  sort?: VideoSort;
  limit?: number;
  offset?: number;
}

/** 목록 + 전체 건수(페이지네이션용). */
export async function listVideos(p: ListVideosParams = {}): Promise<{ items: Video[]; total: number }> {
  const where = [SBS_ONLY];
  const params: unknown[] = [];

  if (p.cateId != null) {
    // 상위 카테고리(5000)로 하위(5100·5200)까지 잡는다.
    where.push("(v.cate_id = ? OR c.p_cate_id = ?)");
    params.push(p.cateId, p.cateId);
  }
  if (p.q?.trim()) {
    where.push("v.name LIKE ?");
    params.push(`%${p.q.trim()}%`);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const limit = Math.min(Math.max(p.limit ?? 24, 1), 100);
  const offset = Math.max(p.offset ?? 0, 0);

  const rows = await query<Row>(
    `${SELECT} ${whereSql} ORDER BY ${ORDER_BY[p.sort ?? "recent"]} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [{ cnt }] = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM t_video v
       LEFT JOIN t_category c ON c.cate_id = v.cate_id
     ${whereSql}`,
    params,
  );

  return { items: rows.map(toVideo), total: Number(cnt) };
}

/** 단건 조회. 노출 대상이 아니면 null — 호출부는 404 로 처리한다. */
export async function getVideo(vId: number): Promise<Video | null> {
  const rows = await query<Row>(`${SELECT} WHERE ${SBS_ONLY} AND v.v_id = ?`, [vId]);
  return rows[0] ? toVideo(rows[0]) : null;
}

/** 노출 대상 영상인지만 확인한다(내려받기·렌더 요청 전 재검증용 — PAGES.md §6). */
export async function isVisible(vId: number): Promise<boolean> {
  const rows = await query<{ one: number }>(
    `SELECT 1 AS one FROM t_video v WHERE ${SBS_ONLY} AND v.v_id = ?`, [vId],
  );
  return rows.length > 0;
}

/**
 * 원본 S3 경로(`t_video.dir` = `{shard}/{v_id}.{ext}`)를 돌려준다 — 원본 구간 재생용.
 * 노출 대상이 아니면 null. `dir` 은 내부 경로라 화면·응답에 그대로 싣지 않는다.
 */
export async function getVideoDir(vId: number): Promise<string | null> {
  const rows = await query<{ dir: string }>(
    `SELECT v.dir FROM t_video v WHERE ${SBS_ONLY} AND v.v_id = ?`, [vId],
  );
  return rows[0]?.dir ?? null;
}

/** 노출 대상 영상에 달린 카테고리만 추린다 — /videos 의 탭 구성용. */
export async function listUsedCategories(): Promise<{ cateId: number; cateName: string; count: number }[]> {
  const rows = await query<{ cate_id: number; cate_name: string | null; cnt: number }>(
    `SELECT v.cate_id, c.cate_name, COUNT(*) AS cnt
       FROM t_video v
       LEFT JOIN t_category c ON c.cate_id = v.cate_id
      WHERE ${SBS_ONLY} AND v.cate_id IS NOT NULL
      GROUP BY v.cate_id, c.cate_name
      ORDER BY cnt DESC, v.cate_id ASC`,
  );
  return rows.map((r) => ({ cateId: r.cate_id, cateName: r.cate_name ?? "기타", count: Number(r.cnt) }));
}
