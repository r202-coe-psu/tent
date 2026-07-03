"""Checkpoint persistence in MongoDB."""

from __future__ import annotations

from datetime import UTC, datetime

from tent_read_model import SyncCheckpoint


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
