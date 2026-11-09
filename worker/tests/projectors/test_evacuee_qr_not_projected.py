"""CR-233 FR-EQR-37 / AC-EQR-9: the `evacuee_qr` print log is never projected to MongoDB."""

from pathlib import Path

import worker.mongo as mongo_pkg
import worker.projectors as projectors_pkg
from worker.projectors.evacuee import project_evacuee

EVACUEE_QR_DOC = {
    "_id": "evacuee_qr:01JC8ZQ4V6M2N5R7T9XBDEFGH0",
    "type": "evacuee_qr",
    "schema_v": 1,
    "shelter_code": "SH001",
    "evacuee_id": "evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0",
    "prints": [
        {
            "printed_at": "2026-11-06T08:15:30.123Z",
            "hash": "683508",
            "printed_by": "staff01",
            "source": "profile",
        }
    ],
}


def _python_sources(package) -> list[Path]:
    return list(Path(next(iter(package.__path__))).rglob("*.py"))


def test_no_projector_or_mongo_writer_handles_evacuee_qr():
    offenders = [
        str(p)
        for pkg in (projectors_pkg, mongo_pkg)
        for p in _python_sources(pkg)
        if "evacuee_qr" in p.read_text(encoding="utf-8")
    ]
    assert offenders == []


def test_evacuee_projector_does_not_upsert_an_evacuee_qr_doc():
    action, payload = project_evacuee(EVACUEE_QR_DOC, shelter_code="SH001")
    assert action == "delete"
    assert payload is None


def test_evacuee_qr_id_is_outside_the_evacuee_id_prefix_filters():
    # mongo/occupant.py and mongo/shelter.py select evacuee docs by this prefix.
    assert not EVACUEE_QR_DOC["_id"].startswith("evacuee:")
