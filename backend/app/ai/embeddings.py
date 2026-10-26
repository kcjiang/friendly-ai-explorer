"""
文本向量化：独立配置的 Gemini / OpenAI 兼容 Embedding（固定 768 维）
切块策略：按段落 + 长度上限，避免超出 Token 限制
"""

import asyncio
import hashlib
import math
import time
from urllib.parse import quote

import httpx

from app.ai.embedding_config import default_embedding_config, load_embedding_config
from app.ai.provider_client import AIError, provider_key

EMBED_DIMENSIONS = 768
CHUNK_SIZE = 800  # 每块最大字符数
CHUNK_OVERLAP = 100  # 块间重叠字符数
_cooldowns = {}


class EmbeddingUnavailable(Exception):
    def __init__(self, reason):
        self.reason = reason
        super().__init__("向量服务不可用：" + reason)


def embedding_identity(config=None):
    # Dimensions alone do not make different models' vector spaces compatible.
    return (config or default_embedding_config()).identity


def normalize_vector(vector):
    if (
        not isinstance(vector, list)
        or len(vector) != EMBED_DIMENSIONS
        or any(type(v) not in (float, int) or not math.isfinite(v) for v in vector)
    ):
        raise EmbeddingUnavailable("invalid_dimensions_or_values")
    scale = max(abs(value) for value in vector)
    if scale <= 0:
        raise EmbeddingUnavailable("zero_vector")
    scaled = [value / scale for value in vector]
    norm = math.sqrt(sum(value * value for value in scaled))
    return [value / norm for value in scaled]


async def _embed(content, task_type, config=None):
    config = config or await load_embedding_config()
    if config.protocol == "disabled":
        raise EmbeddingUnavailable("disabled")
    try:
        key = provider_key(config) if config.api_key_encrypted else ""
    except AIError:
        raise EmbeddingUnavailable("missing_or_invalid_key") from None
    cache_key = (embedding_identity(config), hashlib.sha256(key.encode()).hexdigest())
    cooldown = _cooldowns.get(cache_key)
    if cooldown and cooldown[0] > time.monotonic():
        raise EmbeddingUnavailable(cooldown[1])
    try:
        inputs = [content] if isinstance(content, str) else content
        prefix = (
            config.query_prefix
            if task_type == "retrieval_query"
            else config.document_prefix
        )
        inputs = [prefix + value for value in inputs]
        headers = {}
        if config.protocol == "openai":
            url = config.base_url + "/embeddings"
            if key:
                headers["Authorization"] = "Bearer " + key
            body = {"model": config.model, "input": inputs, "encoding_format": "float"}
            if config.send_dimensions:
                body["dimensions"] = EMBED_DIMENSIONS
        else:
            model = "models/" + config.model.removeprefix("models/")
            url = config.base_url + "/" + quote(model, safe="/") + ":batchEmbedContents"
            headers["x-goog-api-key"] = key
            body = {
                "requests": [
                    {
                        "model": model,
                        "content": {"parts": [{"text": value}]},
                        "taskType": task_type.upper(),
                        "outputDimensionality": EMBED_DIMENSIONS,
                    }
                    for value in inputs
                ]
            }
        async with (
            asyncio.timeout(config.timeout_seconds),
            httpx.AsyncClient(
                timeout=config.timeout_seconds, follow_redirects=False
            ) as client,
        ):
            response = await client.post(url, headers=headers, json=body)
            if response.status_code >= 300:
                reason = {
                    401: "invalid_api_key",
                    403: "permission_denied",
                    404: "model_not_found",
                    429: "rate_limit",
                }.get(response.status_code, "upstream_unavailable")
                if (
                    "location is not supported" in response.text.lower()
                    or "country is not supported" in response.text.lower()
                ):
                    reason = "region_restricted"
                raise EmbeddingUnavailable(reason)
            data = response.json()
            if config.protocol == "openai":
                rows = data["data"]
                if (
                    len(rows) != len(inputs)
                    or any(type(row["index"]) is not int for row in rows)
                    or sorted(row["index"] for row in rows) != list(range(len(inputs)))
                ):
                    raise EmbeddingUnavailable("batch_size_or_index_mismatch")
                vectors = [
                    row["embedding"]
                    for row in sorted(rows, key=lambda row: row["index"])
                ]
            else:
                vectors = [row["values"] for row in data["embeddings"]]
            if len(vectors) != len(inputs):
                raise EmbeddingUnavailable("batch_size_mismatch")
            vectors = [normalize_vector(vector) for vector in vectors]
            return {"embedding": vectors[0] if isinstance(content, str) else vectors}
    except Exception as exc:
        reason = (
            exc.reason
            if isinstance(exc, EmbeddingUnavailable)
            else "timeout"
            if isinstance(exc, (TimeoutError, httpx.TimeoutException))
            else "invalid_response"
            if isinstance(exc, (ValueError, KeyError, TypeError))
            else "upstream_unavailable"
        )
        if len(_cooldowns) >= 16:
            _cooldowns.clear()
        _cooldowns[cache_key] = (
            time.monotonic()
            + (
                60
                if reason
                in (
                    "model_not_found",
                    "permission_denied",
                    "invalid_api_key",
                    "invalid_configuration",
                )
                else 15
            ),
            reason,
        )
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


async def embed_text(
    text: str, *, task_type: str = "retrieval_document", config=None
) -> list[float]:
    """单段文本向量化"""
    result = await _embed(text, task_type, config)
    return normalize_vector(result["embedding"])


async def embed_chunks(chunks: list[str], *, config=None) -> list[list[float]]:
    """Small sequential batches avoid an HTTP request per individual chunk."""
    embeddings = []
    for offset in range(0, len(chunks), 8):
        batch = chunks[offset : offset + 8]
        result = await _embed(batch, "retrieval_document", config)
        vectors = result["embedding"]
        if len(vectors) != len(batch):
            raise EmbeddingUnavailable("batch_size_mismatch")
        embeddings.extend(normalize_vector(vector) for vector in vectors)
    return embeddings
