/**
 * 편성 리포지토리(`t_compose` · `t_compose_clip`).
 *
 * 노출 범위는 영상과 동일하게 `is_sbs = 1` 로 강제한다 — comp_id 는 추측 가능한 정수라
 * 조인으로 막지 않으면 다른 고객 영상의 편성이 열린다.
 *
 * ⚠️ **2026-09-02 스키마 교체(agent-compose2) — 편성의 키는 `(v_id, comp_id)` 복합키다.**
 * comp_id 가 영상 안에서 1부터 다시 매겨지므로 **comp_id 만으로 조회하면 안 된다**
 * (실측: 27건 중 comp_id 는 7종뿐이고 comp_id=1 이 6개 영상에 있다). 이 파일의 모든
 * 편성·클립 조회는 두 값을 함께 받고, 클립 조인도 `v_id` 와 `comp_id` 를 **둘 다** 건다 —
 * comp_id 만으로 조인하면 여러 영상의 클립이 한 편성에 섞여 나온다.
 *
 * 읽기 전용이다. 상태 기록은 agent-compose 가 한다(PAGES.md §10).
 */
import "server-only";
import { query } from "./db";
import { sanitizeCodeText, CODE } from "@/lib/domain/status";
import type { Clip, Compose, VideoGroup } from "@/lib/types";

const SBS_ONLY = "v.is_sbs = 1";

const SELECT = `
  SELECT cp.comp_id, cp.v_id, cp.query, cp.budget_sec, cp.status_code, cp.duration_sec,
         cp.clip_cnt, cp.bumper_yn, cp.reg_datetime,
         v.name AS video_name,
         t.name AS status_name, t.description AS status_desc
    FROM t_compose cp
    JOIN t_video v ON v.v_id = cp.v_id
    LEFT JOIN t_code t ON t.code = cp.status_code
`;

interface Row {
  comp_id: number;
  v_id: number;
  video_name: string;
  query: string;
  budget_sec: number | null;
  status_code: number;
  status_name: string | null;
  status_desc: string | null;
  duration_sec: number;
  clip_cnt: number;
  /** 'Y' / 'N' — 예전 스키마의 tinyint 1/0 이 아니다. */
  bumper_yn: string;
  reg_datetime: Date;
}

function toCompose(r: Row): Compose {
  return {
    compId: r.comp_id,
    vId: r.v_id,
    videoName: r.video_name,
    query: r.query,
    budgetSec: r.budget_sec == null ? null : Number(r.budget_sec),
    statusCode: Number(r.status_code),
    statusName: sanitizeCodeText(r.status_name),
    statusDesc: sanitizeCodeText(r.status_desc),
    duration: Number(r.duration_sec),
    clipCount: Number(r.clip_cnt),
    // 'Y'/'N' 을 대소문자 구분 없이 받는다 — 상류가 소문자로 쓸 여지를 남긴다.
    bumper: String(r.bumper_yn).toUpperCase() === "Y",
    regDatetime: r.reg_datetime.toISOString(),
  };
}

export type ComposeSort = "recent" | "duration" | "clips";

const ORDER_BY: Record<ComposeSort, string> = {
  // comp_id 는 영상 안에서만 증가하므로 전역 정렬의 2차 키로는 v_id 를 함께 쓴다.
  recent: "cp.reg_datetime DESC, cp.v_id DESC, cp.comp_id DESC",
  duration: "cp.duration_sec DESC",
  clips: "cp.clip_cnt DESC",
};

export interface ListComposesParams {
  /** 특정 영상의 편성 이력만. */
  vId?: number;
  /** 질의문·영상 제목 부분 일치. */
  q?: string;
  sort?: ComposeSort;
  limit?: number;
  offset?: number;
}

