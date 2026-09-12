/** @type {import('next').NextConfig} */
const nextConfig = {
  // 开发环境：将 /api/v1/* 代理到 FastAPI 后端
  // 生产环境由 Nginx 负责，此配置不生效
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${process.env.BACKEND_URL ?? "http://localhost:8000"}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
