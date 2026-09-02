/**
 * 화면·API 공용 타입.
 *
 * ⚠️ **`is_sbs` 는 이 파일에 등장하지 않는다.** 고객사는 그런 컬럼이 있다는 사실 자체를 알 필요가 없다
 * (PAGES.md). 필터는 서버 SQL 에서만 적용하고, 어떤 응답 JSON·타입·에러 메시지에도 싣지 않는다.
 */

import type { StageKey, StageState } from "@/lib/domain/status";

/** 영상 1건 — 목록·상세 공용. */
export interface Video {
  vId: number;
  name: string;
  /** 재생 길이(초). */
  playTime: number;
  cateId: number | null;
  cateName: string | null;
  statusCode: number | null;
  /** t_code 표시명(금지어 치환 완료). */
  statusName: string;
  /** t_code 설명(금지어 치환 완료). */
  statusDesc: string;
  /** 등록 시각(ISO). */
  regDatetime: string;
  /** 이 영상으로 만든 편성 건수. */
  composeCount: number;
}

/** 파이프라인 진행 표시용. */
export interface StageView {
  key: StageKey;
  label: string;
  summary: string;
  state: StageState;
}

/**
 * 편성 1건(`t_compose`).
 *
 * ⚠️ 2026-09-02 상류 스키마 교체(agent-compose2) — **`comp_id` 는 더 이상 전역 유일이 아니다.**
 * `t_compose` 의 PK 가 `(v_id, comp_id)` 로 바뀌었고 comp_id 는 **영상 안에서 1부터** 매겨진다.
 * 그래서 편성을 가리킬 때는 **항상 `vId` 와 `compId` 를 함께** 넘겨야 한다(주소·API·큐 키 전부).
 * compId 만으로 조회하면 다른 영상의 편성이 섞인다.
 */
export interface Compose {
  compId: number;
  vId: number;
  /** 영상 제목 — 목록에서 맥락 표시용. */
  videoName?: string;
  query: string;
  /**
   * 요청한 상한 초(`t_compose.budget_sec`). 현재 화면에 표시하지는 않는다.
   * 미지정이면 null 이다(절단 없음) — 예전 스키마의 0 과 달리 NULL 을 허용한다.
   */
  budgetSec: number | null;
  /**
   * 편성 상태코드(`t_compose.status_code` → `t_code` 4000번대).
   * 4000 완료 · 4001 빈 편성 · 4010~4050 진행 · 4900~4960 실패.
   * 판정은 `lib/domain/compose-state.ts` 한 곳에서만 한다.
   */
  statusCode: number;
  /** t_code 표시명(금지어 치환 완료). */
  statusName: string;
  /** t_code 설명(금지어 치환 완료). */
  statusDesc: string;
  /** 총 길이(초) — `t_compose.duration_sec`. */
  duration: number;
  clipCount: number;
  /** 렌더에 사용한 범퍼 설정(`bumper_yn` 'Y'/'N'). 재렌더 다이얼로그 기본값으로만 쓴다. */
  bumper: boolean;
  regDatetime: string;
}

/**
 * 편성 안의 클립 1개(`t_compose_clip`).
 *
 * ⚠️ 2026-09-02 스키마 교체 — 구간이 `start_time`/`end_time` TIME(3) 에서
 * **`start_sec`/`end_sec` 정수 초**로 바뀌었다(TIME_TO_SEC 변환이 더는 필요 없다).
 * `score_before`/`score_after` 는 **삭제**됐고 `tags`(전광판 사건 태그)가 새로 생겼다.
 */
export interface Clip {
  seq: number;
  /** 원본 영상 기준 시작/끝(초). */
  start: number;
  end: number;
  /** 장면 번호(`t_scene_baseball.scene_no`). */
  sceneNo: number;
  /** 전광판 사건 태그 콤마 구분(예: "아웃,주자2루"). */
  tags: string | null;
  labels: string | null;
  /** 이닝 표기(예: "6회초"). 세대마다 표기가 달라 화면에서는 `formatInning` 을 거쳐 쓴다. */
  inning: string | null;
}

/** 편성 진행 상황(agent-compose 폴링 중계). */
export interface ComposeJob {
  jobId: string;
  status: "running" | "done" | "error";
  /** 진행 단계 문구(금지어 치환 완료). */
  progress: string[];
  compId?: number;
  error?: string;
}

/**
 * 편성 클립 목록의 "영상 묶어 보기" 한 줄 — 영상 1개 + 그 영상의 편성 집계.
 * 조회는 `lib/server/composes.ts` 의 `listVideoGroups()`(PAGES.md §2-3).
 */
export interface VideoGroup {
  vId: number;
  name: string;
  /** 원본 길이(초). */
  playTime: number;
  cateName: string | null;
  regDatetime: string;
  /** 이 영상의 전체 편성 건수. */
  composeCount: number;
  /**
   * 편성이 정상 완료(status_code 4000)된 건수.
   *
   * ⚠️ 예전엔 "렌더본까지 준비된 건수"였으나 `render_datetime`·`render_status` 컬럼이
   * 삭제돼 **DB 만으로는 mp4 존재를 알 수 없다**(2026-09-02). 목록에서 영상마다 S3 를
   * 조회할 수는 없으므로 여기서는 **편성 완료 건수**만 말하고, 화면 문구도 그렇게 쓴다.
   */
  readyCount: number;
  /** 검색어에 걸린 편성 건수. 검색이 없으면 composeCount 와 같다. */
  matchCount: number;
  /** 마지막 편성 시각(ISO). 편성이 없으면 null. */
  lastComposeAt: string | null;
}
