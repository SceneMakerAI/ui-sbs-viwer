/**
 * 편성 리포지토리(`t_compose` · `t_compose_clip`).
 *
 * 노출 범위는 영상과 동일하게 `is_sbs = 1` 로 강제한다 — comp_id 는 추측 가능한 정수라
 * 조인으로 막지 않으면 다른 고객 영상의 편성이 열린다.
 *
 * 읽기 전용이다. `render_datetime` 기록은 agent-compose 가 한다(PAGES.md §10).
 */
import "server-only";
import { query } from "./db";
import type { Clip, Compose } from "@/lib/types";

const SBS_ONLY = "v.is_sbs = 1";

const SELECT = `
  SELECT cp.comp_id, cp.v_id, cp.query, cp.budget_sec, cp.status, cp.duration,
         cp.clip_cnt, cp.bumper_yn, cp.render_datetime, cp.render_status, cp.reg_datetime,
         v.name AS video_name
    FROM t_compose cp
    JOIN t_video v ON v.v_id = cp.v_id
`;

interface Row {
  comp_id: number;
  v_id: number;
  video_name: string;
  query: string;
  budget_sec: number;
  status: string;
  duration: number;
  clip_cnt: number;
  bumper_yn: number;
  render_datetime: Date | null;
  render_status: number | null;
  reg_datetime: Date;
}

function toCompose(r: Row): Compose {
  return {
    compId: r.comp_id,
    vId: r.v_id,
    videoName: r.video_name,
    query: r.query,
    budgetSec: r.budget_sec,
    status: r.status,
    duration: Number(r.duration),
    clipCount: Number(r.clip_cnt),
    bumper: r.bumper_yn === 1,
    renderedAt: r.render_datetime ? r.render_datetime.toISOString() : null,
    renderStatus: r.render_status == null ? null : Number(r.render_status),
    regDatetime: r.reg_datetime.toISOString(),
  };
}

export type ComposeSort = "recent" | "duration" | "clips";

const ORDER_BY: Record<ComposeSort, string> = {
  recent: "cp.reg_datetime DESC, cp.comp_id DESC",
  duration: "cp.duration DESC",
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

/** 단건 조회. 노출 대상이 아니면 null. */
export async function getCompose(compId: number): Promise<Compose | null> {
  const rows = await query<Row>(`${SELECT} WHERE ${SBS_ONLY} AND cp.comp_id = ?`, [compId]);
  return rows[0] ? toCompose(rows[0]) : null;
}

/** 편성에 속한 클립 목록. 시간은 SQL TIME → 초로 변환해 내보낸다. */
export async function listClips(compId: number): Promise<Clip[]> {
  const rows = await query<{
    clip_seq: number; start: number; end: number;
    labels: string | null; inning: string | null;
    score_before: string | null; score_after: string | null;
  }>(
    `SELECT cc.clip_seq,
            TIME_TO_SEC(cc.start_time) AS start,
            TIME_TO_SEC(cc.end_time)   AS end,
            cc.labels, cc.inning, cc.score_before, cc.score_after
       FROM t_compose_clip cc
       JOIN t_compose cp ON cp.comp_id = cc.comp_id
       JOIN t_video   v  ON v.v_id     = cp.v_id
      WHERE ${SBS_ONLY} AND cc.comp_id = ?
      ORDER BY cc.clip_seq ASC`,
    [compId],
  );
  return rows.map((r) => ({
    seq: r.clip_seq,
    start: Number(r.start),
    end: Number(r.end),
    labels: r.labels,
    inning: r.inning,
    scoreBefore: r.score_before,
    scoreAfter: r.score_after,
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
 * `t_compose_clip.score_*` 는 "2-0" 처럼 숫자만 있어서 어느 팀 점수인지 알 수 없다.
 *
 * ⚠️ 출처가 바뀌었다(2026-08-23 상류 개편) — 예전엔 `t_scene_baseball.score` 가
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
  const rows = await query<{ start: number }>(
    `SELECT TIME_TO_SEC(cc.start_time) AS start
       FROM t_compose_clip cc
       JOIN t_compose cp ON cp.comp_id = cc.comp_id
       JOIN t_video   v  ON v.v_id     = cp.v_id
      WHERE ${SBS_ONLY} AND cp.v_id = ?
        ${compId != null ? "AND cc.comp_id = ?" : ""}
      ORDER BY cc.comp_id ASC, cc.clip_seq ASC
      LIMIT 1`,
    compId != null ? [vId, compId] : [vId],
  );
  return rows[0] ? Number(rows[0].start) : null;
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
      ORDER BY cp.comp_id DESC
      LIMIT 1`,
    [vId, since],
  );
  return rows[0] ? Number(rows[0].comp_id) : null;
}

/** 대시보드 요약 지표. */
export async function getSummary(): Promise<{ videos: number; composes: number; rendered: number }> {
  const [row] = await query<{ videos: number; composes: number; rendered: number }>(
    `SELECT
       (SELECT COUNT(*) FROM t_video v WHERE ${SBS_ONLY})                          AS videos,
       (SELECT COUNT(*) FROM t_compose cp JOIN t_video v ON v.v_id = cp.v_id
         WHERE ${SBS_ONLY})                                                        AS composes,
       (SELECT COUNT(*) FROM t_compose cp JOIN t_video v ON v.v_id = cp.v_id
         WHERE ${SBS_ONLY} AND cp.render_datetime IS NOT NULL)                     AS rendered`,
  );
  return { videos: Number(row.videos), composes: Number(row.composes), rendered: Number(row.rendered) };
}
