from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.models.integrations import IntegrationService, UserIntegration


class UserIntegrationRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_by_user_and_service(
        self,
        user_id: uuid.UUID,
        service: IntegrationService,
    ) -> UserIntegration | None:
        return (
            await self._db.execute(
                select(UserIntegration).where(
                    UserIntegration.user_id == user_id,
                    UserIntegration.service == service,
                )
            )
        ).scalar_one_or_none()

    async def upsert(
        self,
        user_id: uuid.UUID,
        service: IntegrationService,
        token: str,
    ) -> UserIntegration:
        record = await self.get_by_user_and_service(user_id, service)
        if record is None:
            record = UserIntegration(
                id=uuid.uuid4(),
                user_id=user_id,
                service=service,
                token=token,
            )
            self._db.add(record)
        else:
            record.token = token
        await self._db.commit()
        await self._db.refresh(record)
        return record

    async def list_by_service(
        self,
        service: IntegrationService,
    ) -> list[UserIntegration]:
        return (
            await self._db.execute(
                select(UserIntegration)
                .options(selectinload(UserIntegration.user))
                .where(UserIntegration.service == service)
            )
        ).scalars().all()

    async def delete(
        self,
        user_id: uuid.UUID,
        service: IntegrationService,
    ) -> bool:
        record = await self.get_by_user_and_service(user_id, service)
        if record is None:
            return False
        await self._db.delete(record)
        await self._db.commit()
        return True
