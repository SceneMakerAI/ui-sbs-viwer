import { isBandComplete, isComposable, isErrorCode, isRunning } from "@/lib/domain/status";

/**
 * 영상 상태 배지. `t_code` 문구는 이미 sanitize 된 값이 넘어온다(videos 리포지토리).
 * 판정은 status_code 로만 한다 — `t_video.comment` 는 성공 후에도 옛 에러가 남아 있어 믿을 수 없다
 * (RESEARCH.md 실측).
 */
export default function StatusBadge({
  code,
  label,
  /**
   * `simple` 은 파이프라인 단계를 숨기고 **업로드 중 / 업로드 완료** 두 가지로만 말한다.
   * 목록 카드용이다 — "장면 발행 중", "증거 색인 중" 같은 내부 진행 단계는
   * 훑어보는 화면에서 알 필요가 없다. 자세한 단계는 상세 화면에서 보여준다.
   */
  variant = "detail",
}: {
  code: number | null;
  label?: string;
  variant?: "detail" | "simple";
}) {
  const simple = variant === "simple";
  let tone = "bg-surface-alt text-text-secondary";
  let text = (simple ? "" : label) || "상태 미상";

  if (isErrorCode(code)) {
    tone = "bg-danger-soft text-danger";
    // 실패까지 "업로드 중"으로 뭉개면 영영 기다리게 된다 — 실패는 실패로 알린다.
    text = (simple ? "" : label) || "처리 실패";
  } else if (simple) {
    tone = "bg-brand-blue-soft text-brand-blue";
    // 완료 기준은 "편성할 수 있는가" — 편성·렌더대(4000~)까지 왔으면 이미 완료다.
    text = isComposable(code) ? "업로드 완료" : "업로드 중";
  } else if (isRunning(code)) {
    tone = "bg-brand-blue-soft text-brand-blue";
    text = label || "분석 중";
  } else if (isComposable(code) && isBandComplete(code)) {
    tone = "bg-brand-blue-soft text-brand-blue";
    text = label || "분석 완료";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
      <span className="block h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  );
}
