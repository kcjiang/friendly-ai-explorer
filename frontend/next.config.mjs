import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // A routed AI request can take two 300s attempts plus transport overhead.
  experimental: { proxyTimeout: 660_000 },
  // 同源 API 代理；生产环境的 /api/v1/ 优先由 Nginx 直接转发。
  // 生产构建使用固定的 Docker 服务名 backend，浏览器不访问内部地址。
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${process.env.BACKEND_URL ?? "http://localhost:8000"}/api/v1/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
