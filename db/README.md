# 数据库初始化

开发和生产唯一入口为 `init.sql`，适用于 PostgreSQL 16 + pgvector 的全新空库。脚本用一个事务创建最终表结构、约束、索引和必要基础配置；不包含增量迁移、迁移记录、历史业务数据、演示工单或默认 AI 服务。

表名和字段使用小写 snake_case。工作台使用 `workbench_*` 统一前缀，邮件缓存使用 `workbench_emails`，消息关联使用 `workbench_message_emails`。约束直接声明在表定义中；向量索引使用 HNSW，避免空库 IVFFlat 训练不足。

初始化保留开发者登录账号、基础选项和调试命令；AI 服务由管理员手动添加。`embedding_settings` 只保存当前向量服务指针，多个配置和加密密钥保存在 `embedding_profiles`。

旧版本跨数据库基线升级需先核对版本要求；本轮项目整理不修改数据库结构。全新安装步骤参见 [生产部署](../docs/deployment.md)。初始化脚本不会自动清空已有数据库。
