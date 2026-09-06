import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["agentpm-core"],
  devIndicators: {
    position: "bottom-right",
  },
  async rewrites() {
    return [
      // 静的LP: public/lp<N>/index.html を /lp<N> で配信する（lp1=税理士, lp2=社労士, ...）
      {
        source: "/lp:id(\\d+)",
        destination: "/lp:id/index.html",
      },
    ];
  },
  async redirects() {
    return [
      // 学びのメディア「TASK6」への引っ越し（docs/blog/MEDIA_DESIGN.md）。
      // 旧 /blog のURLを外部リンク・検索結果ごと /task6 へ 301 で引き継ぐ。
      {
        source: "/blog",
        destination: "/task6",
        permanent: true,
      },
      {
        source: "/blog/:slug",
        destination: "/task6/:slug",
        permanent: true,
      },
      // 看板ドメイン task6.jp → 本体 agentpm.app/task6（SEO評価を一箇所に集約）。
      // Vercel 側で task6.jp / www.task6.jp をこのプロジェクトに追加すると効く。
      {
        source: "/",
        has: [{ type: "host", value: "task6.jp" }],
        destination: "https://agentpm.app/task6",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "task6.jp" }],
        destination: "https://agentpm.app/task6/:path*",
        permanent: true,
      },
      {
        source: "/",
        has: [{ type: "host", value: "www.task6.jp" }],
        destination: "https://agentpm.app/task6",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.task6.jp" }],
        destination: "https://agentpm.app/task6/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // GTM(gtm.js) と、GTM が読み込む GA4(gtag.js) を許可
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://www.googletagmanager.com https://*.googletagmanager.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              // GTM のコンテナ取得と GA4 の計測送信先（GTM に GA4 以外のタグを足すときはここにも追加する）
              `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} https://*.supabase.co wss://*.supabase.co https://www.googletagmanager.com https://*.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com`,
              // GTM の noscript フォールバック(iframe)
              "frame-src 'self' https://vercel.live https://www.googletagmanager.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
