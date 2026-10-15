// Keys must match frontend/package.json versions (without the "v" prefix).
// Keep all published entries and insert new versions at the top (newest first).
export const releaseNotes: Record<string, { title: string; items: string[] }> =
  {
    "0.2.0-dev.1": {
      title: "支持多模型调度与 AI 调试",
      items: [
        "新增 AI 服务管理，支持 Gemini 和 OpenAI 兼容接口，可按任务配置主备服务。",
        "优化本地 Qwen 模型兼容性，支持思考模式、结构化输出、超时与重试设置，提升任务的稳定性。",
        "新增管理后台应用日志，支持筛选、自动刷新及通过请求 ID 关联 AI 调用，方便排查问题。",
        "修复知识库向量模型失效问题，增加关键词检索回退、索引状态和手动重建索引，回答展示实际引用的知识库来源。",
      ],
    },
    "0.1.0-dev.3": {
      title: "新增了一些实用功能",
      items: [
        "新增客户、产品和项目资料库，支持关联选择、搜索、排序及创建与更新审计。",
        "优化工单页面交互体验，问题描述现支持 Markdown 格式。",
        "修复侧栏数据维护入口刷新闪烁问题，同时增加 GitHub Bug 提报入口。",
      ],
    },
    "0.1.0-dev.2": {
      title: "解决了一些已知问题",
      items: [
        "修复深色模式下 Logo 颜色异常的问题。(Bug #1)",
        "使用 shadcn/ui 重构登录页面。",
        "修复尾斜杠重定向问题，避免同源代理请求出现网络错误，并新增路由回归测试。",
        "开发环境统一使用 Node 22 和 pnpm 9.15.9。",
      ],
    },
    "0.1.0-dev.1": {
      title: "发布开发预览版",
      items: ["Docker 部署初始版本，包含前端、后端和数据库的基础功能。"],
    },
  };
