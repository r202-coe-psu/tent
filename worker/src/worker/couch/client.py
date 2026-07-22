"""Async CouchDB HTTP client."""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from worker.config import Settings


class CouchClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._auth = (settings.couchdb_user, settings.couchdb_password)
        self._client = httpx.AsyncClient(
            base_url=settings.couch_base_url,
            auth=self._auth,
            timeout=httpx.Timeout(60.0, connect=10.0),
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def get_json(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        response = await self._client.get(path, params=params)
        response.raise_for_status()
        return response.json()

    async def get_doc(self, database: str, doc_id: str) -> dict[str, Any] | None:
        response = await self._client.get(f"/{database}/{doc_id}")
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    async def put_doc(self, database: str, doc: dict[str, Any]) -> dict[str, Any]:
        """PUT a document. On 409, retry once with the latest ``_rev``.

        Returns CouchDB's ``{"ok": true, "id": ..., "rev": ...}`` on success.
        Raises ``httpx.HTTPStatusError`` if the write cannot complete.
        """
        doc_id = doc["_id"]
        response = await self._client.put(f"/{database}/{doc_id}", json=doc)
        if response.status_code != 409:
            response.raise_for_status()
            return response.json()

        existing = await self.get_doc(database, doc_id)
        if existing is None or not existing.get("_rev"):
            response.raise_for_status()
            msg = f"CouchDB 409 for {database}/{doc_id} but document is missing"
            raise RuntimeError(msg)

        retry_doc = {**doc, "_rev": existing["_rev"]}
        retry = await self._client.put(f"/{database}/{doc_id}", json=retry_doc)
        retry.raise_for_status()
        return retry.json()

    async def database_exists(self, database: str) -> bool:
        response = await self._client.get(f"/{database}")
        return response.status_code == 200

    async def ensure_database(self, database: str) -> None:
        """Create DB if missing. CouchDB returns 201 (created) or 412 (already exists)."""
        if await self.database_exists(database):
            return
        response = await self._client.put(f"/{database}")
        if response.status_code in (201, 202, 412):
            return
        response.raise_for_status()

    async def db_update_seq(self, database: str) -> str | int:
        info = await self.get_json(f"/{database}")
        return info.get("update_seq", 0)

    async def iter_all_docs(
        self, database: str, *, batch_size: int = 500
    ) -> AsyncIterator[dict[str, Any]]:
        """Paginate ``_all_docs`` with ``include_docs=true``."""
        startkey: str | None = None
        while True:
            params: dict[str, Any] = {
                "include_docs": "true",
                "limit": batch_size,
            }
            if startkey:
                params["startkey"] = json.dumps(startkey)
                params["skip"] = 1
            data = await self.get_json(f"/{database}/_all_docs", params=params)
            rows = data.get("rows") or []
            if not rows:
                break
            for row in rows:
                doc = row.get("doc")
                if doc and not doc.get("_id", "").startswith("_design"):
                    yield doc
            last_id = rows[-1].get("id")
            if len(rows) < batch_size or not last_id:
                break
            startkey = last_id

    async def stream_changes(
        self,
        database: str,
        *,
        since: str | int,
        include_docs: bool = True,
    ) -> AsyncIterator[dict[str, Any]]:
        params: dict[str, Any] = {
            "feed": "continuous",
            "since": since,
            "heartbeat": 30_000,
        }
        if include_docs:
            params["include_docs"] = "true"

        async with self._client.stream(
            "GET", f"/{database}/_changes", params=params
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                if not line.startswith("{"):
                    continue
                yield json.loads(line)
