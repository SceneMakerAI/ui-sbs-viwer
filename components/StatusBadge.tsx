import { isBandComplete, isComposable, isErrorCode, isRunning } from "@/lib/domain/status";

/**
 * 영상 상태 배지. `t_code` 문구는 이미 sanitize 된 값이 넘어온다(videos 리포지토리).
 * 판정은 status_code 로만 한다 — `t_video.comment` 는 성공 후에도 옛 에러가 남아 있어 믿을 수 없다
 * (RESEARCH.md 실측).
 */
export default function StatusBadge({
  code,
  label,
}: {
  code: number | null;
  label?: string;
}) {
  let tone = "bg-surface-alt text-text-secondary";
  let text = label || "상태 미상";

  if (isErrorCode(code)) {
    tone = "bg-danger-soft text-danger";
    text = label || "처리 실패";
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
