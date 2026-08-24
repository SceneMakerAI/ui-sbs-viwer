import { FileQuestion } from "lucide-react";
import StatusScreen from "@/components/StatusScreen";

/** `/v/[vid]` 전용 404 — 없는 v_id 이거나 노출 대상이 아닌 영상. */
export default function VideoNotFound() {
  return (
    <StatusScreen
      icon={<FileQuestion className="h-6 w-6" aria-hidden />}
      title="영상을 찾을 수 없습니다"
      description="존재하지 않는 영상입니다. 분석 완료 영상 목록에서 다시 골라 주세요."
      actions={[
        { href: "/videos", label: "분석 완료 영상", primary: true },
        { href: "/", label: "대시보드" },
      ]}
    />
  );
}
