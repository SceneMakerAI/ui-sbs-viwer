/**
 * 경량 서버 로거 — 제로 의존성(외부 로깅 라이브러리 없이 node 기본 fs 만 사용).
 * 출력 대상:
 *   · 콘솔(항상) — systemd 의 journal 로 수집되므로 LOG_FILE 미설정이어도 흔적은 남는다.
 *   · 파일(LOG_FILE 설정 시) — 'a'(append) 모드 단일 WriteStream 공유. 절대경로 권장
 *     (systemd `next start` 의 cwd 가 불분명 → 상대경로는 엉뚱한 위치에 생긴다).
 * 설계 원칙:
 *   · 로깅은 절대 요청 경로로 예외를 던지지 않는다 — 파일 쓰기 실패(권한/디스크/잘못된 경로)는
 *     콘솔 전용으로 자동 강등(degrade)하고 요청은 그대로 진행시킨다.
 *   · 시크릿(DB_PW·AWS 키 등) 금지 — 호출부가 meta 에 통째로 객체/env 를 넘기지 않도록 주의.
 * server-only: 클라이언트 번들 금지.
 */
import "server-only";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// LOG_LEVEL 미설정/오타 시 info. 이 레벨 미만은 출력하지 않는다.
const threshold = ORDER[(process.env.LOG_LEVEL as Level) in ORDER ? (process.env.LOG_LEVEL as Level) : "info"];

// 파일 스트림 지연 초기화(db.ts 풀과 동일한 단일 인스턴스 패턴).
//   undefined = 아직 시도 안 함 / null = 미설정 또는 쓰기 실패로 콘솔 전용 강등 / WriteStream = 활성.
let stream: WriteStream | null | undefined;

function getStream(): WriteStream | null {
  if (stream !== undefined) return stream;
  const path = process.env.LOG_FILE;
  if (!path) return (stream = null); // 파일 미설정 → 콘솔 전용
  try {
    mkdirSync(dirname(path), { recursive: true }); // createWriteStream 은 상위 디렉토리를 안 만든다
    const s = createWriteStream(path, { flags: "a" });
    // 쓰기 도중 오류(디스크 풀·권한 등) → 1회 경고 후 콘솔 전용으로 강등. 요청에는 영향 없음.
    s.on("error", (e) => {
      stream = null;
      console.error(`[log] 파일 로깅 비활성화(쓰기 오류) — 콘솔 전용 전환: ${String(e)}`);
    });
    return (stream = s);
  } catch (e) {
    console.error(`[log] LOG_FILE 초기화 실패 — 콘솔 전용: ${String(e)}`);
    return (stream = null);
  }
}

/** meta 직렬화 — 순환참조 등으로 실패해도 로깅이 죽지 않도록 방어. */
function fmtMeta(meta?: Record<string, unknown>): string {
  if (!meta) return "";
  try {
    return " " + JSON.stringify(meta);
  } catch {
    return " [meta 직렬화 실패]";
  }
}

function emit(level: Level, scope: string, message: string, meta?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${fmtMeta(meta)}`;
  // 콘솔: warn/error 는 stderr, 그 외 stdout.
  (level === "warn" || level === "error" ? console.error : console.log)(line);
  getStream()?.write(line + "\n");
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** scope(모듈/도메인 태그)를 묶은 로거를 만든다. 예: `const log = createLogger("stt")`. */
export function createLogger(scope: string): Logger {
  return {
    debug: (m, meta) => emit("debug", scope, m, meta),
    info: (m, meta) => emit("info", scope, m, meta),
    warn: (m, meta) => emit("warn", scope, m, meta),
    error: (m, meta) => emit("error", scope, m, meta),
  };
}
