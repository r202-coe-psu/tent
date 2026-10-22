"""Phase 0 PoC: simulate the staff API by writing `print_job` docs straight into DB `printing`.

    COUCHDB_ADMIN_URL=http://user:pass@localhost:5984 \\
        uv run python scripts/enqueue.py --device-id printer-poc-1 --count 3 --wait

Timestamps (`created_at`, `expires_at`) use THIS machine's UTC clock because the CouchDB server
clock is not available here; the real BFF uses the server clock. Keep this machine's clock close
to the BFF's, or P4 (TTL expiry) results are skewed.

Labels come from `--png FILE` (repeatable) or `--count N` generated test labels: 640x480 1-bit
PNG (80x60 mm at 203 dpi), black border, big label index plus a small job sequence number top-left.
`--wait` polls each job doc until printed/failed/expired and prints a latency table; "claim_s" is
enqueue -> first time seen `printing`, "total_s" is enqueue -> terminal (includes CUPS finishing
the physical print, so it is an upper bound for P1). With --repeat, median and p95 are printed.
"""

import argparse
import base64
import math
import os
import secrets
import statistics
import struct
import sys
import time
import zlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import httpx

DB = "printing"
TERMINAL = {"printed", "failed", "expired"}
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
WIDTH, HEIGHT = 640, 480

# 5x7 block digits, one string per row, '#' = black.
DIGITS = {
    "0": ["#####", "#...#", "#...#", "#...#", "#...#", "#...#", "#####"],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": ["#####", "....#", "....#", "#####", "#....", "#....", "#####"],
    "3": ["#####", "....#", "....#", "#####", "....#", "....#", "#####"],
    "4": ["#...#", "#...#", "#...#", "#####", "....#", "....#", "....#"],
    "5": ["#####", "#....", "#....", "#####", "....#", "....#", "#####"],
    "6": ["#####", "#....", "#....", "#####", "#...#", "#...#", "#####"],
    "7": ["#####", "....#", "....#", "...#.", "..#..", "..#..", "..#.."],
    "8": ["#####", "#...#", "#...#", "#####", "#...#", "#...#", "#####"],
    "9": ["#####", "#...#", "#...#", "#####", "....#", "....#", "#####"],
}


def new_ulid() -> str:
    """Time-based ULID: 48-bit ms timestamp + 80 random bits, Crockford base32 (26 chars)."""
    value = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    return "".join(CROCKFORD[(value >> shift) & 31] for shift in range(125, -1, -5))


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _draw_number(pixels: list[bytearray], text: str, x: int, y: int, scale: int) -> None:
    for position, char in enumerate(text):
        for row, line in enumerate(DIGITS[char]):
            for col, cell in enumerate(line):
                if cell != "#":
                    continue
                left = x + (position * 6 + col) * scale
                for dy in range(scale):
                    pixels[y + row * scale + dy][left : left + scale] = b"\x00" * scale


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))


