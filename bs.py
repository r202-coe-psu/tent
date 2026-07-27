import asyncio
import logging
from worker.couch.bootstrap import bootstrap_all
from worker.couch.client import CouchClient
from worker.config import load_settings
from tent_model import init_db

logging.basicConfig(level=logging.INFO)

async def main():
    settings = load_settings()
    await init_db(settings.mongodb_uri)
    couch = CouchClient(settings)
    await bootstrap_all(couch)

if __name__ == "__main__":
    asyncio.run(main())
