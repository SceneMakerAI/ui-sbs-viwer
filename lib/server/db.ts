/**
 * MariaDB 커넥션 풀 (mysql2/promise) — 운영 DB 접근 통로(접속정보는 env).
 *
 * ⚠️ 이 앱은 **읽기 전용**이다. 운영 DB 계정(sm_viewer)이 SELECT 권한만 갖기 때문에
 * INSERT/UPDATE/DELETE 헬퍼를 의도적으로 두지 않는다 — 렌더 결과 기록은 agent-compose 담당
 * (PAGES.md §10). 쓰기가 필요해지면 여기 헬퍼를 늘리기 전에 그 결정부터 다시 볼 것.
 *
 * server-only: API Route/server component 에서만 import. 클라이언트 번들 금지.
 */
import "server-only";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const { DB_HOST, DB_PORT, DB_USER, DB_PW, DB_NAME } = process.env;
    if (!DB_HOST || !DB_USER || !DB_PW || !DB_NAME) {
      throw new Error("DB 환경변수 누락 — .env.local 의 DB_HOST/DB_USER/DB_PW/DB_NAME 확인");
    }
    pool = mysql.createPool({
      host: DB_HOST,
      port: Number(DB_PORT ?? 13306),
      user: DB_USER,
      password: DB_PW,
      database: DB_NAME,
      connectionLimit: 5,
      charset: "utf8mb4",
      timezone: "+09:00",
    });
  }
  return pool;
}

/** 읽기/쓰기 공통 헬퍼 — 항상 파라미터 바인딩(`?`)으로 호출한다(문자열 연결 금지). */
export async function query<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await getPool().query(sql, params);
  return rows as T[];
}
