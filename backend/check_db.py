import asyncio

from motor.motor_asyncio import AsyncIOMotorClient


async def main():
    client = AsyncIOMotorClient("mongodb://root:example@localhost:27017")
    db = client["tent_db"]
    collection = db["public_announcements"]
    docs = await collection.find({}).to_list(length=10)
    for doc in docs:
        print(doc)


asyncio.run(main())
