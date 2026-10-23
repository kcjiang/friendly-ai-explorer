"""Dedicated worker for workbench checks, automation and cache cleanup."""

import asyncio

from app.database import engine
from app.logging_config import configure_logging
from app.services.workbench_service import worker


async def main():
    configure_logging()
    try:
        await worker()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
