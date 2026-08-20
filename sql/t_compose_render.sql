-- t_compose 렌더 관련 컬럼 추가 (2026-08-19)
-- 목적: ① 범퍼 설정을 편성에 보존해 재렌더 시 재사용 ② 렌더 완료 여부로 중복 렌더 차단
-- 안전성: agent-compose 의 INSERT 는 컬럼명을 명시하므로(compose_repo.py) 컬럼 추가에 영향 없음.
--         조회는 `SELECT *` 라 새 컬럼이 응답에 추가로 실릴 뿐, 기존 키는 그대로다.

ALTER TABLE t_compose
  ADD COLUMN bumper_yn       TINYINT(1) NOT NULL DEFAULT 1
      COMMENT '이닝 사이 범퍼 삽입 여부(렌더 옵션)' AFTER clip_cnt,
  ADD COLUMN render_datetime DATETIME NULL
      COMMENT '렌더 완료 시각. NULL=미렌더 → 렌더 가능, NOT NULL=완료 → 중복 렌더 차단' AFTER bumper_yn;

-- 기존 렌더 완료분 백필 (S3 result/ 산출물 기준)
UPDATE t_compose SET render_datetime = '2026-08-18 20:30:38' WHERE comp_id = 6;
UPDATE t_compose SET render_datetime = '2026-08-19 16:57:16' WHERE comp_id = 10;
