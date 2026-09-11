# Friendly AI Explorer (FAE System)

<p align="center">🇨🇳 中文简体  |  <a title="English" href="./README_EN.md">🇬🇧 English</a></p>

## 1. 项目简介

**Friendly AI Explorer** 是一个面向 FAE 技术支持团队的 AI 驱动型工作与协作平台，旨在通过 AI 能力提升技术支持工作的效率。

### 核心功能

| 模块 | 说明 |
| --- | --- |
| 📊 Dashboard | 提供工单、任务及团队工作情况的可视化概览 |
| 🎫 Ticket Management | 支持客户问题与缺陷工单的创建、跟踪与管理 |
| 📚 Knowledge Base | 支持技术文档的管理、沉淀与检索 |
| 📩 Email Assistant | 支持工作邮箱 AI 托管 |
| 🛠️ OTT Debug | 移植了部分原 FAE 工具箱的调试功能（WebUSB / Serial） |
| 🤖 AI Engine | 支持 Gemini 等在线大模型以及基于 vLLM 部署的本地模型，并支持 RAG（检索增强生成） |

---

## 2. 技术栈

### Frontend

- React
- Tailwind CSS
- shadcn/ui

### Backend

- Python 3.11
- FastAPI
- Uvicorn
- SQLAlchemy 2.0
- Celery
- Redis

### Database

- PostgreSQL 16
- pgvector

---

## 3. Screenshots

### Dashboard

![Dashboard](./docs/images/dashboard.png)

### ADB Debug

![ADB Debug](./docs/images/debug.png)

---

## 4. Quick Start

克隆项目：

```bash
git clone https://github.com/kcjiang/friendly-ai-explorer.git
cd friendly-ai-explorer
```

使用 Docker Compose 构建并启动：

```bash
docker compose -f docker-compose.yml up -d --build
```

启动完成后，在浏览器中访问：

```text
http://localhost:3000
```

---

## 5. 贡献

欢迎参与 **Friendly AI Explorer** 的开发与改进。

如果你希望提交 Bug 修复、功能改进或其他贡献，请阅读：

[CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 6. 致谢

本项目的前端基于以下开源项目进行开发：

[visactor-next-template](https://github.com/mengxi-ream/visactor-next-template) · [Live Demo](https://visactor-next-template.vercel.app/)

感谢原项目作者及所有开源社区贡献者。