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

/** 편성 1건(`t_compose`). */
export interface Compose {
  compId: number;
  vId: number;
  /** 영상 제목 — 목록에서 맥락 표시용. */
  videoName?: string;
  query: string;
  /**
   * 요청한 상한 초(`t_compose.budget_sec`). 현재 화면에 표시하지는 않는다.
   * 2026-08-24 하루 사이 폐기→부활한 값이라 0 인 행(폐기 기간의 편성)이 섞여 있다.
   */
  budgetSec: number;
  status: string;
  /** 총 길이(초). */
  duration: number;
  clipCount: number;
  /** 렌더에 사용한 범퍼 설정. 재렌더 다이얼로그 기본값으로만 쓴다. */
  bumper: boolean;
  /** 렌더 완료 시각(ISO). null 이면 아직 렌더본이 없다 → 렌더 버튼 노출. */
  renderedAt: string | null;
  /**
   * 렌더 상태(`t_compose.render_status`) — null=요청 없음 · 1=진행 중 · 0=성공 · -1=실패.
   * `t_code.result` 와 같은 규약이다(1=진행중, 0=완료, -1=에러).
   * 기록 주체는 agent-compose 다(sql/t_compose_render_status.sql).
   */
  renderStatus: number | null;
  regDatetime: string;
}

/** 편성 안의 클립 1개(`t_compose_clip`). */
export interface Clip {
  seq: number;
  /** 원본 영상 기준 시작/끝(초). */
  start: number;
  end: number;
  labels: string | null;
  /** 이닝 표기(예: "6회초"). 세대마다 표기가 달라 화면에서는 `formatInning` 을 거쳐 쓴다. */
  inning: string | null;
  scoreBefore: string | null;
  scoreAfter: string | null;
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
