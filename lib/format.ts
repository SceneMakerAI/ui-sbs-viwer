/** 표시용 포맷터 — 서버·클라이언트 공용(순수 함수만). */

/** 초 → "5분 11초" / "1시간 3분". 0 이하는 "-". */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "-";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  if (m > 0) return r > 0 ? `${m}분 ${r}초` : `${m}분`;
  return `${r}초`;
}

/** 초 → "1:23:45" / "5:11" (플레이어 타임코드). */
export function formatTimecode(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

/** ISO → "2026.08.19". */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 이닝 표기 정규화 — DB 는 "5_top" / "7_bot" 형태로 저장한다.
 * 규칙 밖 값은 원문을 그대로 돌려준다(임의 해석하지 않는다).
 */
export function formatInning(inning: string | null | undefined): string | null {
  if (!inning) return null;
  const m = inning.match(/^(\d+)_(top|bot)$/i);
  if (!m) return inning;
  return `${m[1]}회${m[2].toLowerCase() === "top" ? "초" : "말"}`;
}

/** "3:2" 형태의 스코어 전후를 "1:0 → 3:0" 으로. 한쪽이 없으면 있는 쪽만. */
export function formatScoreChange(before: string | null, after: string | null): string | null {
  if (before && after && before !== after) return `${before} → ${after}`;
  return after ?? before ?? null;
}

export interface Teams {
  /** 원정(스코어 앞 숫자). */
  away: string;
  /** 홈(스코어 뒤 숫자). */
  home: string;
}

/**
 * "2-0" + 팀명 → "KT 2 : 0 NC".
 * 팀명을 모르거나 형식이 다르면 원문을 그대로 돌려준다(임의 해석하지 않는다).
 */
export function formatScoreWithTeams(score: string | null | undefined, teams: Teams | null): string | null {
  if (!score) return null;
  const m = score.match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m || !teams) return score;
  return `${teams.away} ${m[1]} : ${m[2]} ${teams.home}`;
}
