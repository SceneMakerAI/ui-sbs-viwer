import { Info, Upload } from "lucide-react";
import { PIPELINE_STAGES } from "@/lib/domain/status";

export const metadata = { title: "업로드 · SceneMaker" };

/**
 * 업로드 페이지 — **비활성 전시**(PAGES.md §1-F).
 * 실제 제출은 막되 화면은 실제처럼 보여준다. 파이프라인 4단계 도식은 과제 설명 자료 역할도 한다.
 */
export default function UploadPage() {
  return (
    <div className="mx-auto max-w-[900px] space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">업로드</h1>
        <p className="mt-2 text-sm text-text-secondary">
          경기 영상을 올리면 분석을 거쳐 장면을 골라낼 수 있게 됩니다.
        </p>
      </div>

      <p className="flex items-start gap-2 rounded border border-brand-blue/30 bg-brand-blue-soft px-4 py-3 text-sm text-brand-blue">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          현재 업로드는 비활성화 중입니다.
        </span>
      </p>

      <div
        aria-disabled="true"
        className="flex flex-col items-center rounded-lg border-2 border-dashed border-line bg-surface-alt px-6 py-14 text-center opacity-60"
      >
        <Upload className="h-8 w-8 text-text-muted" aria-hidden />
        <p className="mt-4 text-sm font-bold">영상 파일을 끌어다 놓으세요</p>
        <p className="mt-1 text-xs text-text-muted">MP4 형식 · 최대 20GB</p>
        <button
          type="button"
          disabled
          className="mt-5 cursor-not-allowed rounded bg-text-muted px-5 py-2.5 text-sm font-bold text-on-dark"
        >
          파일 선택
        </button>
      </div>

      <section>
        <h2 className="text-lg font-bold">업로드 후 이렇게 처리됩니다</h2>
        <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE_STAGES.map((stage, i) => (
            <li key={stage.key} className="rounded-lg border border-line p-4">
              <span className="text-xs font-bold text-brand-blue">STEP {i + 1}</span>
              <p className="mt-2 text-sm font-bold">{stage.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{stage.summary}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
