"""
文本向量化：可配置的 Gemini Embedding（固定 768 维，与现有数据库兼容）
切块策略：按段落 + 长度上限，避免超出 Token 限制
"""
import google.generativeai as genai
import asyncio
import hashlib
import math
import time
from app.config import settings

genai.configure(api_key=settings.google_api_key)

EMBED_DIMENSIONS = 768
CHUNK_SIZE   = 800   # 每块最大字符数
CHUNK_OVERLAP = 100  # 块间重叠字符数
_cooldowns = {}


class EmbeddingUnavailable(Exception):
    def __init__(self, reason):
        self.reason = reason
        super().__init__("向量服务不可用：" + reason)


def embedding_model():
    return "models/" + settings.embedding_model.removeprefix("models/")


def embedding_identity():
    # Dimensions alone do not make different models' vector spaces compatible.
    return f"{embedding_model()}:{EMBED_DIMENSIONS}"


def normalize_vector(vector):
    if len(vector) != EMBED_DIMENSIONS or any(not isinstance(v, (float, int)) or not math.isfinite(v) for v in vector):
        raise EmbeddingUnavailable("invalid_dimensions_or_values")
    norm = math.sqrt(sum(v * v for v in vector))
    if norm <= 0:
        raise EmbeddingUnavailable("zero_vector")
    return [v / norm for v in vector]


async def _embed(content, task_type):
    if not settings.google_api_key:
        raise EmbeddingUnavailable("missing_api_key")
    cache_key = (embedding_identity(), hashlib.sha256(settings.google_api_key.encode()).hexdigest())
    cooldown = _cooldowns.get(cache_key)
    if cooldown and cooldown[0] > time.monotonic():
        raise EmbeddingUnavailable(cooldown[1])
    try:
        return await asyncio.wait_for(genai.embed_content_async(
            model=embedding_model(), content=content, task_type=task_type,
            output_dimensionality=EMBED_DIMENSIONS, request_options={"timeout": 15},
        ), timeout=16)
    except Exception as exc:
        reason = {"NotFound": "model_not_found", "PermissionDenied": "permission_denied", "Unauthenticated": "invalid_api_key",
                  "ResourceExhausted": "rate_limit", "InvalidArgument": "invalid_configuration", "TimeoutError": "timeout"}.get(type(exc).__name__, "upstream_unavailable")
        if len(_cooldowns) >= 16:
            _cooldowns.clear()
        _cooldowns[cache_key] = (time.monotonic() + (60 if reason in ("model_not_found", "permission_denied", "invalid_api_key", "invalid_configuration") else 15), reason)
        raise EmbeddingUnavailable(reason) from exc


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


async def embed_text(text: str, *, task_type: str = "retrieval_document") -> list[float]:
    """单段文本向量化"""
    result = await _embed(text, task_type)
    return normalize_vector(result["embedding"])


async def embed_chunks(chunks: list[str]) -> list[list[float]]:
    """Small sequential batches avoid an HTTP request per individual chunk."""
    embeddings = []
    for offset in range(0, len(chunks), 8):
        batch = chunks[offset:offset + 8]
        result = await _embed(batch, "retrieval_document")
        vectors = result["embedding"]
        if len(vectors) != len(batch):
            raise EmbeddingUnavailable("batch_size_mismatch")
        embeddings.extend(normalize_vector(vector) for vector in vectors)
    return embeddings
