import { FileQuestion } from "lucide-react";
import StatusScreen from "@/components/StatusScreen";

/** `/v/[vid]/c/[cid]` 전용 404 — 편성이 삭제됐거나 없는 (v_id, comp_id) 조합으로 들어온 경우. */
export default function ComposeNotFound() {
  return (
    <StatusScreen
      icon={<FileQuestion className="h-6 w-6" aria-hidden />}
      title="편성을 찾을 수 없습니다"
      description="삭제되었거나 존재하지 않는 편성입니다. 편성 클립 목록에서 다른 결과를 확인해 보세요."
      actions={[
        { href: "/clips", label: "편성 클립 목록", primary: true },
        { href: "/", label: "대시보드" },
      ]}
    />
  );
}
