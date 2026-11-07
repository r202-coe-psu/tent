import base64
import importlib.util
import json
from pathlib import Path

import httpx
import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "enqueue.py"
spec = importlib.util.spec_from_file_location("enqueue_script", SCRIPT)
enqueue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enqueue)

DEVICE = {
    "_id": "print_device:printer-poc-1",
    "type": "print_device",
    "shelter_code": "SH001",
    "status": "active",
}


@pytest.fixture
def couch(monkeypatch):
    """Fake CouchDB behind the script's admin client; records (method, path, body)."""
    calls: list[tuple[str, str, dict | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        calls.append((request.method, request.url.raw_path.decode(), body))
        if request.method == "GET":
            if request.url.path == "/printing_devices/print_device:printer-poc-1":
                return httpx.Response(200, json=DEVICE)
            return httpx.Response(404, json={"error": "not_found"})
        return httpx.Response(201, json={"ok": True})

    monkeypatch.setenv("COUCHDB_ADMIN_URL", "http://admin:pw@couch.test:5984")
    monkeypatch.setattr(
        enqueue,
        "admin_client",
        lambda url: httpx.Client(
            base_url="http://couch.test:5984", transport=httpx.MockTransport(handler)
        ),
    )
    return calls


def test_device_is_read_from_printing_devices_and_job_is_written_to_its_shelter_db(couch, capsys):
    exit_code = enqueue.main(["--device-id", "printer-poc-1", "--count", "2"])

    assert exit_code == 0
    methods_and_paths = [(method, path.split("%3A")[0]) for method, path, _ in couch]
    assert methods_and_paths == [
        ("GET", "/printing_devices/print_device"),
        ("PUT", "/printing_sh001/print_job"),
    ]
    doc = couch[1][2]
    assert doc["_id"].startswith("print_job:")
    assert doc["type"] == "print_job"
    assert doc["shelter_code"] == "SH001"
    assert doc["printer_id"] == "print_device:printer-poc-1"
    assert doc["status"] == "pending"
    assert doc["label_count"] == 2
    assert sorted(doc["_attachments"]) == ["label-000.png", "label-001.png"]
    first = doc["_attachments"]["label-000.png"]
    assert first["content_type"] == "image/png"
    assert base64.b64decode(first["data"]).startswith(b"\x89PNG")


def test_job_doc_has_the_final_schema_fields_with_literal_timestamps():
    from datetime import UTC, datetime

    doc = enqueue.build_job_doc(
        DEVICE,
        [b"png"],
        ttl_sec=120,
        source="walk_in",
        job_id="01J9ZABC",
        now=datetime(2026, 11, 2, 10, 0, 0, tzinfo=UTC),
    )

    assert doc == {
        "_id": "print_job:01J9ZABC",
        "type": "print_job",
        "schema_v": 1,
        "shelter_code": "SH001",
        "printer_id": "print_device:printer-poc-1",
        "status": "pending",
        "label_count": 1,
        "source": "walk_in",
        "created_at": "2026-11-02T10:00:00.000Z",
        "created_by": "enqueue_poc",
        "expires_at": "2026-11-02T10:02:00.000Z",
        "claimed_at": None,
        "lease_until": None,
        "finished_at": None,
        "printed": 0,
        "error_code": None,
        "_attachments": {
            "label-000.png": {"content_type": "image/png", "data": "cG5n"},
        },
    }
