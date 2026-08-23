/**
 * 편성 길이 선택지.
 *
 * ⚠️ **의미가 바뀌었다(2026-08-24, agent-compose `0d95b9f`).** 예전 `budget` 은 채우기도 하는
 * 소프트 목표라 900초 요청이 311초로 나오는 일이 있었다. 지금 `budget_sec` 은
 * **덜어내기 전용 상한**이다:
 *   · `finish` 노드가 `rank.fit_budget` 으로 중요도(score) 높은 클립부터 담다가 넘치면 버린다.
 *   · **모자라면 모자란 대로 둔다** — 예산을 채우려고 선곡에 없던 장면을 끌어오지 않는다
 *     (그 통로였던 `fill_budget` 은 폐기됐고 다시 열지 않기로 한 결정이다).
 *   · 최소 1건은 남는다. 반환은 시간순이라 편성은 경기 흐름대로 돈다.
 *   · 값을 안 보내면(`null`) 절단하지 않는다.
 * 그래서 화면 문구는 여전히 "최대 N분"이되, 이제는 **실제로 지켜지는 상한**이다.
 *
 * 필드명도 바뀌었다 — agent 로 보낼 때는 `budget`(구) 이 아니라 **`budget_sec`** 이다.
 */
export const BUDGET_OPTIONS = [
  { sec: 300, label: "5분" },
  { sec: 600, label: "10분" },
  { sec: 900, label: "15분" },
  { sec: 1200, label: "20분" },
] as const;

export const DEFAULT_BUDGET_SEC = 600;

// 값 검증은 `app/api/compose/route.ts` 의 zod literal union 이 한다 — 여기 헬퍼를 따로 두면
// 검증 지점이 둘로 갈린다(구 `isValidBudget` 은 아무도 부르지 않아 지웠다).
