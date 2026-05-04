import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 生产打包成 standalone：next build 后产出 .next/standalone/server.js，
  // 部署只需要 cp .next/standalone + .next/static + public，节省 ~80% 体积，
  // systemd 直接 node server.js 启动。dev 不影响。
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080/api"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
