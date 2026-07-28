from typing import Any
from tent_model import SyncCheckpoint

async def apply_config(action: str, payload: dict[str, Any] | None) -> None:
    db = SyncCheckpoint.get_motor_collection().database
    collection = db["public_config"]
    if action == "upsert" and payload:
        await collection.replace_one({"_id": payload["_id"]}, payload, upsert=True)
    elif action == "delete" and payload:
        await collection.delete_one({"_id": payload["_id"]})
