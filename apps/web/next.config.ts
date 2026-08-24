import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@tanys/video-engine", "@tanys/design-tokens"],
};

export default nextConfig;
