import createNextIntlPlugin from "next-intl/plugin";
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Isolate validation builds from the running development server.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  // A routed AI request can take two 300s attempts plus transport overhead.
  experimental: { proxyTimeout: 660_000 },
  // 开发环境：将 /api/v1/* 代理到 FastAPI 后端
  // 生产环境由 Nginx 负责，此配置不生效
  // 生产镜像构建时固定 Docker 服务名，浏览器使用同源请求。
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: `${process.env.BACKEND_URL ?? "http://localhost:8000"}/uploads/:path*`,
      },
      {
        source: "/api/v1/:path*",
        destination: `${process.env.BACKEND_URL ?? "http://localhost:8000"}/api/v1/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
