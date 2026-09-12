from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.ai.embeddings import embed_text

SYSTEM_PROMPT = """你是 Friendly AI Explorer 的 AI 助手，专门服务于技术支持工程师（FAE）团队。
请基于以下知识库内容回答用户问题。如果知识库中没有相关信息，请基于通用技术知识回答。
请用中文回答，语言简洁专业。

知识库参考内容：
{context}

"""


async def retrieve_context(query: str, db: AsyncSession, top_k: int = 5) -> str:
    """
    向量检索相关文档块，返回拼接好的上下文字符串。
    步骤：
      1. 将查询文本向量化（Gemini Embeddings）
      2. 用 pgvector cosine 距离找最相近的 top_k 个 chunk
      3. 拼接成字符串返回给 Prompt
    """
    try:
        query_embedding = await embed_text(query)
    except Exception as e:
        print(f"[RAG] 查询向量化失败: {e}")
        return ""

    # pgvector 要求向量格式为字符串 "[0.1, 0.2, ...]"
    vec_str = "[" + ",".join(f"{x:.8f}" for x in query_embedding) + "]"

    try:
        result = await db.execute(
            text("""
                SELECT dc.content,
                       d.title,
                       1 - (dc.embedding <=> :vec::vector) AS similarity
                FROM document_chunks dc
                JOIN documents d ON dc.document_id = d.id
                WHERE d.is_published = true
                  AND dc.embedding IS NOT NULL
                ORDER BY dc.embedding <=> :vec::vector
                LIMIT :top_k
            """),
            {"vec": vec_str, "top_k": top_k},
        )
        rows = result.fetchall()
    except Exception as e:
        print(f"[RAG] 向量检索失败: {e}")
        return ""

    if not rows:
        return ""

    parts = [f"【{row.title}】\n{row.content}" for row in rows]
    return "\n\n---\n\n".join(parts)


def build_prompt(context: str, message: str) -> str:
    """
    构建最终发送给 Gemini 的完整 Prompt。
    context: retrieve_context() 返回的知识库内容
    message: 用户原始问题
    """
    ctx = context if context else "（暂无相关知识库内容，请基于通用知识回答）"
    return SYSTEM_PROMPT.format(context=ctx) + f"用户问题：{message}"
