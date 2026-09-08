import asyncio

from pymongo import AsyncMongoClient


async def main():
    client = AsyncMongoClient("mongodb://root:example@localhost:27017")
    db = client["tent_db"]
    collection = db["public_announcements"]
    docs = await collection.find({}).to_list(length=10)
    for doc in docs:
        print(doc)
    await client.close()


asyncio.run(main())
