from typing import AsyncGenerator
import logging
import re
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models.ticket import Ticket
from app.models.user import User
from app.ai.rag_engine import retrieve_context, build_prompt
from app.ai.router import stream
from app.ai.tasks.ticket_analyzer import analyze_ticket
from app.ai.tasks.todo_generator import generate_todos
from app.services import ticket_service


async def stream_rag_answer(message: str, db: AsyncSession, user: User | None = None) -> AsyncGenerator[str, None]:
    """RAG 问答：检索知识库 → 构建 Prompt → 流式返回"""
    sources = []
    context = await retrieve_context(message, db, user=user, sources=sources)
    if not context:
        yield "未在你可访问的已发布知识库中找到相关资料。请确认文档已发布，并在问题中提供产品名称或型号；我不会用通用知识猜测内部产品信息。"
        return
    prompt  = build_prompt(context, message)
    prefix, direct, unusable = "", False, False
    async for chunk in stream("rag_chat", prompt):
        if direct:
            yield chunk
            continue
        if unusable:
            continue
        prefix += chunk
        clean = re.sub(r"[\s*#]", "", prefix)
        if re.match(r"^(?:抱歉[，,。]?)?(?:知识库(?:中)?|资料(?:中)?|文档(?:中)?)(?:未提供|没有提供|未找到|未包含|没有相关)", clean):
            unusable = True
        elif len(prefix) >= 32:
            direct = True
            yield prefix
    if unusable:
        logging.getLogger(__name__).warning("聊天模型未能利用已命中资料，显示知识库原文", extra={"details": {"document_ids": [s["id"] for s in sources]}})
        yield "检索到的知识库原文：\n\n" + context
    elif not direct:
        yield prefix
    if sources:
        yield "\n\n资料来源：" + "、".join(f"《{source['title']}》" for source in sources)


async def analyze_ticket_by_id(ticket_id: str, db: AsyncSession, user: User) -> dict:
    """AI 分析指定工单，结果写回数据库并返回"""
    ticket = await ticket_service.get_ticket(ticket_id, db, user)
    ticket_service.require_edit(ticket, user)
    revision = ticket.revision

    analysis = await analyze_ticket(
        {
            "title":            ticket.title,
            "description":      ticket.description,
            "product_name":     ticket.current_product_name,
            "firmware_version": ticket.firmware_version,
            "customer_name":    ticket.current_customer_name,
            "raw_report":       ticket.raw_report,
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
