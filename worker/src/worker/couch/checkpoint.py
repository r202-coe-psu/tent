"""Checkpoint persistence in MongoDB."""

from __future__ import annotations

from datetime import UTC, datetime

from tent_model import SyncCheckpoint

# Worker bookkeeping lives beside the checkpoints, in the same Mongo database (same
# access pattern as ``public_config`` in ``worker.mongo.config``) — no new infra/model.
WORKER_META_COLLECTION = "_worker_meta"
PROJECTION_VERSION_ID = "projection_version"


def _meta_collection():
    return SyncCheckpoint.get_pymongo_collection().database[WORKER_META_COLLECTION]


async def get_checkpoint(database: str) -> SyncCheckpoint | None:
    return await SyncCheckpoint.find_one(SyncCheckpoint.database == database)


async def get_last_seq(database: str) -> str | int:
    checkpoint = await get_checkpoint(database)
    if checkpoint is None:
        return 0
    return checkpoint.last_seq


async def save_checkpoint(database: str, last_seq: str | int) -> None:
    now = datetime.now(UTC)
    existing = await get_checkpoint(database)
    if existing:
        existing.last_seq = last_seq
        existing.updated_at = now
        await existing.save()
        return
    doc = SyncCheckpoint(
        id=database,
        database=database,
        last_seq=last_seq,
        updated_at=now,
    )
    await doc.insert()


async def get_projection_version() -> int | None:
    """Projection version of the last successful full bootstrap, or None if unknown."""
    doc = await _meta_collection().find_one({"_id": PROJECTION_VERSION_ID})
    if doc is None:
        return None
    version = doc.get("version")
    if isinstance(version, int) and not isinstance(version, bool):
        return version
    return None


async def save_projection_version(version: int) -> None:
    await _meta_collection().replace_one(
        {"_id": PROJECTION_VERSION_ID},
        {
            "_id": PROJECTION_VERSION_ID,
            "version": version,
            "updated_at": datetime.now(UTC),
        },
        upsert=True,
    )
