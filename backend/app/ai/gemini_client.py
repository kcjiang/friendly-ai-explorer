from typing import AsyncGenerator
import google.generativeai as genai
from app.config import settings

genai.configure(api_key=settings.google_api_key)

CHAT_MODEL  = "gemini-2.5-flash"
EMBED_MODEL = "models/text-embedding-004"


class GeminiClient:
    def __init__(self):
        self._model = genai.GenerativeModel(CHAT_MODEL)

    async def chat(self, prompt: str) -> str:
        """单次非流式调用，用于工单分析、TODO 生成等"""
        response = await self._model.generate_content_async(prompt)
        return response.text

    async def stream_chat(self, prompt: str) -> AsyncGenerator[str, None]:
        """流式调用，用于 RAG 问答 SSE"""
        response = await self._model.generate_content_async(prompt, stream=True)
        async for chunk in response:
            if chunk.text:
                yield chunk.text


# 全局单例
gemini = GeminiClient()
