import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "bottom-right",
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
