"""``edge-users-copy`` — CR-247 FR-11/FR-11a/FR-13.

Copies central ``_users`` into one ``edge_users_<code>`` database per shelter so an edge
can pull its users from a database that holds nobody else's. CouchDB only: no MongoDB,
no sync-worker bootstrap.

* One ``_users/_changes`` feed (``style=all_docs``), ``_design/*`` skipped. The position
  is checkpointed in ``_users/_local/edge_users_copy`` (never replicated) and resumed
  after a restart. The same doc carries ``last_seq`` / ``last_error`` / ``updated_at``
  for ``central-repl-user.sh --status`` (FR-13).
* Destinations = ``edge_shelters`` ∪ ``roles`` ``shelter:<CODE>`` (CR-171 FR-9), limited to
  shelters whose ``edge_users_<code>`` database exists (listed every 30 s).
* A doc is written as its winning revision plus ``_revisions`` with
  ``new_edits: false``, so revision ids match central and an edge never sees a conflict.
* A database without ``_local/backfill_done`` is a new shelter: every existing user of
  that shelter is copied (paged, 500/page), then ``_local/backfill_done`` is written.

    uv run --project worker edge-users-copy
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import UTC, datetime
from typing import Any

import httpx

from worker.config import load_settings
from worker.couch.client import CouchClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("edge-users-copy")
# httpx logs every request at INFO: one line per edge DB on each 30 s refresh otherwise.
logging.getLogger("httpx").setLevel(logging.WARNING)

USERS_DB = "_users"
CHECKPOINT_ID = "_local/edge_users_copy"
BACKFILL_DONE_ID = "_local/backfill_done"
DB_PREFIX = "edge_users_"
ROLE_PREFIX = "shelter:"
REFRESH_SECONDS = 30.0
CHANGES_BATCH = 100
BACKFILL_PAGE = 500
BULK_GET_CHUNK = 100
POLL_TIMEOUT_MS = 10_000
ERROR_BACKOFF_SECONDS = 5.0


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def edge_db_name(code: str) -> str:
    return f"{DB_PREFIX}{code.lower()}"


def doc_shelter_codes(doc: dict[str, Any]) -> set[str]:
    """Lower-cased shelter codes from ``edge_shelters`` ∪ roles ``shelter:<CODE>``."""
    codes: set[str] = set()
    for code in doc.get("edge_shelters") or []:
        if isinstance(code, str) and code:
            codes.add(code.lower())
    for role in doc.get("roles") or []:
        if (
            isinstance(role, str)
            and role.startswith(ROLE_PREFIX)
            and len(role) > len(ROLE_PREFIX)
        ):
            codes.add(role[len(ROLE_PREFIX) :].lower())
    return codes


def destination_dbs(doc: dict[str, Any], existing_dbs: set[str]) -> set[str]:
    """Databases a user doc must be written to: its shelters that have an edge DB."""
    return {
        name
        for code in doc_shelter_codes(doc)
        if (name := edge_db_name(code)) in existing_dbs
    }


def _is_404(exc: httpx.HTTPStatusError) -> bool:
    return exc.response.status_code == 404


class EdgeUsersCopier:
    def __init__(self, couch: CouchClient) -> None:
        self._couch = couch
        self.existing_dbs: set[str] = set()
        self._last_refresh = float("-inf")
        self._checkpoint: dict[str, Any] = {"_id": CHECKPOINT_ID}

    # --- status / checkpoint -------------------------------------------------

    async def load_checkpoint(self) -> Any:
        doc = await self._couch.get_doc(USERS_DB, CHECKPOINT_ID)
        if doc:
            self._checkpoint = doc
        return self._checkpoint.get("last_seq", 0)

    async def save_checkpoint(self, *, last_seq: Any, error: str | None) -> None:
        doc: dict[str, Any] = {
            "_id": CHECKPOINT_ID,
            "last_seq": last_seq,
            "last_error": error,
            "updated_at": now_iso(),
        }
        if self._checkpoint.get("_rev"):
            doc["_rev"] = self._checkpoint["_rev"]
        result = await self._couch.put_doc(USERS_DB, doc)
        self._checkpoint = {**doc, "_rev": result.get("rev")}

    # --- database list / backfill -------------------------------------------

    async def list_edge_dbs(self) -> set[str]:
        data = await self._couch.get_json(
            "/_all_dbs",
            params={
                "start_key": json.dumps(DB_PREFIX),
                "end_key": json.dumps(DB_PREFIX + "￰"),
            },
        )
        return {name for name in data if name.startswith(DB_PREFIX)}

    async def refresh_dbs(self, *, force: bool = False) -> None:
        """Re-list ``edge_users_*`` (every 30 s) and backfill at most one new DB per call."""
        if not force and time.monotonic() - self._last_refresh < REFRESH_SECONDS:
            return
        self.existing_dbs = await self.list_edge_dbs()
        self._last_refresh = time.monotonic()
        for database in sorted(self.existing_dbs):
            # Checked on every refresh (no cache): ``--remove`` + reinstall inside one
            # interval leaves the name unchanged but the new DB has no marker (FR-11a).
            try:
                if await self._couch.get_doc(database, BACKFILL_DONE_ID) is None:
                    await self.backfill(database)
                    # One backfill per loop turn so a changes batch (revocations) runs between
                    # backfills; refresh again next turn for the remaining new DBs.
                    self._last_refresh = float("-inf")
                    return
            except httpx.HTTPStatusError as exc:
                if not _is_404(exc):
                    raise
                self._last_refresh = float("-inf")  # DB vanished: list again next loop

    async def backfill(self, database: str) -> int:
        """Copy every existing user of ``database``'s shelter, 500 docs per page."""
        code = database.removeprefix(DB_PREFIX)
        copied = 0
        startkey: str | None = None
        while True:
            params: dict[str, Any] = {"include_docs": "true", "limit": BACKFILL_PAGE}
            if startkey is not None:
                params["startkey"] = json.dumps(startkey)
                params["skip"] = 1
            data = await self._couch.get_json(f"/{USERS_DB}/_all_docs", params=params)
            rows = data.get("rows") or []
            if not rows:
                break
            refs: list[tuple[str, str | None]] = []
            for row in rows:
                doc = row.get("doc")
                if not doc or str(doc.get("_id", "")).startswith("_design/"):
                    continue
                if code in doc_shelter_codes(doc):
                    refs.append((doc["_id"], doc.get("_rev")))
            batch = await self.fetch_with_revisions(refs)
            if batch:
                await self._write(database, batch)
                copied += len(batch)
            if len(rows) < BACKFILL_PAGE:
                break
            startkey = rows[-1]["id"]
        await self._couch.put_doc(
            database, {"_id": BACKFILL_DONE_ID, "completed_at": now_iso()}
        )
        logger.info("backfill %s: %d users", database, copied)
        return copied

    # --- copy ---------------------------------------------------------------

    async def fetch_with_revisions(
        self, refs: list[tuple[str, str | None]]
    ) -> list[dict[str, Any]]:
        """Docs at the given revisions plus ``_revisions``, via ``_bulk_get`` (100 per request).

        A revision that is gone (purged / compacted away, ``not_found``) is skipped.
        """
        docs: list[dict[str, Any]] = []
        for start in range(0, len(refs), BULK_GET_CHUNK):
            chunk = refs[start : start + BULK_GET_CHUNK]
            body = {
                "docs": [
                    {"id": doc_id, **({"rev": rev} if rev else {})}
                    for doc_id, rev in chunk
                ]
            }
            # CouchClient has no _bulk_get helper, so post directly (like ``_write``).
            response = await self._couch._client.post(
                f"/{USERS_DB}/_bulk_get", params={"revs": "true"}, json=body
            )
            response.raise_for_status()
            for result in response.json().get("results") or []:
                for entry in result.get("docs") or []:
                    if "ok" in entry:
                        docs.append(entry["ok"])
                    elif (entry.get("error") or {}).get("error") != "not_found":
                        msg = f"_bulk_get {result.get('id')}: {entry.get('error')}"
                        raise RuntimeError(msg)
        return docs

    async def _write(self, database: str, docs: list[dict[str, Any]]) -> bool:
        """``new_edits: false`` bulk write. False when the DB is gone (404)."""
        # CouchClient.bulk_docs has no ``new_edits`` switch, so post directly.
        response = await self._couch._client.post(
            f"/{database}/_bulk_docs", json={"docs": docs, "new_edits": False}
        )
        if response.status_code == 404:
            return False
        response.raise_for_status()
        failures = [row for row in response.json() if row.get("error")]
        if failures:
            msg = f"{database}: bulk write rows failed: {failures[:3]}"
            raise RuntimeError(msg)
        return True

    async def process_batch(self, changes: list[dict[str, Any]]) -> None:
        refs: list[tuple[str, str | None]] = []
        for change in changes:
            doc_id = change.get("id", "")
            if doc_id.startswith("_design/"):
                continue
            revs = change.get("changes") or []
            if not revs:
                continue
            refs.append((doc_id, revs[0].get("rev")))
        per_db: dict[str, list[dict[str, Any]]] = {}
        for doc in await self.fetch_with_revisions(refs):
            for database in destination_dbs(doc, self.existing_dbs):
                per_db.setdefault(database, []).append(doc)
        for database, docs in per_db.items():
            if not await self._write(database, docs):
                # Dropped by ``--remove`` meanwhile: skip it, re-list, not an error.
                self.existing_dbs.discard(database)
                self._last_refresh = float("-inf")

    async def fetch_changes(self, since: Any) -> dict[str, Any]:
        return await self._couch.get_json(
            f"/{USERS_DB}/_changes",
            params={
                "style": "all_docs",
                "feed": "longpoll",
                "timeout": POLL_TIMEOUT_MS,
                "since": since,
                "limit": CHANGES_BATCH,
            },
        )

    async def run_once(self, since: Any) -> Any:
        """One loop turn: refresh DBs, read one changes batch, copy, checkpoint."""
        await self.refresh_dbs()
        data = await self.fetch_changes(since)
        results = data.get("results") or []
        await self.process_batch(results)
        last_seq = data.get("last_seq", since)
        if results or last_seq != since:
            await self.save_checkpoint(last_seq=last_seq, error=None)
        return last_seq

    async def run(self) -> None:
        since = await self.load_checkpoint()
        logger.info("starting from seq %s", since)
        while True:
            try:
                since = await self.run_once(since)
            except Exception as exc:
                logger.exception("copy failed")
                try:
                    await self.save_checkpoint(last_seq=since, error=str(exc)[:500])
                except Exception:
                    logger.exception("could not record status")
                await asyncio.sleep(ERROR_BACKOFF_SECONDS)


async def _amain() -> None:
    couch = CouchClient(load_settings())
    try:
        await EdgeUsersCopier(couch).run()
    finally:
        await couch.close()


def main() -> None:
    try:
        asyncio.run(_amain())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
