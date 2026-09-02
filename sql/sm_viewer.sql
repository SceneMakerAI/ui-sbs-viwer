-- 공개 뷰어(sm-pub-02)용 읽기 전용 DB 계정
--
-- ⚠️ 실행에는 **전역 CREATE USER 권한**이 필요하다. `sm_db` 계정으로는 안 된다
--    (sm_db 는 `GRANT ALL ON sm_db.*` 뿐이라 1227 Access denied). sm-db-01 의 DB root 로 실행할 것.
--
-- <비밀번호> 자리는 sm-pub-02 의 /usr/service/ui-sbs-viwer/.env 의 DB_PW 와 **반드시 동일**해야 한다.

CREATE USER IF NOT EXISTS 'sm_viewer'@'192.168.0.%' IDENTIFIED BY '<비밀번호>';

GRANT SELECT ON sm_db.t_video          TO 'sm_viewer'@'192.168.0.%';
GRANT SELECT ON sm_db.t_compose        TO 'sm_viewer'@'192.168.0.%';
GRANT SELECT ON sm_db.t_compose_clip   TO 'sm_viewer'@'192.168.0.%';
GRANT SELECT ON sm_db.t_code           TO 'sm_viewer'@'192.168.0.%';
GRANT SELECT ON sm_db.t_category       TO 'sm_viewer'@'192.168.0.%';
GRANT SELECT ON sm_db.t_scene_baseball TO 'sm_viewer'@'192.168.0.%';
-- 2026-08-24 추가 — 팀명 출처가 여기로 옮겨왔다(아래 용도 표 참조). 이 GRANT 가 없으면
-- 편성 상세(/c/{comp_id})가 1142 Access denied 로 500 이 된다.
GRANT SELECT ON sm_db.t_frame_baseball_board_detail TO 'sm_viewer'@'192.168.0.%';

FLUSH PRIVILEGES;

SHOW GRANTS FOR 'sm_viewer'@'192.168.0.%';

-- ── 테이블별 용도 ──
--  t_video          영상 목록·상세 (is_sbs=1 필터)
--  t_compose        편성 목록·상세 (status_code 로 진행/완료/실패 판정)
--                   ⚠️ 2026-09-02 스키마 교체(agent-compose2): PK 가 (v_id, comp_id) 복합키가 되고
--                      render_datetime·render_status 컬럼이 **삭제**됐다. 렌더 완료 여부는
--                      status_code 로 알 수 없어(4000 이 편성 완료와 렌더 완료 공용) S3 존재로 본다.
--  t_compose_clip   클립 구간(start_sec·end_sec 정수 초)·이닝·태그
--                   ⚠️ score_before·score_after 는 삭제, tags 신설. PK 는 (v_id, comp_id, clip_seq).
--  t_code           상태코드 → 한국어 표기 (조인). t_video 뿐 아니라 **t_compose.status_code 조인에도
--                   쓴다**(2026-09-02~) — 이 GRANT 가 없으면 편성 목록·상세가 통째로 실패한다.
--  t_category       카테고리명 (조인)
--  t_scene_baseball 장면 메타 (현재 뷰어 직접 조회는 없음 — 향후 장면 표기용으로 유지)
--  t_frame_baseball_board_detail
--                   클립 카드의 팀명 판독 (kind='TEAM', txt = "KT 5: NC 1" 최빈 쌍)
--                   ⚠️ 예전 출처였던 t_scene_baseball.score 는 **컬럼이 삭제**됐다
--                      (vision3 migration_20260823i — 전이 원장 폐기).
--
-- 쓰기 권한은 주지 않는다. 렌더 결과 기록은 agent-compose 담당(PAGES.md §10).
-- 로그인 기능을 붙일 때 t_viewer_user 에 SELECT, UPDATE 를 추가한다.
--
-- 접속이 거부되면(1045) 호스트 매칭을 확인한다:
--   SELECT user, host FROM mysql.user WHERE user='sm_viewer';
