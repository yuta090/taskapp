import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  devIndicators: {
    position: 'bottom-right',
  },
  outputFileTracingRoot: resolve(__dirname),
};

export default nextConfig;
