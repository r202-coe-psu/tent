"""MongoDB GridFS helpers for Unassigned Registration face photos (#255 / CR-113)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from bson import ObjectId
from gridfs.asynchronous import AsyncGridFSBucket

from .database import get_database

UNASSIGNED_PHOTO_BUCKET = "unassigned_registration_photos"
PHOTO_ID_PREFIX = "gfs:"


@dataclass(frozen=True, slots=True)
class StoredUnassignedPhoto:
	"""One face photo stored as GridFS full (+ optional thumb) files."""

	photo_id: str
	content_type: str
	filename: str
	width: int | None
	height: int | None
	original_size: int | None
	compressed_size: int | None
	thumbnail_size: int | None


def photo_ref(file_id: ObjectId | str) -> str:
	oid = str(file_id)
	return oid if oid.startswith(PHOTO_ID_PREFIX) else f"{PHOTO_ID_PREFIX}{oid}"


def parse_photo_ref(value: str | None) -> ObjectId | None:
	if not value:
		return None
	raw = value.strip()
	if raw.startswith(PHOTO_ID_PREFIX):
		raw = raw[len(PHOTO_ID_PREFIX) :]
	if not ObjectId.is_valid(raw):
		return None
	return ObjectId(raw)


def _bucket() -> AsyncGridFSBucket:
	db = get_database()
	if db is None:
		raise RuntimeError("Mongo database is not initialized")
	return AsyncGridFSBucket(db, bucket_name=UNASSIGNED_PHOTO_BUCKET)


async def store_unassigned_photo(
	*,
	full_bytes: bytes,
	thumb_bytes: bytes | None,
	filename: str,
	content_type: str,
	width: int | None = None,
	height: int | None = None,
	original_size: int | None = None,
	compressed_size: int | None = None,
	thumbnail_size: int | None = None,
) -> StoredUnassignedPhoto:
	"""Persist full (+ optional thumb) into GridFS; return `gfs:{oid}` ref for the full file."""
	bucket = _bucket()
	metadata: dict[str, Any] = {
		"kind": "unassigned_face_full",
		"content_type": content_type,
		"filename": filename,
		"width": width,
		"height": height,
		"original_size": original_size,
		"compressed_size": compressed_size or len(full_bytes),
		"thumbnail_size": thumbnail_size,
	}

	full_id = await bucket.upload_from_stream(
		filename or "face.webp",
		full_bytes,
		metadata=metadata,
	)

	if thumb_bytes:
		thumb_id = await bucket.upload_from_stream(
			f"thumb-{filename or 'face.webp'}",
			thumb_bytes,
			metadata={
				"kind": "unassigned_face_thumb",
				"content_type": content_type,
				"full_id": str(full_id),
			},
		)
		# Link thumb on the full file metadata (best-effort second write via rename no-op —
		# store thumb_id by re-uploading is heavy; keep linkage on thumb only + return sizes).
		metadata["thumb_id"] = str(thumb_id)
		# Update full file metadata with thumb_id via gridfs files collection.
		files = get_database()[f"{UNASSIGNED_PHOTO_BUCKET}.files"]
		await files.update_one({"_id": full_id}, {"$set": {"metadata.thumb_id": str(thumb_id)}})

	return StoredUnassignedPhoto(
		photo_id=photo_ref(full_id),
		content_type=content_type,
		filename=filename,
		width=width,
		height=height,
		original_size=original_size,
		compressed_size=compressed_size or len(full_bytes),
		thumbnail_size=thumbnail_size or (len(thumb_bytes) if thumb_bytes else None),
	)


@dataclass(frozen=True, slots=True)
class LoadedUnassignedPhoto:
	full_bytes: bytes
	thumb_bytes: bytes | None
	content_type: str
	filename: str
	width: int | None
	height: int | None
	original_size: int | None
	compressed_size: int | None
	thumbnail_size: int | None


async def load_unassigned_photo(photo_id: str) -> LoadedUnassignedPhoto | None:
	"""Load full (+ thumb if linked) bytes for claim → Couch image birth."""
	oid = parse_photo_ref(photo_id)
	if oid is None:
		return None
	bucket = _bucket()
	try:
		stream = await bucket.open_download_stream(oid)
	except Exception:
		return None

	full_bytes = await stream.read()
	meta = getattr(stream, "metadata", None) or {}
	content_type = str(meta.get("content_type") or "image/webp")
	filename = str(meta.get("filename") or getattr(stream, "filename", None) or "face.webp")
	thumb_bytes: bytes | None = None
	thumb_id_raw = meta.get("thumb_id")
	if thumb_id_raw and ObjectId.is_valid(str(thumb_id_raw)):
		try:
			thumb_stream = await bucket.open_download_stream(ObjectId(str(thumb_id_raw)))
			thumb_bytes = await thumb_stream.read()
		except Exception:
			thumb_bytes = None

	return LoadedUnassignedPhoto(
		full_bytes=full_bytes,
		thumb_bytes=thumb_bytes,
		content_type=content_type,
		filename=filename,
		width=meta.get("width") if isinstance(meta.get("width"), int) else None,
		height=meta.get("height") if isinstance(meta.get("height"), int) else None,
		original_size=meta.get("original_size") if isinstance(meta.get("original_size"), int) else None,
		compressed_size=(
			meta.get("compressed_size") if isinstance(meta.get("compressed_size"), int) else len(full_bytes)
		),
		thumbnail_size=(
			meta.get("thumbnail_size")
			if isinstance(meta.get("thumbnail_size"), int)
			else (len(thumb_bytes) if thumb_bytes else None)
		),
	)
