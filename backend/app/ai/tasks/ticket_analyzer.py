from sqlalchemy.ext.asyncio import AsyncSession
from app.ai.gemini_client import gemini
from app.ai.rag_engine import retrieve_context

ANALYZE_PROMPT = """你是一名资深的技术支持工程师（FAE），请分析以下客户工单，给出专业的技术支持建议。

工单信息：
- 标题：{title}
- 描述：{description}
- 产品型号：{product_name}
- 固件版本：{firmware_version}
- 客户名称：{customer_name}

相关知识库参考：
{context}

请按以下结构输出（使用 Markdown 格式）：

## 问题分析
简要分析问题的可能根因（2-3条）

## 排查步骤
分步骤列出具体排查方法

## 解决建议
给出优先推荐的解决方案

## 注意事项
列出处理此类问题需要注意的要点
"""


async def analyze_ticket(ticket: dict, db: AsyncSession) -> str:
    """
    AI 分析工单，结合知识库生成排查建议。
    ticket: 包含 title, description, product_name, firmware_version, customer_name 的字典
    """
    query = f"{ticket.get('title', '')} {ticket.get('description', '')}"
    context = await retrieve_context(query, db, top_k=4)

    prompt = ANALYZE_PROMPT.format(
        title=ticket.get("title") or "未填写",
        description=ticket.get("description") or "未填写",
        product_name=ticket.get("product_name") or "未填写",
        firmware_version=ticket.get("firmware_version") or "未填写",
        customer_name=ticket.get("customer_name") or "未填写",
        context=context or "（暂无相关知识库内容）",
    )

    return await gemini.chat(prompt)
