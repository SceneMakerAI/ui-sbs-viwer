-- SBS 공개 뷰어 로그인 계정 테이블 (2026-08-19, 개인정보 미보유 방침으로 name 없음)
CREATE TABLE IF NOT EXISTS t_viewer_user (
  user_id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  login_id       VARCHAR(50) NOT NULL UNIQUE,
  pw_hash        VARCHAR(100) NOT NULL,             -- bcrypt
  must_change_pw TINYINT(1) NOT NULL DEFAULT 1,     -- 1=최초/재발급 비밀번호, 로그인 후 변경 강제
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  last_login     DATETIME NULL,
  reg_datetime   DATETIME NOT NULL DEFAULT current_timestamp()
) COMMENT='SBS 공개 뷰어 로그인 계정';

-- 계정 발급 예시 (해시는 발급 시점에 bcrypt로 생성 — 평문 비밀번호는 커밋 금지)
-- INSERT INTO t_viewer_user (login_id, pw_hash) VALUES ('sbs', '<bcrypt hash>');
-- 재발급: UPDATE t_viewer_user SET pw_hash='<new hash>', must_change_pw=1 WHERE login_id='sbs';
