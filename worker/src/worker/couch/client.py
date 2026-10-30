"""Async CouchDB HTTP client."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any
from urllib.parse import quote

import httpx

from worker.config import Settings


def _doc_path(database: str, doc_id: str) -> str:
    """``/{database}/{doc_id}`` with the id percent-encoded.

    A raw id breaks on ``+``, ``#``, ``?``, ``/`` or ``%`` (``org.couchdb.user:a+b@x.co``
    404s), so encode it; ``_design/`` and ``_local/`` keep their literal slash.
    """
    for prefix in ("_design/", "_local/"):
        if doc_id.startswith(prefix):
            return f"/{database}/{prefix}{quote(doc_id[len(prefix) :], safe='')}"
    return f"/{database}/{quote(doc_id, safe='')}"


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
        response = await self._client.get(_doc_path(database, doc_id))
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    async def put_doc(
        self, database: str, doc: dict[str, Any], *, retry_conflict: bool = True
    ) -> dict[str, Any]:
        """PUT a document. On 409, retry once with the latest ``_rev``.

        With ``retry_conflict=False`` a 409 raises instead: the caller put an explicit
        ``_rev`` in ``doc`` and wants to know the document moved, not to overwrite it.

        Returns CouchDB's ``{"ok": true, "id": ..., "rev": ...}`` on success.
        Raises ``httpx.HTTPStatusError`` if the write cannot complete.
        """
        doc_id = doc["_id"]
        response = await self._client.put(_doc_path(database, doc_id), json=doc)
        if response.status_code != 409 or not retry_conflict:
            response.raise_for_status()
            return response.json()

        existing = await self.get_doc(database, doc_id)
        if existing is None or not existing.get("_rev"):
            response.raise_for_status()
            msg = f"CouchDB 409 for {database}/{doc_id} but document is missing"
            raise RuntimeError(msg)

        retry_doc = {**doc, "_rev": existing["_rev"]}
        retry = await self._client.put(_doc_path(database, doc_id), json=retry_doc)
        retry.raise_for_status()
        return retry.json()

    async def update_doc(
        self,
        database: str,
        doc_id: str,
        mutate: Callable[[dict[str, Any]], Awaitable[dict[str, Any] | None]],
        *,
        attempts: int = 3,
    ) -> dict[str, Any] | None:
        """Read-modify-write one document, re-reading it on every ``409``.

        Unlike ``put_doc`` (which replays its own, possibly stale, body with the latest
        ``_rev``) the change is re-derived from the *fresh* document on each attempt:
        ``mutate`` gets the current doc and returns the full new doc, or ``None`` when its
        precondition no longer holds (nothing is written). Returns the written doc
        (with its new ``_rev``), or ``None`` when the doc is missing or ``mutate``
        declined. Raises ``httpx.HTTPStatusError`` if the write fails, or still conflicts
        after ``attempts`` tries.
        """
        for attempt in range(attempts):
            current = await self.get_doc(database, doc_id)
            if current is None:
                return None
            changed = await mutate(current)
            if changed is None:
                return None
            response = await self._client.put(_doc_path(database, doc_id), json=changed)
            if response.status_code == 409 and attempt + 1 < attempts:
                continue
            response.raise_for_status()
            return {**changed, "_rev": response.json().get("rev")}
        return None  # unreachable: the last attempt returns or raises

    async def find(
        self,
        database: str,
        selector: dict[str, Any],
        *,
        fields: list[str] | None = None,
        limit: int = 25,
        use_index: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Mango ``_find`` — returns the matching ``docs`` list.

        ``use_index`` is ``[ddoc, name]``; a partial index is only ever used when named.
        """
        body: dict[str, Any] = {"selector": selector, "limit": limit}
        if fields is not None:
            body["fields"] = fields
        if use_index is not None:
            body["use_index"] = use_index
        response = await self._client.post(f"/{database}/_find", json=body)
        response.raise_for_status()
        return response.json().get("docs") or []

    async def bulk_docs(
        self, database: str, docs: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """POST ``_bulk_docs`` — returns CouchDB's per-row results.

        Rows carry ``{"id", "rev"}`` on success or ``{"id", "error", "reason"}``
        on failure (e.g. ``conflict``); callers decide which row errors matter.
        """
        response = await self._client.post(
            f"/{database}/_bulk_docs", json={"docs": docs}
        )
        response.raise_for_status()
        return response.json()

    async def database_exists(self, database: str) -> bool:
        response = await self._client.get(f"/{database}")
        return response.status_code == 200

    async def database_missing(self, database: str) -> bool:
        """True only when CouchDB answers 404; auth failures and 5xx are NOT "missing".

        Read-only. Callers that delete data on the strength of "the database is gone"
        must use this rather than ``not database_exists`` (which also reads 401/500 as gone).
        """
        response = await self._client.get(f"/{database}")
        return response.status_code == 404

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