def make_label_png(index: int, job_seq: int) -> bytes:
    """1-bit grayscale PNG: border, big `index`, small `job_seq` top-left (white = 1)."""
    pixels = [bytearray(b"\x01" * WIDTH) for _ in range(HEIGHT)]
    border = 8
    for y in range(HEIGHT):
        for x in range(WIDTH):
            if y < border or y >= HEIGHT - border or x < border or x >= WIDTH - border:
                pixels[y][x] = 0
    big = str(index)
    scale = 24
    big_width = (len(big) * 6 - 1) * scale
    _draw_number(pixels, big, (WIDTH - big_width) // 2, (HEIGHT - 7 * scale) // 2, scale)
    _draw_number(pixels, str(job_seq), 24, 24, 6)

    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter: none
        for start in range(0, WIDTH, 8):
            byte = 0
            for bit in row[start : start + 8]:
                byte = (byte << 1) | bit
            raw.append(byte)
    header = struct.pack(">IIBBBBB", WIDTH, HEIGHT, 1, 0, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _png_chunk(b"IEND", b"")
    )


def admin_client(url: str) -> httpx.Client:
    parts = urlsplit(url)
    if not parts.hostname:
        raise SystemExit("COUCHDB_ADMIN_URL must look like http://user:pass@host:5984")
    host = parts.hostname + (f":{parts.port}" if parts.port else "")
    base = urlunsplit((parts.scheme, host, parts.path.rstrip("/"), "", ""))
    auth = (unquote(parts.username or ""), unquote(parts.password or ""))
    return httpx.Client(base_url=base, auth=auth, timeout=15.0)


def _doc_url(doc_id: str) -> str:
    return f"/{DB}/{quote(doc_id, safe='')}"


def enqueue_job(
    http: httpx.Client,
    device: dict,
    pngs: list[bytes],
    ttl_sec: int,
    source: str,
) -> str:
    now = datetime.now(UTC)
    doc_id = f"print_job:{new_ulid()}"
    doc = {
        "_id": doc_id,
        "type": "print_job",
        "schema_v": 1,
        "shelter_code": device["shelter_code"],
        "printer_id": device["_id"],
        "status": "pending",
        "label_count": len(pngs),
        "source": source,
        "created_at": _iso(now),
        "created_by": "enqueue_poc",
        "expires_at": _iso(now + timedelta(seconds=ttl_sec)),
        "claimed_at": None,
        "lease_until": None,
        "finished_at": None,
        "printed": 0,
        "error_code": None,
        "_attachments": {
            f"label-{i:03d}.png": {
                "content_type": "image/png",
                "data": base64.b64encode(png).decode(),
            }
            for i, png in enumerate(pngs)
        },
    }
    response = http.put(_doc_url(doc_id), json=doc)
    if response.status_code not in (201, 202):
        raise SystemExit(f"enqueue failed: HTTP {response.status_code} {response.text[:200]}")
    return doc_id


def wait_for_jobs(
    http: httpx.Client, started: dict[str, float], timeout_sec: float
) -> list[dict[str, object]]:
    """Poll until every job is terminal (or timeout). `started` maps job id -> monotonic start."""
    claimed_at: dict[str, float] = {}
    results: dict[str, dict[str, object]] = {}
    deadline = time.monotonic() + timeout_sec
    while len(results) < len(started) and time.monotonic() < deadline:
        for doc_id, t0 in started.items():
            if doc_id in results:
                continue
            response = http.get(_doc_url(doc_id))
            if response.status_code != 200:
                continue
            doc = response.json()
            elapsed = time.monotonic() - t0
            if doc["status"] != "pending":
                claimed_at.setdefault(doc_id, elapsed)
            if doc["status"] in TERMINAL:
                results[doc_id] = {
                    "id": doc_id.removeprefix("print_job:"),
                    "status": doc["status"],
                    "printed": f"{doc.get('printed', 0)}/{doc['label_count']}",
                    "error_code": doc.get("error_code") or "-",
                    "claim_s": claimed_at.get(doc_id),
                    "total_s": elapsed,
                }
        time.sleep(0.25)
    for doc_id in started:
        results.setdefault(
            doc_id,
            {
                "id": doc_id.removeprefix("print_job:"),
                "status": "timeout",
                "printed": "?",
                "error_code": "-",
                "claim_s": claimed_at.get(doc_id),
                "total_s": None,
            },
        )
    return [results[doc_id] for doc_id in started]


def _fmt(seconds: object) -> str:
    return "-" if seconds is None else f"{seconds:.2f}"


def print_table(rows: list[dict[str, object]]) -> None:
    print(
        f"{'job id':<28}{'status':<9}{'printed':<9}{'error_code':<18}{'claim_s':>8}{'total_s':>9}"
    )
    for row in rows:
        print(
            f"{row['id']:<28}{row['status']:<9}{row['printed']:<9}{row['error_code']:<18}"
            f"{_fmt(row['claim_s']):>8}{_fmt(row['total_s']):>9}"
        )


def percentile(values: list[float], pct: float) -> float:
    """Nearest-rank percentile."""
    ordered = sorted(values)
    return ordered[max(0, math.ceil(pct / 100 * len(ordered)) - 1)]


def print_stats(rows: list[dict[str, object]]) -> None:
    printed = [row for row in rows if row["status"] == "printed"]
    print(f"\n{len(printed)}/{len(rows)} jobs printed")
    for key in ("claim_s", "total_s"):
        values = [float(row[key]) for row in printed if row[key] is not None]  # type: ignore[arg-type]
        if values:
            print(
                f"{key}: median {statistics.median(values):.2f}  p95 {percentile(values, 95):.2f}"
                f"  max {max(values):.2f}  (n={len(values)})"
            )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Simulate the staff API: write print_job docs into DB `printing`. "
        "Needs env COUCHDB_ADMIN_URL=http://user:pass@host:5984. created_at/expires_at use the "
        "LOCAL UTC clock of this machine (CouchDB server time is not available).",
    )
    parser.add_argument(
        "--device-id", help="target print_device id (required unless --write-label)"
    )
    labels = parser.add_mutually_exclusive_group()
    labels.add_argument("--png", action="append", type=Path, metavar="FILE", help="repeatable")
    labels.add_argument("--count", type=int, default=1, metavar="N", help="generated labels")
    parser.add_argument("--jobs", type=int, default=1, metavar="K", help="K jobs back to back")
    parser.add_argument("--ttl-sec", type=int, default=120, help="expires_at = now + TTL")
    parser.add_argument("--source", choices=("walk_in", "evacuee_qr"), default="walk_in")
    parser.add_argument("--wait", action="store_true", help="poll until terminal, print table")
    parser.add_argument("--wait-timeout", type=float, default=300.0, metavar="SEC")
    parser.add_argument("--repeat", type=int, default=1, help="repeat the whole run (needs --wait)")
    parser.add_argument(
        "--write-label",
        type=Path,
        metavar="FILE",
        help="only write generated label #1 to FILE and exit (no CouchDB needed)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.write_label:
        args.write_label.write_bytes(make_label_png(1, 1))
        print(f"wrote {args.write_label}")
        return 0
    if not args.device_id:
        parser.error("--device-id is required")
    if args.repeat > 1 and not args.wait:
        parser.error("--repeat needs --wait")
    if args.jobs < 1 or args.repeat < 1:
        parser.error("--jobs and --repeat must be >= 1")
    if args.png is None and not 1 <= args.count <= 20:
        parser.error("--count must be 1..20")
    if args.png is not None and not 1 <= len(args.png) <= 20:
        parser.error("--png must be given 1..20 times")
    url = os.environ.get("COUCHDB_ADMIN_URL", "").strip()
    if not url:
        parser.error("env COUCHDB_ADMIN_URL is required (http://user:pass@host:5984)")

    file_pngs = [path.read_bytes() for path in args.png] if args.png else None
    rows: list[dict[str, object]] = []
    try:
        with admin_client(url) as http:
            response = http.get(_doc_url(f"print_device:{args.device_id}"))
            if response.status_code != 200:
                raise SystemExit(f"print_device {args.device_id} not found (run provision_poc.py)")
            device = response.json()
            job_seq = 0
            for _ in range(args.repeat):
                started: dict[str, float] = {}
                for _ in range(args.jobs):
                    job_seq += 1
                    pngs = file_pngs or [make_label_png(i + 1, job_seq) for i in range(args.count)]
                    doc_id = enqueue_job(http, device, pngs, args.ttl_sec, args.source)
                    started[doc_id] = time.monotonic()
                    print(f"enqueued {doc_id} ({len(pngs)} labels)")
                if args.wait:
                    rows.extend(wait_for_jobs(http, started, args.wait_timeout))
    except httpx.TransportError as exc:
        print(f"cannot reach CouchDB: {type(exc).__name__}", file=sys.stderr)
        return 1

    if rows:
        print()
        print_table(rows)
        if args.repeat > 1:
            print_stats(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
