"""Run the suite only against an explicitly configured disposable test database."""

import os
import unittest

from sqlalchemy.engine import make_url


def main():
    database = make_url(os.environ["DATABASE_URL"]).database or ""
    if os.environ.get("ENVIRONMENT") != "test" or not database.endswith("_test"):
        raise SystemExit(
            "Tests require ENVIRONMENT=test and a database ending in _test."
        )
    suite = unittest.defaultTestLoader.discover("tests", top_level_dir=".")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())


if __name__ == "__main__":
    main()
