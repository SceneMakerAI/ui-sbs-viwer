"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import Thumb from "./Thumb";
import { formatDate, formatDuration } from "@/lib/format";
import { isComposable } from "@/lib/domain/status";
import type { Video } from "@/lib/types";

/**
 * `[새 편성]` → 영상 선택 다이얼로그.
 * 메뉴에서 "편성 클립"으로 들어온 사용자는 아직 영상을 고르지 않았다 —
 * 여기서 영상을 고르고 `/v/[vid]` 로 넘긴다(PAGES.md §2-1-1).
 *
 * 분석이 끝나지 않은 영상은 고를 수 없다(선택 시 편성이 실패하므로 사전에 막는다).
 */
export default function NewComposeDialog({ videos }: { videos: Video[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded bg-brand-blue px-4 py-2 text-sm font-bold text-on-dark transition-colors hover:bg-brand-blue-hover"
      >
        <Plus className="h-4 w-4" aria-hidden />
        새 편성
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-compose-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-surface">
            <div className="flex items-start justify-between gap-4 p-6 pb-4">
              <div>
                <h2 id="new-compose-title" className="text-lg font-bold">
                  어떤 영상으로 편성할까요?
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  분석이 끝난 영상만 고를 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="rounded p-1 text-text-muted hover:bg-surface-alt"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 pb-6">
              {videos.length === 0 && (
                <p className="rounded border border-line bg-surface-alt p-8 text-center text-sm text-text-secondary">
                  편성할 수 있는 영상이 아직 없습니다.
                </p>
              )}

              {videos.map((v) => {
                const ready = isComposable(v.statusCode);
                return (
                  <button
                    key={v.vId}
                    type="button"
                    disabled={!ready}
                    onClick={() => router.push(`/v/${v.vId}`)}
                    className={`flex w-full items-center gap-3 rounded border border-line p-3 text-left transition-colors ${
                      ready ? "hover:border-brand-blue" : "cursor-not-allowed opacity-50"
                    }`}
                  >
                    <Thumb vId={v.vId} alt="" className="aspect-video w-20 shrink-0 rounded" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{v.name}</span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {formatDate(v.regDatetime)}
                        {v.playTime > 0 && ` · ${formatDuration(v.playTime)}`}
                        {!ready && ` · ${v.statusName || "분석 중"}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
