from fastapi import APIRouter, Depends
import json
import logging
from uuid import UUID
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import AnyUser
from app.services import ai_service
from app.ai.provider_client import AIError

router = APIRouter()


class ChatRequest(BaseModel):
    message: str


@router.post("/chat", summary="RAG 流式问答（SSE）")
async def chat(
    body: ChatRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    """
    接收用户消息，检索知识库，以 Server-Sent Events 格式流式返回 AI 回答。
    前端使用 fetch + ReadableStream 接收。
    """
    async def event_stream():
        try:
            async for chunk in ai_service.stream_rag_answer(body.message, db, current_user):
                # JSON keeps newlines inside model chunks intact across SSE/network boundaries.
                yield "data: " + json.dumps({"text": chunk}, ensure_ascii=False) + "\n\n"
        except AIError as e:
            yield "data: " + json.dumps({"error": str(e)}, ensure_ascii=False) + "\n\n"
        except Exception:
            logging.getLogger(__name__).warning("AI chat failed before completion")
            yield 'data: {"error":"AI 请求失败，请稍后重试或联系管理员"}\n\n'
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":               "no-cache",
            "X-Accel-Buffering":           "no",   # 禁止 Nginx 缓冲
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.post("/analyze-ticket/{ticket_id}", summary="AI 分析工单")
async def analyze_ticket(
    ticket_id: UUID,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await ai_service.analyze_ticket_by_id(ticket_id, db, current_user)


@router.get("/todos", summary="获取今日 AI 生成的 TODO 列表")
async def get_todos(
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    todos = await ai_service.get_todos(db, current_user)
    return {"todos": todos}
