# Friendly AI Explorer

[English](README.en.md) · 简体中文

面向 FAE 技术支持团队的工作平台，提供工单管理、知识库与 RAG、工作邮箱、AI 工作流，以及 WebUSB / Serial 设备调试。

界面支持英语与简体中文。默认采用浏览器首选语言，不支持的语言回退英语；手动选择通过会话 Cookie 保持。AI 新生成内容跟随界面语言，业务原文与已保存内容保持不变。

## 技术栈

- 前端：Next.js 15、React、TypeScript、Tailwind CSS 4、shadcn/ui。
- 后端：Python 3.11、FastAPI、SQLAlchemy，以及独立工作台任务进程。
- 数据库：PostgreSQL 16 + pgvector。
- 部署：Docker Compose、Nginx；前端运行于 Node.js 22。

## 本地启动

需要 Docker Engine / Docker Desktop 与 Docker Compose。在项目根目录复制配置模板：

```sh
cp .env.example .env
```

Windows PowerShell 可使用 `Copy-Item .env.example .env`。填写三个独立的随机密钥 `DB_PASSWORD`、`APP_MASTER_KEY`、`AUTH_SECRET`，然后执行：

```sh
docker compose -f docker-compose.yml up -d --build
```

访问 [本地应用](http://localhost:3000)。全新空库自动执行 `db/init.sql`；已有数据库内容不会因启动而被重建。首次登录账号为 `dev@kaicheng.me`，初始密码为 `123456`，登录后请修改密码并配置 AI 服务。

## 使用与部署

- [生产部署与配置](docs/deployment.md)
- [版本记录](docs/releases/CHANGELOG.md)
- [数据库初始化说明](db/README.md)

## 界面

![Dashboard](docs/images/dashboard.png)
![ADB Debug](docs/images/debug.png)

## 致谢与许可

前端起源于 [visactor-next-template](https://github.com/mengxi-ream/visactor-next-template)。保留原作者许可，见 [前端许可证](frontend/LICENSE)；项目许可见 [LICENSE](LICENSE)。
