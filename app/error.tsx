"use client";

import { AlertTriangle } from "lucide-react";

/**
 * 예기치 못한 오류 화면(DB·S3 접속 실패 등).
 * **원인 문구를 화면에 그대로 내지 않는다** — 내부 호스트·계정 정보가 섞여 나올 수 있다.
 * 상세는 서버 로그에 남는다.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center sm:py-32">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="mt-6 text-xl font-bold tracking-tight sm:text-2xl">화면을 불러오지 못했습니다</h1>
      <p className="mt-3 text-sm leading-relaxed text-text-secondary">
        일시적인 문제일 수 있습니다. 다시 시도해도 같으면 담당자에게 문의해 주세요.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded bg-brand-blue px-5 py-3 text-sm font-bold text-on-dark transition-colors hover:bg-brand-blue-hover"
        >
          다시 시도
        </button>
        <a
          href="/"
          className="rounded border border-line px-5 py-3 text-sm font-bold text-text-secondary transition-colors hover:border-brand-blue hover:text-brand-blue"
        >
          대시보드
        </a>
      </div>
    </div>
  );
}
