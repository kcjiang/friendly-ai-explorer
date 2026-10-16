from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import DevOnly
from app.schemas.ai_config import ProviderInput, RoutesInput, TestInput
from app.services import ai_admin_service as service
from app.services import embedding_admin_service as embedding

router = APIRouter()


@router.get("/embedding")
async def embedding_settings(user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await embedding.public_config(db)


@router.put("/embedding")
async def save_embedding_settings(body: embedding.EmbeddingInput, user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await embedding.save_config(db, body)


@router.post("/embedding/test")
async def test_embedding_settings(user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await embedding.test_config(db)


@router.get("/providers")
async def providers(user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await service.list_providers(db)


@router.post("/providers", status_code=201)
async def create_provider(body: ProviderInput, user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await service.save_provider(db, body)


@router.put("/providers/{provider_id}")
async def update_provider(provider_id: UUID, body: ProviderInput, user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await service.save_provider(db, body, provider_id)


@router.delete("/providers/{provider_id}")
async def delete_provider(provider_id: UUID, user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await service.delete_provider(db, provider_id)


@router.post("/providers/{provider_id}/test")
async def test_provider(provider_id: UUID, body: TestInput, user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await service.test_provider(db, provider_id, body.mode)


@router.get("/routes")
async def routes(user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await service.list_routes(db)


@router.put("/routes")
async def save_routes(body: RoutesInput, user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await service.save_routes(db, body)


@router.get("/logs")
async def logs(user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await service.list_logs(db)
