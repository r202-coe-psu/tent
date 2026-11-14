"""Unit tests for edge-users-copy (CR-247 FR-11, FR-11a, FR-13) against a fake CouchDB."""

import json
from typing import Any

import httpx
import pytest

from worker.cli import edge_users_copy as euc
from worker.cli.edge_users_copy import (
    EdgeUsersCopier,
    doc_role_codes,
    split_destinations,
)


def _resp(status: int, body: Any = None) -> httpx.Response:
    return httpx.Response(
        status,
        json=body if body is not None else {},
        request=httpx.Request("GET", "http://x"),
    )


class FakeCouch:
    """Just enough of CouchClient + its ``_client`` for the copier."""

    def __init__(self, users: dict[str, dict], dbs: list[str]) -> None:
        self.users = users
        self.dbs: dict[str, dict[str, dict]] = {name: {} for name in dbs}
        self.local: dict[str, dict] = {}  # "_users/_local/..." and "<db>/_local/..."
        self.writes: list[tuple[str, list[dict], Any]] = []
        self.users_pages: list[int] = []
        self.bulk_gets: list[int] = []
        self.changes: list[dict] = []
        self._client = self
        self.status_override: dict[str, int] = {}

    async def get_json(self, path: str, params: dict | None = None) -> Any:
        params = params or {}
        if path == "/_all_dbs":
            return sorted(self.dbs)
        if path == "/_users/_all_docs":
            ids = sorted(self.users)
            if "startkey" in params:
                start = json.loads(params["startkey"])
                ids = [i for i in ids if i > start]
            page = ids[: params["limit"]]
            self.users_pages.append(len(page))
            return {"rows": [{"id": i, "doc": {**self.users[i]}} for i in page]}
        if path == "/_users/_changes":
            return {"results": self.changes, "last_seq": f"{len(self.changes)}-x"}
        raise httpx.HTTPStatusError(
            "nf", request=httpx.Request("GET", "http://x"), response=_resp(404)
        )

    async def get_doc(self, database: str, doc_id: str) -> dict | None:
        return self.local.get(f"{database}/{doc_id}")

    async def put_doc(self, database: str, doc: dict, **_: Any) -> dict:
        self.local[f"{database}/{doc['_id']}"] = doc
        return {"ok": True, "rev": "0-1"}

    async def get(self, path: str) -> httpx.Response:  # _client.get
        _, database, doc_id = path.split("/", 2)
        if database not in self.dbs:
            return _resp(
                404, {"error": "not_found", "reason": "Database does not exist."}
            )
        doc = self.dbs[database].get(doc_id)
        if doc is None or doc.get("_deleted"):
            return _resp(404, {"error": "not_found", "reason": "missing"})
        return _resp(200, doc)

    async def post(
        self, path: str, json: dict, params: dict | None = None
    ) -> httpx.Response:  # _client.post
        if path == "/_users/_bulk_get":
            assert (params or {}).get("revs") == "true"
            self.bulk_gets.append(len(json["docs"]))
            results = []
            for ref in json["docs"]:
                doc = self.users.get(ref["id"])
                if doc is None or ref.get("rev", doc["_rev"]) != doc["_rev"]:
                    entry = {"error": {"id": ref["id"], "error": "not_found"}}
                else:
                    entry = {"ok": {**doc, "_revisions": {"start": 1, "ids": ["a"]}}}
                results.append({"id": ref["id"], "docs": [entry]})
            return _resp(200, {"results": results})
        database = path.split("/")[1]
        if database in self.status_override or database not in self.dbs:
            return _resp(self.status_override.get(database, 404))
        self.writes.append((database, json["docs"], json.get("new_edits", True)))
        for d in json["docs"]:
            self.dbs[database][d["_id"]] = d
        return _resp(201, [{"id": d["_id"], "rev": d["_rev"]} for d in json["docs"]])


def user(uid: str, rev: str = "1-a", **fields: Any) -> dict:
    return {"_id": uid, "_rev": rev, **fields}


