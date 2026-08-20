/**
 * 편성 길이 선택지.
 *
 * ⚠️ `budget` 은 **목표가 아니라 상한**이다 — 900초로 요청한 편성이 311초로 나온 실측이 있다.
 * 그래서 화면 문구는 "최대 N분"으로 쓴다(PAGES.md §1-C).
 */
export const BUDGET_OPTIONS = [
  { sec: 300, label: "5분" },
  { sec: 600, label: "10분" },
  { sec: 900, label: "15분" },
  { sec: 1200, label: "20분" },
] as const;

export const DEFAULT_BUDGET_SEC = 600;

export function isValidBudget(sec: number): boolean {
  return BUDGET_OPTIONS.some((o) => o.sec === sec);
}
