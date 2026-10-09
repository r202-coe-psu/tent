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
    conflict = httpx.Response(
        409, json={"error": "conflict"}, request=httpx.Request("PUT", "http://x")
    )
    ok = httpx.Response(
        201,
        json={"ok": True, "id": "donation:1", "rev": "2-abc"},
        request=httpx.Request("PUT", "http://x"),
    )
    client._client.put = AsyncMock(side_effect=[conflict, ok])
    client.get_doc = AsyncMock(return_value={"_id": "donation:1", "_rev": "1-xyz"})

    result = await client.put_doc(
        "shelter_sh001", {"_id": "donation:1", "type": "donation"}
    )
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
    conflict = httpx.Response(
        409, json={"error": "conflict"}, request=httpx.Request("PUT", "http://x")
    )
    client._client.put = AsyncMock(return_value=conflict)
    client.get_doc = AsyncMock(return_value=None)

    with pytest.raises(httpx.HTTPStatusError):
        await client.put_doc("shelter_sh001", {"_id": "donation:missing"})

    await client.close()


def _client() -> CouchClient:
    settings = MagicMock()
    settings.couch_base_url = "http://couch:5984"
    settings.couchdb_user = "admin"
    settings.couchdb_password = "password"
    return CouchClient(settings)


@pytest.mark.asyncio
async def test_find_posts_selector_and_returns_docs():
    client = _client()
    response = httpx.Response(
        200,
        json={"docs": [{"_id": "evacuee:1"}], "bookmark": "x"},
        request=httpx.Request("POST", "http://x"),
    )
    client._client.post = AsyncMock(return_value=response)

    docs = await client.find(
        "shelter_sh001", {"type": "evacuee"}, fields=["_id", "current_stay"], limit=1
    )
    assert docs == [{"_id": "evacuee:1"}]
    call = client._client.post.await_args
    assert call.args[0] == "/shelter_sh001/_find"
    assert call.kwargs["json"] == {
        "selector": {"type": "evacuee"},
        "limit": 1,
        "fields": ["_id", "current_stay"],
    }

    await client.close()


@pytest.mark.asyncio
async def test_find_omits_fields_when_none():
    client = _client()
    response = httpx.Response(
        200, json={"docs": []}, request=httpx.Request("POST", "http://x")
    )
    client._client.post = AsyncMock(return_value=response)

    assert await client.find("shelter_sh001", {"type": "evacuee"}) == []
    assert client._client.post.await_args.kwargs["json"] == {
        "selector": {"type": "evacuee"},
        "limit": 25,
    }

    await client.close()


@pytest.mark.asyncio
async def test_bulk_docs_returns_row_results():
    client = _client()
    rows = [
        {"ok": True, "id": "household:1", "rev": "1-a"},
        {"id": "evacuee:1", "error": "conflict", "reason": "Document update conflict."},
    ]
    response = httpx.Response(201, json=rows, request=httpx.Request("POST", "http://x"))
    client._client.post = AsyncMock(return_value=response)

    docs = [{"_id": "household:1"}, {"_id": "evacuee:1"}]
    assert await client.bulk_docs("shelter_sh001", docs) == rows
    call = client._client.post.await_args
    assert call.args[0] == "/shelter_sh001/_bulk_docs"
    assert call.kwargs["json"] == {"docs": docs}

    await client.close()


@pytest.mark.asyncio
async def test_bulk_docs_raises_on_http_error():
    client = _client()
    response = httpx.Response(
        401, json={"error": "unauthorized"}, request=httpx.Request("POST", "http://x")
    )
    client._client.post = AsyncMock(return_value=response)

    with pytest.raises(httpx.HTTPStatusError):
        await client.bulk_docs("shelter_sh001", [])

    await client.close()