def test_destination_split_write_for_roles_remove_for_leaver_shelters():
    doc = user(
        "u",
        edge_shelters=["SH001", "SH002"],
        roles=["shelter:SH002", "admin", "shelter:", "shelter:SH003"],
    )
    assert doc_role_codes(doc) == {"sh002", "sh003"}
    dbs = {
        "edge_users_sh001",
        "edge_users_sh002",
        "edge_users_sh003",
        "edge_users_sh004",
    }
    write, remove = split_destinations(doc, dbs)
    assert write == {"edge_users_sh002", "edge_users_sh003"}
    assert remove == {"edge_users_sh001"}


def test_shelters_without_db_are_skipped():
    doc = user("u", edge_shelters=["SH008"], roles=["shelter:SH009"])
    assert split_destinations(doc, {"edge_users_sh001"}) == (set(), set())


def test_edge_shelters_only_user_is_a_leaver_not_a_write():
    doc = user("u", edge_shelters=["SH001"])
    assert split_destinations(doc, {"edge_users_sh001"}) == (
        set(),
        {"edge_users_sh001"},
    )


async def test_user_in_two_shelters_goes_to_both_only():
    couch = FakeCouch(
        {"u1": user("u1", roles=["shelter:SH001", "shelter:SH002"])},
        ["edge_users_sh001", "edge_users_sh002", "edge_users_sh003"],
    )
    copier = EdgeUsersCopier(couch)
    await copier.refresh_dbs(force=True)
    couch.writes.clear()
    await copier.process_batch([{"id": "u1", "changes": [{"rev": "1-a"}]}])
    assert sorted(w[0] for w in couch.writes) == [
        "edge_users_sh001",
        "edge_users_sh002",
    ]
    for _, docs, new_edits in couch.writes:
        assert new_edits is False
        assert docs[0]["_revisions"]


async def test_design_docs_skipped():
    couch = FakeCouch(
        {"_design/x": user("_design/x", roles=["shelter:SH001"])}, ["edge_users_sh001"]
    )
    copier = EdgeUsersCopier(couch)
    copier.existing_dbs = {"edge_users_sh001"}
    await copier.process_batch([{"id": "_design/x", "changes": [{"rev": "1-a"}]}])
    assert couch.writes == []


async def test_404_on_write_skips_shelter_and_forces_relist():
    couch = FakeCouch(
        {"u1": user("u1", roles=["shelter:SH001", "shelter:SH002"])},
        ["edge_users_sh002"],
    )
    copier = EdgeUsersCopier(couch)
    copier.existing_dbs = {"edge_users_sh001", "edge_users_sh002"}  # sh001 just removed
    await copier.process_batch([{"id": "u1", "changes": [{"rev": "1-a"}]}])
    assert [w[0] for w in couch.writes] == ["edge_users_sh002"]
    assert copier.existing_dbs == {"edge_users_sh002"}
    assert copier._last_refresh == float("-inf") and not copier._pass_open


async def test_checkpoint_saved_and_resumed():
    couch = FakeCouch({"u1": user("u1", roles=["shelter:SH001"])}, ["edge_users_sh001"])
    couch.changes = [{"id": "u1", "changes": [{"rev": "1-a"}]}]
    copier = EdgeUsersCopier(couch)
    since = await copier.load_checkpoint()
    assert since == 0
    seq = await copier.run_once(since)
    cp = couch.local["_users/_local/edge_users_copy"]
    assert cp["last_seq"] == seq == "1-x"
    assert cp["last_error"] is None and cp["updated_at"]

    restarted = EdgeUsersCopier(couch)
    assert await restarted.load_checkpoint() == "1-x"


async def test_backfill_pages_filters_and_is_idempotent(monkeypatch):
    monkeypatch.setattr(euc, "BACKFILL_PAGE", 2)
    users = {
        f"u{i}": user(f"u{i}", roles=["shelter:SH001"] if i % 2 else [])
        for i in range(5)
    }
    couch = FakeCouch(users, ["edge_users_sh001"])
    copier = EdgeUsersCopier(couch)
    await copier.refresh_dbs(force=True)
    assert couch.users_pages == [2, 2, 1]
    copied = [d["_id"] for _, docs, _ in couch.writes for d in docs]
    assert copied == ["u1", "u3"]
    assert "edge_users_sh001/_local/backfill_done" in couch.local

    couch.writes.clear()
    couch.users_pages.clear()
    await copier.refresh_dbs(force=True)  # marker present: no second backfill
    assert couch.writes == [] and couch.users_pages == []


