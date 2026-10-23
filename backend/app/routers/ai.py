from app.i18n import message as system_message
from fastapi import APIRouter, Depends
import json
import logging
from uuid import UUID
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import AnyUser
from app.services import ai_service
from app.ai.provider_client import AIError

router = APIRouter()


class ChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    message: str = Field(min_length=1, max_length=8000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=10)
    page: Literal["dashboard", "tickets", "knowledge", "email", "debug", "catalog", "admin", "other"] = "other"

    @model_validator(mode="after")
    def bounded_history(self):
        if sum(len(turn.content) for turn in self.history) > 16000:
            raise ValueError(system_message("errors.conversationHistoryIsTooLongStartANewConversation"))
        if any(turn.role != ("user" if index % 2 == 0 else "assistant") for index, turn in enumerate(self.history)) or len(self.history) % 2:
            raise ValueError(system_message("errors.historyMustContainCompleteUserAndAssistantTurns"))
        return self


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
            async for chunk in ai_service.stream_rag_answer(body.message, db, current_user, history=[turn.model_dump() for turn in body.history], page=body.page):
                # JSON keeps newlines inside model chunks intact across SSE/network boundaries.
                yield "data: " + json.dumps({"text": chunk}, ensure_ascii=False) + "\n\n"
        except AIError as e:
            yield "data: " + json.dumps({"error": str(e)}, ensure_ascii=False) + "\n\n"
        except Exception:
            logging.getLogger(__name__).warning("AI chat failed before completion")
            yield "data: " + json.dumps({"error": system_message("errors.aiRequestFailed")}) + "\n\n"
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
