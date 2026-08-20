/**
 * 카테고리(`t_category`) 상수.
 * 트리는 DB 에 있지만, **분석 지원 여부**는 DB 에 없는 정보라 여기서 관리한다
 * (미지원 카테고리는 agent-vision 이 3901 로 거부한다 — RESEARCH.md §1-2).
 */

export const CATE = {
  NEWS: 1000,
  DOCU: 2000,
  DRAMA: 3000,
  ENTERTAINMENT: 4000,
  SPORTS: 5000,
  BASEBALL: 5100,
  SOCCER: 5200,
  TALK: 6000,
  ETC: 9000,
} as const;

/** 현재 분석 플로우가 준비된 카테고리. 나머지는 화면에서 "준비 중"으로 표기한다. */
export const SUPPORTED_CATEGORIES: readonly number[] = [CATE.BASEBALL];

export function isSupportedCategory(cateId: number | null | undefined): boolean {
  return cateId != null && SUPPORTED_CATEGORIES.includes(cateId);
}