async def test_backfill_skips_users_with_only_edge_shelters():
    users = {
        "u1": user("u1", roles=["shelter:SH001"]),
        "u2": user("u2", edge_shelters=["SH001"]),  # role dropped earlier
    }
    couch = FakeCouch(users, ["edge_users_sh001"])
    await EdgeUsersCopier(couch).refresh_dbs(force=True)
    assert [d["_id"] for _, docs, _ in couch.writes for d in docs] == ["u1"]


async def test_recreated_db_is_backfilled_again():
    couch = FakeCouch({"u1": user("u1", roles=["shelter:SH001"])}, ["edge_users_sh001"])
    copier = EdgeUsersCopier(couch)
    await copier.refresh_dbs(force=True)
    del couch.local["edge_users_sh001/_local/backfill_done"]  # --remove + reinstall
    couch.writes.clear()
    await copier.refresh_dbs(force=True)
    assert len(couch.writes) == 1


async def test_one_backfill_per_turn_lets_changes_run_between():
    couch = FakeCouch(
        {"u1": user("u1", roles=["shelter:SH001", "shelter:SH002"])},
        ["edge_users_sh001", "edge_users_sh002"],
    )
    couch.changes = [{"id": "u1", "changes": [{"rev": "1-a"}]}]
    copier = EdgeUsersCopier(couch)

    await copier.run_once(0)
    assert "edge_users_sh001/_local/backfill_done" in couch.local
    assert "edge_users_sh002/_local/backfill_done" not in couch.local
    # the changes batch was processed in the same turn, for both DBs
    assert sorted(w[0] for w in couch.writes[1:]) == [
        "edge_users_sh001",
        "edge_users_sh002",
    ]

    await copier.run_once("1-x")  # next turn picks up the remaining DB at once
    assert "edge_users_sh002/_local/backfill_done" in couch.local


async def test_changes_fetched_with_bulk_get_in_chunks(monkeypatch):
    monkeypatch.setattr(euc, "BULK_GET_CHUNK", 2)
    users = {f"u{i}": user(f"u{i}", roles=["shelter:SH001"]) for i in range(5)}
    couch = FakeCouch(users, ["edge_users_sh001"])
    copier = EdgeUsersCopier(couch)
    copier.existing_dbs = {"edge_users_sh001"}
    changes = [{"id": i, "changes": [{"rev": "1-a"}]} for i in sorted(users)]
    changes.append({"id": "gone", "changes": [{"rev": "2-b"}]})  # purged: skipped
    await copier.process_batch(changes)
    assert couch.bulk_gets == [2, 2, 2]
    assert len(couch.writes) == 1  # one bulk write per destination DB
    assert [d["_id"] for d in couch.writes[0][1]] == sorted(users)


async def test_pending_backfills_do_not_recheck_confirmed_markers():
    n = 30
    dbs = [f"edge_users_s{i:03d}" for i in range(n)]
    couch = FakeCouch({"u1": user("u1", roles=["shelter:S000"])}, dbs)
    marker_gets = 0
    orig = couch.get_doc

    async def counting(database: str, doc_id: str) -> dict | None:
        nonlocal marker_gets
        marker_gets += doc_id == "_local/backfill_done"
        return await orig(database, doc_id)

    couch.get_doc = counting  # type: ignore[method-assign]
    copier = EdgeUsersCopier(couch)
    turns = 0
    while len(couch.local) < n:  # one backfill marker per DB
        await copier.refresh_dbs()
        turns += 1
    assert turns == n
    assert marker_gets == n  # every marker read once, not n*(n+1)/2

    await copier.refresh_dbs()  # pass finished: nothing due for 30 s
    assert marker_gets == n
    await copier.refresh_dbs(force=True)  # forced: a new pass re-reads them all
    assert marker_gets == 2 * n


