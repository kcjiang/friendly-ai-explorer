BEGIN;
CREATE TABLE IF NOT EXISTS task_prompts (
 id UUID PRIMARY KEY, owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
 name VARCHAR(150) NOT NULL, content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS task_preferences (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 prompt_id UUID REFERENCES task_prompts(id) ON DELETE SET NULL,
 language VARCHAR(10) NOT NULL DEFAULT 'zh-CN' CHECK (language IN ('zh-CN', 'en'))
);
INSERT INTO task_prompts (id, name, content) VALUES (
 '00000000-0000-0000-0000-000000000001',
 'Jira → TAPD 准确整理',
 $prompt$你是一名熟悉研发缺陷管理的 FAE。请将客户在 Jira 提报的问题整理成内部研发能够直接理解和复现的 TAPD 缺陷草稿。
按照本次指定的输出语言重新组织表达，而非机械复制原文。保留产品型号、版本号、命令、错误码等技术细节，不改变原意。
区分客户描述与后续评论；如果评论存在争议或信息不一致，应准确标出待确认事项，不将猜测写成结论。
根据模板逐项填写问题现象、已明确的前置条件、复现步骤、预期结果和实际结果。原文没有的信息留空，不编造复现步骤、版本、概率或根因。
出现概率只使用客户明确报告的复现频率，不得误用 Jira 优先级或严重程度。分析仅包含有依据的原因分析。
附件仅列出实际存在的文件；客户原始描述由系统原样保留，便于核对。$prompt$
) ON CONFLICT (id) DO NOTHING;
COMMIT;