export async function listComposes(p: ListComposesParams = {}): Promise<{ items: Compose[]; total: number }> {
  const where = [SBS_ONLY];
  const params: unknown[] = [];

  if (p.vId != null) {
    where.push("cp.v_id = ?");
    params.push(p.vId);
  }
  if (p.q?.trim()) {
    where.push("(cp.query LIKE ? OR v.name LIKE ?)");
    params.push(`%${p.q.trim()}%`, `%${p.q.trim()}%`);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const limit = Math.min(Math.max(p.limit ?? 24, 1), 100);
  const offset = Math.max(p.offset ?? 0, 0);

  const rows = await query<Row>(
    `${SELECT} ${whereSql} ORDER BY ${ORDER_BY[p.sort ?? "recent"]} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [{ cnt }] = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM t_compose cp JOIN t_video v ON v.v_id = cp.v_id ${whereSql}`,
    params,
  );

  return { items: rows.map(toCompose), total: Number(cnt) };
}

/**
 * 단건 조회. 노출 대상이 아니면 null.
 *
 * ⚠️ `vId` 는 선택 인자가 아니다 — comp_id 만으로는 편성이 특정되지 않는다.
 */
export async function getCompose(vId: number, compId: number): Promise<Compose | null> {
  const rows = await query<Row>(
    `${SELECT} WHERE ${SBS_ONLY} AND cp.v_id = ? AND cp.comp_id = ?`,
    [vId, compId],
  );
  return rows[0] ? toCompose(rows[0]) : null;
}

/**
 * 편성에 속한 클립 목록.
 *
 * 구간은 이제 **정수 초 컬럼**(`start_sec`/`end_sec`)이라 `TIME_TO_SEC` 변환이 없다.
 * ⚠️ 조인은 `v_id` 와 `comp_id` 를 **둘 다** 건다 — comp_id 만 걸면 같은 번호를 가진
 * 다른 영상의 클립까지 딸려 온다(실측: comp_id=1 이 6개 영상에 존재).
 */
export async function listClips(vId: number, compId: number): Promise<Clip[]> {
  const rows = await query<{
    clip_seq: number; start_sec: number; end_sec: number; scene_no: number;
    tags: string | null; labels: string | null; inning: string | null;
  }>(
    `SELECT cc.clip_seq, cc.start_sec, cc.end_sec, cc.scene_no,
            cc.tags, cc.labels, cc.inning
       FROM t_compose_clip cc
       JOIN t_compose cp ON cp.v_id = cc.v_id AND cp.comp_id = cc.comp_id
       JOIN t_video   v  ON v.v_id  = cp.v_id
      WHERE ${SBS_ONLY} AND cc.v_id = ? AND cc.comp_id = ?
      ORDER BY cc.clip_seq ASC`,
    [vId, compId],
  );
  return rows.map((r) => ({
    seq: r.clip_seq,
    start: Number(r.start_sec),
    end: Number(r.end_sec),
    sceneNo: Number(r.scene_no),
    tags: r.tags,
    labels: r.labels,
    inning: r.inning,
  }));
}

/**
 * 팀명 판독에 요구하는 최소 프레임 수 — agent-compose `repos._TEAM_MIN_FRAMES` 와 같은 값.
 * 이보다 적으면 지어내지 않고 null 을 돌린다(화면은 숫자만 쓴다).
 */
const TEAM_MIN_FRAMES = 30;

/** "KT 5" → "KT". 뒤에 붙은 점수 한 토큰만 떼어낸다(팀명에 공백이 있어도 안전). */
function stripScore(s: string): string {
  const t = s.trim();
  const i = t.lastIndexOf(" ");
  return (i < 0 ? t : t.slice(0, i)).trim();
}

/**
 * 대결 팀명(원정, 홈).
 *
 * ⚠️ 출처가 두 번 바뀌었다. 2026-09-02 스키마 교체로 `t_compose_clip.score_before`·`score_after`
 * 마저 **삭제**돼, 클립 단위 스코어 표기는 더 이상 만들 수 없다(화면에서도 걷어냈다).
 * 팀명만은 아래 경로로 남는다 — 향후 스코어 표기를 되살린다면 출처를 새로 정해야 한다.
 *
 * 앞선 변경(2026-08-23 상류 개편) — 예전엔 `t_scene_baseball.score` 가
 * "{원정} {원정점}-{홈점} {홈}" 을 들고 있었으나 **그 컬럼이 사라졌다**(전이 원장 폐기,
 * vision3 migration_20260823i). 지금 팀명의 유일한 출처는 화면 정보 자막
 * `t_frame_baseball_board_detail(kind='TEAM')` 이고, agent-compose `repos.fetch_teams` 와
 * **같은 방식**으로 읽는다:
 *   · 자막 원문은 "KT 5: NC 1" 로 **원정이 먼저**다. 점수는 프레임마다 바뀌므로 숫자를
 *     걷어낸 뒤 팀 쌍의 최빈값을 고른다 — 중계 자막엔 다른 경기 스코어가 섞여 흐른다
 *     (v201 실측: 삼성:롯데 3,619 vs KIA:NC 103).
 *   · 원문 그대로 최빈값을 뽑으면 "팀 쌍"이 아니라 "스코어 줄"을 세게 되므로 안 된다.
 *     SQL 은 원문 단위로만 압축하고(수천 행 → 수백 행), 쌍 집계는 여기서 한다.
 */
export async function getTeams(vId: number): Promise<{ away: string; home: string } | null> {
  const rows = await query<{ txt: string; cnt: number }>(
    `SELECT d.txt, COUNT(*) AS cnt
       FROM t_frame_baseball_board_detail d
       JOIN t_video v ON v.v_id = d.v_id
      WHERE ${SBS_ONLY} AND d.v_id = ? AND d.kind = 'TEAM' AND d.txt <> ''
      GROUP BY d.txt`,
    [vId],
  );

  const pairs = new Map<string, { away: string; home: string; n: number }>();
  for (const r of rows) {
    const i = r.txt.indexOf(":");
    if (i < 0) continue;
    const away = stripScore(r.txt.slice(0, i));
    const home = stripScore(r.txt.slice(i + 1));
    if (!away || !home) continue;
    const key = `${away}|${home}`;
    const cur = pairs.get(key) ?? { away, home, n: 0 };
    cur.n += Number(r.cnt);
    pairs.set(key, cur);
  }

  let best: { away: string; home: string; n: number } | null = null;
  for (const p of pairs.values()) if (!best || p.n > best.n) best = p;

  // 판독이 모자라면 지어내지 않는다 — 틀린 팀명은 숫자만 있는 것보다 나쁘다.
  return best && best.n >= TEAM_MIN_FRAMES ? { away: best.away, home: best.home } : null;
}

/**
 * 썸네일용 대표 시각(초) — 첫 클립의 시작 지점.
 * `compId` 를 주면 그 편성의 첫 클립, 없으면 이 영상의 아무 편성이나 첫 클립.
 * 편성이 없으면 null → 호출부가 기본값을 쓴다.
 */
export async function getThumbSec(vId: number, compId?: number): Promise<number | null> {
  const rows = await query<{ start_sec: number }>(
    `SELECT cc.start_sec
       FROM t_compose_clip cc
       JOIN t_compose cp ON cp.v_id = cc.v_id AND cp.comp_id = cc.comp_id
       JOIN t_video   v  ON v.v_id  = cp.v_id
      WHERE ${SBS_ONLY} AND cc.v_id = ?
        ${compId != null ? "AND cc.comp_id = ?" : ""}
      ORDER BY cc.comp_id ASC, cc.clip_seq ASC
      LIMIT 1`,
    compId != null ? [vId, compId] : [vId],
  );
  return rows[0] ? Number(rows[0].start_sec) : null;
}

/**
 * `since` 이후에 이 영상으로 만들어진 편성 중 가장 최근 것.
 *
 * 편성 잠금 감시(`compose-agent.ts`)가 agent 에게 잡 상태를 못 물었을 때(잡 캐시 소멸 등)
 * "그래도 편성이 만들어졌는가"를 DB 로 확인하는 용도다. 행이 없다고 실패는 아니고
 * **아직 진행 중일 수도** 있으므로, 이 함수만으로 실패를 단정하지 않는다.
 */
export async function findComposeSince(vId: number, since: Date): Promise<number | null> {
  const rows = await query<{ comp_id: number }>(
    `SELECT cp.comp_id
       FROM t_compose cp
       JOIN t_video v ON v.v_id = cp.v_id
      WHERE ${SBS_ONLY} AND cp.v_id = ? AND cp.reg_datetime >= ?
      ORDER BY cp.reg_datetime DESC, cp.comp_id DESC
      LIMIT 1`,
    [vId, since],
  );
  return rows[0] ? Number(rows[0].comp_id) : null;
}

/**
 * 대시보드 요약 지표.
 *
 * ⚠️ 세 번째 지표는 예전엔 "완성 영상"(`render_datetime IS NOT NULL`)이었으나 그 컬럼이
 * 삭제돼 **DB 로는 mp4 존재를 셀 수 없다**(2026-09-02). 지표 하나를 위해 편성마다 S3 를
 * 조회할 수는 없으므로 **정상 완료된 편성 수**로 바꾸고, 화면 라벨도 그에 맞춰 고쳤다.
 * 세지 못하는 값을 옛 이름으로 계속 내보내면 화면이 조용히 거짓말을 한다.
 */
export async function getSummary(): Promise<{ videos: number; composes: number; completed: number }> {
  const [row] = await query<{ videos: number; composes: number; completed: number }>(
    `SELECT
       (SELECT COUNT(*) FROM t_video v WHERE ${SBS_ONLY})                          AS videos,
       (SELECT COUNT(*) FROM t_compose cp JOIN t_video v ON v.v_id = cp.v_id
         WHERE ${SBS_ONLY})                                                        AS composes,
       (SELECT COUNT(*) FROM t_compose cp JOIN t_video v ON v.v_id = cp.v_id
         WHERE ${SBS_ONLY} AND cp.status_code = ?)                                 AS completed`,
    [CODE.COMPOSE_OK],
  );
  return { videos: Number(row.videos), composes: Number(row.composes), completed: Number(row.completed) };
}

/* ── 영상 묶어 보기(그룹 모드) ───────────────────────────────────────── */

/**
 * 편성 클립 목록의 **기본 보기**는 영상 묶음이다(2026-08-24 결정, PAGES.md §2-3).
 * 목록의 단위가 편성이 아니라 영상이므로 t_video 를 축으로 t_compose 를 집계한다.
 *
 * 이 함수를 videos.ts 가 아니라 여기 두는 이유: 두 번째 쿼리(`listComposesByVideos`)가
 * 같은 `SELECT`·`toCompose` 를 쓰고, 이 화면의 관심사는 어디까지나 편성이다.
 * 영상 쪽 컬럼은 표시에 필요한 것만 가져온다(is_sbs 는 여기서도 select 하지 않는다).
 * 반환 타입 `VideoGroup` 은 클라이언트 컴포넌트도 쓰므로 `lib/types.ts` 에 둔다.
 */

export type GroupSort = "recent" | "video" | "composes";

const GROUP_ORDER_BY: Record<GroupSort, string> = {
  // 편성이 없는 영상은 last_compose_at 이 NULL 이라 DESC 에서 뒤로 밀린다(MariaDB).
  recent: "last_compose_at DESC, v.reg_datetime DESC",
  video: "v.reg_datetime DESC, v.v_id DESC",
  composes: "compose_cnt DESC, last_compose_at DESC",
};

/**
 * 검색은 **클립까지 본다**(2026-08-24 결정) — 영상 제목 또는 편성 질의가 걸리면 남는다.
 * 편성 1건의 일치 판정은 `listComposes` 와 **같은 식**이어야 한다: 제목이 걸린 영상은
 * 그 영상의 편성 전부가 일치로 잡혀야(캐러셀이 비지 않게) 하기 때문이다.
 */
const MATCH = "(cp.query LIKE ? OR v.name LIKE ?)";

export interface ListVideoGroupsParams {
  q?: string;
  sort?: GroupSort;
  limit?: number;
  offset?: number;
}

export async function listVideoGroups(
  p: ListVideoGroupsParams = {},
): Promise<{ items: VideoGroup[]; total: number }> {
  const q = p.q?.trim();
  const like = q ? `%${q}%` : null;
  const limit = Math.min(Math.max(p.limit ?? 15, 1), 100);
  const offset = Math.max(p.offset ?? 0, 0);

  // 검색 조건은 영상 단위다 — 제목이 걸리거나, 걸리는 편성을 하나라도 가진 영상.
  const searchSql = q
    ? `AND (v.name LIKE ?
            OR EXISTS (SELECT 1 FROM t_compose x WHERE x.v_id = v.v_id AND x.query LIKE ?))`
    : "";
  const searchParams = q ? [like, like] : [];

  const rows = await query<{
    v_id: number; name: string; play_time: number; cate_name: string | null;
    reg_datetime: Date; compose_cnt: number; ready_cnt: number; match_cnt: number;
    last_compose_at: Date | null;
  }>(
    `SELECT v.v_id, v.name, v.play_time, v.reg_datetime, c.cate_name,
            COUNT(cp.comp_id) AS compose_cnt,
            SUM(CASE WHEN cp.status_code = ${CODE.COMPOSE_OK} THEN 1 ELSE 0 END) AS ready_cnt,
            ${q ? `SUM(CASE WHEN ${MATCH} THEN 1 ELSE 0 END)` : "COUNT(cp.comp_id)"} AS match_cnt,
            MAX(cp.reg_datetime) AS last_compose_at
       FROM t_video v
       LEFT JOIN t_category c ON c.cate_id = v.cate_id
       LEFT JOIN t_compose  cp ON cp.v_id  = v.v_id
      WHERE ${SBS_ONLY} ${searchSql}
      GROUP BY v.v_id, v.name, v.play_time, v.reg_datetime, c.cate_name
      ORDER BY ${GROUP_ORDER_BY[p.sort ?? "recent"]}
      LIMIT ? OFFSET ?`,
    [...(q ? [like, like] : []), ...searchParams, limit, offset],
  );

  const [{ cnt }] = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM t_video v WHERE ${SBS_ONLY} ${searchSql}`,
    searchParams,
  );

  return {
    items: rows.map((r) => ({
      vId: r.v_id,
      name: r.name,
      playTime: Number(r.play_time),
      cateName: r.cate_name,
      regDatetime: r.reg_datetime.toISOString(),
      composeCount: Number(r.compose_cnt),
      readyCount: Number(r.ready_cnt),
      matchCount: Number(r.match_cnt),
      lastComposeAt: r.last_compose_at ? r.last_compose_at.toISOString() : null,
    })),
    total: Number(cnt),
  };
}

/**
 * 한 페이지에 걸린 영상들의 편성을 **한 번에** 가져온다 — 영상마다 쿼리를 날리지 않는다.
 * 캐러셀은 펼치기 전부터 DOM 에 있으므로(펼침은 표시 전환일 뿐) 미리 받아 둔다.
 *
 * 영상당 상한을 둔다: 편성이 수백 건인 영상이 생기면 캐러셀이 아니라 목록이 필요하다 —
 * 그때는 "클립만 보기"가 정답이다. 상한을 넘으면 최근 것만 싣고 화면이 그 사실을 말한다.
 */
export const GROUP_COMPOSE_MAX = 30;

export async function listComposesByVideos(
  vIds: number[],
  q?: string,
): Promise<Record<number, Compose[]>> {
  const out: Record<number, Compose[]> = {};
  if (vIds.length === 0) return out;

  const like = q?.trim() ? `%${q.trim()}%` : null;
  const holes = vIds.map(() => "?").join(",");
  const rows = await query<Row>(
    `${SELECT} WHERE ${SBS_ONLY} AND cp.v_id IN (${holes})
       ${like ? `AND ${MATCH}` : ""}
       ORDER BY cp.v_id ASC, cp.reg_datetime DESC, cp.comp_id DESC`,
    like ? [...vIds, like, like] : [...vIds],
  );

  for (const r of rows) {
    const list = (out[r.v_id] ??= []);
    if (list.length < GROUP_COMPOSE_MAX) list.push(toCompose(r));
  }
  return out;
}
