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


def _response(status: int, **body) -> httpx.Response:
    return httpx.Response(status, json=body, request=httpx.Request("PUT", "http://x"))


@pytest.mark.asyncio
async def test_update_doc_rereads_and_rederives_the_change_on_409():
    client = _client()
    client.get_doc = AsyncMock(
        side_effect=[
            {"_id": "d", "_rev": "1-a", "status": "open", "n": 1},
            {"_id": "d", "_rev": "2-b", "status": "open", "n": 2},
        ]
    )
    client._client.put = AsyncMock(
        side_effect=[
            _response(409, error="conflict"),
            _response(201, ok=True, rev="3-c"),
        ]
    )

    async def close(doc):
        return {**doc, "status": "closed"}

    written = await client.update_doc("db", "d", close)

    first, second = (call.kwargs["json"] for call in client._client.put.await_args_list)
    assert first == {"_id": "d", "_rev": "1-a", "status": "closed", "n": 1}
    # the retry carries the *fresh* doc's other fields, not the stale body
    assert second == {"_id": "d", "_rev": "2-b", "status": "closed", "n": 2}
    assert written == {**second, "_rev": "3-c"}
    await client.close()


@pytest.mark.asyncio
async def test_update_doc_stops_when_the_precondition_no_longer_holds_after_a_409():
    client = _client()
    client.get_doc = AsyncMock(
        side_effect=[
            {"_id": "d", "_rev": "1-a", "status": "open"},
            {"_id": "d", "_rev": "2-b", "status": "taken"},
        ]
    )
    client._client.put = AsyncMock(return_value=_response(409, error="conflict"))

    async def close_if_open(doc):
        return {**doc, "status": "closed"} if doc["status"] == "open" else None

    assert await client.update_doc("db", "d", close_if_open) is None
    assert client._client.put.await_count == 1  # no second write over the new state
    await client.close()


@pytest.mark.asyncio
async def test_update_doc_returns_none_for_a_missing_doc_and_raises_after_the_attempts():
    client = _client()
    client.get_doc = AsyncMock(return_value=None)
    client._client.put = AsyncMock()

    async def touch(doc):
        return doc

    assert await client.update_doc("db", "gone", touch) is None
    client._client.put.assert_not_awaited()

    client.get_doc = AsyncMock(return_value={"_id": "d", "_rev": "1-a"})
    client._client.put = AsyncMock(return_value=_response(409, error="conflict"))
    with pytest.raises(httpx.HTTPStatusError):
        await client.update_doc("db", "d", touch, attempts=3)
    assert client._client.put.await_count == 3
    assert client.get_doc.await_count == 3
    await client.close()


@pytest.mark.asyncio
async def test_update_doc_does_not_retry_other_errors():
    client = _client()
    client.get_doc = AsyncMock(return_value={"_id": "d", "_rev": "1-a"})
    client._client.put = AsyncMock(return_value=_response(500, error="boom"))

    async def touch(doc):
        return doc

    with pytest.raises(httpx.HTTPStatusError):
        await client.update_doc("db", "d", touch)
    assert client._client.put.await_count == 1
    await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "expected"),
    [(404, True), (200, False), (401, False), (403, False), (500, False), (503, False)],
)
async def test_database_missing_is_true_only_for_404(status: int, expected: bool):
    client = _client()
    client._client.get = AsyncMock(
        return_value=httpx.Response(
            status, json={}, request=httpx.Request("GET", "http://x")
        )
    )

    assert await client.database_missing("shelter_sh001") is expected
    assert client._client.get.await_args.args[0] == "/shelter_sh001"
    await client.close()


@pytest.mark.asyncio
async def test_database_missing_propagates_connection_errors():
    client = _client()
    client._client.get = AsyncMock(side_effect=httpx.ConnectError("down"))

    with pytest.raises(httpx.ConnectError):  # never reported as "missing"
        await client.database_missing("shelter_sh001")
    await client.close()


@pytest.mark.asyncio
async def test_put_doc_without_conflict_retry_raises_on_409():
    settings = MagicMock()
    settings.couch_base_url = "http://couch:5984"
    settings.couchdb_user = "admin"
    settings.couchdb_password = "password"

    client = CouchClient(settings)
    conflict = httpx.Response(
        409, json={"error": "conflict"}, request=httpx.Request("PUT", "http://x")
    )
    client._client.put = AsyncMock(return_value=conflict)
    client.get_doc = AsyncMock()

    with pytest.raises(httpx.HTTPStatusError):
        await client.put_doc(
            "shelter_sh001",
            {"_id": "donation:1", "_rev": "1-xyz"},
            retry_conflict=False,
        )
    assert client._client.put.await_count == 1
    client.get_doc.assert_not_awaited()

    await client.close()
