import { Compass } from "lucide-react";
import StatusScreen from "@/components/StatusScreen";

/** 전역 404 — 위 경로에 해당하지 않는 주소. */
export default function NotFound() {
  return (
    <StatusScreen
      icon={<Compass className="h-6 w-6" aria-hidden />}
      title="페이지를 찾을 수 없습니다"
      description="주소가 잘못되었거나 삭제된 페이지입니다."
      actions={[{ href: "/", label: "대시보드로 가기", primary: true }]}
    />
  );
}
