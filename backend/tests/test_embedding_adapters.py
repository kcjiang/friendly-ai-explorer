import unittest
from dataclasses import replace
from unittest.mock import AsyncMock, patch
import httpx

from app.ai.embedding_config import EmbeddingConfig
from app.ai import embeddings

VECTOR = [2.0] + [0.0] * 767


class LocalEmbeddingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        embeddings._cooldowns.clear()
        self.config = EmbeddingConfig(protocol="openai", base_url="http://local.test/v1", model="bge", use_env_key=False)

    async def test_local_batches_ordered_by_index_and_prefixes(self):
        response = httpx.Response(200, json={"data": [{"index": 1, "embedding": [0.0, 2.0] + [0.0]*766}, {"index": 0, "embedding": VECTOR}]})
        with patch("httpx.AsyncClient.post", AsyncMock(return_value=response)) as api:
            result = await embeddings.embed_chunks(["a", "b"], config=replace(self.config, document_prefix="doc: "))
        self.assertEqual(result[0][0], 1)
        self.assertEqual(result[1][1], 1)
        self.assertEqual(api.await_args.kwargs["json"]["input"], ["doc: a", "doc: b"])
        self.assertNotIn("Authorization", api.await_args.kwargs["headers"])
        self.assertNotIn("dimensions", api.await_args.kwargs["json"])
        response = httpx.Response(200, json={"data": [{"index": 0, "embedding": VECTOR}]})
        with patch("httpx.AsyncClient.post", AsyncMock(return_value=response)) as api:
            await embeddings.embed_text("a", task_type="retrieval_query", config=replace(self.config, query_prefix="query: ", send_dimensions=True))
        self.assertEqual(api.await_args.kwargs["json"]["input"], ["query: a"])
        self.assertEqual(api.await_args.kwargs["json"]["dimensions"], 768)

    async def test_invalid_dimensions_indices_and_values_rejected(self):
        for rows in ([{"index": 0, "embedding": [0.0]*768}], [{"index": 0, "embedding": [1.0]*1024}],
                     [{"index": 3, "embedding": VECTOR}], [{"index": 0, "embedding": "invalid"}], []):
            embeddings._cooldowns.clear()
            with patch("httpx.AsyncClient.post", AsyncMock(return_value=httpx.Response(200, json={"data": rows}))):
                with self.assertRaises(embeddings.EmbeddingUnavailable):
                    await embeddings.embed_text("query", config=self.config)

    async def test_region_failure_is_safe_and_disabled_skips_network(self):
        with patch("httpx.AsyncClient.post", AsyncMock(return_value=httpx.Response(400, text="User location is not supported. secret-fixture"))):
            with self.assertRaises(embeddings.EmbeddingUnavailable) as raised:
                await embeddings.embed_text("query", config=self.config)
        self.assertEqual(raised.exception.reason, "region_restricted")
        self.assertNotIn("secret-fixture", str(raised.exception))
        with patch("httpx.AsyncClient.post") as api:
            with self.assertRaises(embeddings.EmbeddingUnavailable):
                await embeddings.embed_text("query", config=replace(self.config, protocol="disabled"))
        api.assert_not_called()

    def test_encoder_identity_excludes_secret_but_tracks_model_endpoint_and_prefix(self):
        original = self.config.identity
        self.assertEqual(original, replace(self.config, api_key_encrypted="ciphertext").identity)
        for variant in (replace(self.config, model="other"), replace(self.config, base_url="http://other.test/v1"), replace(self.config, query_prefix="query:")):
            self.assertNotEqual(original, variant.identity)
        for bad in ([float("inf")]*768, [True]*768):
            with self.assertRaises(embeddings.EmbeddingUnavailable):
                embeddings.normalize_vector(bad)
        huge = embeddings.normalize_vector([1e308]*768)
        self.assertAlmostEqual(sum(value*value for value in huge), 1)
