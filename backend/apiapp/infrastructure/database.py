from urllib.parse import urlparse

import beanie
import motor.motor_asyncio
from loguru import logger
from tent_model import ALL_DOCUMENTS


def _database_name(database_uri: str) -> str:
    path = urlparse(database_uri).path.lstrip("/")
    name = path.split("?")[0] if path else ""
    if not name:
        msg = "DATABASE_URI must include a database name, e.g. mongodb://localhost:27017/tentdb"
        raise ValueError(msg)
    return name


class BeanieClient:
    def __init__(self):
        self.client = None
        self.database = None
        self.settings = None

    async def init_beanie(self, settings):
        """Initialize Beanie with MongoDB connection"""
        try:
            self.settings = settings
            db_name = _database_name(settings.DATABASE_URI)
            # Log db name only — URI may embed credentials.
            logger.info(f"Connecting to MongoDB database: {db_name}")

            self.client = motor.motor_asyncio.AsyncIOMotorClient(
                settings.DATABASE_URI, connect=True
            )

            self.database = self.client[db_name]
            logger.debug(f"Using database: {self.database.name}")
            logger.info(f"Initializing Beanie with {len(ALL_DOCUMENTS)} models:")
            for document in ALL_DOCUMENTS:
                logger.info(f"  - {document.__name__}")

            await beanie.init_beanie(
                database=self.database,
                document_models=ALL_DOCUMENTS,
            )

            logger.info("Beanie initialization successful")

        except Exception as e:
            logger.error(f"Beanie initialization failed: {e}")
            raise

    async def close(self):
        """Close MongoDB connection"""
        if self.client:
            self.client.close()
            logger.info("MongoDB connection closed")

    async def ping(self) -> bool:
        """Check database connection"""
        try:
            if self.client:
                await self.client.admin.command("ping")
                return True
            return False
        except Exception as e:
            logger.error(f"Database ping failed: {e}")
            return False


beanie_client = BeanieClient()


async def init_beanie(settings):
    """Initialize Beanie with settings"""
    await beanie_client.init_beanie(settings)


async def close_beanie():
    """Close Beanie connection"""
    await beanie_client.close()


def get_database():
    """Get database instance"""
    return beanie_client.database
