"""Unit tests for CouchClient.put_doc conflict retry."""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from worker.couch.client import CouchClient


@pytest.mark.asyncio
async def test_put_doc_retries_with_rev_on_409():
    settings = MagicMock()
    settings.couch_base_url = "http://couch:5984"
    settings.couchdb_user = "admin"
    settings.couchdb_password = "password"

    client = CouchClient(settings)
    conflict = httpx.Response(409, json={"error": "conflict"}, request=httpx.Request("PUT", "http://x"))
    ok = httpx.Response(
        201,
        json={"ok": True, "id": "donation:1", "rev": "2-abc"},
        request=httpx.Request("PUT", "http://x"),
    )
    client._client.put = AsyncMock(side_effect=[conflict, ok])
    client.get_doc = AsyncMock(return_value={"_id": "donation:1", "_rev": "1-xyz"})

    result = await client.put_doc("shelter_sh001", {"_id": "donation:1", "type": "donation"})
    assert result["ok"] is True
    assert client._client.put.await_count == 2
    assert client._client.put.await_args_list[1].kwargs["json"]["_rev"] == "1-xyz"

    await client.close()


@pytest.mark.asyncio
async def test_put_doc_raises_when_409_and_doc_missing():
    settings = MagicMock()
    settings.couch_base_url = "http://couch:5984"
    settings.couchdb_user = "admin"
    settings.couchdb_password = "password"

    client = CouchClient(settings)
    conflict = httpx.Response(409, json={"error": "conflict"}, request=httpx.Request("PUT", "http://x"))
    client._client.put = AsyncMock(return_value=conflict)
    client.get_doc = AsyncMock(return_value=None)

    with pytest.raises(httpx.HTTPStatusError):
        await client.put_doc("shelter_sh001", {"_id": "donation:missing"})

    await client.close()
