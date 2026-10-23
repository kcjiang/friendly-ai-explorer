"""Knowledge indexing/retrieval regression tests. DB writes roll back; API calls mocked."""
import math
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from dataclasses import asdict, replace
from app.ai.provider_client import encrypt_key
from app.database import engine, get_db
from app.middleware.auth import get_current_user
from app.models.document import Document, DocumentChunk, DocVisibility
from app.models.user import User, UserRole
from app.ai import embeddings, rag_engine
from app.ai.embedding_config import EmbeddingConfig, EmbeddingSettings, EmbeddingProfile
from app.services import knowledge_service, ai_service

VECTOR = [1.0] + [0.0] * 767


class EmbeddingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.config = EmbeddingConfig(protocol="gemini", base_url="https://generativelanguage.googleapis.com/v1beta", model="gemini-embedding-001", api_key_encrypted=encrypt_key("non-secret-test-key"))

    async def test_batch_dimensions_normalization_and_task_types(self):
        embeddings._cooldowns.clear()
        vectors = [[2.0] + [0.0] * 767, [0.0, 3.0] + [0.0] * 766]
        response = httpx.Response(200, json={"embeddings": [{"values": vector} for vector in vectors]})
        with patch("httpx.AsyncClient.post", AsyncMock(return_value=response)) as api:
            results = await embeddings.embed_chunks(["first", "second"], config=self.config)
        self.assertEqual(api.await_count, 1)
        self.assertEqual(api.await_args.kwargs["json"]["requests"][0]["taskType"], "RETRIEVAL_DOCUMENT")
        self.assertEqual(api.await_args.kwargs["json"]["requests"][0]["outputDimensionality"], 768)
        self.assertTrue(all(abs(sum(v*v for v in row) - 1) < 1e-8 for row in results))
        for bad in ([1.0], [0.0] * 768, [float("nan")] * 768):
            with self.assertRaises(embeddings.EmbeddingUnavailable):
                embeddings.normalize_vector(bad)

    async def test_unavailable_model_uses_short_cooldown(self):
        embeddings._cooldowns.clear()
        try:
            with patch("httpx.AsyncClient.post", AsyncMock(return_value=httpx.Response(404))) as api:
                for _ in range(2):
                    with self.assertRaises(embeddings.EmbeddingUnavailable) as raised:
                        await embeddings.embed_text("test", config=self.config)
                    self.assertEqual(raised.exception.reason, "model_not_found")
                self.assertEqual(api.await_count, 1)
        finally:
            embeddings._cooldowns.clear()


class KnowledgeRAGTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.connection = await engine.connect()
        self.transaction = await self.connection.begin()
        self.db = AsyncSession(bind=self.connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
        self.owner = User(id=uuid4(), name="RAG owner", email=f"{uuid4()}@example.test", password_hash="test-only", role=UserRole.engineer, is_active=True)
        self.other = User(id=uuid4(), name="RAG other", email=f"{uuid4()}@example.test", password_hash="test-only", role=UserRole.engineer, is_active=True)
        self.embedding_config = EmbeddingConfig(protocol="gemini", base_url="https://generativelanguage.googleapis.com/v1beta", model="gemini-embedding-001", api_key_encrypted=encrypt_key("non-secret-test-key"))
        embedding_row = await self.db.get(EmbeddingSettings, 1)
        if not embedding_row:
            embedding_row = EmbeddingSettings(id=1); self.db.add(embedding_row)
        profile = EmbeddingProfile(name="test encoder", config=asdict(self.embedding_config))
        self.db.add(profile)
        await self.db.flush()
        self.embedding_profile_id = profile.id
        embedding_row.active_profile_id = profile.id
        self.db.add_all([self.owner, self.other])
        await self.db.flush()
        self.code = "RAGSKU-" + uuid4().hex[:12]
        self.failure = patch("app.services.knowledge_service.embed_chunks", AsyncMock(side_effect=embeddings.EmbeddingUnavailable("model_not_found")))
        self.failure.start()
        self.query_embedding = patch("app.ai.rag_engine.embed_text", AsyncMock(side_effect=embeddings.EmbeddingUnavailable("upstream_unavailable")))
        self.query_embedding.start()
        async def database():
            yield self.db
        async def user():
            return self.owner
        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = user
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        self.failure.stop()
        self.query_embedding.stop()
        await self.client.aclose()
        await self.db.close()
        await self.transaction.rollback()
        await self.connection.close()
        await engine.dispose()

    async def create(self, **overrides):
        body = {"title": self.code + " 产品资料", "content": self.code + " 由星河制造，额定电压为19V。", "is_published": True, "visibility": "public"}
        body.update(overrides)
        response = await self.client.post("/api/v1/knowledge", json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    async def test_failed_embeddings_keep_text_and_answer_context(self):
        row = await self.create()
        self.assertEqual(row["index_status"], "text_only")
        self.assertEqual(row["indexed_vectors"], 0)
        self.assertGreater(row["indexed_chunks"], 0)
        context = await rag_engine.retrieve_context(self.code + " 电压是多少？", self.db, user=self.owner)
        self.assertIn("19V", context)
        self.assertIn("星河制造", context)
        rows = (await self.db.scalars(select(DocumentChunk).where(DocumentChunk.document_id == row["id"]))).all()
        self.assertTrue(all(r.embedding is None for r in rows))

    async def test_legacy_saved_document_without_chunks_is_searchable(self):
        doc = Document(author_id=self.owner.id, title=self.code, content=self.code + " 厂家是凌云，功率77W。", is_published=True, visibility=DocVisibility.public)
        self.db.add(doc)
        await self.db.commit()
        context = await rag_engine.retrieve_context(self.code + " 是谁生产的？", self.db, user=self.owner)
        self.assertIn("凌云", context)
        self.assertIn("77W", context)

    async def test_publication_and_private_visibility_apply_to_keyword_path(self):
        await self.create(content=self.code + " PUBLIC_MARKER")
        await self.create(title=self.code + " own private", content=self.code + " OWN_PRIVATE_MARKER", visibility="private")
        await self.create(title=self.code + " draft", content=self.code + " DRAFT_MARKER", is_published=False)
        self.db.add(Document(author_id=self.other.id, title=self.code + " other", content=self.code + " OTHER_PRIVATE_MARKER", is_published=True, visibility=DocVisibility.private))
        await self.db.commit()
        context = await rag_engine.retrieve_context(self.code, self.db, top_k=8, user=self.owner)
        self.assertIn("PUBLIC_MARKER", context)
        self.assertIn("OWN_PRIVATE_MARKER", context)
        self.assertNotIn("OTHER_PRIVATE_MARKER", context)
        self.assertNotIn("DRAFT_MARKER", context)
        public_only = await rag_engine.retrieve_context(self.code, self.db, top_k=8)
        self.assertNotIn("OWN_PRIVATE_MARKER", public_only)

    async def test_vector_path_filters_private_and_incompatible_models(self):
        docs = [Document(author_id=self.owner.id, title=self.code, content="VECTOR_PUBLIC", visibility=DocVisibility.public, is_published=True),
                Document(author_id=self.other.id, title="private fixture", content="VECTOR_HIDDEN", visibility=DocVisibility.private, is_published=True),
                Document(author_id=self.owner.id, title="old fixture", content="VECTOR_OLD_MODEL", visibility=DocVisibility.public, is_published=True)]
        self.db.add_all(docs)
        await self.db.flush()
        for index, doc in enumerate(docs):
            self.db.add(DocumentChunk(document_id=doc.id, chunk_index=0, content=doc.content, embedding=VECTOR,
                metadata_={"embedding_model": embeddings.embedding_identity(self.embedding_config) if index < 2 else "models/text-embedding-004:768"}))
        await self.db.commit()
        with patch("app.ai.rag_engine.embed_text", AsyncMock(return_value=VECTOR)):
            context = await rag_engine.retrieve_context("unmatchedsemantic" + uuid4().hex, self.db, user=self.owner)
        self.assertIn("VECTOR_PUBLIC", context)
        self.assertNotIn("VECTOR_HIDDEN", context)
        self.assertNotIn("VECTOR_OLD_MODEL", context)

    async def test_reindex_is_author_only_and_reports_ready(self):
        row = await self.create()
        async def vectors(chunks, **kwargs):
            return [VECTOR for _ in chunks]
        with patch("app.services.knowledge_service.embed_chunks", vectors):
            response = await self.client.post(f"/api/v1/knowledge/{row['id']}/reindex")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["index_status"], "ready")
        self.assertEqual(response.json()["indexed_vectors"], response.json()["indexed_chunks"])
        self.assertEqual(response.json()["index_model"], self.embedding_config.identity)
        async def other():
            return self.other
        app.dependency_overrides[get_current_user] = other
        self.assertEqual((await self.client.post(f"/api/v1/knowledge/{row['id']}/reindex")).status_code, 403)

    async def test_switch_encoder_excludes_old_vectors_and_disabled_keeps_text(self):
        from dataclasses import asdict
        from app.ai.embedding_config import EmbeddingSettings
        doc = Document(author_id=self.owner.id, title=self.code, content="semantic-only fixture", is_published=True, visibility=DocVisibility.public)
        self.db.add(doc)
        await self.db.flush()
        self.db.add(DocumentChunk(document_id=doc.id, chunk_index=0, content=doc.content, embedding=VECTOR, metadata_={"embedding_model": embeddings.embedding_identity(self.embedding_config)}))
        row = await self.db.get(EmbeddingProfile, self.embedding_profile_id)
        row.config = asdict(EmbeddingConfig(protocol="openai", base_url="http://encoder.test/v1", model="bge"))
        await self.db.commit()
        with patch("app.ai.rag_engine.embed_text", AsyncMock(return_value=VECTOR)) as api:
            result = await rag_engine.retrieve_context("unmatchedsemantic" + uuid4().hex, self.db, user=self.owner)
        self.assertEqual(result, "")
        api.assert_not_awaited()
        self.assertEqual((await knowledge_service._index_states([doc], self.db))[0].index_status, "text_only")
        row.config = asdict(EmbeddingConfig(protocol="disabled"))
        await self.db.commit()
        with patch("app.services.knowledge_service.embed_chunks") as api:
            await knowledge_service._vectorize_document(doc, doc.content, self.db)
        api.assert_not_called()
        chunks = list((await self.db.scalars(select(DocumentChunk).where(DocumentChunk.document_id == doc.id))).all())
        self.assertTrue(chunks)
        self.assertTrue(all(chunk.embedding is None for chunk in chunks))

    async def test_similarity_threshold_filters_weak_vector_matches(self):
        from dataclasses import asdict
        from app.ai.embedding_config import EmbeddingSettings
        doc = Document(author_id=self.owner.id, title=self.code, content="WEAK_SEMANTIC_MATCH", is_published=True, visibility=DocVisibility.public)
        self.db.add(doc)
        await self.db.flush()
        self.db.add(DocumentChunk(document_id=doc.id, chunk_index=0, content=doc.content, embedding=VECTOR, metadata_={"embedding_model": embeddings.embedding_identity(self.embedding_config)}))
        await self.db.commit()
        query = "unmatchedsemantic" + uuid4().hex
        with patch("app.ai.rag_engine.embed_text", AsyncMock(return_value=[0.6, 0.8] + [0.0]*766)):
            self.assertEqual(await rag_engine.retrieve_context(query, self.db, user=self.owner), "")
            row = await self.db.get(EmbeddingProfile, self.embedding_profile_id)
            row.config = asdict(replace(self.embedding_config, min_similarity=0.5))
            await self.db.commit()
            self.assertIn("WEAK_SEMANTIC_MATCH", await rag_engine.retrieve_context(query, self.db, user=self.owner))

    async def test_update_empty_or_unpublish_removes_stale_chunks(self):
        row = await self.create()
        response = await self.client.patch(f"/api/v1/knowledge/{row['id']}", json={"content": ""})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["index_status"], "empty")
        self.assertEqual(response.json()["indexed_chunks"], 0)
        await self.client.patch(f"/api/v1/knowledge/{row['id']}", json={"content": self.code + " newer text"})
        response = await self.client.patch(f"/api/v1/knowledge/{row['id']}", json={"is_published": False})
        self.assertEqual(response.json()["index_status"], "draft")
        self.assertEqual(response.json()["indexed_chunks"], 0)
        self.assertEqual((await self.client.post(f"/api/v1/knowledge/{row['id']}/reindex")).status_code, 409)

    async def test_empty_retrieval_uses_general_conversation_without_fake_sources(self):
        prompts = []
        async def model(task, prompt, **kwargs):
            prompts.append(prompt)
            yield "可以帮你解释技术问题。"
        with patch("app.services.ai_service.retrieve_context", AsyncMock(return_value="")), patch("app.services.ai_service.stream", model):
            result = "".join([chunk async for chunk in ai_service.stream_rag_answer("unknown", self.db, self.owner)])
        self.assertIn("解释技术问题", result)
        self.assertNotIn("参考资料：", result)
        self.assertIn("通用知识回答", prompts[0])
        self.assertIn("不得捏造内部参数", prompts[0])

    async def test_actual_context_reaches_stream_prompt(self):
        await self.create()
        prompts = []
        async def model(task, prompt, **kwargs):
            prompts.append(prompt)
            yield "根据知识库，额定电压为19V。"
        with patch("app.services.ai_service.stream", model):
            result = "".join([chunk async for chunk in ai_service.stream_rag_answer(self.code + " 电压？", self.db, self.owner)])
        self.assertIn("19V", result)
        self.assertIn("知识库参考资料：", result)
        self.assertIn(self.code + " 产品资料", result)
        self.assertIn("星河制造", prompts[0])
        self.assertIn("以文档记载为准", prompts[0])

    async def test_followup_uses_history_and_page_without_claiming_actions(self):
        await self.create()
        prompts = []
        async def model(task, prompt, **kwargs):
            prompts.append(prompt)
            self.assertEqual(kwargs["history"][0]["content"], self.code)
            yield "它的额定电压是19V。"
        with patch("app.services.ai_service.stream", model):
            result = "".join([chunk async for chunk in ai_service.stream_rag_answer("它的电压是多少？", self.db, self.owner,
                history=[{"role": "user", "content": self.code}, {"role": "assistant", "content": "产品介绍"}], page="tickets")])
        self.assertIn("19V", result)
        self.assertIn("tickets", prompts[0])
        self.assertIn("星河制造", prompts[0])
        self.assertIn("尚不能执行页面操作", prompts[0])


if __name__ == "__main__":
    unittest.main()
