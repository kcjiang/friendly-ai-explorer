"""Collection requests must reach auth instead of redirecting to an internal host."""
import unittest

from fastapi.testclient import TestClient

from app.main import app


class CollectionRoutesTest(unittest.TestCase):
    def test_collection_routes_do_not_redirect_before_auth(self):
        with TestClient(app, base_url="http://backend:8000") as client:
            for method, path in (
                ("GET", "/api/v1/tickets"),
                ("POST", "/api/v1/tickets"),
                ("GET", "/api/v1/knowledge"),
                ("POST", "/api/v1/knowledge"),
                ("GET", "/api/v1/users"),
            ):
                for suffix in ("", "/"):
                    with self.subTest(method=method, path=path + suffix):
                        response = client.request(method, path + suffix, follow_redirects=False)
                        self.assertIn(response.status_code, (401, 403))
                        self.assertNotIn("location", response.headers)


if __name__ == "__main__":
    unittest.main()
