-- t_compose 렌더 진행 상태 컬럼 추가 (2026-08-20)
--
-- 배경: `render_datetime` 만으로는 **완료/미완료** 두 가지밖에 말할 수 없다.
--       "지금 만드는 중"과 "만들다 실패함"과 "만든 적 없음"이 전부 NULL 로 뭉쳐서,
--       목록 배지가 셋을 다 "준비 중"으로 표시했다.
--
-- 값 규약(2026-08-20 확정) — **`t_code.result` 와 같은 규약**(1=진행중, 0=완료, -1=에러):
--   NULL = 렌더를 요청한 적 없음 (편성만 한 상태)
--      1 = 렌더 진행 중
--      0 = 렌더 성공  (이때 render_datetime 도 함께 기록)
--     -1 = 렌더 실패
--
-- 안전성: agent-compose 의 INSERT 는 컬럼명을 명시하고(compose_repo.py) 조회는 `SELECT *` 라
--         컬럼 추가만으로는 기존 코드가 깨지지 않는다(t_compose_render.sql 때 검증한 전제와 동일).
--
-- ⚠️ **순서 주의** — 뷰어가 이 컬럼을 SELECT 하므로, 이 DDL 을 **뷰어 배포보다 먼저** 적용할 것.
--    (sm_viewer 계정은 테이블 단위 SELECT 라 별도 GRANT 는 필요 없다.)

ALTER TABLE t_compose
  ADD COLUMN render_status TINYINT NULL
      COMMENT '렌더 상태. NULL=요청 없음, 1=진행 중, 0=성공, -1=실패' AFTER render_datetime;

-- 기존 데이터 백필 — 완료 시각이 있으면 성공이다.
-- (실측 2026-08-20: bumper_yn 과 render_datetime 이 항상 함께 채워져 있어
--  "요청했으나 미완료(-1 후보)" 인 행은 없다. 나머지는 NULL = 렌더한 적 없음.)
UPDATE t_compose SET render_status = 0 WHERE render_datetime IS NOT NULL;

-- 확인
SELECT render_status, COUNT(*) FROM t_compose GROUP BY render_status;
