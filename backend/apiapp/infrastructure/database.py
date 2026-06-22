from motor.motor_asyncio import AsyncIOMotorClient
from ..core.config import Settings
from loguru import logger

class Database:
    client: AsyncIOMotorClient = None
    db = None

db_helper = Database()

async def init_mongodb(settings: Settings) -> None:
    logger.info(f"Connecting to MongoDB at {settings.MONGODB_URI}...")
    db_helper.client = AsyncIOMotorClient(settings.MONGODB_URI)
    db_helper.db = db_helper.client[settings.MONGODB_DB_NAME]
    # Create indexes
    await db_helper.db["donations"].create_index("tracking_token_hash", unique=True)
    logger.info("MongoDB initialized successfully and indexes generated.")

async def close_mongodb() -> None:
    if db_helper.client:
        db_helper.client.close()
        logger.info("MongoDB client session terminated.")
