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

FLUSH PRIVILEGES;

SHOW GRANTS FOR 'sm_viewer'@'192.168.0.%';

-- ── 테이블별 용도 ──
--  t_video          영상 목록·상세 (is_sbs=1 필터)
--  t_compose        편성 목록·상세 (render_datetime 으로 렌더 여부 판정)
--  t_compose_clip   클립 구간·이닝·스코어
--  t_code           상태코드 → 한국어 표기 (조인)
--  t_category       카테고리명 (조인)
--  t_scene_baseball 클립 카드의 팀명 파싱 (score = "KT 0-0 NC")
--
-- 쓰기 권한은 주지 않는다. 렌더 결과 기록은 agent-compose 담당(PAGES.md §10).
-- 로그인 기능을 붙일 때 t_viewer_user 에 SELECT, UPDATE 를 추가한다.
--
-- 접속이 거부되면(1045) 호스트 매칭을 확인한다:
--   SELECT user, host FROM mysql.user WHERE user='sm_viewer';
