"""
文本向量化：Gemini text-embedding-004（768 维）
切块策略：按段落 + 长度上限，避免超出 Token 限制
"""
import google.generativeai as genai
from app.config import settings

genai.configure(api_key=settings.google_api_key)

EMBED_MODEL  = "models/text-embedding-004"
CHUNK_SIZE   = 800   # 每块最大字符数
CHUNK_OVERLAP = 100  # 块间重叠字符数


def chunk_text(text: str) -> list[str]:
    """将长文本切成带重叠的小块"""
    if not text or not text.strip():
        return []

    # 先按段落切分
    paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    chunks: list[str] = []
    current = ""

    for para in paragraphs:
        if len(current) + len(para) + 1 <= CHUNK_SIZE:
            current = (current + "\n" + para).strip()
        else:
            if current:
                chunks.append(current)
            # 段落本身超过 CHUNK_SIZE 时强制按字符切
            if len(para) > CHUNK_SIZE:
                for i in range(0, len(para), CHUNK_SIZE - CHUNK_OVERLAP):
                    chunks.append(para[i : i + CHUNK_SIZE])
                current = ""
            else:
                # 带重叠：把上一块末尾加到新块开头
                overlap = current[-CHUNK_OVERLAP:] if current else ""
                current = (overlap + "\n" + para).strip()

    if current:
        chunks.append(current)

    return chunks


async def embed_text(text: str) -> list[float]:
    """单段文本向量化"""
    result = genai.embed_content(
        model=EMBED_MODEL,
        content=text,
        task_type="retrieval_document",
    )
    return result["embedding"]


async def embed_chunks(chunks: list[str]) -> list[list[float]]:
    """批量向量化（串行，避免 API 速率限制）"""
    embeddings = []
    for chunk in chunks:
        emb = await embed_text(chunk)
        embeddings.append(emb)
    return embeddings