async def test_failure_leaves_checkpoint_and_records_error(monkeypatch):
    couch = FakeCouch({"u1": user("u1", roles=["shelter:SH001"])}, ["edge_users_sh001"])
    couch.changes = [{"id": "u1", "changes": [{"rev": "1-a"}]}]
    copier = EdgeUsersCopier(couch)
    await copier.refresh_dbs(force=True)
    couch.status_override["edge_users_sh001"] = 401
    with pytest.raises(httpx.HTTPStatusError):
        await copier.run_once(0)
    await copier.save_checkpoint(last_seq=0, error="boom")
    assert couch.local["_users/_local/edge_users_copy"]["last_error"] == "boom"


LEAVER = {"id": "u1", "changes": [{"rev": "2-b"}]}


def _leaver_couch(**fields: Any) -> FakeCouch:
    doc = user("u1", rev="2-b", edge_shelters=["SH001", "SH002"], **fields)
    return FakeCouch({"u1": doc}, ["edge_users_sh001", "edge_users_sh002"])


async def test_leaver_absent_from_edge_db_writes_nothing_there():
    couch = _leaver_couch(roles=["shelter:SH002"])
    copier = EdgeUsersCopier(couch)
    copier.existing_dbs = {"edge_users_sh001", "edge_users_sh002"}
    await copier.process_batch([LEAVER])
    assert [w[0] for w in couch.writes] == ["edge_users_sh002"]


async def test_leaver_present_gets_tombstone_and_current_shelter_still_written():
    couch = _leaver_couch(roles=["shelter:SH002"])
    couch.dbs["edge_users_sh001"]["u1"] = user("u1", rev="1-a")
    copier = EdgeUsersCopier(couch)
    copier.existing_dbs = {"edge_users_sh001", "edge_users_sh002"}
    await copier.process_batch([LEAVER])
    by_db = {w[0]: w for w in couch.writes}
    assert by_db["edge_users_sh002"][2] is False
    _, docs, _ = by_db["edge_users_sh001"]
    assert docs == [{"_id": "u1", "_rev": "1-a", "_deleted": True}]


async def test_second_change_after_tombstone_writes_nothing():
    couch = _leaver_couch(roles=["shelter:SH002"])
    couch.dbs["edge_users_sh001"]["u1"] = user("u1", rev="1-a")
    copier = EdgeUsersCopier(couch)
    copier.existing_dbs = {"edge_users_sh001", "edge_users_sh002"}
    await copier.process_batch([LEAVER])
    couch.writes.clear()
    await copier.process_batch([LEAVER])
    assert [w[0] for w in couch.writes] == ["edge_users_sh002"]


async def test_user_returning_is_written_again_over_the_tombstone():
    couch = _leaver_couch(roles=["shelter:SH002"])
    couch.dbs["edge_users_sh001"]["u1"] = user("u1", rev="1-a")
    copier = EdgeUsersCopier(couch)
    copier.existing_dbs = {"edge_users_sh001", "edge_users_sh002"}
    await copier.process_batch([LEAVER])
    couch.writes.clear()
    couch.users["u1"] = user(
        "u1", rev="3-c", edge_shelters=["SH001", "SH002"], roles=["shelter:SH001"]
    )
    await copier.process_batch([{"id": "u1", "changes": [{"rev": "3-c"}]}])
    by_db = {w[0]: w for w in couch.writes}
    _, docs, new_edits = by_db["edge_users_sh001"]
    assert new_edits is False
    assert docs[0]["_rev"] == "3-c" and docs[0]["_revisions"]
    assert "_deleted" not in docs[0]


async def test_404_on_tombstone_drops_db_and_forces_relist():
    couch = _leaver_couch(roles=["shelter:SH002"])
    del couch.dbs["edge_users_sh001"]  # removed after the last listing
    copier = EdgeUsersCopier(couch)
    copier.existing_dbs = {"edge_users_sh001", "edge_users_sh002"}
    await copier.process_batch([LEAVER])
    assert copier.existing_dbs == {"edge_users_sh002"}
    assert copier._last_refresh == float("-inf") and not copier._pass_open
