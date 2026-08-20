import { AlertTriangle, Check, Circle, Loader2 } from "lucide-react";
import { PIPELINE_STAGES, stageStates } from "@/lib/domain/status";

/**
 * 파이프라인 4단계 진행 패널.
 * 단계 표기는 우리가 소유한다 — 내부 명칭(STT·자막 추출·장면 인지)을 노출하지 않는다(PAGES.md §2-2).
 */
export default function PipelinePanel({ statusCode }: { statusCode: number | null }) {
  const states = stageStates(statusCode);

  return (
    <section className="rounded-lg bg-surface-alt p-5">
      <h2 className="text-sm font-bold">분석 진행 상황</h2>

      <ol className="mt-4 space-y-4">
        {PIPELINE_STAGES.map((stage) => {
          const state = states[stage.key];
          const icon =
            state === "done" ? (
              <Check className="h-4 w-4 text-brand-blue" aria-hidden />
            ) : state === "active" ? (
              <Loader2 className="h-4 w-4 animate-spin text-brand-blue" aria-hidden />
            ) : state === "error" ? (
              <AlertTriangle className="h-4 w-4 text-danger" aria-hidden />
            ) : (
              <Circle className="h-4 w-4 text-text-muted" aria-hidden />
            );

          return (
            <li key={stage.key} className="flex gap-3">
              <span className="mt-0.5 shrink-0">{icon}</span>
              <span className="min-w-0">
                <span
                  className={`block text-sm font-bold ${
                    state === "pending" ? "text-text-muted" : state === "error" ? "text-danger" : ""
                  }`}
                >
                  {stage.label}
                </span>
                <span className="mt-0.5 block text-xs text-text-muted">{stage.summary}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
