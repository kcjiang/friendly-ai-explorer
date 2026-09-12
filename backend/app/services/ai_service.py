from typing import AsyncGenerator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models.ticket import Ticket
from app.models.user import User
from app.ai.rag_engine import retrieve_context, build_prompt
from app.ai.gemini_client import gemini
from app.ai.tasks.ticket_analyzer import analyze_ticket
from app.ai.tasks.todo_generator import generate_todos


async def stream_rag_answer(message: str, db: AsyncSession) -> AsyncGenerator[str, None]:
    """RAG 问答：检索知识库 → 构建 Prompt → 流式返回"""
    context = await retrieve_context(message, db)
    prompt  = build_prompt(context, message)
    async for chunk in gemini.stream_chat(prompt):
        yield chunk


async def analyze_ticket_by_id(ticket_id: str, db: AsyncSession, user: User) -> dict:
    """AI 分析指定工单，结果写回数据库并返回"""
    result = await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="工单不存在")

    analysis = await analyze_ticket(
        {
            "title":            ticket.title,
            "description":      ticket.description,
            "product_name":     ticket.product_name,
            "firmware_version": ticket.firmware_version,
            "customer_name":    ticket.customer_name,
        },
        db,
    )

    # 写回工单
    ticket.ai_analysis = analysis
    await db.commit()

    return {"ticket_id": ticket_id, "analysis": analysis}


async def get_todos(db: AsyncSession, user: User) -> list[dict]:
    """生成当前用户的今日 TODO 列表"""
    return await generate_todos(user, db)
