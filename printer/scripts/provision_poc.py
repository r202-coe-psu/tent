"""Phase 0 PoC: provision CouchDB DB `printing` and (optionally) one `print_device` doc.

Idempotent for the DB part. Uses the CouchDB admin credential, so run it from a dev machine only:

    COUCHDB_ADMIN_URL=http://user:pass@localhost:5984 \\
        uv run python scripts/provision_poc.py --device-id printer-poc-1 \\
        --name "PoC printer" --shelter-code SH001 --host-kind standalone

The device secret is printed ONCE (only its SHA-256 hash is stored). Use --rotate to issue a new
one for an existing device. See docs/plans/print-server-implementation-plan.md §3.1-3.2.
"""

import argparse
import hashlib
import os
import secrets
import sys
from datetime import UTC, datetime
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import httpx

DB = "printing"
CREATED_BY = "provision_poc"
SECURITY = {
    "admins": {"names": [], "roles": ["_admin"]},
    "members": {"names": [], "roles": ["_admin"]},
}
INDEXES = {
    "print-job-printer-status-created": ["printer_id", "status", "created_at"],
    "print-job-status-finished": ["status", "finished_at"],
    "print-job-status-lease": ["status", "lease_until"],
}


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def admin_client(url: str) -> httpx.Client:
    """httpx client for a `http://user:pass@host:port` URL (credentials moved to basic auth)."""
    parts = urlsplit(url)
    if not parts.hostname:
        raise SystemExit("COUCHDB_ADMIN_URL must look like http://user:pass@host:5984")
    host = parts.hostname + (f":{parts.port}" if parts.port else "")
    base = urlunsplit((parts.scheme, host, parts.path.rstrip("/"), "", ""))
    auth = (unquote(parts.username or ""), unquote(parts.password or ""))
    return httpx.Client(base_url=base, auth=auth, timeout=15.0)


def _check(response: httpx.Response, what: str, ok: tuple[int, ...]) -> None:
    if response.status_code not in ok:
        raise SystemExit(f"{what} failed: HTTP {response.status_code} {response.text[:200]}")


def provision_db(http: httpx.Client) -> None:
    created = http.put(f"/{DB}")
    _check(created, f"create DB {DB}", (201, 202, 412))
    print(f"db {DB}: {'exists' if created.status_code == 412 else 'created'}")

    _check(http.put(f"/{DB}/_security", json=SECURITY), "PUT _security", (200,))
    print("_security: admins only")

    _check(http.put(f"/{DB}/_revs_limit", json=100), "PUT _revs_limit", (200,))
    print("_revs_limit: 100")

    for name, fields in INDEXES.items():
        body = {"index": {"fields": fields}, "name": name, "type": "json"}
        response = http.post(f"/{DB}/_index", json=body)
        _check(response, f"create index {name}", (200,))
        print(f"index {name} {fields}: {response.json().get('result')}")


def provision_device(
    http: httpx.Client, device_id: str, name: str, shelter_code: str, host_kind: str, rotate: bool
) -> str:
    doc_url = f"/{DB}/{quote(f'print_device:{device_id}', safe='')}"
    existing = http.get(doc_url)
    if existing.status_code == 200 and not rotate:
        raise SystemExit(f"device {device_id} already exists; use --rotate to issue a new secret")
    if existing.status_code not in (200, 404):
        raise SystemExit(f"read device failed: HTTP {existing.status_code}")

    secret = f"sk_print_{secrets.token_hex(32)}"
    secret_fields = {
        "secret_hash": hashlib.sha256(secret.encode()).hexdigest(),
        "secret_prefix": secret[:16],
        "updated_at": _now(),
    }
    if existing.status_code == 200:
        doc = {**existing.json(), **secret_fields}
    else:
        doc = {
            "_id": f"print_device:{device_id}",
            "type": "print_device",
            "schema_v": 1,
            "device_id": device_id,
            "name": name,
            "shelter_code": shelter_code,
            "station": None,
            "host_kind": host_kind,
            "status": "active",
            "last_seen_at": None,
            "queue_state": "unknown",
            "agent_version": None,
            "created_at": _now(),
            "created_by": CREATED_BY,
            **secret_fields,
        }
    _check(http.put(doc_url, json=doc), "PUT print_device", (201, 202))
    print(f"device {device_id}: {'secret rotated' if existing.status_code == 200 else 'created'}")
    return secret


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Provision DB `printing` (idempotent) and optionally a print_device doc. "
        "Needs env COUCHDB_ADMIN_URL=http://user:pass@host:5984.",
    )
    parser.add_argument("--device-id", help="create/rotate print_device:<DEVICE_ID>")
    parser.add_argument("--name", help="display name (default: the device id)")
    parser.add_argument("--shelter-code", help="required with --device-id")
    parser.add_argument("--host-kind", choices=("standalone", "kiosk"), default="standalone")
    parser.add_argument(
        "--rotate", action="store_true", help="issue a new secret for an existing device"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.device_id and not args.shelter_code:
        parser.error("--shelter-code is required with --device-id")
    if args.rotate and not args.device_id:
        parser.error("--rotate needs --device-id")
    url = os.environ.get("COUCHDB_ADMIN_URL", "").strip()
    if not url:
        parser.error("env COUCHDB_ADMIN_URL is required (http://user:pass@host:5984)")

    try:
        with admin_client(url) as http:
            provision_db(http)
            if not args.device_id:
                return 0
            secret = provision_device(
                http,
                args.device_id,
                args.name or args.device_id,
                args.shelter_code,
                args.host_kind,
                args.rotate,
            )
    except httpx.TransportError as exc:
        print(f"cannot reach CouchDB: {type(exc).__name__}", file=sys.stderr)
        return 1

    print("\nSecret (shown ONCE, not stored; use --rotate to issue a new one). Paste into .env:\n")
    print("TENT_BASE_URL=http://<bff-host>:5173   # BFF reachable from the Pi")
    print(f"DEVICE_ID={args.device_id}")
    print(f"DEVICE_SECRET={secret}")
    print("PRINTER_NAME=tent_xprinter")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
