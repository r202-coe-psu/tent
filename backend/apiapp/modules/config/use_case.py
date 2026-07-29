from __future__ import annotations

from typing import Any
from fastapi import Depends
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase
from apiapp.infrastructure.database import get_database
from .schemas import ConfigResponse, FaqItem

class ConfigUseCase:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self.db = db

    async def get_public_faqs(self) -> ConfigResponse:
        collection = self.db["public_config"]
        doc = await collection.find_one({"_id": "config:public_portal"})
        if not doc or "faqs" not in doc or "public" not in doc["faqs"]:
            logger.info("No config:public_portal found in database or missing faqs.public")
            return ConfigResponse(faqs=[])
        
        items = doc["faqs"]["public"]
        faqs = [FaqItem(**item) for item in items if item.get("is_published", False)]
        faqs.sort(key=lambda x: x.order)
        return ConfigResponse(faqs=faqs)

def get_config_use_case(db: AsyncIOMotorDatabase = Depends(get_database)) -> ConfigUseCase:
    return ConfigUseCase(db)
