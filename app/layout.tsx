import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import Header from "@/components/Header";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-kr",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SceneMaker",
  description: "경기 영상에서 원하는 장면만 골라 클립으로 편성합니다.",
  // 고객 전용 화면 — 검색 노출 차단
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={notoSansKr.variable}>
      <body className="min-h-screen bg-surface text-text-primary antialiased">
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}
