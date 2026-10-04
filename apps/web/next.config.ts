import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.SMARTRETAIL_NEXT_DIST_DIR
    ?? (process.env.E2E_TEST_MODE === "true" ? ".next-e2e" : ".next"),
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  experimental: { optimizePackageImports: ["lucide-react", "recharts"] },
};

export default nextConfig;
