/**
 * 영상 썸네일 — 원본 mp4 에서 프레임 1장을 뽑아 로컬에 캐시한다.
 *
 * **입력 시킹이 핵심이다.** `-ss` 를 `-i` **앞에** 두면 ffmpeg 가 presigned URL 에 HTTP Range 요청을
 * 보내 해당 지점 근처 수 MB 만 읽는다. 실측(10.4GB 원본): 어느 지점이든 0.8~1.1초.
 * `-ss` 를 뒤에 두면 처음부터 디코딩해 수십 분이 걸린다 — 순서를 바꾸지 말 것.
 *
 * 캐시는 파일 하나가 10~30KB라 사실상 무제한이다(30GB 디스크).
 * server-only.
 */
import "server-only";
import { spawn } from "node:child_process";
import { mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "./log";
import { presignRaw, sourceKey } from "./s3";
import { getVideoDir } from "./videos";

const log = createLogger("thumbs");

const CACHE_DIR = process.env.THUMB_CACHE_DIR ?? "./.cache/thumbs";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
/** 썸네일 가로 폭(px). 카드가 최대 320px 남짓이라 480이면 고해상도 화면까지 커버한다. */
const WIDTH = 480;
/** 추출 제한시간(ms) — 원본이 없거나 S3 가 느릴 때 요청이 매달리지 않게. */
const TIMEOUT_MS = 20_000;

/**
 * 동시 추출 제한. t3.small(2 vCPU)이라 목록 페이지에서 카드 12개가 한꺼번에 몰리면
 * 서로 CPU 를 뺏어 전부 느려진다. 2개씩 순차 처리한다.
 */
const MAX_CONCURRENT = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
}

function release(): void {
  running--;
  waiting.shift()?.();
}

/** 같은 썸네일을 동시에 여러 번 뽑지 않도록 진행 중인 작업을 공유한다. */
const inFlight = new Map<string, Promise<string | null>>();

function cachePath(vId: number, sec: number): string {
  return join(CACHE_DIR, `${vId}_${sec}.jpg`);
}

async function exists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.size > 0;
  } catch {
    return false;
  }
}

function runFfmpeg(url: string, sec: number, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // turbopackIgnore — FFMPEG 는 프로젝트 파일이 아니라 시스템 바이너리(env 로 지정)다.
    // 이 주석이 없으면 Turbopack 이 "동적 파일 접근"으로 보고 프로젝트 전체를 번들 추적에 포함시킨다.
    const p = spawn(/* turbopackIgnore: true */ FFMPEG, [
      "-nostdin",
      "-loglevel", "error",
      "-ss", String(sec),        // ⚠️ 반드시 -i 앞
      "-i", url,
      "-frames:v", "1",
      "-vf", `scale=${WIDTH}:-1`,
      "-q:v", "4",
      // 출력이 `.jpg.<pid>.tmp` 라 확장자로 포맷을 못 고른다 → 명시한다.
      "-f", "image2",
      "-y", out,
    ]);

    let err = "";
    p.stderr.on("data", (d) => {
      if (err.length < 500) err += String(d);
    });

    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("ffmpeg 시간 초과"));
    }, TIMEOUT_MS);

    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`ffmpeg 종료코드 ${code}: ${err.trim()}`));
    });
  });
}

/**
 * 썸네일 파일 경로를 돌려준다. 없으면 만들고, 실패하면 null.
 * 호출부는 null 을 404 로 처리하고 화면은 대체 표시로 넘어간다(썸네일은 필수 요소가 아니다).
 */
export async function getThumb(vId: number, sec: number): Promise<string | null> {
  const out = cachePath(vId, sec);
  if (await exists(out)) return out;

  const key = `${vId}_${sec}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = (async (): Promise<string | null> => {
    await acquire();
    try {
      if (await exists(out)) return out; // 대기 중에 다른 요청이 만들었을 수 있다
      const dir = await getVideoDir(vId);
      if (!dir) return null;

      await mkdir(CACHE_DIR, { recursive: true });
      // 임시 파일에 쓴 뒤 rename — 추출 도중 잘린 파일이 캐시로 남지 않게.
      const tmp = `${out}.${process.pid}.tmp`;
      // 응답 헤더 오버라이드가 붙은 URL 은 ffmpeg 가 열지 못한다(400) → presignRaw 사용.
      const url = await presignRaw(sourceKey(dir));

      const t0 = Date.now();
      await runFfmpeg(url, sec, tmp);
      await rename(tmp, out);
      log.info("썸네일 생성", { vId, sec, ms: Date.now() - t0 });
      return out;
    } catch (e) {
      log.warn("썸네일 생성 실패", { vId, sec, message: String(e) });
      return null;
    } finally {
      release();
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
}

/**
 * 이 영상의 대표 프레임 시각(초).
 *
 * 0초는 중계 오프닝·광고라 쓸모가 없다. 편성된 클립이 있으면 **첫 클립 시작 지점**을 쓴다 —
 * 실제 경기 장면이 보장된다. 없으면 10분 지점으로 둔다(경기 시작 직후).
 */
export const DEFAULT_SEC = 600;
