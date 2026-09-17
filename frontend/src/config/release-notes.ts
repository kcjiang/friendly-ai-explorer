// Keys must match frontend/package.json versions (without the "v" prefix).
// Keep all published entries and insert new versions at the top (newest first).
export const releaseNotes: Record<string, { title: string; items: string[] }> = {
  "0.1.0-dev.2": {
    title: "解决了一些已知问题",
    items: [
      "修复深色模式下 Logo 颜色异常的问题。(Bug #1)",
      "使用 shadcn/ui 重构登录页面。",
      "修复尾斜杠重定向问题，避免同源代理请求出现网络错误，并新增路由回归测试。",
      "开发环境统一使用 Node 22 和 pnpm 9.15.9。"
    ],
  },
  "0.1.0-dev.1": {
    title: "发布开发预览版",
    items: [
      "Docker 部署初始版本，包含前端、后端和数据库的基础功能。"
    ],
  },
};
