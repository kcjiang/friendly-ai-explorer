from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.rag_engine import build_prompt, retrieve_context
from app.ai.router import stream
from app.ai.tasks.ticket_analyzer import analyze_ticket
from app.ai.tasks.todo_generator import generate_todos
from app.models.user import User
from app.services import ticket_service


async def stream_rag_answer(
    message: str, db: AsyncSession, user: User | None = None, *, history=None, page=None
) -> AsyncGenerator[str, None]:
    """RAG 问答：检索知识库 → 构建 Prompt → 流式返回"""
    sources = []
    import re

    query = message
    if (
        history
        and len(message) < 100
        and re.search(r"它|这个|上述|刚才|继续|\b(it|that|those)\b", message, re.I)
    ):
        previous = next(
            (turn["content"] for turn in reversed(history) if turn["role"] == "user"),
            "",
        )
        query = previous[:1500] + "\n" + message
    context = await retrieve_context(query, db, user=user, sources=sources)
    prompt = build_prompt(context, message, page=page)
    async for chunk in stream("rag_chat", prompt, history=history):
        yield chunk
    if sources:
        yield "\n\n知识库参考资料：" + "、".join(
            f"《{source['title']}》" for source in sources
        )


async def analyze_ticket_by_id(ticket_id: str, db: AsyncSession, user: User) -> dict:
    """AI 分析指定工单，结果写回数据库并返回"""
    ticket = await ticket_service.get_ticket(ticket_id, db, user)
    ticket_service.require_edit(ticket, user)
    revision = ticket.revision

    analysis = await analyze_ticket(
        {
            "title": ticket.title,
            "description": ticket.description,
            "product_name": ticket.current_product_name,
            "firmware_version": ticket.firmware_version,
            "customer_name": ticket.current_customer_name,
            "raw_report": ticket.raw_report,
        },
        db,
        user=user,
    )

    # 写回工单
    ticket = await ticket_service.locked_ticket(ticket_id, db, user, revision)
    ticket.ai_analysis = analysis
    ticket_service.stamp(ticket, user)
    await db.commit()

    return {"ticket_id": ticket_id, "analysis": analysis}


async def get_todos(db: AsyncSession, user: User) -> list[dict]:
    """生成当前用户的今日 TODO 列表"""
    return await generate_todos(user, db)
