import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 서버 전용 패키지(mysql2)는 번들링하지 않고 런타임에서 require
  serverExternalPackages: ["mysql2"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // AGENTS.md/CLAUDE.md 자동 생성 끄기 — 지침은 README.md 로 관리한다.
  agentRules: false,
};

export default nextConfig;
