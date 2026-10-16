"""Dedicated durable scheduler: python -m app.task_worker. No browser required."""
import asyncio
import logging
from sqlalchemy import select
from app.database import AsyncSessionLocal, engine
from app.models.ai_task import AITask, now
from app.services.ai_task_service import scan
from app.logging_config import configure_logging


async def main():
    configure_logging()
    try:
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    due = (await db.execute(select(AITask.id, AITask.user_id).where(AITask.enabled, AITask.next_run_at <= now()).order_by(AITask.next_run_at).limit(20))).all()
                for task_id, user_id in due:
                    try:
                        await scan(task_id, user_id, scheduled=True)
                    except Exception:
                        logging.getLogger(__name__).warning("任务执行未完成，将在下次轮询重试")
            except Exception:
                logging.getLogger(__name__).warning("任务调度暂不可用，请检查数据库和 v11 迁移")
            await asyncio.sleep(15)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
