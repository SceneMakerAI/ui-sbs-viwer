/**
 * S3 읽기 전용 접근 — 원본 영상 재생과 렌더 산출물 재생·내려받기용 presigned GET 만 제공한다.
 * 이 앱은 S3 에 쓰지 않는다(업로드 기능은 비활성 전시).
 *
 * 키 규칙(실측):
 *   · 원본  : `vod/{v_id % 50}/{v_id}.{ext}`  — `t_video.dir` 에 `{shard}/{v_id}.{ext}` 만 저장돼 있다
 *   · 렌더본: `result/{v_id}/{v_id}_{comp_id}.mp4`
 *
 * server-only. 자격증명: 로컬 dev 는 AWS_PROFILE(mfa), 운영은 EC2 인스턴스 롤.
 */
import "server-only";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client: S3Client | undefined;

export function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.AWS_REGION,
      // SDK v3(>=3.729)의 기본 CRC32 체크섬 강제는 presigned URL 사용을 방해한다 — 필요할 때만으로.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

function bucket(): string {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET 환경변수 누락 — .env.local 확인");
  return b;
}

/**
 * presigned URL 유효시간(초).
 *
 * 내려받기와 재생의 요구가 다르다:
 *   · **내려받기**는 짧게 — 유출돼도 금방 죽어야 한다(PAGES.md §6).
 *   · **재생**은 길게 — `<video>` 는 탐색·버퍼링 때마다 새 range 요청을 보낸다.
 *     원본이 3시간 45분짜리라 짧은 TTL 이면 재생 도중(특히 뒤쪽 클립으로 이동할 때) 403 이 난다.
 */
function ttl(kind: "play" | "download"): number {
  return kind === "download"
    ? Number(process.env.S3_PRESIGN_TTL ?? 600)
    : Number(process.env.S3_PLAY_TTL ?? 3600);
}

/** 렌더 산출물 키. */
export function renderKey(vId: number, compId: number): string {
  return `result/${vId}/${vId}_${compId}.mp4`;
}

/** 원본 영상 키 — `t_video.dir` 값(`{shard}/{v_id}.{ext}`)에 `vod/` 를 붙인다. */
export function sourceKey(dir: string): string {
  return `vod/${dir.replace(/^\/+/, "")}`;
}

/**
 * presigned GET 발급.
 * @param download 지정하면 `Content-Disposition: attachment; filename=...` 을 씌운다.
 *                 파일명은 **서버가 정한 값만** 넘길 것(사용자 입력 금지 — PAGES.md §6).
 */
export async function presignGet(key: string, download?: string): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    // 워커가 Content-Type 없이 올려 binary/octet-stream 이라 재생되도록 덮어쓴다.
    ResponseContentType: "video/mp4",
    ...(download ? { ResponseContentDisposition: `attachment; filename="${download}"` } : {}),
  });
  return getSignedUrl(getClient(), cmd, { expiresIn: ttl(download ? "download" : "play") });
}

/**
 * 응답 헤더 오버라이드 **없는** presigned GET — ffmpeg 등 서버측 도구용.
 *
 * ⚠️ `presignGet` 은 `response-content-type` 을 붙이는데, ffmpeg 로 열면 400 이 난다(실측).
 * 브라우저 재생에는 그 오버라이드가 필요하지만 서버측 읽기에는 불필요하므로 분리한다.
 */
export async function presignRaw(key: string, expiresIn = 900): Promise<string> {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn });
}

/** 객체 존재 여부. 없으면 false(404 를 예외로 올리지 않는다). */
export async function exists(key: string): Promise<boolean> {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch {
    return false;
  }
}
