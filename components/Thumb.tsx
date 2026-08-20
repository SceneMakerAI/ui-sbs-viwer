"use client";

import { useState } from "react";
import { Film } from "lucide-react";

/**
 * 영상 썸네일. 원본에서 뽑은 프레임을 `/api/thumb` 로 받아 보여준다.
 *
 * **실패해도 화면이 깨지지 않아야 한다** — 원본이 아직 없거나 추출이 실패하면
 * 깨진 이미지 아이콘 대신 대체 표시로 조용히 넘어간다. 썸네일은 필수 요소가 아니다.
 */
export default function Thumb({
  vId,
  compId,
  alt,
  className = "",
}: {
  vId: number;
  compId?: number;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = compId != null ? `/api/thumb/${vId}?c=${compId}` : `/api/thumb/${vId}`;

  return (
    <span className={`relative flex items-center justify-center overflow-hidden bg-ink-soft ${className}`}>
      {failed ? (
        <Film className="h-6 w-6 text-on-dark-dim" aria-hidden />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- 서버가 이미 480px로 만든 JPEG이라 최적화 불필요
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}
