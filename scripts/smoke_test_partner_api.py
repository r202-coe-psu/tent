#!/usr/bin/env python3
"""
Partner API Smoke Test Script (Issues #214 - #220 / EXT-001 - EXT-011)
=======================================================================
Validates the Partner API against Smart Shelter public paths
(Cloudflare → nginx → FastAPI). Prefer providing an existing client (UI-issued)
for staging.

Modes
-----
1) Provided credentials (recommended for staging — no admin API needed):
  export PARTNER_API_BASE_URL=https://shelter.importstar.dev
  export PARTNER_API_PREFIX=/public-api   # staging edge; omit for local FastAPI
  export PARTNER_CLIENT_ID=...
  export PARTNER_CLIENT_SECRET=...
  python3 scripts/smoke_test_partner_api.py

2) Local admin provision (needs FastAPI + EXTERNAL_API_SECRET reachable):
  python3 scripts/smoke_test_partner_api.py \\
    --base-url http://localhost:9000 --api-prefix "" --admin-secret <secret>

Endpoints exercised (prefix + path):
  POST {prefix}/external/token
  GET  {prefix}/external/locations
  GET  {prefix}/external/locations/{code}
  GET  {prefix}/external/locations/{code}/stock
  GET  {prefix}/external/locations/{code}/occupancy
  GET  {prefix}/external/summary
  GET  {prefix}/external/locations/{code}/occupants
  POST {prefix}/external/bookings                      (M2, EXT-008, scope booking-write)
  GET  {prefix}/external/bookings/{booking_id}         (M2, EXT-010)
  GET  {prefix}/external/persons/shelter-residency     (M2, EXT-011, scope residency-read)
  POST {prefix}/external/persons/search                (EXT-012, scope occupant-search)
  POST {prefix}/external/bookings/{booking_id}/cancel  (M2, EXT-009)

Normal mode also covers the CR-169 group rules at API level (persons[] of 2-3, cid
duplicates in one request, several bad persons, duplicate vs existing booking, group
cancel, EXT-010 persons[]). Repeat-cancel → 200 (CR-169 FR-40, #592) is a normal assertion.

M2 checks (EXT-008..012) are scope-aware: when the token lacks `booking-write` /
`residency-read` / `occupant-search` the script asserts the 403 insufficient_scope gate instead of
skipping silently. The booking checks WRITE one booking (random checksum-valid CID,
name "Smoke Test") to the target shelter and always cancel it afterwards. Use
--skip-booking-writes to keep a run strictly read-only.

Optional: PARTNER_CHECKED_IN_CID=<13 digits of a person already checked in> adds
the EXT-011 200-path check (the CID is sent to the API, never printed).

End-to-end mode (--e2e, issue #597 / CR-169)
--------------------------------------------
Opt-in. Follows multi-person bookings across the whole chain
API -> Mongo `external_bookings` -> sync worker -> CouchDB `shelter_{code}` and
measures how long the worker needs for a group (default 100 people, the
`MAX_PERSONS` cap, CR-169 FR-6). `--e2e` replaces the read-only smoke sections:
it mints a token (same two modes as above), runs the e2e scenarios, cleans up
and revokes the admin-created client. Without `--e2e` nothing below applies and
the script behaves exactly as before.

WARNING: a 100-person group creates 100 households + 100 evacuees (+ audit docs
on cancel) in the CouchDB of ONE shelter, and cleanup DELETES docs there. Run `--e2e`
only against a dedicated TEST shelter that has no real people: deletes create CouchDB
tombstones that sync to kiosk/staff devices. The local-host guard and
`--i-know-this-writes-to` below are not a substitute for choosing the right shelter.
Use a dedicated test shelter on a local/dev stack. The script refuses non-localhost targets unless you pass
--i-know-this-writes-to <host>[,<host>] naming every non-local API / CouchDB / Mongo
host (local = localhost, 127.0.0.1, ::1; exact match; every host of a multi-host
mongodb:// URI is checked; `mongodb+srv://` always counts as non-local). The check runs
before any connection or write. URLs that embed credentials (user:pass@host) are
refused; pass them through env vars / the repo-root .env instead. Printed URLs are
redacted.
When ANY target is non-local, `--mongo-uri` is REQUIRED as well (exit 2 before any
connection or write, even with --i-know-this-writes-to; an unreachable Mongo or a missing
pymongo aborts instead of silently dropping to the no-Mongo mode). Reason: without Mongo,
cleanup ownership is a `created_at` comparison between THIS machine's clock and the
worker's, and a POST that timed out cannot be found; that is only trustworthy when
everything runs on this host, so the no-Mongo mode is for all-local runs only.

Prerequisites: local stack up (`docker compose up -d`), with fastapi + worker
built from a branch that contains CR-169 (`docker compose up -d --build --no-deps
fastapi worker`), a seeded shelter that is `open` and has the pre-registration
switch ON (#751: a shelter without the switch is not bookable; the seed data does not set
it, so turn it on for the target shelter first, e.g. in the staff UI), CouchDB admin credentials.

Run (local; admin provision mode, secrets from env / repo-root .env, never echoed):
  set -a; . ./.env; set +a          # COUCHDB_USER, COUCHDB_PASSWORD, EXTERNAL_API_SECRET
  uv run --with pymongo python3 scripts/smoke_test_partner_api.py --e2e \
    --base-url http://localhost:9000 --api-prefix "" \
    --admin-secret "$EXTERNAL_API_SECRET" \
    --e2e-shelter-code SH004 --mongo-uri mongodb://localhost:27017/tentdb

  * --mongo-uri is optional for all-local runs (needs `pymongo`; plain python3 works
    without it) and REQUIRED as soon as any target is non-local. With
    it the script also asserts "no committed=false rows left" (rows of this run's
    client_id only), runs the sweeper case, finds this run's rows by client_id (also
    those of a POST that timed out before a booking_id came back) and deletes the
    terminal `external_bookings` rows it created. Without it those become
    API-behaviour-only checks / SKIPPED and the (PII-free) cancelled rows stay in Mongo.
    RUN WITH --mongo-uri FOR A RELIABLE CLEANUP: without it the worker-quiescence
    wait is only a heuristic ("bed-holding evacuee count stopped changing") and cleanup
    can end before the worker has finished a big group.
  * The worker must run the same code version as fastapi (a worker that does not filter
    `committed != false` can pick up rows that are still being staged).
  * Env equivalents: PARTNER_E2E_SHELTER_CODE, PARTNER_E2E_COUCH_URL (default
    http://localhost:5984), COUCHDB_USER / COUCHDB_PASSWORD (or the repo-root .env),
    PARTNER_E2E_MONGO_URI.
  * Useful flags: --e2e-big-size N (default 100; use 20 for a quick run),
    --skip-e2e-big, --e2e-timeout, --e2e-big-timeout, --e2e-race-rounds,
    --e2e-big-budget SECONDS (fail the 100-person check when slower). --require-578 is a
    no-op kept for old invocations: every case below is a plain assertion now.

Scenarios (all CIDs are random checksum-valid; only counts, booking_ids and timings
are printed, never CIDs / phones / names):
  1. group of 3 -> 201 persons_count 3, then 3 households + 3 evacuees in CouchDB
     (`pre_registered`, `registered_via: api`, gender null, 1 person = 1 household), and
     every evacuee has `booking_ref` == booking_id and `schema_v` 14 (CR-169)
  2. group with a duplicate person -> 409 duplicate_booking, detail `persons[i]`,
     no docs in CouchDB for the rest of the group, and the rest can be booked
     afterwards (API-level proof that no staged row was left holding the index)
  3. cancel the group after the worker wrote it -> every evacuee and household
     ends `cancelled`
  4. N rounds of two concurrent groups with an overlapping CID -> exactly one 201
     and one 409, no `committed=false` rows left (Mongo; else the loser's other
     people can be booked afterwards)
  5. 100-person group: timing report (POST, 201 -> first/all households+evacuees
     visible, cancel -> all cancelled; min/avg/max per person) = the gate for the cap
  6. (banner "E2E 6") CouchDB-side duplicate planted before the worker writes anything:
     the whole group is REJECTED (duplicate) and no doc is written (FR-21, first pass).
     The per-person retry rule (D1/D4, part of the group already in CouchDB) is covered by
     scenario 8, which reserves a member's ids so the worker takes that path without a crash.
  7. (banner "E2E 7") sweeper: an orphan committed=false row older than 60 s is removed
     (FR-33; needs Mongo, else SKIPPED)
  8. (banner "E2E 8") partial group, the CR-169 retry rule (D1/D4): member 1's own
     pre-registration is already in CouchDB and its CID is held by a foreign live
     evacuee. The worker rejects member 1 only (its stay cancelled) and writes the others;
     aggregate REJECTED. Then group cancel -> 200 and aggregate CANCELLED, the other
     members cancelled, repeat cancel -> 200 (FR-21 D1/D4, FR-40/42; needs Mongo, else
     SKIPPED). Member 1's ids are reserved through the test's own Mongo row (CAS), which
     is what lets the worker take the retry path without a crash. If the worker reserves
     member 1 before the CAS, the case reports "race lost" as a FAIL (fail-closed): rerun it.
  9. (banner "E2E 9") group with a checked-in member (stay set to `arriving` in the test
     shelter's CouchDB and waited for in the API projection, restored afterwards) -> cancel
     409 booking_not_cancellable and nothing changed (FR-40/53; needs Mongo, else SKIPPED)

Pre-flight: before any group is sent, the freshly generated CIDs are looked up in the
test shelter's CouchDB; a CID that already has an evacuee doc is regenerated (bounded
retries, else that scenario fails). Only CIDs that passed are registered for cleanup.

Cleanup (always, also on failure): every CID is registered BEFORE its request is sent,
so a request that times out after the server committed is still cleaned up. It cancels
every booking it created (with Mongo also the ones it only finds by this run's
client_id; transport errors / 5xx / 401 are retried with a small bounded backoff, a
409/404 is terminal but recorded and printed in the cleanup summary), waits for the
worker to settle, then deletes from CouchDB only docs it can prove are its own. If the
worker has not settled within --e2e-cleanup-timeout the run records a FAIL ("worker
settled before cleanup", with the still-open booking_ids), cancels those again and, with
Mongo, compare-and-sets THIS run's still `pending` / `cancel_requested` rows (client_id +
tracked booking_ids + shelter, never other clients' rows) to `cancelled` with their PII
cleared so the worker cannot write them afterwards, then purges anyway.
With --mongo-uri the ownership proof is the `evacuee_id` / `household_id` the
worker reserved on this run's `external_bookings` rows (kept for the whole run); without
it, a doc must match a CID this run registered, `registered_via: api`, this run's
`partner:M2` creator and a `created_at` not older than the run start (60 s skew). The
`partner:` prefix alone is never enough. Proven ids are kept for the whole cleanup (id ->
kind): every round re-fetches them directly and audit docs are looked up by `target_id`
over all of them, even ones already deleted, so a failed delete of a household/audit is
retried and can never be forgotten. PASS = no proven doc still exists and no unresolved
delete failure. Audit docs of owned targets and the one planted duplicate evacuee go too.
When the CouchDB purge could not be verified clean, the run's settled Mongo rows are kept
(they are the ownership proof for a retry). Never unseeds or touches other shelters.
Expected runtime (local, 3 s worker poll): about 1-3 minutes plus the 100-person run
(worker handles rows one by one; see the printed timing).
Recovery manifest (--e2e-manifest, --e2e-cleanup-from)
-----------------------------------------------------
Before the first request that can create data the run writes a JSON manifest (default
`smoke-e2e-<runid>.json` in the system temp dir, mode 0600, created exclusively and never
overwritten; override with --e2e-manifest PATH) and rewrites it atomically (temp file +
rename) after every registration step: run id and UTC start, shelter + CouchDB database,
redacted API/CouchDB/Mongo host:port, the admin-created client_id and its row id, every
tracked CID (registered before it is sent), booking_ids, the evacuee/household ids proven
or reserved, and planted ids. It holds synthetic test CIDs and ids only: no real data and
no secrets (never the client secret, the admin secret or CouchDB credentials), but keep it
private anyway. After a SUCCESSFUL cleanup (every cleanup check passed and the client
revoked) it is deleted; after a cleanup FAIL, crash or abort it is kept and its path plus
the exact recovery command are printed.

  python3 scripts/smoke_test_partner_api.py --e2e-cleanup-from PATH \
    --base-url ... --api-prefix ... --couch-url ... [--mongo-uri ...] \
    --admin-secret "$EXTERNAL_API_SECRET"

finishes the job WITHOUT sending any booking. The flags must match the manifest's targets
(refused otherwise; same guard as a run: a non-local target needs --mongo-uri, a manifest
that is not a private file owned by you is refused). It rescans this run's Mongo rows by
the manifest's client_id, scrubs still-open rows (same compare-and-set as above; there is
no token in recovery, so nothing is cancelled through the API), purges the proven CouchDB
docs with the cumulative proven-id logic (manifest CIDs/ids are only candidates; the
ownership rules are unchanged, and without Mongo the stricter CID + created_at rule
applies and worker idleness cannot be proven), revokes the admin-created client when the
admin API accepts --admin-secret (otherwise it says so), deletes the run's Mongo rows and
deletes the manifest only if everything succeeded. It is idempotent.

Signals: SIGINT/SIGTERM during the run stop the scenarios and run the normal cleanup. A
signal while cleanup runs prints that cleanup is in progress and is ignored; only a
further one aborts (exit 128+signal, manifest kept, recovery command printed). Repeats of
the same signal within 1 s count as one press (a Ctrl-C under `uv run` arrives twice), so
wait about a second between presses. SIGKILL cannot be handled: the manifest is the
recovery path.

"green" = exit code 0: no FAIL lines; SKIPPED lines (no Mongo, --skip-e2e-big) are listed.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
import random
import re
import shlex
import signal
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

# Terminal Colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"


# Default UA: Cloudflare bot fight / browser integrity on staging bans
# Python-urllib's default signature (Error 1010 browser_signature_banned).
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (compatible; TentPartnerAPISmoke/1.0; +https://shelter.importstar.dev) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)


#: Module the admin-provisioned client is created with, and the creator its writes carry
#: (`partner:<module>`). The ONE place the literal lives: client creation and the
#: cleanup ownership check must never drift apart.
ADMIN_CLIENT_MODULE = "M2"
ADMIN_CLIENT_CREATOR = f"partner:{ADMIN_CLIENT_MODULE}"


def get_error_code(data: Dict[str, Any]) -> str:
    """Helper to extract error code whether returned top-level or nested under 'error'."""
    if isinstance(data, dict):
        if "code" in data:
            return str(data["code"])
        if isinstance(data.get("error"), dict) and "code" in data["error"]:
            return str(data["error"]["code"])
    return ""


def get_error_detail(data: Dict[str, Any]) -> str:
    """Helper to extract error detail/message string."""
    if isinstance(data, dict):
        if "detail" in data:
            return str(data["detail"])
        if isinstance(data.get("error"), dict) and "detail" in data["error"]:
            return str(data["error"]["detail"])
        if "message" in data:
            return str(data["message"])
        if isinstance(data.get("error"), dict) and "message" in data["error"]:
            return str(data["error"]["message"])
    return ""


def make_valid_cid() -> str:
    """Random 13-digit Thai national ID with a correct mod-11 check digit."""
    digits = [random.randint(1, 8)] + [random.randint(0, 9) for _ in range(11)]
    total = sum(d * (13 - i) for i, d in enumerate(digits))
    digits.append((11 - total % 11) % 10)
    return "".join(str(d) for d in digits)


def make_group_person(cid: Optional[str], **overrides: Any) -> Dict[str, Any]:
    """One `persons[]` entry for EXT-008 (CR-169); valid unless overridden."""
    person: Dict[str, Any] = {
        "cid": cid,
        "first_name": "Smoke",
        "last_name": "Test",
        "phone": "+66812345678",
    }
    person.update(overrides)
    return person


_USERINFO_RE = re.compile(r"([A-Za-z][A-Za-z0-9+.\-]*://)[^/\s@?#]*@")


def redact_url(url: str) -> str:
    """URL safe to print: userinfo replaced by `***@`, query and fragment dropped."""
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return "<unparseable-url>"
    netloc = parts.netloc
    if "@" in netloc:
        netloc = "***@" + netloc.rsplit("@", 1)[1]
    return urllib.parse.urlunsplit((parts.scheme, netloc, parts.path, "", ""))


def redact_text(text: Any) -> str:
    """Mask `scheme://user:pass@` in any free text (exception messages, URLs)."""
    return _USERINFO_RE.sub(r"\1***@", str(text))


class SmokeTestRunner:
    def __init__(
        self,
        base_url: str,
        admin_secret: str,
        shelter_code: Optional[str] = None,
        keep_client: bool = False,
        verbose: bool = False,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        api_prefix: str = "/public-api",
        skip_booking_writes: bool = False,
        checked_in_cid: Optional[str] = None,
    ):
        self.base_url = base_url.rstrip("/")
        # Staging edge keeps partner routes under /public-api/external/*;
        # local FastAPI mounts them at /external/* (prefix "").
        self.api_prefix = api_prefix.rstrip("/")
        self.admin_secret = admin_secret
        self.shelter_code = shelter_code
        self.explicit_shelter_code = shelter_code
        self.keep_client = keep_client
        self.verbose = verbose
        self.skip_booking_writes = skip_booking_writes
        self.checked_in_cid = (checked_in_cid or "").strip() or None

        # When set, skip admin create/revoke and mint tokens with these credentials.
        self.provided_client_id = (client_id or "").strip() or None
        self.provided_client_secret = (client_secret or "").strip() or None
        self.use_provided_credentials = bool(
            self.provided_client_id and self.provided_client_secret
        )

        self.created_client_row_id: Optional[str] = None
        self.created_client_id: Optional[str] = self.provided_client_id
        self.client_secret: Optional[str] = self.provided_client_secret
        self.access_token: Optional[str] = None
        self.token_scopes: List[str] = []

        # M2 booking state shared across EXT-008..011 scenarios
        self.booking_id: Optional[str] = None
        self.booking_cid: Optional[str] = None
        self.booking_location: Optional[str] = None

        self.results: List[Tuple[str, str, bool, str]] = []  # (issue, test_name, passed, detail)
        self.skipped: List[Tuple[str, str, str]] = []

    def _on_client_created(self) -> None:
        """Hook: the admin API just created a client (id + row id are known)."""

    def partner_path(self, path: str) -> str:
        """Join api_prefix with a FastAPI partner path like /external/token."""
        if not path.startswith("/"):
            path = f"/{path}"
        return f"{self.api_prefix}{path}" if self.api_prefix else path

    def log(self, text: str):
        print(text)

    def log_verbose(self, text: str):
        if self.verbose:
            print(f"  {CYAN}[DEBUG]{RESET} {text}")

    def record_result(self, issue: str, test_name: str, passed: bool, detail: str = ""):
        self.results.append((issue, test_name, passed, detail))
        status = f"{GREEN}✓ PASS{RESET}" if passed else f"{RED}✗ FAIL{RESET}"
        detail_msg = f" ({detail})" if detail else ""
        self.log(f"  {status} {BOLD}[{issue}]{RESET} {test_name}{detail_msg}")

    def record_skip(self, issue: str, test_name: str, reason: str) -> None:
        self.skipped.append((issue, test_name, reason))
        self.log(f"  {YELLOW}○ SKIPPED{RESET} {BOLD}[{issue}]{RESET} {test_name} ({reason})")

    def http_request(
        self,
        method: str,
        path: str,
        headers: Optional[Dict[str, str]] = None,
        body: Optional[Dict[str, Any]] = None,
        timeout: float = 15,
        log_body: bool = True,
    ) -> Tuple[int, Dict[str, Any]]:
        url = f"{self.base_url}{path}"
        headers = dict(headers or {})
        req_body: Optional[bytes] = None

        if body is not None:
            req_body = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        headers.setdefault("Accept", "application/json")
        headers.setdefault("User-Agent", DEFAULT_USER_AGENT)
        req = urllib.request.Request(url, data=req_body, headers=headers, method=method)

        self.log_verbose(f"HTTP {method} {redact_text(url)}")
        if body and self.verbose and log_body:
            # Never echo client_secret in verbose logs.
            safe_body = {k: ("***" if k == "client_secret" else v) for k, v in body.items()}
            self.log_verbose(f"Payload: {json.dumps(safe_body)}")

        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status_code = resp.status
                raw_data = resp.read().decode("utf-8")
                parsed = json.loads(raw_data) if raw_data else {}
                self.log_verbose(f"Response ({status_code}): {raw_data[:200]}...")
                return status_code, parsed
        except urllib.error.HTTPError as err:
            status_code = err.code
            raw_data = err.read().decode("utf-8")
            try:
                parsed = json.loads(raw_data)
            except Exception:
                parsed = {"raw": raw_data}
            self.log_verbose(f"HTTPError ({status_code}): {raw_data[:200]}...")
            return status_code, parsed
        except Exception as ex:
            self.log_verbose(f"Connection Exception: {redact_text(ex)}")
            return 0, {"error": redact_text(ex)}

    @staticmethod
    def is_cloudflare_block(status: int, data: Dict[str, Any]) -> bool:
        if status != 403:
            return False
        if data.get("cloudflare_error") or data.get("error_code") == 1010:
            return True
        detail = str(data.get("detail", ""))
        return "cloudflare" in detail.lower() or "browser's signature" in detail

    # -------------------------------------------------------------------------
    # Scenario 1: Issue #215 (EXT-001 OAuth2 Token Minting & Client Admin)
    # -------------------------------------------------------------------------
    def test_issue_215_auth(self) -> bool:
        self.log(f"\n{BOLD}======================================================{RESET}")
        self.log(f"{BOLD}Testing Issue #215: EXT-001 OAuth2 Client & Auth Flow{RESET}")
        self.log(f"{BOLD}======================================================{RESET}")

        if self.use_provided_credentials:
            self.record_result(
                "#215",
                "Using provided PARTNER_CLIENT_ID / PARTNER_CLIENT_SECRET (skip admin create)",
                True,
                f"client_id={self.created_client_id}",
            )
        else:
            # 1.1 Create Third-party Client via Admin API (local / internal FastAPI only)
            ts = int(time.time())
            payload = {
                "name": f"smoke-m2-{ts}",
                "module_name": ADMIN_CLIENT_MODULE,
                # `booking-bypass` (#751, EOC override) is deliberately not granted: the smoke
                # run checks the normal EXT-008 rule.
                "allowed_scopes": [
                    "location-read",
                    "location-stock-read",
                    "occupancy-read",
                    "booking-write",
                    "residency-read",
                    "occupant-search",
                ],
            }
            status, data = self.http_request(
                "POST",
                "/v1/admin/thirdparty-clients",
                headers={"Authorization": f"Bearer {self.admin_secret}"},
                body=payload,
            )

            if status == 201 and data.get("client_secret"):
                self.created_client_row_id = data.get("id")
                # client_id is generated server-side (tpc_…)
                self.created_client_id = data.get("client_id")
                self.client_secret = data.get("client_secret")
                self._on_client_created()
                self.record_result(
                    "#215",
                    "Admin API creates Partner Client with plaintext secret reveal",
                    True,
                    f"client_id={self.created_client_id}",
                )
            else:
                self.record_result(
                    "#215",
                    "Admin API creates Partner Client",
                    False,
                    f"HTTP {status} - {data}",
                )
                return False

        # 1.2 Mint Access Token via POST /external/token
        token_payload = {
            "grant_type": "client_credentials",
            "client_id": self.created_client_id,
            "client_secret": self.client_secret,
        }
        status, data = self.http_request(
            "POST", self.partner_path("/external/token"), body=token_payload
        )

        token = data.get("access_token")
        expires_in = data.get("expires_in")
        scopes = data.get("scopes", [])
        if status == 200 and token and expires_in == 3600 and "location-read" in scopes:
            self.access_token = token
            self.token_scopes = list(scopes)
            self.record_result(
                "#215",
                "Token endpoint mints scoped Bearer JWT (3,600s TTL)",
                True,
                f"expires_in={expires_in}s, scopes={scopes}",
            )
        else:
            self.record_result(
                "#215",
                "Token endpoint mints scoped Bearer JWT",
                False,
                f"HTTP {status} - {data}",
            )
            return False

        # 1.3 Negative Test: Invalid Secret rejection
        bad_token_payload = {
            "grant_type": "client_credentials",
            "client_id": self.created_client_id,
            "client_secret": "wrong-secret",
        }
        status, data = self.http_request(
            "POST", self.partner_path("/external/token"), body=bad_token_payload
        )
        err_code = get_error_code(data)
        if status == 401 and err_code == "invalid_client":
            self.record_result(
                "#215",
                "Token endpoint rejects invalid credentials with 401 invalid_client",
                True,
            )
        else:
            self.record_result(
                "#215",
                "Token endpoint rejects invalid credentials",
                False,
                f"Expected 401 invalid_client, got HTTP {status} (code={err_code})",
            )

        # 1.4 Negative Test: Unsupported grant type rejection
        bad_grant_payload = {
            "grant_type": "password",
            "client_id": self.created_client_id,
            "client_secret": self.client_secret,
        }
        status, data = self.http_request(
            "POST", self.partner_path("/external/token"), body=bad_grant_payload
        )
        err_code = get_error_code(data)
        if status == 400 and err_code == "unsupported_grant_type":
            self.record_result(
                "#215",
                "Token endpoint rejects unsupported grant_type with 400",
                True,
            )
        else:
            self.record_result(
                "#215",
                "Token endpoint rejects unsupported grant_type",
                False,
                f"Expected 400 unsupported_grant_type, got HTTP {status} (code={err_code})",
            )

        return True

    # -------------------------------------------------------------------------
    # Scenario 2: Issue #216 (EXT-002 & EXT-003 Location Master & DOPA codes)
    # -------------------------------------------------------------------------
    def test_issue_216_locations(self) -> bool:
        self.log(f"\n{BOLD}======================================================{RESET}")
        self.log(f"{BOLD}Testing Issue #216: Location Master & DOPA Codes{RESET}")
        self.log(f"{BOLD}======================================================{RESET}")

        if not self.access_token:
            self.record_result("#216", "Location Master endpoints", False, "Missing access token")
            return False

        headers = {"Authorization": f"Bearer {self.access_token}"}

        # 2.1 List Locations (EXT-002)
        status, data = self.http_request(
            "GET", self.partner_path("/external/locations"), headers=headers
        )
        result = data.get("result", [])

        if status == 200 and data.get("status") == 200 and isinstance(result, list):
            self.record_result(
                "#216",
                "GET /external/locations returns ODT envelope list",
                True,
                f"total={len(result)} locations, message='{data.get('message')}'",
            )
        else:
            self.record_result(
                "#216",
                "GET /external/locations returns ODT envelope list",
                False,
                f"HTTP {status} - {data}",
            )
            return False

        # Pick a shelter code for subsequent tests if not explicitly provided
        if not self.shelter_code and len(result) > 0:
            self.shelter_code = result[0].get("location_code")

        # 2.2 Verify DOPA administrative codes mapping
        has_dopa = False
        for loc in result:
            p_code = loc.get("province_code")
            d_code = loc.get("district_code")
            sd_code = loc.get("subdistrict_code")
            if p_code or d_code or sd_code:
                has_dopa = True
                self.record_result(
                    "#216",
                    "DOPA administrative codes mapped from Thai admin names",
                    True,
                    f"code={loc.get('location_code')} (province={p_code}, district={d_code}, subdistrict={sd_code})",
                )
                break

        if not has_dopa and len(result) > 0:
            self.record_result(
                "#216",
                "DOPA administrative codes mapped from Thai admin names",
                False,
                "No location had DOPA codes resolved",
            )
        elif len(result) == 0:
            self.record_result(
                "#216",
                "DOPA administrative codes mapped from Thai admin names",
                True,
                "Notice: 0 locations returned (seed shelter data to test lookup)",
            )

        # 2.3 Single Location Detail (EXT-003)
        target_code = self.shelter_code or "SH001"
        status, data = self.http_request(
            "GET",
            self.partner_path(f"/external/locations/{target_code}"),
            headers=headers,
        )
        if status == 200 and data.get("result", {}).get("location_code") == target_code:
            loc_data = data["result"]
            facilities = loc_data.get("facilities", [])
            self.record_result(
                "#216",
                f"GET /external/locations/{target_code} returns detail & facilities",
                True,
                f"name='{loc_data.get('name_th')}', facilities={len(facilities)} items",
            )
        else:
            self.record_result(
                "#216",
                f"GET /external/locations/{target_code} returns detail",
                False,
                f"HTTP {status} - {data}",
            )

        # 2.4 Negative: Unknown location returns 404
        status, data = self.http_request(
            "GET",
            self.partner_path("/external/locations/NON_EXISTENT_999"),
            headers=headers,
        )
        err_code = get_error_code(data)
        if status == 404 and err_code == "location_not_found":
            self.record_result(
                "#216",
                "Unknown location returns 404 location_not_found error envelope",
                True,
            )
        else:
            self.record_result(
                "#216",
                "Unknown location returns 404",
                False,
                f"Expected 404 location_not_found, got HTTP {status} (code={err_code})",
            )

        # 2.5 Scope Protection: Request without token returns 401/403
        status, _ = self.http_request("GET", self.partner_path("/external/locations"))
        if status in (401, 403):
            self.record_result("#216", "Unauthenticated request rejected with 401/403", True)
        else:
            self.record_result(
                "#216",
                "Unauthenticated request rejected",
                False,
                f"Expected 401/403, got HTTP {status}",
            )

        return True

    # -------------------------------------------------------------------------
    # Scenario 3: Issue #217 (EXT-005 Occupancy Projection & Demographics)
    # -------------------------------------------------------------------------
    def test_issue_217_occupancy(self) -> bool:
        self.log(f"\n{BOLD}======================================================{RESET}")
        self.log(f"{BOLD}Testing Issue #217: EXT-005 Occupancy Projection{RESET}")
        self.log(f"{BOLD}======================================================{RESET}")

        if not self.access_token:
            self.record_result("#217", "Occupancy endpoint", False, "Missing access token")
            return False

        headers = {"Authorization": f"Bearer {self.access_token}"}
        target_code = self.shelter_code or "SH001"

        status, data = self.http_request(
            "GET",
            self.partner_path(f"/external/locations/{target_code}/occupancy"),
            headers=headers,
        )

        res = data.get("result", {})
        breakdown = res.get("breakdown", {})
        expected_keys = {
            "male",
            "female",
            "gender_unspecified",
            "child_under_5",
            "elderly_over_60",
            "pregnant",
            "bedridden",
            "disabled",
        }

        if (
            status == 200
            and res.get("location_code") == target_code
            and "occupancy_total" in res
            and expected_keys.issubset(breakdown.keys())
        ):
            role = res.get("updated_by_role")
            self.record_result(
                "#217",
                "GET .../occupancy returns total, demographic breakdown & audit role",
                True,
                f"total={res.get('occupancy_total')}, role='{role}'",
            )
        else:
            self.record_result(
                "#217",
                "GET .../occupancy returns total and breakdown",
                False,
                f"HTTP {status} - {data}",
            )

        return True

    # -------------------------------------------------------------------------
    # Scenario 4: Issue #218 (EXT-004 Stock Projection & M6 Mapping)
    # -------------------------------------------------------------------------
    def test_issue_218_stock(self) -> bool:
        self.log(f"\n{BOLD}======================================================{RESET}")
        self.log(f"{BOLD}Testing Issue #218: EXT-004 Shelter Stock Projection{RESET}")
        self.log(f"{BOLD}======================================================{RESET}")

        if not self.access_token:
            self.record_result("#218", "Stock endpoint", False, "Missing access token")
            return False

        headers = {"Authorization": f"Bearer {self.access_token}"}
        target_code = self.shelter_code or "SH001"

        status, data = self.http_request(
            "GET",
            self.partner_path(f"/external/locations/{target_code}/stock"),
            headers=headers,
        )

        res = data.get("result", {})
        items = res.get("items", [])

        if status == 200 and res.get("location_code") == target_code and isinstance(items, list):
            self.record_result(
                "#218",
                "GET .../stock returns location stock envelope",
                True,
                f"items_count={len(items)}",
            )

            # Check M6 format compliance if items exist
            if len(items) > 0:
                first = items[0]
                m6_valid = (
                    "type_code" in first
                    and "quantity_on_hand" in first
                    and first.get("source") == "direct_donation"
                    and first.get("m6_reference_id") is None
                )
                self.record_result(
                    "#218",
                    "Stock items comply with M6 schema (source=direct_donation, m6_ref=null)",
                    m6_valid,
                    f"sample: {first.get('name_th')} (type={first.get('type_code')}, qty={first.get('quantity_on_hand')})",
                )
            else:
                self.record_result(
                    "#218",
                    "Stock envelope adheres to EXT-004 contract",
                    True,
                    "location has 0 stock items recorded",
                )
        else:
            self.record_result(
                "#218",
                "GET .../stock returns location stock envelope",
                False,
                f"HTTP {status} - {data}",
            )

        return True

    # -------------------------------------------------------------------------
    # Scenario 5: Issue #219 (EXT-006 Cross-Location Summary)
    # -------------------------------------------------------------------------
    def test_issue_219_summary(self) -> bool:
        self.log(f"\n{BOLD}======================================================{RESET}")
        self.log(f"{BOLD}Testing Issue #219: EXT-006 Cross-Location Summary{RESET}")
        self.log(f"{BOLD}======================================================{RESET}")

        if not self.access_token:
            self.record_result("#219", "Summary endpoint", False, "Missing access token")
            return False

        headers = {"Authorization": f"Bearer {self.access_token}"}
        status, data = self.http_request(
            "GET", self.partner_path("/external/summary"), headers=headers
        )

        res = data.get("result", {})
        locs = res.get("locations", [])

        if (
            status == 200
            and "location_count" in res
            and "capacity_total" in res
            and isinstance(locs, list)
        ):
            # Check critical_items rule: only critical (<=0) or low (<reorder)
            has_valid_critical_rules = True
            for loc in locs:
                for c_item in loc.get("critical_items", []):
                    if c_item.get("level") not in ("critical", "low"):
                        has_valid_critical_rules = False

            self.record_result(
                "#219",
                "GET /external/summary returns aggregated metrics & critical items",
                has_valid_critical_rules,
                f"locations={res.get('location_count')}, capacity={res.get('capacity_total')}, occupancy={res.get('occupancy_total')}",
            )
        else:
            self.record_result(
                "#219",
                "GET /external/summary returns aggregated metrics",
                False,
                f"HTTP {status} - {data}",
            )

        return True

    # -------------------------------------------------------------------------
    # Scenario 6: Issue #220 (EXT-007 Occupants Scaffold & PDPA Governance)
    # -------------------------------------------------------------------------
    def test_issue_220_occupants_pdpa(self) -> bool:
        self.log(f"\n{BOLD}======================================================{RESET}")
        self.log(f"{BOLD}Testing Issue #220: EXT-007 Occupants & PDPA Audit{RESET}")
        self.log(f"{BOLD}======================================================{RESET}")

        if not self.access_token:
            self.record_result("#220", "Occupants endpoint", False, "Missing access token")
            return False

        headers = {"Authorization": f"Bearer {self.access_token}"}
        target_code = self.shelter_code or "SH001"

        # 6.1 Missing purpose rejected with 400
        status, data = self.http_request(
            "GET",
            self.partner_path(f"/external/locations/{target_code}/occupants"),
            headers=headers,
        )
        err_code = get_error_code(data)
        if status == 400 and err_code == "missing_purpose":
            self.record_result(
                "#220",
                "Mandatory 'purpose' query parameter enforced with 400 missing_purpose",
                True,
            )
        else:
            self.record_result(
                "#220",
                "Mandatory 'purpose' parameter enforced",
                False,
                f"Expected 400 missing_purpose, got HTTP {status} (code={err_code})",
            )

        # 6.2 Scope gate: 403 without occupancy-pii-read, or 200 envelope when granted
        status, data = self.http_request(
            "GET",
            self.partner_path(f"/external/locations/{target_code}/occupants")
            + "?purpose=emergency_rationing",
            headers=headers,
        )
        err_code = get_error_code(data)
        err_detail = get_error_detail(data)
        if (
            status == 403
            and err_code == "insufficient_scope"
            and "ต้องได้รับอนุมัติสิทธิ์เป็นรายกรณีก่อนใช้งาน" in err_detail
        ):
            self.record_result(
                "#220",
                "PDPA Default-Deny: Returns 403 Forbidden with legal approval notice",
                True,
                f"detail='{err_detail}'",
            )
        elif status == 200 and isinstance(data.get("result"), list):
            self.record_result(
                "#220",
                "occupancy-pii-read granted: occupants envelope returned",
                True,
                f"count={len(data.get('result', []))}",
            )
        else:
            self.record_result(
                "#220",
                "Occupants scope gate (403 deny or 200 grant)",
                False,
                f"Unexpected HTTP {status} (code={err_code}, detail={err_detail})",
            )

        return True

    # -------------------------------------------------------------------------
    # M2 scenarios (CR-154): EXT-008 create · EXT-010 status · EXT-011 residency · EXT-009 cancel
    # -------------------------------------------------------------------------
    def _banner(self, title: str) -> None:
        bar = "======================================================"
        self.log(f"\n{BOLD}{bar}{RESET}")
        self.log(f"{BOLD}{title}{RESET}")
        self.log(f"{BOLD}{bar}{RESET}")

    def _booking_candidates(self, headers: Dict[str, str]) -> List[str]:
        """Explicit --shelter-code only; otherwise bookable `open` locations from EXT-002.

        #751: `accepts_booking=true` keeps shelters whose pre-registration switch is off (or was
        never set) out of the list, since EXT-008 now answers 409 for them.

        Not `self.shelter_code`: #216 auto-fills it with the first listed location,
        which may be closed or opted out of pre-registration.
        """
        if self.explicit_shelter_code:
            return [self.explicit_shelter_code]
        status, data = self.http_request(
            "GET",
            self.partner_path("/external/locations") + "?status=open&accepts_booking=true&limit=20",
            headers=headers,
        )
        result = data.get("result") if status == 200 else None
        if not isinstance(result, list):
            return []
        return [loc["location_code"] for loc in result if loc.get("location_code")]

    def test_m2_bookings(self) -> bool:
        """EXT-008 (create) + EXT-010 (status). Leaves the booking open for EXT-011/009."""
        self._banner("Testing M2: EXT-008 Create Booking & EXT-010 Booking Status")

        if not self.access_token:
            self.record_result("M2", "Booking endpoints", False, "Missing access token")
            return False

        headers = {"Authorization": f"Bearer {self.access_token}"}
        bookings = self.partner_path("/external/bookings")

        # M2.1 No token → rejected
        status, _ = self.http_request("POST", bookings, body={"location_code": "X"})
        self.record_result(
            "M2",
            "EXT-008 unauthenticated request rejected with 401/403",
            status in (401, 403),
            "" if status in (401, 403) else f"got HTTP {status}",
        )

        # M2.2 Scope gate: without booking-write the whole group is 403
        if "booking-write" not in self.token_scopes:
            status, data = self.http_request(
                "POST", bookings, headers=headers, body={"location_code": "X"}
            )
            err_code = get_error_code(data)
            self.record_result(
                "M2",
                "Token without booking-write is denied (403 insufficient_scope)",
                status == 403 and err_code == "insufficient_scope",
                f"HTTP {status} (code={err_code})",
            )
            self.log(
                f"  {YELLOW}Skipping booking write checks (token has no booking-write scope){RESET}"
            )
            return True

        # M2.3 Validation: empty body / bad CID checksum → 422 validation_error
        status, data = self.http_request("POST", bookings, headers=headers, body={})
        err_code = get_error_code(data)
        self.record_result(
            "M2",
            "EXT-008 empty body rejected with 422 validation_error",
            status == 422 and err_code == "validation_error",
            f"HTTP {status} (code={err_code})",
        )

        candidates = self._booking_candidates(headers)
        if not candidates:
            self.record_result(
                "M2",
                "EXT-008 needs an open location to book",
                True,
                "Notice: no open location (seed one or pass --shelter-code); write checks skipped",
            )
            return True

        person = {
            "location_code": candidates[0],
            "first_name": "Smoke",
            "last_name": "Test",
            "phone": "+66812345678",
        }
        bad_cid = {**person, "cid": "1234567890123"}  # fails mod-11 checksum
        status, data = self.http_request("POST", bookings, headers=headers, body=bad_cid)
        err_code = get_error_code(data)
        self.record_result(
            "M2",
            "EXT-008 CID with bad checksum rejected with 422 validation_error",
            status == 422 and err_code == "validation_error",
            f"HTTP {status} (code={err_code})",
        )

        # M2.3b Group validation (CR-169 FR-1/FR-4) — nothing is written by these requests
        status, data = self.http_request(
            "POST",
            bookings,
            headers=headers,
            body={
                "location_code": candidates[0],
                "persons": [
                    make_group_person(make_valid_cid()),
                    make_group_person("1234567890123", first_name=""),
                    make_group_person(make_valid_cid()),
                    make_group_person("9999999999999", phone="123"),
                ],
            },
        )
        err_msg = get_error_detail(data)
        self.record_result(
            "M2",
            "EXT-008 persons[] with several bad people → 422 naming every bad index",
            status == 422
            and get_error_code(data) == "validation_error"
            and "persons[1]" in err_msg
            and "persons[3]" in err_msg
            and "1234567890123" not in err_msg
            and "9999999999999" not in err_msg,
            f"HTTP {status} (code={get_error_code(data)})",
        )

        shared_cid = make_valid_cid()
        status, data = self.http_request(
            "POST",
            bookings,
            headers=headers,
            body={
                "location_code": candidates[0],
                "persons": [
                    make_group_person(make_valid_cid()),
                    make_group_person(shared_cid),
                    make_group_person(shared_cid),
                ],
            },
        )
        self.record_result(
            "M2",
            "EXT-008 same CID twice inside one persons[] → 422 validation_error",
            status == 422
            and get_error_code(data) == "validation_error"
            and "persons[2]" in get_error_detail(data)
            and shared_cid not in json.dumps(data),
            f"HTTP {status} (code={get_error_code(data)})",
        )

        for label, persons in (
            ("empty persons[]", []),
            ("persons[] over the 100-person cap", [make_group_person(None)] * 101),
        ):
            status, data = self.http_request(
                "POST",
                bookings,
                headers=headers,
                body={"location_code": candidates[0], "persons": persons},
            )
            self.record_result(
                "M2",
                f"EXT-008 {label} rejected with 422 validation_error",
                status == 422 and get_error_code(data) == "validation_error",
                f"HTTP {status} (code={get_error_code(data)})",
            )

        # M2.4 Unknown location → 404 location_not_found
        status, data = self.http_request(
            "POST",
            bookings,
            headers=headers,
            body={**person, "location_code": "NON_EXISTENT_999", "cid": make_valid_cid()},
        )
        err_code = get_error_code(data)
        self.record_result(
            "M2",
            "EXT-008 unknown location rejected with 404 location_not_found",
            status == 404 and err_code == "location_not_found",
            f"HTTP {status} (code={err_code})",
        )

        # M2.5 Unknown booking id → 404 booking_not_found (EXT-010)
        status, data = self.http_request("GET", f"{bookings}/BK-NON_EXISTENT_999", headers=headers)
        err_code = get_error_code(data)
        self.record_result(
            "M2",
            "EXT-010 unknown booking_id returns 404 booking_not_found",
            status == 404 and err_code == "booking_not_found",
            f"HTTP {status} (code={err_code})",
        )

        if self.skip_booking_writes:
            self.log(f"  {YELLOW}Skipping booking create (--skip-booking-writes){RESET}")
            return True

        # M2.6 Create a booking → 201 BOOKED (next candidate when a location opts out)
        cid = make_valid_cid()
        location = candidates[0]
        for location in candidates:
            status, data = self.http_request(
                "POST",
                bookings,
                headers=headers,
                body={**person, "location_code": location, "cid": cid},
            )
            if not (status == 409 and get_error_code(data) == "location_not_bookable"):
                break
        res = data.get("result", {}) if isinstance(data, dict) else {}
        booking_id = res.get("booking_id", "")
        if (
            status == 201
            and str(booking_id).startswith("BK-")
            and res.get("location_code") == location
            and res.get("booking_status") == "BOOKED"
        ):
            self.booking_id, self.booking_cid, self.booking_location = (
                booking_id,
                cid,
                location,
            )
            self.record_result(
                "M2",
                "EXT-008 POST /external/bookings accepts booking (201 BOOKED)",
                True,
                f"booking_id={booking_id}, location={location}",
            )
        else:
            self.record_result(
                "M2",
                "EXT-008 POST /external/bookings accepts booking (201 BOOKED)",
                False,
                f"HTTP {status} - {data}",
            )
            return False

        self.record_result(
            "M2",
            "EXT-008 legacy single-person body still accepted (persons_count 1)",
            res.get("persons_count") == 1,
            f"persons_count={res.get('persons_count')}",
        )

        # M2.7 Same CID, same shelter → 409 duplicate_booking
        status, data = self.http_request(
            "POST",
            bookings,
            headers=headers,
            body={**person, "location_code": location, "cid": cid},
        )
        err_code = get_error_code(data)
        self.record_result(
            "M2",
            "EXT-008 same CID at same location rejected with 409 duplicate_booking",
            status == 409 and err_code == "duplicate_booking",
            f"HTTP {status} (code={err_code})",
        )

        # M2.8 Status read-back (EXT-010)
        status, data = self.http_request("GET", f"{bookings}/{self.booking_id}", headers=headers)
        res = data.get("result", {}) if isinstance(data, dict) else {}
        stamps_ok = all(
            str(res.get(k, "")).endswith("+07:00") for k in ("created_at", "updated_at")
        )
        self.record_result(
            "M2",
            "EXT-010 GET /external/bookings/{id} returns BOOKED with +07:00 timestamps",
            status == 200
            and res.get("booking_id") == self.booking_id
            and res.get("location_code") == location
            and res.get("booking_status") == "BOOKED"
            and stamps_ok,
            f"HTTP {status}, booking_status={res.get('booking_status')}",
        )

        self._group_booking_checks(headers, bookings, location)
        self._idempotency_checks(headers, bookings, location)
        return True

    def _idempotency_checks(self, headers: Dict[str, str], bookings: str, location: str) -> None:
        """#614 Idempotency-Key (API level). The booking made here is cancelled again."""
        key = f"smoke-{os.urandom(8).hex()}"
        keyed = {**headers, "Idempotency-Key": key}
        cid = make_valid_cid()
        body = {**make_group_person(cid), "location_code": location}
        status, data = self.http_request("POST", bookings, headers=keyed, body=body)
        result = data.get("result") if isinstance(data, dict) else None
        first_id = str((result or {}).get("booking_id", ""))
        if status != 201 or not first_id.startswith("BK-"):
            self.record_result(
                "M2",
                "EXT-008 Idempotency-Key first request → 201",
                False,
                f"HTTP {status} - {data}",
            )
            return

        try:
            status, data = self.http_request("POST", bookings, headers=keyed, body=body)
            result = data.get("result") if isinstance(data, dict) else None
            replay_id = str((result or {}).get("booking_id", ""))
            self.record_result(
                "M2",
                "EXT-008 same Idempotency-Key and body replays 201 with the same booking_id",
                status == 201 and replay_id == first_id,
                f"HTTP {status}, booking_id={replay_id}",
            )

            different = {**body, "first_name": "Other"}
            status, data = self.http_request("POST", bookings, headers=keyed, body=different)
            err_code = get_error_code(data)
            self.record_result(
                "M2",
                "EXT-008 reused Idempotency-Key, different body → 409 idempotency_key_reused",
                status == 409 and err_code == "idempotency_key_reused",
                f"HTTP {status} (code={err_code})",
            )
        finally:
            self.http_request(
                "POST",
                f"{bookings}/{first_id}/cancel",
                headers=headers,
                body={"reason": "smoke test cleanup"},
            )

    def _group_booking_checks(self, headers: Dict[str, str], bookings: str, location: str) -> None:
        """CR-169 group scenarios (EXT-008/009/010, API level). Every group made here is
        cancelled again before returning, like the single booking."""
        # G1 Group of 3 → 201 with one BK- group id and persons_count 3
        group_cids = [make_valid_cid() for _ in range(3)]
        status, data = self.http_request(
            "POST",
            bookings,
            headers=headers,
            body={"location_code": location, "persons": [make_group_person(c) for c in group_cids]},
        )
        res = data.get("result", {}) if isinstance(data, dict) else {}
        group_id = str(res.get("booking_id", ""))
        group_ok = (
            status == 201
            and group_id.startswith("BK-")
            and res.get("persons_count") == 3
            and res.get("location_code") == location
            and res.get("booking_status") == "BOOKED"
        )
        self.record_result(
            "M2",
            "EXT-008 persons[] of 3 → 201 BOOKED with persons_count 3 and a BK- group id",
            group_ok,
            f"HTTP {status} - {data}" if not group_ok else f"booking_id={group_id}",
        )
        if not group_ok:
            # A group that was created despite a wrong shape must still be cleaned up
            if group_id.startswith("BK-"):
                self.http_request(
                    "POST",
                    f"{bookings}/{group_id}/cancel",
                    headers=headers,
                    body={"reason": "smoke test cleanup"},
                )
            return

        # G2 Status of the group: one aggregate + one entry per person, no PII
        status, data = self.http_request("GET", f"{bookings}/{group_id}", headers=headers)
        res = data.get("result", {}) if isinstance(data, dict) else {}
        persons_out = res.get("persons") or []
        pii_keys = ("cid", "first_name", "last_name", "phone")
        self.record_result(
            "M2",
            "EXT-010 group status: BOOKED aggregate, persons[] index 0..2, no PII",
            status == 200
            and res.get("booking_status") == "BOOKED"
            and [p.get("index") for p in persons_out] == [0, 1, 2]
            and all(
                p.get("booking_status") == "BOOKED" and p.get("reject_reason") is None
                for p in persons_out
            )
            and not any(key in p for p in persons_out for key in pii_keys),
            f"HTTP {status}, booking_status={res.get('booking_status')}",
        )

        # G3 Duplicate of an existing booking in the group → 409, detail = first duplicate index
        fresh_cid = make_valid_cid()
        status, data = self.http_request(
            "POST",
            bookings,
            headers=headers,
            body={
                "location_code": location,
                "persons": [
                    make_group_person(fresh_cid),
                    make_group_person(self.booking_cid),
                    make_group_person(make_valid_cid()),
                ],
            },
        )
        self.record_result(
            "M2",
            "EXT-008 group with a person already booked here → 409 duplicate_booking, detail persons[1]",
            status == 409
            and get_error_code(data) == "duplicate_booking"
            and get_error_detail(data) == "persons[1]"
            and self.booking_cid not in json.dumps(data),
            f"HTTP {status} (code={get_error_code(data)}, detail={get_error_detail(data)})",
        )

        # The duplicate group must be refused; if the API booked it anyway, cancel it again
        # so nothing from this smoke run stays booked.
        if status == 201 and isinstance(data, dict):
            stray = str((data.get("result") or {}).get("booking_id", ""))
            if stray.startswith("BK-"):
                c_status, c_data = self.http_request(
                    "POST",
                    f"{bookings}/{stray}/cancel",
                    headers=headers,
                    body={"reason": "smoke test cleanup"},
                )
                self.record_result(
                    "M2",
                    "cleanup: stray group booked by the duplicate-group check was cancelled",
                    c_status == 200,
                    f"HTTP {c_status} (code={get_error_code(c_data)})",
                )

        # G4 Nothing from the refused group is held: the other person can still book alone
        status, data = self.http_request(
            "POST",
            bookings,
            headers=headers,
            body={"location_code": location, "persons": [make_group_person(fresh_cid)]},
        )
        res = data.get("result", {}) if isinstance(data, dict) else {}
        lone_id = str(res.get("booking_id", ""))
        self.record_result(
            "M2",
            "EXT-008 person from the refused group can still be booked (409 left nothing behind)",
            status == 201 and lone_id.startswith("BK-"),
            f"HTTP {status} (code={get_error_code(data)})",
        )
        if lone_id.startswith("BK-"):
            status, _ = self.http_request(
                "POST",
                f"{bookings}/{lone_id}/cancel",
                headers=headers,
                body={"reason": "smoke test cleanup"},
            )
            self.record_result(
                "M2",
                "EXT-009 cancel of the one-person group → 200",
                status == 200,
                f"HTTP {status}",
            )

        # G5 Cancel the whole group in one call → 200 CANCELLED
        status, data = self.http_request(
            "POST",
            f"{bookings}/{group_id}/cancel",
            headers=headers,
            body={"reason": "smoke test cleanup"},
        )
        res = data.get("result", {}) if isinstance(data, dict) else {}
        self.record_result(
            "M2",
            "EXT-009 group cancel (one call for every person) → 200 CANCELLED",
            status == 200
            and res.get("booking_id") == group_id
            and res.get("booking_status") == "CANCELLED",
            f"HTTP {status} - {data}" if status != 200 else "",
        )

        # G6 Every person reads CANCELLED afterwards
        status, data = self.http_request("GET", f"{bookings}/{group_id}", headers=headers)
        res = data.get("result", {}) if isinstance(data, dict) else {}
        self.record_result(
            "M2",
            "EXT-010 group reads CANCELLED for the aggregate and every person",
            status == 200
            and res.get("booking_status") == "CANCELLED"
            and all(p.get("booking_status") == "CANCELLED" for p in res.get("persons") or []),
            f"HTTP {status}, booking_status={res.get('booking_status')}",
        )

        # G7 Repeat group cancel → 200 idempotent (CR-169 FR-40, #592)
        status, data = self.http_request(
            "POST", f"{bookings}/{group_id}/cancel", headers=headers, body=None
        )
        res = data.get("result", {}) if isinstance(data, dict) else {}
        self.record_result(
            "M2",
            "EXT-009 repeat group cancel is idempotent (200 CANCELLED)",
            status == 200 and res.get("booking_status") == "CANCELLED",
            f"HTTP {status} (code={get_error_code(data)})",
        )

        # G9 Group of 2 (the lower bound of a multi-person group) → 201, then cancel it
        pair_cids = [make_valid_cid(), make_valid_cid()]
        status, data = self.http_request(
            "POST",
            bookings,
            headers=headers,
            body={"location_code": location, "persons": [make_group_person(c) for c in pair_cids]},
        )
        res = data.get("result", {}) if isinstance(data, dict) else {}
        pair_id = str(res.get("booking_id", ""))
        self.record_result(
            "M2",
            "EXT-008 persons[] of 2 → 201 BOOKED with persons_count 2 and a BK- id",
            status == 201 and pair_id.startswith("BK-") and res.get("persons_count") == 2,
            f"HTTP {status} - {data}" if not pair_id.startswith("BK-") else f"booking_id={pair_id}",
        )
        if pair_id.startswith("BK-"):
            status, _ = self.http_request(
                "POST",
                f"{bookings}/{pair_id}/cancel",
                headers=headers,
                body={"reason": "smoke test cleanup"},
            )
            self.record_result(
                "M2",
                "EXT-009 cancel of the two-person group → 200",
                status == 200,
                f"HTTP {status}",
            )

        # G8 Partial groups (a worker-rejected member, a checked-in member) need the worker
        # and CouchDB: covered by e2e scenarios 8 and 9 (run with --e2e)
        self.record_skip(
            "M2",
            "EXT-009/010 partial groups (rejected member, cancel after check-in)",
            "needs the worker and CouchDB; run with --e2e",
        )

    def test_person_search(self) -> bool:
        """EXT-012 — purpose + scope gates, 422 for a bad query, 200 + empty result for no match."""
        self._banner("Testing EXT-012 Person Search")

        if not self.access_token:
            self.record_result("EXT-012", "Person search endpoint", False, "Missing access token")
            return False

        headers = {"Authorization": f"Bearer {self.access_token}"}
        path = self.partner_path("/external/persons/search")

        def search(query: str, purpose: Optional[str] = "smoke-test") -> Tuple[int, Dict[str, Any]]:
            url = path if purpose is None else f"{path}?{urllib.parse.urlencode({'purpose': purpose})}"
            # The query is a national ID / name: keep it out of the verbose log.
            return self.http_request(
                "POST", url, headers=headers, body={"search": query}, log_body=False
            )

        status, data = search(make_valid_cid(), purpose=None)
        err_code = get_error_code(data)
        self.record_result(
            "EXT-012",
            "EXT-012 missing 'purpose' rejected with 400 missing_purpose",
            status == 400 and err_code == "missing_purpose",
            f"HTTP {status} (code={err_code})",
        )

        if "occupant-search" not in self.token_scopes:
            status, data = search(make_valid_cid())
            err_code = get_error_code(data)
            self.record_result(
                "EXT-012",
                "Token without occupant-search is denied (403 insufficient_scope)",
                status == 403 and err_code == "insufficient_scope",
                f"HTTP {status} (code={err_code})",
            )
            self.log(
                f"  {YELLOW}Skipping person search (token has no occupant-search scope){RESET}"
            )
            return True

        status, data = search("a")
        err_code = get_error_code(data)
        self.record_result(
            "EXT-012",
            "EXT-012 too-short query rejected with 422 validation_error",
            status == 422 and err_code == "validation_error",
            f"HTTP {status} (code={err_code})",
        )

        status, data = search(make_valid_cid())
        result = data.get("result") if isinstance(data, dict) else None
        self.record_result(
            "EXT-012",
            "EXT-012 unknown cid returns 200 with an empty result list",
            status == 200 and data.get("status") == 200 and result == [],
            f"HTTP {status}, result={result}",
        )
        return True

    def test_m2_residency(self) -> bool:
        """EXT-011 — purpose + scope gates, 404 for a booked-but-not-checked-in CID."""
        self._banner("Testing M2: EXT-011 Shelter Residency Lookup")

        if not self.access_token:
            self.record_result("M2", "Residency endpoint", False, "Missing access token")
            return False

        headers = {"Authorization": f"Bearer {self.access_token}"}
        path = self.partner_path("/external/persons/shelter-residency")

        def query(cid: str, purpose: Optional[str] = "smoke-test") -> str:
            params = {"cid": cid}
            if purpose is not None:
                params["purpose"] = purpose
            return f"{path}?{urllib.parse.urlencode(params)}"

        # M2.9 Missing purpose → 400 (checked before scope)
        status, data = self.http_request(
            "GET", query(make_valid_cid(), purpose=None), headers=headers
        )
        err_code = get_error_code(data)
        self.record_result(
            "M2",
            "EXT-011 missing 'purpose' rejected with 400 missing_purpose",
            status == 400 and err_code == "missing_purpose",
            f"HTTP {status} (code={err_code})",
        )

        # M2.10 Scope gate
        if "residency-read" not in self.token_scopes:
            status, data = self.http_request("GET", query(make_valid_cid()), headers=headers)
            err_code = get_error_code(data)
            self.record_result(
                "M2",
                "Token without residency-read is denied (403 insufficient_scope)",
                status == 403 and err_code == "insufficient_scope",
                f"HTTP {status} (code={err_code})",
            )
            self.log(
                f"  {YELLOW}Skipping residency lookups (token has no residency-read scope){RESET}"
            )
            return True

        # M2.11 Malformed CID → 422
        status, data = self.http_request("GET", query("123"), headers=headers)
        err_code = get_error_code(data)
        self.record_result(
            "M2",
            "EXT-011 malformed cid rejected with 422 validation_error",
            status == 422 and err_code == "validation_error",
            f"HTTP {status} (code={err_code})",
        )

        # M2.12 Unknown CID → 404 residency_not_found
        status, data = self.http_request("GET", query(make_valid_cid()), headers=headers)
        err_code = get_error_code(data)
        self.record_result(
            "M2",
            "EXT-011 unknown cid returns 404 residency_not_found",
            status == 404 and err_code == "residency_not_found",
            f"HTTP {status} (code={err_code})",
        )

        # M2.13 Booked but not checked in → still 404 (pre_registered is not residency)
        if self.booking_cid:
            status, data = self.http_request("GET", query(self.booking_cid), headers=headers)
            err_code = get_error_code(data)
            self.record_result(
                "M2",
                "EXT-011 booked-but-not-checked-in cid returns 404 residency_not_found",
                status == 404 and err_code == "residency_not_found",
                f"HTTP {status} (code={err_code})",
            )

        # M2.14 Optional 200 path with a known checked-in person
        if self.checked_in_cid:
            status, data = self.http_request("GET", query(self.checked_in_cid), headers=headers)
            res = data.get("result", {}) if isinstance(data, dict) else {}
            self.record_result(
                "M2",
                "EXT-011 checked-in cid returns residency envelope",
                status == 200
                and res.get("residency_status") in ("CHECKED_IN", "CHECKED_OUT")
                and bool(res.get("location_code"))
                and "checkin_datetime" in res
                and isinstance(res.get("in_zone"), bool),
                f"HTTP {status}, location={res.get('location_code')}, "
                f"residency_status={res.get('residency_status')}",
            )
        return True

    def test_m2_cancel(self) -> bool:
        """EXT-009 — always runs when a booking was created, so no test booking is left open."""
        if not self.booking_id:
            return True
        self._banner("Testing M2: EXT-009 Cancel Booking")

        headers = {"Authorization": f"Bearer {self.access_token}"}
        base = self.partner_path(f"/external/bookings/{self.booking_id}")

        # M2.15 Over-long reason → 422 (validated before the booking is touched)
        status, data = self.http_request(
            "POST", f"{base}/cancel", headers=headers, body={"reason": "x" * 201}
        )
        err_code = get_error_code(data)
        self.record_result(
            "M2",
            "EXT-009 reason over 200 chars rejected with 422 validation_error",
            status == 422 and err_code == "validation_error",
            f"HTTP {status} (code={err_code})",
        )

        # M2.16 Cancel → 200 CANCELLED
        status, data = self.http_request(
            "POST", f"{base}/cancel", headers=headers, body={"reason": "smoke test cleanup"}
        )
        res = data.get("result", {}) if isinstance(data, dict) else {}
        self.record_result(
            "M2",
            "EXT-009 POST .../cancel returns 200 CANCELLED",
            status == 200
            and res.get("booking_id") == self.booking_id
            and res.get("booking_status") == "CANCELLED",
            f"HTTP {status} - {data}" if status != 200 else "",
        )

        # M2.17 Status reflects the cancellation immediately (FR-35)
        status, data = self.http_request("GET", base, headers=headers)
        res = data.get("result", {}) if isinstance(data, dict) else {}
        self.record_result(
            "M2",
            "EXT-010 status reads CANCELLED after cancel",
            status == 200 and res.get("booking_status") == "CANCELLED",
            f"HTTP {status}, booking_status={res.get('booking_status')}",
        )

        # M2.18 Cancelling twice → 200 idempotent (CR-169 FR-40, #592)
        status, data = self.http_request("POST", f"{base}/cancel", headers=headers)
        res = data.get("result", {}) if isinstance(data, dict) else {}
        self.record_result(
            "M2",
            "EXT-009 second cancel is idempotent (200 CANCELLED)",
            status == 200 and res.get("booking_status") == "CANCELLED",
            f"HTTP {status} (code={get_error_code(data)})",
        )
        return True

    # -------------------------------------------------------------------------
    # Scenario 7: Cleanup & Client Revocation (Issue #215 Lifecycle)
    # -------------------------------------------------------------------------
    def test_cleanup_and_revocation(self) -> bool:
        if self.use_provided_credentials:
            self.log(
                f"\n{YELLOW}Skipping client cleanup (using provided credentials — not revoking){RESET}"
            )
            return True

        if self.keep_client:
            self.log(f"\n{YELLOW}Skipping client cleanup (--keep-client specified){RESET}")
            return True

        if not self.created_client_row_id or not self.created_client_id:
            return True

        self.log(f"\n{BOLD}======================================================{RESET}")
        self.log(f"{BOLD}Testing Client Revocation & Cleanup (Issue #215 Lifecycle){RESET}")
        self.log(f"{BOLD}======================================================{RESET}")

        # 7.1 Revoke Client
        status, data = self.http_request(
            "POST",
            f"/v1/admin/thirdparty-clients/{self.created_client_row_id}/revoke",
            headers={"Authorization": f"Bearer {self.admin_secret}"},
        )
        client_data = data.get("client", {})
        if status == 200 and data.get("success") is True and client_data.get("is_active") is False:
            self.record_result(
                "#215",
                "Admin API revokes third-party client (is_active=False)",
                True,
                f"client_id={self.created_client_id}",
            )
        else:
            self.record_result(
                "#215",
                "Admin API revokes third-party client",
                False,
                f"HTTP {status} - {data}",
            )

        # 7.2 Revoked client cannot mint new tokens
        token_payload = {
            "grant_type": "client_credentials",
            "client_id": self.created_client_id,
            "client_secret": self.client_secret,
        }
        status, data = self.http_request(
            "POST", self.partner_path("/external/token"), body=token_payload
        )
        err_code = get_error_code(data)
        if status == 401 and err_code == "invalid_client":
            self.record_result(
                "#215",
                "Revoked client is immediately barred from minting tokens (401)",
                True,
            )
        else:
            self.record_result(
                "#215",
                "Revoked client barred from minting tokens",
                False,
                f"Expected 401 invalid_client, got HTTP {status} (code={err_code})",
            )

        return True

    # -------------------------------------------------------------------------
    # Runner Execution & Summary
    # -------------------------------------------------------------------------
    def run_all(self) -> int:
        start_time = time.time()
        mode = (
            "provided credentials"
            if self.use_provided_credentials
            else "admin provision (+ EXTERNAL_API_SECRET)"
        )
        self.log(
            f"\n{BOLD}================================================================={RESET}"
        )
        self.log(
            f"{BOLD}{CYAN}SMOKE TEST SUITE: Smart Shelter Partner API (Issues #214-#220 + M2 EXT-008..011){RESET}"
        )
        self.log(f"{BOLD}Target Host: {redact_url(self.base_url)}{RESET}")
        self.log(f"{BOLD}API prefix: {self.api_prefix or '(none — direct FastAPI paths)'}{RESET}")
        self.log(f"{BOLD}Mode: {mode}{RESET}")
        self.log(f"{BOLD}================================================================={RESET}")

        # Connectivity: public plane has no /v1/health — probe partner path instead.
        probe_path = self.partner_path("/external/locations")
        self.log("\nChecking target server connectivity...")
        status, probe_body = self.http_request("GET", probe_path)
        if status == 0:
            self.log(f"{RED}ERROR: Cannot connect to server at {redact_url(self.base_url)}.{RESET}")
            self.log(
                f"{YELLOW}Hint: Use the public origin (e.g. https://shelter.importstar.dev) "
                f"with --api-prefix /public-api.{RESET}"
            )
            return 1
        if self.is_cloudflare_block(status, probe_body):
            self.log(
                f"{RED}ERROR: Cloudflare blocked this client (Error 1010 / browser signature).{RESET}"
            )
            self.log(
                f"{YELLOW}Hint: Script already sets a browser-like User-Agent; if still blocked, "
                f"allowlist your IP in Cloudflare WAF. ray_id={probe_body.get('ray_id', '?')}{RESET}"
            )
            return 1
        raw_probe = str(probe_body.get("raw", ""))
        if status == 404 and ("html" in raw_probe.lower() or not probe_body.get("code")):
            self.log(
                f"{RED}ERROR: {probe_path} returned SPA/HTML 404 — partner route not found.{RESET}"
            )
            self.log(
                f"{YELLOW}Hint: On staging use --api-prefix /public-api "
                f"(not bare /external). Local FastAPI: --api-prefix ''.{RESET}"
            )
            return 1
        self.log_verbose(f"Probe GET {probe_path} → HTTP {status} (expect 401 without token)")

        # Execute tests sequentially
        self.test_issue_215_auth()
        self.test_issue_216_locations()
        self.test_issue_217_occupancy()
        self.test_issue_218_stock()
        self.test_issue_219_summary()
        self.test_issue_220_occupants_pdpa()
        self.test_m2_bookings()
        self.test_m2_residency()
        self.test_person_search()
        self.test_m2_cancel()
        self.test_cleanup_and_revocation()

        elapsed = time.time() - start_time
        return self.print_summary(elapsed)

    def print_summary(self, elapsed: float) -> int:
        total = len(self.results)
        passed_count = sum(1 for _, _, p, _ in self.results if p)
        failed_count = total - passed_count

        self.log(
            f"\n\n{BOLD}================================================================={RESET}"
        )
        self.log(f"{BOLD}                     SMOKE TEST SUMMARY REPORT                   {RESET}")
        self.log(f"{BOLD}================================================================={RESET}")

        # Summary by Issue
        issue_map = {
            "#214": "Spec: Partner API Integration (Envelope, Schema contract)",
            "#215": "EXT-001: OAuth2 Client Credentials & Admin Provisioning",
            "#216": "EXT-002/003: Location Master & DOPA Administrative Codes",
            "#217": "EXT-005: Occupancy Projection & Demographics Breakdown",
            "#218": "EXT-004: Shelter Stock Projection & M6 Schema Alignment",
            "#219": "EXT-006: Cross-Location Summary & Critical Items Alerts",
            "#220": "EXT-007: Occupants Scaffold & PDPA Default-Deny Audit",
            "M2": "EXT-008..011: Bookings (create/cancel/status) & Shelter Residency",
            "E2E": "EXT-008..010 end-to-end: API -> Mongo -> worker -> CouchDB (CR-169)",
        }

        for issue_id, issue_name in issue_map.items():
            tests = [r for r in self.results if r[0] == issue_id]
            if not tests:
                # Issue 214 is implicitly tested by envelope & schema across all checks
                if issue_id == "#214":
                    status_badge = f"{GREEN}PASS{RESET}"
                    self.log(
                        f"  [{status_badge}] {BOLD}{issue_id}{RESET} - {issue_name} (Verified via ADR 0002 envelopes)"
                    )
                continue

            all_passed = all(p for _, _, p, _ in tests)
            status_badge = f"{GREEN}PASS{RESET}" if all_passed else f"{RED}FAIL{RESET}"
            p_sub = sum(1 for _, _, p, _ in tests if p)
            self.log(
                f"  [{status_badge}] {BOLD}{issue_id}{RESET} - {issue_name} ({p_sub}/{len(tests)} checks passed)"
            )

        for issue_id, name, reason in self.skipped:
            self.log(f"  [{YELLOW}SKIPPED{RESET}] {issue_id} {name} ({reason})")
        self.log(f"-----------------------------------------------------------------")
        self.log(
            f"Total Checks: {BOLD}{total}{RESET} | Passed: {GREEN}{passed_count}{RESET} | Failed: {RED}{failed_count}{RESET} | Duration: {elapsed:.2f}s"
        )
        if self.skipped:
            self.log(f"Skipped: {YELLOW}{len(self.skipped)}{RESET}")
        self.log(
            f"{BOLD}================================================================={RESET}\n"
        )

        return 0 if failed_count == 0 else 1


# =============================================================================
# End-to-end mode (--e2e, issue #597): API -> Mongo -> sync worker -> CouchDB
# =============================================================================
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")
#: Mirrors worker POLL_INTERVAL_SECONDS (worker/src/worker/inbound/external_bookings.py).
WORKER_POLL_SECONDS = 3
#: A repeat of the same signal within this window counts as the SAME key press: `uv run`
#: forwards a terminal Ctrl-C to its child on top of the copy the child gets from the
#: terminal's process group, so one press would otherwise arrive twice.
SIGNAL_DEBOUNCE_SECONDS = 1.0
#: Stay statuses that hold a bed (same set as the worker / API duplicate guards).
HOLD_STATUSES = (
    "pre_registered",
    "arriving",
    "active",
    "room_confirmed",
    "temporary_leave",
)
#: Sleep between CouchDB polls in watch_group (timing resolution is bounded by it).
WATCH_POLL_SECONDS = 0.25
#: Fallback ownership (no Mongo): a doc older than run start minus this is not ours.
CLOCK_SKEW = dt.timedelta(seconds=60)
#: Cleanup: bounded retry of one cancel call (transport error / 5xx / 401), and how many
#: cleanup passes may retry the same booking.
CANCEL_TRIES = 3
CANCEL_BACKOFF_SECONDS = (0.5, 1.5)
CANCEL_ROUNDS = 3
#: Cleanup: delete/re-scan rounds, and scrub/re-check rounds for rows left open.
PURGE_ROUNDS = 3
SCRUB_ROUNDS = 3
#: Pre-flight: regeneration rounds for CIDs that already have a doc in the shelter.
PREFLIGHT_ATTEMPTS = 5
S1_REF_CASE = "evacuee.booking_ref == booking_id and schema_v 14"
EVACUEE_FIELDS = [
    "_id",
    "household_id",
    "current_stay",
    "registered_via",
    "gender",
    "schema_v",
    "booking_ref",
    "created_by",
    "person_id.number",
]


MANIFEST_SCHEMA = "smoke-e2e-manifest/1"


class RunInterrupted(BaseException):
    """First SIGINT/SIGTERM while the e2e run is going: unwind to the normal cleanup.

    A BaseException so that no `except Exception` in the run swallows it."""

    def __init__(self, signum: int):
        super().__init__(signal.Signals(signum).name)
        self.signum = signum


class CleanupAborted(BaseException):
    """Cleanup was aborted by repeated signals; the manifest is kept for a recovery run."""

    def __init__(self, signum: int):
        super().__init__(signal.Signals(signum).name)
        self.signum = signum


class ManifestError(ValueError):
    """The recovery manifest is missing, unsafe or malformed (refuse; fail closed)."""


class RunManifest:
    """Per-run JSON file that lets `--e2e-cleanup-from` finish a run that died.

    Holds synthetic test CIDs, ids and redacted target hosts: NO secrets (never the client
    secret, the admin secret or CouchDB credentials). Created exclusively with mode 0600
    BEFORE the first request that can create data, then replaced atomically (temp file in
    the same directory + rename) after every registration step.
    """

    def __init__(self, path: str):
        self.path = path

    @staticmethod
    def default_path(run_id: str) -> str:
        return os.path.join(tempfile.gettempdir(), f"smoke-e2e-{run_id}.json")

    @staticmethod
    def _dump(handle: Any, data: Dict[str, Any]) -> None:
        json.dump(data, handle, indent=1, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())

    def create(self, data: Dict[str, Any]) -> None:
        """First write; O_EXCL, so an existing path (or symlink) is refused, never reused."""
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            self._dump(handle, data)

    def write(self, data: Dict[str, Any]) -> None:
        directory = os.path.dirname(os.path.abspath(self.path))
        fd, tmp = tempfile.mkstemp(prefix=".smoke-e2e-", suffix=".tmp", dir=directory)  # 0600
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                self._dump(handle, data)
            os.replace(tmp, self.path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def remove(self) -> None:
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass

    @staticmethod
    def load(path: str) -> Dict[str, Any]:
        """Read + validate a manifest. Refuses anything that is not a private regular file
        owned by this user, or whose content does not have the expected shape."""
        try:
            info = os.stat(path)
        except FileNotFoundError:
            raise ManifestError(
                "manifest not found (already cleaned up, or a wrong path)"
            ) from None
        except OSError as exc:
            raise ManifestError(f"cannot read the manifest ({type(exc).__name__})") from None
        if not os.path.isfile(path):
            raise ManifestError("the manifest path is not a regular file")
        if hasattr(os, "getuid") and info.st_uid != os.getuid():
            raise ManifestError("the manifest is not owned by this user")
        if info.st_mode & 0o022:
            raise ManifestError("the manifest is group/world writable; refusing to trust it")
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            raise ManifestError("the manifest is not valid JSON") from None
        try:
            if data.get("schema") != MANIFEST_SCHEMA:
                raise ManifestError("unsupported manifest schema")
            for key in ("run_id", "run_started", "shelter", "couch_database"):
                if not isinstance(data.get(key), str) or not data[key]:
                    raise ManifestError(f"manifest field {key} is missing")
            if data["couch_database"] != f"shelter_{data['shelter'].lower()}":
                raise ManifestError("manifest couch_database does not match its shelter")
            started = dt.datetime.fromisoformat(data["run_started"].replace("Z", "+00:00"))
            if started.tzinfo is None:
                raise ManifestError("manifest run_started has no timezone")
            for key in ("cids", "booking_ids", "planted_ids", "orphan_ids"):
                if not isinstance(data.get(key), list) or not all(
                    isinstance(i, str) for i in data[key]
                ):
                    raise ManifestError(f"manifest field {key} is malformed")
            reserved = data.get("reserved")
            if not isinstance(reserved, dict) or not all(
                isinstance(reserved.get(k), list) and all(isinstance(i, str) for i in reserved[k])
                for k in ("evacuees", "households")
            ):
                raise ManifestError("manifest field reserved is malformed")
            if not isinstance(data.get("proven"), dict):
                raise ManifestError("manifest field proven is malformed")
            client = data.get("client")
            if not isinstance(client, dict) or client.get("mode") not in ("admin", "provided"):
                raise ManifestError("manifest field client is malformed")
            if not isinstance(data.get("targets"), dict):
                raise ManifestError("manifest field targets is malformed")
        except (AttributeError, ValueError, TypeError) as exc:
            if isinstance(exc, ManifestError):
                raise
            raise ManifestError("the manifest is malformed") from None
        return data


def host_port(url: str) -> str:
    """`host:port` of an http(s) URL (userinfo, path and query dropped)."""
    try:
        parts = urllib.parse.urlsplit(url)
        port = parts.port or {"http": 80, "https": 443}.get(parts.scheme, 0)
    except ValueError:
        return "?"
    return f"{(parts.hostname or '').lower()}:{port}"


def mongo_endpoints(uri: str) -> Tuple[List[str], str]:
    """(sorted `host[:port]` list, database name) of a mongodb URI; userinfo dropped."""
    rest = uri.strip().split("://", 1)[1] if "://" in uri else uri.strip()
    match = re.match(r"([^/?#]*)([^?#]*)", rest)
    authority, path = (match.group(1), match.group(2)) if match else ("", "")
    if "@" in authority:
        authority = authority.rsplit("@", 1)[1]
    hosts = sorted(p.strip().lower() for p in authority.split(",") if p.strip())
    return hosts, path.strip("/")


def target_fingerprint(args: argparse.Namespace) -> Dict[str, Any]:
    """Redacted identity of the targets (no credentials, no paths): what the manifest
    records and what `--e2e-cleanup-from` must match."""
    fingerprint: Dict[str, Any] = {
        "api": host_port(args.base_url),
        "couch": host_port(args.couch_url),
        "mongo": None,
        "mongo_db": None,
    }
    if args.mongo_uri:
        fingerprint["mongo"], fingerprint["mongo_db"] = mongo_endpoints(args.mongo_uri)
    return fingerprint


def read_env_file(path: str) -> Dict[str, str]:
    """Parse KEY=VALUE lines of a dotenv file. Values are never printed."""
    values: Dict[str, str] = {}
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip().strip("'\"")
    except OSError:
        pass
    return values


def url_host(url: str) -> str:
    try:
        return (urllib.parse.urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def url_has_userinfo(url: str) -> bool:
    """True when a http(s)/mongodb URL embeds credentials (`user[:pass]@host`)."""
    rest = url.split("://", 1)[1] if "://" in url else url
    authority = re.split(r"[/?#]", rest, maxsplit=1)[0]
    return "@" in authority


def mongo_uri_hosts(uri: str) -> Tuple[List[Tuple[str, bool]], Optional[str]]:
    """Every host of a `mongodb://` URI as (host, may_be_local), plus an error text.

    `mongodb+srv://` resolves hosts through DNS, so it never counts as local.
    """
    lowered = uri.strip()
    if lowered.lower().startswith("mongodb+srv://"):
        rest, may_be_local = lowered[len("mongodb+srv://") :], False
    elif lowered.lower().startswith("mongodb://"):
        rest, may_be_local = lowered[len("mongodb://") :], True
    else:
        return [], "must start with mongodb:// or mongodb+srv://"
    authority = re.split(r"[/?#]", rest, maxsplit=1)[0]
    if "@" in authority:
        authority = authority.rsplit("@", 1)[1]
    hosts: List[Tuple[str, bool]] = []
    for part in authority.split(","):
        part = part.strip()
        if part.startswith("["):  # [::1]:27017
            host = part[1:].split("]", 1)[0]
        elif part.count(":") == 1:
            host = part.split(":", 1)[0]
        else:
            host = part
        hosts.append((host.lower(), may_be_local))
    return hosts, None


def unsafe_hosts(hosts: List[Tuple[str, bool]], confirmed: List[str]) -> List[str]:
    """Hosts that are neither local (exact match) nor explicitly confirmed.

    `hosts` holds (host, may_be_local). An empty/unparseable host is never allowed.
    """
    allowed = {h.strip().lower() for h in confirmed if h.strip()}
    risky = set()
    for host, may_be_local in hosts:
        if not host:
            risky.add("(unparseable host)")
        elif not (may_be_local and host in LOCAL_HOSTS) and host not in allowed:
            risky.add(host)
    return sorted(risky)


def e2e_target_hosts(args: argparse.Namespace) -> List[Tuple[str, bool]]:
    """Every host of the API, CouchDB and Mongo targets as (host, may_be_local)."""
    hosts: List[Tuple[str, bool]] = [
        (url_host(args.base_url), True),
        (url_host(args.couch_url), True),
    ]
    if args.mongo_uri:
        mongo_hosts, _ = mongo_uri_hosts(args.mongo_uri)
        hosts.extend(mongo_hosts or [("", True)])
    return hosts


def nonlocal_hosts(hosts: List[Tuple[str, bool]]) -> List[str]:
    """Hosts that are not local, whether or not they were confirmed (sorted, no secrets)."""
    return sorted(
        {
            host or "(unparseable host)"
            for host, may_be_local in hosts
            if not (may_be_local and host in LOCAL_HOSTS)
        }
    )


def e2e_target_guard(parser: argparse.ArgumentParser, args: argparse.Namespace) -> Optional[int]:
    """Safety checks for every e2e target, BEFORE any connection or write.

    Returns an exit code when the run must not proceed. Never echoes URL values.
    """
    targets = [("--base-url", args.base_url), ("--couch-url", args.couch_url)]
    if args.mongo_uri:
        targets.append(("--mongo-uri", args.mongo_uri))
    for label, value in targets:
        if url_has_userinfo(value):
            print(
                f"{RED}Refusing {label}: the URL embeds credentials (user:pass@host).{RESET}\n"
                "Do not put secrets in URLs (they leak into logs and shell history). Pass "
                "CouchDB credentials through COUCHDB_USER / COUCHDB_PASSWORD (env or .env) "
                "and use a credential-free URL.",
                file=sys.stderr,
            )
            return 2
    for label, value in targets[:2]:
        scheme = value.split("://", 1)[0].lower() if "://" in value else ""
        if scheme not in ("http", "https"):
            print(f"{RED}Refusing {label}: it must be an http(s) URL.{RESET}", file=sys.stderr)
            return 2
    if args.mongo_uri:
        _, problem = mongo_uri_hosts(args.mongo_uri)
        if problem:
            print(f"{RED}Refusing --mongo-uri: {problem}.{RESET}", file=sys.stderr)
            return 2
    hosts = e2e_target_hosts(args)
    confirmed = [h for h in args.i_know_this_writes_to.split(",") if h.strip()]
    risky = unsafe_hosts(hosts, confirmed)
    refused = False
    if risky:
        print(
            f"{RED}Refusing e2e writes to non-local host(s): {', '.join(risky)}.{RESET}\n"
            "A 100-person group creates 100 households + 100 evacuees, and the script "
            "inserts/deletes external_bookings rows. Use a local stack, or pass "
            "--i-know-this-writes-to <host> naming each host (API, CouchDB and Mongo) if "
            "you really mean it.",
            file=sys.stderr,
        )
        refused = True
    remote = nonlocal_hosts(hosts)
    if remote and not args.mongo_uri:
        # Without Mongo, ownership of CouchDB docs falls back to `created_at` compared with
        # THIS machine's clock, and a POST that timed out cannot be discovered. That is only
        # trustworthy when everything runs on this host, so a confirmation is not enough.
        print(
            f"{RED}Refusing: --mongo-uri is required when any target is non-local "
            f"({', '.join(remote)}).{RESET}\n"
            "The no-Mongo mode proves ownership with a clock comparison between this machine "
            "and the worker, so it is only allowed when the API, CouchDB and Mongo all run "
            "locally. Pass --mongo-uri (the same remote stack; needs pymongo); "
            "--i-know-this-writes-to does not lift this.",
            file=sys.stderr,
        )
        refused = True
    return 2 if refused else None


class PreflightError(RuntimeError):
    """Raised when fresh CIDs cannot be proven absent from the test shelter."""


def stats(values: List[float]) -> str:
    if not values:
        return "n/a"
    return f"min {min(values):.2f}s / avg {sum(values) / len(values):.2f}s / max {max(values):.2f}s"


class CouchAdmin:
    """Tiny CouchDB admin client (stdlib) scoped to ONE shelter database."""

    def __init__(self, base_url: str, user: str, password: str, database: str):
        self.base_url = base_url.rstrip("/")
        self.database = database
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        self._headers = {
            "Authorization": f"Basic {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def request(
        self, method: str, path: str, body: Optional[Any] = None, timeout: float = 60
    ) -> Tuple[int, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            f"{self.base_url}{path}", data=data, headers=self._headers, method=method
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8")
            try:
                return err.code, json.loads(raw)
            except ValueError:
                return err.code, {"raw": raw}
        except Exception as ex:  # connection refused, timeout, ...
            return 0, {"error": redact_text(ex)}

    def info(self) -> Optional[Dict[str, Any]]:
        status, data = self.request("GET", f"/{self.database}")
        return data if status == 200 else None

    def find(
        self, selector: Dict[str, Any], fields: Optional[List[str]] = None, limit: int = 1000
    ) -> List[Dict[str, Any]]:
        body: Dict[str, Any] = {"selector": selector, "limit": limit}
        if fields:
            body["fields"] = fields
        status, data = self.request("POST", f"/{self.database}/_find", body)
        if status != 200:
            raise RuntimeError(f"CouchDB _find failed (HTTP {status})")
        return data.get("docs") or []

    def get_many(self, ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """Fetch docs by id (missing ones are simply absent from the result)."""
        found: Dict[str, Dict[str, Any]] = {}
        for start in range(0, len(ids), 200):
            chunk = ids[start : start + 200]
            status, data = self.request(
                "POST",
                f"/{self.database}/_all_docs?include_docs=true",
                {"keys": chunk},
            )
            if status != 200:
                raise RuntimeError(f"CouchDB _all_docs failed (HTTP {status})")
            for row in data.get("rows", []):
                doc = row.get("doc")
                if doc:
                    found[doc["_id"]] = doc
        return found

    def put(self, doc: Dict[str, Any]) -> bool:
        status, _ = self.request("PUT", f"/{self.database}/{doc['_id']}", doc)
        return status in (200, 201, 202)

    def get_stay(self, doc_id: str) -> str | None:
        """The `current_stay.status` of one doc (None when missing)."""
        status, doc = self.request(
            "GET", f"/{self.database}/{urllib.parse.quote(doc_id, safe=':')}"
        )
        if status != 200 or not isinstance(doc, dict):
            return None
        return (doc.get("current_stay") or {}).get("status")

    def set_stay(self, doc_id: str, stay: dict[str, Any]) -> bool:
        """Replace one evacuee's `current_stay` (read-modify-write of that doc only)."""
        path = f"/{self.database}/{urllib.parse.quote(doc_id, safe=':')}"
        status, doc = self.request("GET", path)
        if status != 200 or not isinstance(doc, dict):
            return False
        doc["current_stay"] = stay
        status, _ = self.request("PUT", path, doc)
        return status in (200, 201, 202)

    def bulk_delete(self, docs: List[Dict[str, Any]]) -> List[str]:
        """Delete docs (needs `_id` + `_rev`); returns the ids that were NOT deleted."""
        failed: List[str] = []
        for start in range(0, len(docs), 200):
            part = docs[start : start + 200]
            chunk = [{"_id": d["_id"], "_rev": d["_rev"], "_deleted": True} for d in part]
            status, rows = self.request("POST", f"/{self.database}/_bulk_docs", {"docs": chunk})
            if status not in (200, 201, 202) or not isinstance(rows, list):
                failed.extend(d["_id"] for d in part)  # whole chunk unknown: fail closed
            else:
                failed.extend(str(r.get("id")) for r in rows if r.get("error"))
        return failed


class MongoProbe:
    """Optional Mongo access (pymongo) for `external_bookings` assertions.

    Every query is scoped to THIS run: the token's `client_id` + the test shelter, and
    (for destructive ones) the run's own tracked booking_ids / CIDs.
    """

    def __init__(self, uri: str):
        import pymongo  # imported lazily: the script is stdlib-only otherwise

        options: Dict[str, Any] = {"serverSelectionTimeoutMS": 3000}
        hosts, _ = mongo_uri_hosts(uri)
        if len(hosts) == 1 and "replicaset" not in uri.lower() and hosts[0][1]:
            options["directConnection"] = True  # never follow a topology to other hosts
        self._client = pymongo.MongoClient(uri, **options)
        self._client.admin.command("ping")
        database = self._client.get_default_database()
        self.bookings = database["external_bookings"]
        self.persons = database["public_persons"]  # the API's projection of stays (FR-32)

    @staticmethod
    def owned_filter(
        client_id: str,
        shelter_code: str,
        since: dt.datetime,
        cids: List[str],
        booking_ids: List[str],
        strict: bool,
    ) -> Dict[str, Any]:
        """Rows this run created. `strict` (provided, shared client credentials) also
        requires a tracked CID / booking_id; an admin-created client is unique to the run."""
        flt: Dict[str, Any] = {
            "client_id": client_id,
            "shelter_code": shelter_code,
            "created_at": {"$gte": since},
            "_id": {"$not": re.compile("^BP-E2E-ORPHAN-")},  # planted orphans: own path
        }
        if strict:
            flt["$or"] = [{"cid": {"$in": cids}}, {"booking_id": {"$in": booking_ids}}]
        return flt

    def staged_rows(self, shelter_code: str, client_id: str) -> int:
        """`committed=False` rows of this run's client (other writers do not count)."""
        return self.bookings.count_documents(
            {"shelter_code": shelter_code, "client_id": client_id, "committed": False}
        )

    def booking_ids_of(self, flt: Dict[str, Any]) -> List[str]:
        return sorted(self.bookings.distinct("booking_id", flt))

    def reserved_ids(self, flt: Dict[str, Any]) -> Tuple[set, set]:
        """(evacuee_ids, household_ids) the worker reserved on these rows. Kept in every
        state (clear_pii only blanks cid/names/phone), so they outlive PII clearing."""
        evacuees: set = set()
        households: set = set()
        for row in self.bookings.find(flt, {"evacuee_id": 1, "household_id": 1}):
            if row.get("evacuee_id"):
                evacuees.add(row["evacuee_id"])
            if row.get("household_id"):
                households.add(row["household_id"])
        return evacuees, households

    @staticmethod
    def _open_filter(flt: Dict[str, Any]) -> Dict[str, Any]:
        """`flt` narrowed to rows the worker still has to act on."""
        return {
            **flt,
            "$and": [
                {
                    "$or": [
                        {"state": "pending"},
                        {"state": "written", "cancel_requested": True},
                    ]
                }
            ],
        }

    def open_rows(self, flt: Dict[str, Any]) -> int:
        """Rows of the run the worker still has to act on."""
        return self.bookings.count_documents(self._open_filter(flt))

    def open_booking_ids(self, flt: Dict[str, Any]) -> List[str]:
        """booking_ids (not PII) of the run's rows the worker still has to act on."""
        return sorted(self.bookings.distinct("booking_id", self._open_filter(flt)))

    def scrub_open_rows(self, flt: Dict[str, Any], booking_ids: List[str], reason: str) -> int:
        """Compare-and-set this run's open rows to `cancelled` and clear their PII, so the
        worker never writes them afterwards. `flt` already carries client_id + shelter and
        is narrowed to the run's tracked booking_ids. Each update is guarded on the state
        it observed (like the API cancel / the worker transitions); reserved
        evacuee_id/household_id are left untouched. Returns the number of rows changed."""
        now = dt.datetime.now(dt.timezone.utc)
        scoped = {**flt, "booking_id": {"$in": booking_ids}}
        pending = self.bookings.update_many(
            {**scoped, "state": "pending"},
            {
                "$set": {
                    "state": "cancelled",
                    "cancel_reason": reason,
                    "cid": None,
                    "first_name": None,
                    "last_name": None,
                    "phone": None,
                    "updated_at": now,
                }
            },
        )
        due = self.bookings.update_many(
            {**scoped, "state": "written", "cancel_requested": True},
            {
                "$set": {
                    "state": "cancelled",
                    "cancel_requested": False,
                    "cid": None,
                    "first_name": None,
                    "last_name": None,
                    "phone": None,
                    "updated_at": now,
                }
            },
        )
        return int(pending.modified_count) + int(due.modified_count)

    def plaintext_rows(self, booking_ids: List[str]) -> int:
        """Rows of these groups that are terminal yet still hold CID/phone/name."""
        return self.bookings.count_documents(
            {
                "booking_id": {"$in": booking_ids},
                "state": {"$in": ["written", "cancelled", "rejected"]},
                "$or": [
                    {"cid": {"$ne": None}},
                    {"phone": {"$ne": None}},
                    {"first_name": {"$ne": None}},
                    {"last_name": {"$ne": None}},
                ],
            }
        )

    def plant_orphan(
        self, shelter_code: str, client_id: str, age_seconds: int, suffix: Optional[str] = None
    ) -> str:
        """Insert an API-crashed-mid-insert lookalike row (`committed=False`, no PII).

        It carries this run's `client_id`, so staged-row checks and cleanup find it.
        """
        suffix = suffix or f"{random.getrandbits(64):016x}"
        created = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=age_seconds)
        self.bookings.insert_one(
            {
                "_id": f"BP-E2E-ORPHAN-{suffix}",
                "booking_id": f"BK-E2E-ORPHAN-{suffix}",
                "person_seq": 0,
                "group_size": 1,
                "committed": False,
                "client_id": client_id,
                "module_name": None,
                "shelter_code": shelter_code,
                "cid": None,
                "cid_hash": f"e2e-orphan-{suffix}",
                "first_name": None,
                "last_name": None,
                "phone": None,
                "state": "pending",
                "cancel_requested": False,
                "created_at": created,
                "updated_at": created,
            }
        )
        return f"BK-E2E-ORPHAN-{suffix}"

    def orphan_exists(self, booking_id: str) -> bool:
        return self.bookings.count_documents({"booking_id": booking_id}) > 0

    def count_rows(self, booking_id: str, extra: dict[str, Any]) -> int:
        return int(self.bookings.count_documents({"booking_id": booking_id, **extra}))

    def person_status(self, evacuee_id: str) -> str | None:
        """The API projection of one stay (`public_persons`); None until the worker syncs it."""
        doc = self.persons.find_one({"_id": evacuee_id}, {"status": 1})
        return doc.get("status") if doc else None

    def reserve_member(
        self,
        booking_id: str,
        client_id: str,
        person_seq: int,
        shelter_code: str,
        evacuee_id: str,
        household_id: str,
    ) -> int:
        """Reserve the worker's ids on one still-pending row that has none (a CAS).

        Returns 0 when the worker reserved the row first; the test then reports a race.
        """
        result = self.bookings.update_one(
            {
                "booking_id": booking_id,
                "person_seq": person_seq,
                "client_id": client_id,
                "shelter_code": shelter_code,
                "state": "pending",
                "evacuee_id": None,
                "household_id": None,
            },
            {
                "$set": {
                    "evacuee_id": evacuee_id,
                    "household_id": household_id,
                    "updated_at": dt.datetime.now(dt.UTC),
                }
            },
        )
        return int(result.modified_count)

    def delete_groups(
        self, booking_ids: List[str], states: List[str], client_id: str, shelter_code: str
    ) -> int:
        result = self.bookings.delete_many(
            {
                "booking_id": {"$in": booking_ids},
                "client_id": client_id,
                "shelter_code": shelter_code,
                "state": {"$in": states},
                "cancel_requested": {"$ne": True},  # the worker still owes a cancel
            }
        )
        return int(result.deleted_count)

    def delete_staged(self, booking_ids: List[str], client_id: str, shelter_code: str) -> int:
        """Leftover `committed=False` rows of this run's own groups (never anything else)."""
        result = self.bookings.delete_many(
            {
                "booking_id": {"$in": booking_ids},
                "client_id": client_id,
                "shelter_code": shelter_code,
                "committed": False,
            }
        )
        return int(result.deleted_count)

    def delete_orphan(self, booking_id: str, client_id: str) -> None:
        self.bookings.delete_many(
            {
                "booking_id": booking_id,
                "client_id": client_id,
                "_id": {"$regex": "^BP-E2E-ORPHAN-"},
            }
        )


class E2ERunner(SmokeTestRunner):
    """EXT-008..010 end to end: partner API -> Mongo -> worker -> CouchDB (issue #597)."""

    def __init__(
        self,
        *args: Any,
        e2e_shelter: str,
        couch: CouchAdmin,
        mongo: Optional[MongoProbe],
        group_timeout: float = 30,
        big_size: int = 100,
        big_timeout: float = 300,
        big_budget: Optional[float] = None,
        race_rounds: int = 3,
        settle: float = 2 * WORKER_POLL_SECONDS + 2,
        cleanup_timeout: float = 180,
        skip_big: bool = False,
        recovery: bool = False,
        **kwargs: Any,
    ):
        super().__init__(*args, **kwargs)
        self.recovery = recovery  # --e2e-cleanup-from: no token, no new data
        self.e2e_shelter = e2e_shelter
        self.couch = couch
        self.mongo = mongo
        self.group_timeout = group_timeout
        self.big_size = big_size
        self.big_timeout = big_timeout
        self.big_budget = big_budget
        self.race_rounds = race_rounds
        self.settle = settle
        self.cleanup_timeout = cleanup_timeout
        self.skip_big = skip_big

        # Everything this run created, so cleanup only ever touches its own data.
        self.e2e_cids: set = set()
        self.e2e_booking_ids: List[str] = []
        self.e2e_planted_ids: List[str] = []
        self.e2e_orphan_ids: List[str] = []
        #: Couch ids of this run's docs, read from its Mongo rows (--mongo-uri only).
        self.run_evacuee_ids: set = set()
        self.run_household_ids: set = set()
        self.run_started = dt.datetime.now(dt.timezone.utc)
        self.run_id = f"{self.run_started:%Y%m%dT%H%M%SZ}-{random.getrandbits(32):08x}"
        #: Recovery manifest (see RunManifest) + what the printed recovery command needs.
        self.manifest: Optional[RunManifest] = None
        self.targets: Dict[str, Any] = {}
        self.cli_context: Dict[str, Any] = {}
        self._manifest_lock = threading.RLock()
        #: Signal handling: "run" until the first signal / the start of cleanup.
        self._phase = "run"
        self._cleanup_signals = 0
        self._aborted = False
        self._last_signal_at: Dict[int, float] = {}
        self._in_cleanup = False
        self.cleanup_done = False  # e2e_cleanup ran to its end
        self.cleanup_failed = False  # a cleanup check failed or a cleanup step raised
        self.revocation_ok = True
        #: Cumulative PROVEN ownership across the whole cleanup: doc id -> kind. Only ever
        #: grows, so a doc proven once is still deleted / verified later even when the doc
        #: that led to it (evacuee -> household -> audit) is already gone.
        self.proven: Dict[str, str] = {}
        self.deleted_ids: set = set()
        self.failed_ids: set = set()  # delete failures not (yet) resolved by a later round
        #: Cleanup cancel bookkeeping: booking_id -> outcome.
        self.cancel_ok: set = set()  # 200
        self.cancel_settled: Dict[str, str] = {}  # 409/404 -> "409:booking_not_cancellable"
        self.cancel_failed: Dict[str, str] = {}  # retries exhausted -> "HTTP 503"
        self.cancel_rounds: Dict[str, int] = {}
        self.timing_lines: List[str] = []
        self.baseline_doc_count: Optional[int] = None
        #: True once the worker was seen writing a group (sweeper verdict wording).
        self.worker_proven = False

    # ------------------------------------------------------------------ helpers
    def _auth(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}

    def _bookings_path(self) -> str:
        return self.partner_path("/external/bookings")

    def e2e_result(self, name: str, passed: bool, detail: str = "") -> None:
        if self._in_cleanup and not passed:
            self.cleanup_failed = True
        self.record_result("E2E", name, passed, detail)

    # ------------------------------------------------------------------ manifest
    def _manifest_data(self) -> Dict[str, Any]:
        """Snapshot for the manifest. Synthetic CIDs and ids only: no secret of any kind."""
        return {
            "schema": MANIFEST_SCHEMA,
            "run_id": self.run_id,
            "run_started": self.run_started.isoformat().replace("+00:00", "Z"),
            "shelter": self.e2e_shelter,
            "couch_database": self.couch.database,
            "targets": self.targets,
            "client": {
                "mode": "provided" if self.use_provided_credentials else "admin",
                "client_id": self.created_client_id,
                "row_id": self.created_client_row_id,
            },
            "cids": sorted(self.e2e_cids),
            "booking_ids": list(self.e2e_booking_ids),
            "reserved": {
                "evacuees": sorted(self.run_evacuee_ids),
                "households": sorted(self.run_household_ids),
            },
            "proven": dict(sorted(self.proven.items())),
            "planted_ids": list(self.e2e_planted_ids),
            "orphan_ids": list(self.e2e_orphan_ids),
        }

    def _save_manifest(self, strict: bool = False) -> None:
        """Atomically rewrite the manifest. `strict` (before something is sent) raises, so
        nothing is created that the manifest could not recover; otherwise a failure is
        only reported (cleanup must go on)."""
        if self.manifest is None:
            return
        with self._manifest_lock:
            try:
                self.manifest.write(self._manifest_data())
            except OSError as exc:
                if strict:
                    raise
                self.log(f"  {YELLOW}could not update the manifest: {type(exc).__name__}{RESET}")

    def attach_manifest(self, path: Optional[str], targets: Dict[str, Any]) -> str:
        """Create the manifest (mode 0600, O_EXCL) before anything can be created."""
        self.targets = targets
        self.manifest = RunManifest(path or RunManifest.default_path(self.run_id))
        self.manifest.create(self._manifest_data())
        return self.manifest.path

    def _on_client_created(self) -> None:
        self._save_manifest()  # the client id + row id are what recovery needs to revoke

    def load_manifest(self, manifest: RunManifest, data: Dict[str, Any]) -> None:
        """Adopt the identity of the run that wrote `data` (recovery mode)."""
        self.manifest = manifest
        self.targets = data["targets"]
        self.run_id = data["run_id"]
        self.run_started = dt.datetime.fromisoformat(data["run_started"].replace("Z", "+00:00"))
        client = data["client"]
        self.use_provided_credentials = client["mode"] == "provided"
        self.created_client_id = client.get("client_id") or None
        self.created_client_row_id = client.get("row_id") or None
        self.e2e_cids = set(data["cids"])
        self.e2e_booking_ids = list(data["booking_ids"])
        self.e2e_planted_ids = list(data["planted_ids"])
        self.e2e_orphan_ids = list(data["orphan_ids"])
        # Candidates + (Mongo mode) proof: attribute checks in _owned_by_this_run still
        # apply, and without Mongo the stricter CID/created_at rule is unchanged.
        proven = data["proven"]
        self.run_evacuee_ids = set(data["reserved"]["evacuees"]) | {
            i for i, kind in proven.items() if kind == "evacuee"
        }
        self.run_household_ids = set(data["reserved"]["households"]) | {
            i for i, kind in proven.items() if kind == "household"
        }

    def not_run(self, name: str, reason: str) -> None:
        """A case whose set-up failed or whose precondition was not reached: FAIL."""
        self.e2e_result(name, False, f"not exercised: {reason}")

    # -- Mongo scoping: only rows of THIS run's client_id (+ tracked ids when shared) --
    def mongo_on(self) -> bool:
        return self.mongo is not None and bool(self.created_client_id)

    def staged_count(self) -> int:
        assert self.mongo is not None and self.created_client_id
        return self.mongo.staged_rows(self.e2e_shelter, self.created_client_id)

    def owned_rows_filter(self) -> Dict[str, Any]:
        assert self.created_client_id
        return MongoProbe.owned_filter(
            self.created_client_id,
            self.e2e_shelter,
            self.run_started - dt.timedelta(minutes=5),
            sorted(self.e2e_cids),
            list(self.e2e_booking_ids),
            strict=self.use_provided_credentials,
        )

    def _cids_with_docs(self, cids: List[str]) -> set:
        """The subset of `cids` that already has an evacuee doc in the test shelter."""
        taken: set = set()
        listed = sorted(cids)
        for start in range(0, len(listed), 100):
            for doc in self.couch.find(
                {"type": "evacuee", "person_id.number": {"$in": listed[start : start + 100]}},
                fields=["_id", "person_id.number"],
            ):
                taken.add((doc.get("person_id") or {}).get("number"))
        return taken

    def make_group(self, size: int) -> List[str]:
        """`size` random CIDs proven absent from the shelter's CouchDB (pre-flight).

        A random CID could collide with a real person; cleanup must never touch that
        doc, so a colliding CID is regenerated (bounded) and never sent or registered.
        A CouchDB error propagates (fail closed). CIDs are never logged.
        """
        cids = [make_valid_cid() for _ in range(size)]
        for attempt in range(PREFLIGHT_ATTEMPTS + 1):
            taken = self._cids_with_docs(cids)
            if not taken:
                return cids
            if attempt == PREFLIGHT_ATTEMPTS:
                raise PreflightError(
                    f"{len(taken)} generated CID(s) still collide with existing docs in "
                    f"{self.e2e_shelter} after {PREFLIGHT_ATTEMPTS} regenerations; nothing was sent"
                )
            self.log(
                f"  pre-flight: {len(taken)} generated CID(s) already have a doc in "
                f"{self.e2e_shelter}; regenerating (round {attempt + 1}/{PREFLIGHT_ATTEMPTS})"
            )
            cids = [make_valid_cid() if cid in taken else cid for cid in cids]
        raise AssertionError("unreachable")

    def create_group(
        self, cids: List[str], timeout: float = 60
    ) -> Tuple[int, Dict[str, Any], float]:
        """POST a group (all-or-nothing). Returns (HTTP status, body, monotonic time)."""
        with self._manifest_lock:
            self.e2e_cids.update(cids)  # tracked even on failure: staged rows may leak
            self._save_manifest(strict=True)  # on disk BEFORE the request can create data
        body = {
            "location_code": self.e2e_shelter,
            "persons": [
                {
                    "cid": cid,
                    "first_name": "E2E",
                    "last_name": f"Smoke{index}",
                    "phone": "0812345678",
                }
                for index, cid in enumerate(cids)
            ],
        }
        status, data = self.http_request(
            "POST",
            self._bookings_path(),
            headers=self._auth(),
            body=body,
            timeout=timeout,
            log_body=False,
        )
        stamp = time.monotonic()
        res = data.get("result", {}) if isinstance(data, dict) else {}
        if status == 201 and res.get("booking_id"):
            with self._manifest_lock:
                self.e2e_booking_ids.append(res["booking_id"])
                self._save_manifest()
        return status, data, stamp

    def cancel_group(self, booking_id: str) -> Tuple[int, Dict[str, Any], float]:
        status, data = self.http_request(
            "POST",
            f"{self._bookings_path()}/{booking_id}/cancel",
            headers=self._auth(),
            body={"reason": "e2e smoke test cleanup"},
            timeout=60,
        )
        return status, data, time.monotonic()

    def booking_status(self, booking_id: str) -> Tuple[int, Dict[str, Any]]:
        status, data = self.http_request(
            "GET", f"{self._bookings_path()}/{booking_id}", headers=self._auth()
        )
        return status, (data.get("result", {}) if isinstance(data, dict) else {})

    def evacuees(self, cids: List[str]) -> Dict[str, List[Dict[str, Any]]]:
        """Evacuee docs of `cids` in the test shelter, grouped by CID."""
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        listed = sorted(cids)
        for start in range(0, len(listed), 100):
            docs = self.couch.find(
                {
                    "type": "evacuee",
                    "person_id.number": {"$in": listed[start : start + 100]},
                },
                fields=EVACUEE_FIELDS,
            )
            for doc in docs:
                number = (doc.get("person_id") or {}).get("number")
                grouped.setdefault(number, []).append(doc)
        return grouped

    @staticmethod
    def stay(doc: Dict[str, Any]) -> Optional[str]:
        return (doc.get("current_stay") or {}).get("status")

    def watch_group(
        self,
        cids: List[str],
        started: float,
        timeout: float,
        evacuee_ready: Callable[[Dict[str, Any]], bool],
        household_ready: Callable[[Dict[str, Any]], bool],
    ) -> Dict[str, Any]:
        """Poll CouchDB until every person's evacuee + household is `ready`.

        `started` is a `time.monotonic()` stamp; the returned times are seconds since
        then at which each evacuee / household was first seen ready. A time is stamped
        AFTER the CouchDB query that showed the doc returned, so it never understates
        latency; resolution is bounded by the poll interval + query time (`max_query`).
        """
        evac_seen: Dict[str, float] = {}
        house_seen: Dict[str, float] = {}
        evac_docs: Dict[str, Dict[str, Any]] = {}
        house_docs: Dict[str, Dict[str, Any]] = {}
        deadline = started + timeout
        max_query = 0.0
        while True:
            query_start = time.monotonic()
            found = self.evacuees(cids)
            seen_at = time.monotonic()  # stamp after the observation
            max_query = max(max_query, seen_at - query_start)
            for cid, docs in found.items():
                doc = docs[0]
                evac_docs[cid] = doc
                if cid not in evac_seen and evacuee_ready(doc):
                    evac_seen[cid] = seen_at - started
            house_ids = sorted(
                {d["household_id"] for d in evac_docs.values() if d.get("household_id")}
            )
            query_start = time.monotonic()
            house_docs = self.couch.get_many(house_ids) if house_ids else {}
            seen_at = time.monotonic()
            max_query = max(max_query, seen_at - query_start)
            for house_id, doc in house_docs.items():
                if house_id not in house_seen and household_ready(doc):
                    house_seen[house_id] = seen_at - started
            done = len(evac_seen) == len(cids) and len(house_seen) == len(cids)
            if done or time.monotonic() >= deadline:
                return {
                    "complete": done,
                    "evac_seen": evac_seen,
                    "house_seen": house_seen,
                    "evac_docs": evac_docs,
                    "house_docs": house_docs,
                    "elapsed": time.monotonic() - started,
                    "max_query": max_query,
                }
            time.sleep(WATCH_POLL_SECONDS)

    def verify_written(self, count: int, watch: Dict[str, Any]) -> Tuple[bool, str]:
        """FR-10/51: one household per evacuee, pre_registered, registered_via api."""
        evac = list(watch["evac_docs"].values())
        households = watch["house_docs"]
        problems: List[str] = []
        if len(evac) != count or len(households) != count:
            problems.append(f"evacuees={len(evac)} households={len(households)}")
        if any(self.stay(d) != "pre_registered" for d in evac):
            problems.append("stay not pre_registered")
        if any(d.get("registered_via") != "api" for d in evac):
            problems.append("registered_via != api")
        if any(d.get("gender") is not None for d in evac):
            problems.append("gender not null")
        if len({d.get("household_id") for d in evac}) != count:
            problems.append("households shared between persons")
        for doc in evac:
            house = households.get(doc.get("household_id"))
            if not house or house.get("head_evacuee_id") != doc["_id"]:
                problems.append("household head mismatch")
                break
            if house.get("type") != "household" or house.get("status") != "pre_registered":
                problems.append("household not pre_registered")
                break
        return not problems, "; ".join(problems)

    def check_booking_ref(self, booking_id: str, watch: Dict[str, Any], name: str) -> None:
        docs = list(watch["evac_docs"].values())
        refs_ok = bool(docs) and all(d.get("booking_ref") == booking_id for d in docs)
        schema_ok = bool(docs) and all(d.get("schema_v") == 14 for d in docs)
        self.e2e_result(
            name,
            refs_ok and schema_ok,
            f"booking_ref matches={refs_ok}, schema_v==14={schema_ok} "
            f"(schema_v seen={sorted({d.get('schema_v') for d in docs}, key=str)})",
        )

    # --------------------------------------------------------------- scenarios
    def scenario_group_of_three(self) -> None:
        self._banner("E2E 1: group of 3 -> 201 -> CouchDB households + evacuees")
        cids = self.make_group(3)
        self.s1_cids = cids
        status, data, t201 = self.create_group(cids)
        res = data.get("result", {}) if isinstance(data, dict) else {}
        ok = status == 201 and res.get("persons_count") == 3
        self.e2e_result(
            "POST group of 3 -> 201 persons_count 3",
            ok,
            f"booking_id={res.get('booking_id')}" if ok else f"HTTP {status} - {data}",
        )
        if not ok:
            self.not_run(S1_REF_CASE, "group of 3 was not created")
            return
        self.s1_booking = res["booking_id"]
        watch = self.watch_group(
            cids,
            t201,
            self.group_timeout,
            lambda d: self.stay(d) == "pre_registered",
            lambda d: d.get("type") == "household",
        )
        self.s1_watch = watch
        self.worker_proven = self.worker_proven or watch["complete"]
        self.e2e_result(
            f"CouchDB has 3 households + 3 evacuees within {self.group_timeout:.0f}s",
            watch["complete"],
            f"{watch['elapsed']:.1f}s after 201",
        )
        if watch["complete"]:
            good, why = self.verify_written(3, watch)
            self.e2e_result(
                "evacuees pre_registered / registered_via api / 1 household each",
                good,
                why,
            )
        _, st = self.booking_status(self.s1_booking)
        self.e2e_result(
            "EXT-010 persons[] lists 3 BOOKED people (no PII)",
            st.get("booking_status") == "BOOKED"
            and [p.get("index") for p in st.get("persons", [])] == [0, 1, 2]
            and set(st.get("persons", [{}])[0].keys())
            <= {"index", "booking_status", "reject_reason"},
        )
        if watch["complete"]:
            self.check_booking_ref(self.s1_booking, watch, S1_REF_CASE)
        else:
            self.not_run(S1_REF_CASE, "group of 3 was never written by the worker")
        if self.mongo:
            left = self.mongo.plaintext_rows([self.s1_booking])
            self.e2e_result(
                "no CID/phone/name plaintext left in written rows", left == 0, f"rows={left}"
            )

    def scenario_duplicate_group(self) -> None:
        self._banner("E2E 2: group with a duplicate person -> 409, nothing in CouchDB")
        if not getattr(self, "s1_booking", None):
            self.record_skip("E2E", "duplicate group", "scenario 1 did not create a booking")
            return
        fresh = self.make_group(2)
        cids = [fresh[0], self.s1_cids[1], fresh[1]]
        status, data, _ = self.create_group(cids)
        self.e2e_cids.update(cids)
        err = get_error_code(data)
        detail = get_error_detail(data)
        self.e2e_result(
            "group with an already-booked person -> 409 duplicate_booking",
            status == 409 and err == "duplicate_booking",
            f"HTTP {status} (code={err})",
        )
        self.e2e_result(
            "409 detail names persons[1] (index only)",
            detail == "persons[1]",
            f"detail={detail!r}" if detail != "persons[1]" else "",
        )
        time.sleep(self.settle)
        found = self.evacuees(fresh)
        self.e2e_result(
            f"no docs in CouchDB for the rest of the group after {self.settle:.0f}s",
            not found,
            f"found docs for {len(found)} person(s)" if found else "",
        )
        if self.mongo_on():
            staged = self.staged_count()
            self.e2e_result("no committed=false rows left in Mongo", staged == 0, f"rows={staged}")
        # API-level proof the rolled-back group left nothing holding the unique index.
        status, data, _ = self.create_group(fresh)
        self.e2e_result(
            "the rest of the group can be booked afterwards (no staged row left)",
            status == 201,
            f"HTTP {status} (code={get_error_code(data)})" if status != 201 else "",
        )

    def scenario_cancel_after_written(self) -> None:
        self._banner("E2E 3: cancel the written group -> all cancelled in CouchDB")
        booking_id = getattr(self, "s1_booking", None)
        watch = getattr(self, "s1_watch", None)
        if not booking_id or not watch or not watch["complete"]:
            self.record_skip(
                "E2E", "cancel after written", "scenario 1 group was not fully written"
            )
            return
        status, data, tcancel = self.cancel_group(booking_id)
        res = data.get("result", {}) if isinstance(data, dict) else {}
        self.e2e_result(
            "EXT-009 cancel group -> 200 CANCELLED",
            status == 200 and res.get("booking_status") == "CANCELLED",
            f"HTTP {status} - {data}" if status != 200 else "",
        )
        if status != 200:
            return
        done = self.watch_group(
            self.s1_cids,
            tcancel,
            self.group_timeout,
            lambda d: self.stay(d) == "cancelled",
            lambda d: d.get("status") == "cancelled",
        )
        self.e2e_result(
            f"all 3 evacuees and their households end cancelled within {self.group_timeout:.0f}s",
            done["complete"],
            f"{done['elapsed']:.1f}s after cancel",
        )
        if self.mongo:
            left = self.mongo.plaintext_rows([booking_id])
            self.e2e_result(
                "no plaintext PII left in the cancelled group's rows", left == 0, f"rows={left}"
            )

    def scenario_race(self) -> None:
        self._banner(
            f"E2E 4: two concurrent groups with an overlapping CID ({self.race_rounds} rounds)"
        )
        for round_no in range(1, self.race_rounds + 1):
            shared = self.make_group(1)[0]
            a_only = self.make_group(2)
            b_only = self.make_group(2)
            groups = {"A": [shared] + a_only, "B": [shared] + b_only}
            barrier = threading.Barrier(2)
            outcome: Dict[str, Tuple[int, Dict[str, Any]]] = {}

            def fire(name: str) -> None:
                barrier.wait()
                status, data, _ = self.create_group(groups[name])
                outcome[name] = (status, data)

            threads = [threading.Thread(target=fire, args=(n,)) for n in groups]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()

            statuses = sorted(s for s, _ in outcome.values())
            self.e2e_result(
                f"round {round_no}: one 201 and one 409",
                statuses == [201, 409],
                f"statuses={statuses}" if statuses != [201, 409] else "",
            )
            loser = next((n for n, (s, _) in outcome.items() if s == 409), None)
            if loser is None:
                continue
            loser_status, loser_data = outcome[loser]
            self.e2e_result(
                f"round {round_no}: loser is duplicate_booking persons[0]",
                get_error_code(loser_data) == "duplicate_booking"
                and get_error_detail(loser_data) == "persons[0]",
                f"code={get_error_code(loser_data)} detail={get_error_detail(loser_data)!r}",
            )
            if self.mongo_on():
                staged = self.staged_count()
                self.e2e_result(
                    f"round {round_no}: no committed=false rows left in Mongo",
                    staged == 0,
                    f"rows={staged}",
                )
            # API-only evidence: the loser's other people must be bookable (a leaked staged
            # row would still hold the unique (shelter, cid_hash) index and give 409).
            rebook, data, _ = self.create_group(groups[loser][1:])
            self.e2e_result(
                f"round {round_no}: loser's other people bookable afterwards",
                rebook == 201,
                f"HTTP {rebook} (code={get_error_code(data)})" if rebook != 201 else "",
            )
        if not self.mongo:
            self.log(
                f"  {YELLOW}Note: no --mongo-uri, so 'no committed=false rows' was "
                f"asserted through API behaviour only (loser re-book) .{RESET}"
            )

    def scenario_big_group(self) -> None:
        size = self.big_size
        self._banner(f"E2E 5: {size}-person group -> timing (gate for the cap, CR-169 FR-6)")
        if self.skip_big:
            self.record_skip("E2E", f"{size}-person group timing", "--skip-e2e-big")
            return
        cids = self.make_group(size)
        t_start = time.monotonic()
        status, data, t201 = self.create_group(cids, timeout=120)
        res = data.get("result", {}) if isinstance(data, dict) else {}
        ok = status == 201 and res.get("persons_count") == size
        self.e2e_result(
            f"POST group of {size} -> 201 persons_count {size}",
            ok,
            f"booking_id={res.get('booking_id')}, POST took {t201 - t_start:.2f}s"
            if ok
            else f"HTTP {status} - {str(data)[:200]}",
        )
        if not ok:
            self.not_run(
                f"{size}-person evacuee.booking_ref + schema_v 14", "group was not created"
            )
            return
        booking_id = res["booking_id"]
        written = self.watch_group(
            cids,
            t201,
            self.big_timeout,
            lambda d: self.stay(d) == "pre_registered",
            lambda d: d.get("type") == "household",
        )
        evac_times = sorted(written["evac_seen"].values())
        house_times = sorted(written["house_seen"].values())
        total_written = written["elapsed"]
        within_budget = self.big_budget is None or (
            written["complete"] and total_written <= self.big_budget
        )
        budget_note = "" if self.big_budget is None else f", budget {self.big_budget:.0f}s"
        self.e2e_result(
            f"all {size} households + {size} evacuees in CouchDB within {self.big_timeout:.0f}s{budget_note}",
            written["complete"] and within_budget,
            f"{total_written:.1f}s after 201 "
            f"(evacuees {len(evac_times)}/{size}, households {len(house_times)}/{size})",
        )
        self.worker_proven = self.worker_proven or written["complete"]
        if written["complete"]:
            good, why = self.verify_written(size, written)
            self.e2e_result(
                f"{size} evacuees pre_registered / registered_via api / 1 household each",
                good,
                why,
            )
            self.check_booking_ref(
                booking_id, written, f"{size}-person evacuee.booking_ref + schema_v 14"
            )
        else:
            self.not_run(
                f"{size}-person evacuee.booking_ref + schema_v 14",
                "group was not fully written by the worker",
            )

        # Cancel timing (EXT-009 fan-out through the worker).
        t_cancel_req = time.monotonic()
        cstatus, cdata, t_cancelled = self.cancel_group(booking_id)
        cancelled: Dict[str, Any] = {
            "complete": False,
            "evac_seen": {},
            "house_seen": {},
            "elapsed": 0.0,
        }
        if cstatus == 200:
            cancelled = self.watch_group(
                cids,
                t_cancelled,
                self.big_timeout,
                lambda d: self.stay(d) == "cancelled",
                lambda d: d.get("status") == "cancelled",
            )
        self.e2e_result(
            f"cancel the {size}-person group -> all evacuees + households cancelled",
            cstatus == 200 and cancelled["complete"],
            f"HTTP {cstatus}; {cancelled['elapsed']:.1f}s after cancel"
            if cstatus == 200
            else f"HTTP {cstatus} - {cdata}",
        )

        c_evac = sorted(cancelled["evac_seen"].values())
        c_house = sorted(cancelled["house_seen"].values())
        rate = (size / total_written) if written["complete"] and total_written else 0.0
        self.timing_lines = [
            f"{size}-person group timing report (booking_id={booking_id})",
            f"  POST /external/bookings (request -> 201) : {t201 - t_start:.2f}s",
            f"  201 -> first evacuee visible in CouchDB   : "
            f"{(evac_times[0] if evac_times else float('nan')):.2f}s",
            f"  201 -> evacuees visible  ({len(evac_times)}/{size})    : {stats(evac_times)}",
            f"  201 -> households visible ({len(house_times)}/{size})   : {stats(house_times)}",
            f"  201 -> ALL {size} households + evacuees visible : "
            f"{total_written:.2f}s{'' if written['complete'] else ' (TIMEOUT)'}"
            f"  (~{rate:.1f} persons/s)",
            f"  cancel API call latency                    : {t_cancelled - t_cancel_req:.2f}s",
            f"  cancel -> evacuees cancelled ({len(c_evac)}/{size})   : {stats(c_evac)}",
            f"  cancel -> households cancelled ({len(c_house)}/{size}) : {stats(c_house)}",
            f"  cancel -> ALL cancelled                    : "
            f"{cancelled['elapsed']:.2f}s{'' if cancelled['complete'] else ' (TIMEOUT/skipped)'}",
            f"  total (request -> everything cancelled)    : {time.monotonic() - t_start:.2f}s",
            f"  (times are stamped after each CouchDB query returns; resolution is bounded by "
            f"the {WATCH_POLL_SECONDS:.2f}s poll interval + query time, max query "
            f"{max(written.get('max_query', 0.0), cancelled.get('max_query', 0.0)):.2f}s)",
        ]

    def _wait_for(self, check: Callable[[], bool], timeout: float) -> bool:
        """Poll `check` every WATCH_POLL_SECONDS until it is true or `timeout` passes."""
        deadline = time.monotonic() + timeout
        while True:
            if check():
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(WATCH_POLL_SECONDS)

    @staticmethod
    def _person_map(status: dict[str, Any]) -> dict[Any, Any]:
        return {p.get("index"): p.get("booking_status") for p in status.get("persons") or []}

    def scenario_couch_side_duplicate(self) -> None:
        """FR-21, first pass: a CouchDB-side duplicate seen before the worker wrote anything
        rejects the WHOLE group and writes no doc. The per-person retry rule (D1/D4: part of
        the group already in CouchDB) is covered by scenario 8."""
        self._banner("E2E 6: CouchDB-side duplicate rejects the whole group (FR-21, first pass)")
        case = "CouchDB-side duplicate rejects the whole group with no docs written"
        cids = self.make_group(3)
        planted_id = f"evacuee:E2E-PLANT-{random.getrandbits(48):012x}"
        with self._manifest_lock:
            self.e2e_planted_ids.append(planted_id)
            self._save_manifest(strict=True)  # recorded before the PUT that creates it
        status, data, _ = self.create_group(cids)  # registers cids before sending
        res = data.get("result", {}) if isinstance(data, dict) else {}
        if status != 201 or not res.get("booking_id"):
            self.e2e_result(
                "set-up: group accepted before planting the duplicate", False, f"HTTP {status}"
            )
            self.not_run(case, "set-up failed")
            return
        booking_id = res["booking_id"]
        # Decide "race lost" BEFORE planting: if the worker already wrote any doc of the
        # group the duplicate can no longer be seen by it, so the case is not testable.
        if self.evacuees(cids):
            self.not_run(
                case, "race lost: worker wrote the group before the duplicate was planted; rerun"
            )
            return
        # The duplicate exists only in CouchDB, planted right after the API accepted the
        # group, so the API-side projection check cannot see it (only the worker can).
        now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
        planted = self.couch.put(
            {
                "_id": planted_id,
                "type": "evacuee",
                "schema_v": 12,
                "shelter_code": self.e2e_shelter,
                "created_at": now,
                "updated_at": now,
                "created_by": "e2e-smoke",
                "first_name": "E2E",
                "last_name": "Plant",
                "gender": None,
                "phone": None,
                "person_id": {"cardType": "national_id", "number": cids[1]},
                "country": "THAILAND",
                "vulnerable_groups": [],
                "special_needs": [],
                "household_id": None,
                "current_stay": {"status": "pre_registered", "zone": None, "since": now},
                "privacy": {"search_excluded": False},
            }
        )
        if not planted:
            self.e2e_result("set-up: CouchDB duplicate planted", False, "PUT failed")
            self.not_run(case, "set-up failed")
            return

        def written_docs() -> int:
            """Docs the worker wrote for the group (the planted doc itself excluded)."""
            others = sum(len(v) for v in self.evacuees([cids[0], cids[2]]).values())
            own = [d for d in self.evacuees([cids[1]]).get(cids[1], []) if d["_id"] != planted_id]
            return others + len(own)

        deadline = time.monotonic() + self.group_timeout
        last: Dict[str, Any] = {}
        while time.monotonic() < deadline:
            _, last = self.booking_status(booking_id)
            rejected = any(p.get("booking_status") == "REJECTED" for p in last.get("persons", []))
            if rejected or written_docs():
                break
            time.sleep(0.5)
        # Let the worker finish the rest of the group before judging.
        time.sleep(WORKER_POLL_SECONDS + 1)
        _, last = self.booking_status(booking_id)
        persons = last.get("persons", [])
        leaked = written_docs()
        all_rejected = len(persons) == 3 and all(
            p.get("booking_status") == "REJECTED" and p.get("reject_reason") == "duplicate"
            for p in persons
        )
        processed = leaked > 0 or any(p.get("booking_status") == "REJECTED" for p in persons)
        detail = (
            f"statuses={[p.get('booking_status') for p in persons]}, "
            f"docs written for the group={leaked}"
        )
        if not processed:
            detail += " (worker did not process the group in time)"
        self.e2e_result(case, all_rejected and leaked == 0, detail)
        if self.mongo:
            left = self.mongo.plaintext_rows([booking_id])
            self.e2e_result(
                "no plaintext PII left in any row of the group after the worker ran",
                left == 0,
                f"rows with plaintext={left}",
            )

    def scenario_partial_group(self) -> None:
        """CR-169 FR-21 retry rule (D1/D4) + EXT-009/010 (FR-40/42, #592).

        Part of the group is already in CouchDB (member 1's own pre-registration, written
        before the worker reserved its ids) and member 1's CID is also held by a foreign live
        evacuee. The worker rejects member 1 only (its stay is cancelled) and writes the
        others. Then group cancel and repeat cancel.
        """
        self._banner("E2E 8: partial group (D1/D4): one duplicate member, cancel -> CANCELLED")
        case = "EXT-009/010 partial group (duplicate member rejected, others written)"
        if not self.mongo_on():
            self.record_skip("E2E", case, "needs --mongo-uri (pymongo)")
            return
        assert self.mongo is not None and self.created_client_id
        cids = self.make_group(3)
        token = f"{random.getrandbits(48):012x}"
        member_ev = f"evacuee:E2E-PART-{token}"
        member_hh = f"household:E2E-PART-{token}"
        foreign_id = f"evacuee:E2E-PLANT-{token}"
        now = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
        # Every id goes into the manifest BEFORE the doc that uses it is written.
        with self._manifest_lock:
            self.e2e_planted_ids.extend([member_ev, member_hh, foreign_id])
            self._save_manifest(strict=True)
        shelter = self.e2e_shelter
        own_stay = {
            "_id": member_ev,
            "type": "evacuee",
            "schema_v": 14,
            "shelter_code": shelter,
            "created_at": now,
            "updated_at": now,
            "created_by": "e2e-smoke",
            "first_name": "E2E",
            "last_name": "Partial",
            "gender": None,
            "phone": None,
            "person_id": {"cardType": "national_id", "number": cids[1]},
            "country": "THAILAND",
            "vulnerable_groups": [],
            "special_needs": [],
            "household_id": member_hh,
            "registered_via": "api",
            "current_stay": {"status": "pre_registered", "zone": None, "since": now},
            "privacy": {"search_excluded": False},
        }
        own_house = {
            "_id": member_hh,
            "type": "household",
            "schema_v": 1,
            "shelter_code": shelter,
            "created_at": now,
            "updated_at": now,
            "created_by": "e2e-smoke",
            "label": "E2E partial",
            "head_evacuee_id": member_ev,
            "status": "pre_registered",
            "pets": [],
            "vehicles": [],
        }
        foreign = {
            "_id": foreign_id,
            "type": "evacuee",
            "schema_v": 12,
            "shelter_code": shelter,
            "created_at": now,
            "updated_at": now,
            "created_by": "e2e-smoke",
            "first_name": "E2E",
            "last_name": "Foreign",
            "gender": None,
            "phone": None,
            "person_id": {"cardType": "national_id", "number": cids[1]},
            "country": "THAILAND",
            "vulnerable_groups": [],
            "special_needs": [],
            "household_id": None,
            "current_stay": {"status": "pre_registered", "zone": None, "since": now},
            "privacy": {"search_excluded": False},
        }
        # The API refuses a CID its projection already shows as held, so the group is sent
        # first and the docs follow (the same order as scenario 6). The reservation CAS below
        # then decides whether the worker can still take the retry path.
        status, data, t201 = self.create_group(cids)  # registers cids before sending
        res = data.get("result", {}) if isinstance(data, dict) else {}
        booking_id = str(res.get("booking_id", ""))
        if status != 201 or not booking_id.startswith("BK-"):
            self.e2e_result("set-up: group of 3 accepted", False, f"HTTP {status} - {data}")
            self.not_run(case, "set-up failed")
            return
        if not (self.couch.put(own_stay) and self.couch.put(own_house) and self.couch.put(foreign)):
            self.e2e_result(
                "set-up: CouchDB docs of the partial group written", False, "PUT failed"
            )
            self.not_run(case, "set-up failed")
            return
        # CAS on the still-unreserved row: 0 means the worker got there first (race lost).
        reserved = self.mongo.reserve_member(
            booking_id, self.created_client_id, 1, shelter, member_ev, member_hh
        )
        self.e2e_result(
            "set-up: member 1 reserved the partial group's ids before the worker's pass",
            reserved == 1,
            f"rows={reserved} (0 = worker reserved first: race lost, rerun)",
        )
        if reserved != 1:
            return
        watch = self.watch_group(
            [cids[0], cids[2]],
            t201,
            self.group_timeout,
            lambda d: self.stay(d) == "pre_registered",
            lambda d: d.get("type") == "household",
        )
        self.e2e_result(
            f"members 0 and 2 written by the worker within {self.group_timeout:.0f}s",
            watch["complete"],
        )
        if not watch["complete"]:
            return

        expected_rows = {0: "BOOKED", 1: "REJECTED", 2: "BOOKED"}
        last: dict[str, Any] = {}

        def rejected_and_booked() -> bool:
            nonlocal last
            _, last = self.booking_status(booking_id)
            return (
                last.get("booking_status") == "REJECTED"
                and self._person_map(last) == expected_rows
            )

        ok = self._wait_for(rejected_and_booked, self.group_timeout)
        reason = {p.get("index"): p.get("reject_reason") for p in last.get("persons") or []}
        self.e2e_result(
            "EXT-010 aggregate REJECTED; persons 0 and 2 BOOKED, person 1 REJECTED (duplicate)",
            ok and reason.get(1) == "duplicate",
            f"booking_status={last.get('booking_status')}, persons={self._person_map(last)}, "
            f"reject_reason[1]={reason.get(1)}",
        )
        stay_cancelled = self._wait_for(
            lambda: self.couch.get_stay(member_ev) == "cancelled", self.group_timeout
        )
        self.e2e_result(
            "rejected member's own stay cancelled in CouchDB (D4; not left live)", stay_cancelled
        )

        status, data, tcancel = self.cancel_group(booking_id)
        res = data.get("result", {}) if isinstance(data, dict) else {}
        self.e2e_result(
            "EXT-009 cancel with a rejected member -> 200 CANCELLED",
            status == 200 and res.get("booking_status") == "CANCELLED",
            f"HTTP {status} - {data}" if status != 200 else "",
        )
        if status != 200:
            return
        done = self.watch_group(
            [cids[0], cids[2]],
            tcancel,
            self.group_timeout,
            lambda d: self.stay(d) == "cancelled",
            lambda d: d.get("status") == "cancelled",
        )
        self.e2e_result(
            f"remaining 2 evacuees and their households end cancelled "
            f"within {self.group_timeout:.0f}s",
            done["complete"],
            f"{done['elapsed']:.1f}s after cancel",
        )
        expected_after = {0: "CANCELLED", 1: "REJECTED", 2: "CANCELLED"}

        def cancelled_aggregate() -> bool:
            nonlocal last
            _, last = self.booking_status(booking_id)
            return (
                last.get("booking_status") == "CANCELLED"
                and self._person_map(last) == expected_after
            )

        ok = self._wait_for(cancelled_aggregate, self.group_timeout)
        self.e2e_result(
            "EXT-010 aggregate CANCELLED; persons 0 and 2 CANCELLED, person 1 still REJECTED",
            ok,
            f"booking_status={last.get('booking_status')}, persons={self._person_map(last)}",
        )
        status, data, _ = self.cancel_group(booking_id)
        self.e2e_result(
            "EXT-009 repeat cancel of the partial group -> 200 (idempotent)",
            status == 200,
            f"HTTP {status} (code={get_error_code(data)})" if status != 200 else "",
        )
        left = self.mongo.plaintext_rows([booking_id])
        self.e2e_result(
            "no plaintext PII left in the partial group's rows", left == 0, f"rows={left}"
        )

    def scenario_checked_in(self) -> None:
        """EXT-009 after check-in: 409 booking_not_cancellable and nothing changed (FR-40/53)."""
        self._banner("E2E 9: group with a checked-in member -> cancel 409, nothing changed")
        case = "EXT-009 cancel with a checked-in member"
        if not self.mongo_on():
            self.record_skip(
                "E2E", case, "needs --mongo-uri (pymongo): waits for the API projection"
            )
            return
        assert self.mongo is not None and self.created_client_id
        cids = self.make_group(2)
        status, data, t201 = self.create_group(cids)
        res = data.get("result", {}) if isinstance(data, dict) else {}
        booking_id = str(res.get("booking_id", ""))
        if status != 201 or not booking_id.startswith("BK-"):
            self.e2e_result("set-up: group of 2 accepted", False, f"HTTP {status} - {data}")
            return
        watch = self.watch_group(
            cids,
            t201,
            self.group_timeout,
            lambda d: self.stay(d) == "pre_registered",
            lambda d: d.get("type") == "household",
        )
        if not watch["complete"]:
            self.e2e_result("set-up: group of 2 written by the worker", False)
            return
        target = self.evacuees([cids[0]]).get(cids[0], [])
        if not target:
            self.e2e_result("set-up: member 0 found in CouchDB", False)
            return
        evac_id = target[0]["_id"]
        original = dict(target[0].get("current_stay") or {})
        # watch_group above waited for pre_registered, so `original` is that stay; the
        # fallback only covers a doc that has no current_stay.
        restore = original or {"status": "pre_registered", "zone": None, "since": None}
        set_ok = False
        try:
            now = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
            arriving = {"status": "arriving", "zone": None, "since": now}
            set_ok = self.couch.set_stay(evac_id, arriving)
            self.e2e_result("set-up: member 0 checked in (stay arriving) in CouchDB", set_ok)
            if not set_ok:
                return
            # FR-32: the API decides from its projection, so wait until the worker has synced it.
            projected = self._wait_for(
                lambda: self.mongo.person_status(evac_id) == "arriving", self.group_timeout
            )
            self.e2e_result("API projection shows member 0 arriving", projected)
            if not projected:
                return
            status, data, _ = self.cancel_group(booking_id)
            err = get_error_code(data)
            self.e2e_result(
                "EXT-009 cancel with a checked-in member -> 409 booking_not_cancellable",
                status == 409 and err == "booking_not_cancellable",
                f"HTTP {status} (code={err})",
            )
            time.sleep(self.settle)
            _, st = self.booking_status(booking_id)
            untouched_rows = (
                self.mongo.count_rows(booking_id, {"state": "written", "cancel_requested": False})
                == 2
            )
            other_stay = self.stay(self.evacuees([cids[1]]).get(cids[1], [{}])[0])
            self.e2e_result(
                "nothing changed after the refused cancel (API BOOKED, rows and stays as before)",
                st.get("booking_status") == "BOOKED"
                and untouched_rows
                and other_stay == "pre_registered"
                and self.stay(self.evacuees([cids[0]]).get(cids[0], [{}])[0]) == "arriving",
                f"booking_status={st.get('booking_status')}, untouched_rows={untouched_rows}, "
                f"other member stay={other_stay}",
            )
        finally:
            # Put the member back so this group can be cancelled by cleanup (only when changed).
            if set_ok:
                restored = self.couch.set_stay(evac_id, restore)
                back = restored and self._wait_for(
                    lambda: self.mongo.person_status(evac_id) == "pre_registered",
                    self.group_timeout,
                )
                self.e2e_result(
                    "restore: member 0 back to pre_registered (CouchDB and API)", bool(back)
                )

    def scenario_sweeper(self) -> None:
        """FR-33: an orphan committed=false row older than 60 s is swept by the worker."""
        self._banner("E2E 7: sweeper removes orphan committed=false rows")
        case = "sweeper deletes a committed=false row older than 60s"
        if not self.mongo_on():
            self.record_skip("E2E", case, "needs --mongo-uri (pymongo) to plant an orphan row")
            return
        assert self.mongo is not None and self.created_client_id
        suffix = f"{random.getrandbits(64):016x}"
        with self._manifest_lock:
            self.e2e_orphan_ids.append(f"BK-E2E-ORPHAN-{suffix}")
            self._save_manifest(strict=True)  # recorded before the row is inserted
        orphan = self.mongo.plant_orphan(
            self.e2e_shelter, self.created_client_id, age_seconds=120, suffix=suffix
        )
        deadline = time.monotonic() + max(self.settle * 3, 2 * WORKER_POLL_SECONDS + 15)
        gone = False
        while time.monotonic() < deadline:
            if not self.mongo.orphan_exists(orphan):
                gone = True
                break
            time.sleep(1)
        detail = ""
        if not gone:
            detail = "orphan row still present (sweeper did not run)" + (
                "" if self.worker_proven else "; worker never proven healthy in this run"
            )
        self.e2e_result(case, gone, detail)

    # ------------------------------------------------------------------ cleanup
    def _discover_run_bookings(self) -> List[str]:
        """Add this run's Mongo bookings we have no booking_id for (e.g. a POST that
        timed out after the server committed). Scoped to this run's client_id."""
        if not self.mongo_on():
            return []
        assert self.mongo is not None
        known = set(self.e2e_booking_ids)
        found = [b for b in self.mongo.booking_ids_of(self.owned_rows_filter()) if b not in known]
        if found:
            with self._manifest_lock:
                self.e2e_booking_ids.extend(found)
                self._save_manifest()
        return found

    def _remint_token(self) -> None:
        """Fresh token after a 401 (a long run can outlive the 1 h TTL). Never printed."""
        if not (self.created_client_id and self.client_secret):
            return
        status, data = self.http_request(
            "POST",
            self.partner_path("/external/token"),
            body={
                "grant_type": "client_credentials",
                "client_id": self.created_client_id,
                "client_secret": self.client_secret,
            },
        )
        if status == 200 and isinstance(data, dict) and data.get("access_token"):
            self.access_token = data["access_token"]

    def cancel_one(self, booking_id: str) -> str:
        """Cancel one booking with a small bounded retry. Returns the outcome:
        `cancelled` (200), `settled` (409/404: terminal, recorded) or `failed`.

        Transport errors, 5xx and 401 (token is re-minted) are retried; any other status
        is final. Nothing here touches CouchDB or Mongo.
        """
        status = 0
        for attempt in range(CANCEL_TRIES):
            status, data, _ = self.cancel_group(booking_id)
            if status == 200:
                self.cancel_ok.add(booking_id)
                self.cancel_failed.pop(booking_id, None)
                return "cancelled"
            if status in (404, 409):
                code = get_error_code(data)
                self.cancel_settled[booking_id] = f"{status}:{code}" if code else str(status)
                self.cancel_failed.pop(booking_id, None)
                return "settled"
            if not (status == 0 or status >= 500 or status == 401):
                break  # 400/403/422/...: retrying cannot help
            if status == 401:
                self._remint_token()
            if attempt < CANCEL_TRIES - 1:
                time.sleep(CANCEL_BACKOFF_SECONDS[min(attempt, len(CANCEL_BACKOFF_SECONDS) - 1)])
        self.cancel_failed[booking_id] = f"HTTP {status}"
        return "failed"

    def cancel_new(self, only: Optional[List[str]] = None, force: bool = False) -> None:
        """Cancel tracked bookings that have no terminal outcome yet. A `failed` one is
        retried on later passes (at most CANCEL_ROUNDS, or always with `force`)."""
        if not self.access_token:
            return  # recovery mode: no client secret, so no API cancel (Mongo CAS only)
        wanted = set(only) if only is not None else None
        for booking_id in list(self.e2e_booking_ids):
            if wanted is not None and booking_id not in wanted:
                continue
            if booking_id in self.cancel_ok or booking_id in self.cancel_settled:
                continue
            if not force and self.cancel_rounds.get(booking_id, 0) >= CANCEL_ROUNDS:
                continue
            self.cancel_rounds[booking_id] = self.cancel_rounds.get(booking_id, 0) + 1
            self.cancel_one(booking_id)

    def _log_cancel_summary(self) -> None:
        def ids(items: Any) -> str:
            shown = sorted(items)
            more = f" (+{len(shown) - 20} more)" if len(shown) > 20 else ""
            return ", ".join(shown[:20]) + more

        self.log(
            f"  cancel summary: {len(self.cancel_ok)} cancelled (200), "
            f"{len(self.cancel_settled)} already settled/invisible (409/404), "
            f"{len(self.cancel_failed)} failed after retries, of {len(self.e2e_booking_ids)} tracked"
        )
        if self.cancel_settled:
            self.log("    settled (terminal; the Mongo scrub/delete below still covers them): ")
            for booking_id in sorted(self.cancel_settled)[:20]:
                self.log(f"      {booking_id} -> {self.cancel_settled[booking_id]}")
            if len(self.cancel_settled) > 20:
                self.log(f"      (+{len(self.cancel_settled) - 20} more)")
        if self.cancel_failed:
            self.log(f"    {YELLOW}cancel failed for: {ids(self.cancel_failed)}{RESET}")

    def _open_booking_ids(self) -> List[str]:
        """booking_ids the worker may still act on. Without Mongo that cannot be told, so
        every tracked id is listed (fail closed)."""
        if self.mongo_on():
            assert self.mongo is not None
            try:
                return self.mongo.open_booking_ids(self.owned_rows_filter())
            except Exception as exc:
                self.log(f"  {YELLOW}could not list open rows: {type(exc).__name__}{RESET}")
        return sorted(self.e2e_booking_ids)

    def _wait_worker_settled(self) -> bool:
        """Wait until the worker has nothing left to do for our groups, so a late write
        cannot resurrect a doc after the purge. With Mongo that is "no pending /
        cancel_requested rows of this run" (re-discovering late-committed groups of timed
        out requests each poll); without it, "the number of bed-holding evacuees stopped
        changing" (a partly-written group the API refuses to cancel never drains).
        Returns False when the cleanup timeout expired first."""
        deadline = time.monotonic() + self.cleanup_timeout
        quiet_since: Optional[float] = None
        last_holding = -1
        while time.monotonic() < deadline:
            try:
                holding = sum(
                    1
                    for docs in self.evacuees(list(self.e2e_cids)).values()
                    for d in docs
                    if self.stay(d) in HOLD_STATUSES and d["_id"] not in self.e2e_planted_ids
                )
                if self.mongo_on():
                    assert self.mongo is not None
                    fresh = self._discover_run_bookings()
                    self.cancel_new()
                    self._refresh_run_ids()
                    busy = self.mongo.open_rows(self.owned_rows_filter()) + len(fresh)
                else:
                    busy = holding
            except Exception as exc:
                self.log(f"  {YELLOW}cleanup poll failed: {redact_text(exc)}{RESET}")
                holding, busy = -1, 1
            changing = holding != last_holding if not self.mongo_on() else bool(busy)
            last_holding = holding
            if changing:
                quiet_since = None
            elif quiet_since is None:
                quiet_since = time.monotonic()
            elif time.monotonic() - quiet_since >= self.settle:
                return True
            time.sleep(1)
        return False

    def _scrub_open_rows(self) -> int:
        """Stop the worker from writing this run's still-open rows (Mongo mode only).

        Compare-and-set `pending` / `cancel_requested` rows of THIS run (client_id +
        tracked booking_ids + shelter) to `cancelled` and clear their PII. A row the worker
        was writing at that moment is moved back to `written`+`cancel_requested` by the
        worker, so after a scrub wait two polls, re-check and scrub again (bounded). The
        reserved doc ids stay on the rows and are re-read afterwards, so the purge still
        has its ownership proof. Returns the number of rows changed.
        """
        if not self.mongo_on():
            return 0
        assert self.mongo is not None
        total = 0
        for _ in range(SCRUB_ROUNDS):
            self._discover_run_bookings()
            changed = self.mongo.scrub_open_rows(
                self.owned_rows_filter(),
                list(self.e2e_booking_ids),
                "e2e smoke test cleanup (scrub)",
            )
            total += changed
            self._refresh_run_ids()
            if changed:
                time.sleep(2 * WORKER_POLL_SECONDS)  # an in-flight worker write moves on
                self._refresh_run_ids()
            if self.mongo.open_rows(self.owned_rows_filter()) == 0:
                break
        return total

    def purge_run_docs(self) -> bool:
        """Delete this run's CouchDB docs; True only when verified clean.

        Round after round: re-prove ownership (only ever adds to `self.proven`), re-fetch
        EVERY proven id directly (so a doc whose finder is gone, or whose delete failed,
        is retried) and delete what exists. Delete failures are kept as a set of ids until
        a later round deletes them. PASS = no proven doc still exists AND no unresolved
        delete failure.
        """
        for _ in range(PURGE_ROUNDS):
            self._refresh_run_ids()  # rows still exist here; they go only after the purge
            skipped = self._discover_proven()
            if skipped:
                self.log(f"  {YELLOW}left {skipped} doc(s) alone (not attributable){RESET}")
            existing = self.couch.get_many(sorted(self.proven))
            if not existing:
                break
            docs = list(existing.values())
            failed = set(self.couch.bulk_delete(docs))
            deleted_now = {d["_id"] for d in docs} - failed
            self.deleted_ids |= deleted_now
            self.failed_ids = (self.failed_ids - deleted_now) | failed
            time.sleep(WORKER_POLL_SECONDS + 1)  # catch late worker writes, then re-scan
        self._refresh_run_ids()
        self._discover_proven()
        leftover = self.couch.get_many(sorted(self.proven))
        unresolved = sorted(self.failed_ids)
        self.log(
            f"  deleted {len(self.deleted_ids)} CouchDB doc(s) of {len(self.proven)} proven "
            f"(unresolved delete failures: {len(unresolved)})"
        )
        clean = not leftover and not unresolved
        self.e2e_result(
            "cleanup leaves no CouchDB docs of this run in the test shelter",
            clean,
            f"leftover={len(leftover)}, unresolved_delete_failures={len(unresolved)}"
            if not clean
            else "",
        )
        return clean

    def e2e_cleanup(self) -> None:
        self._phase = "cleanup"  # later signals no longer unwind the run
        self._in_cleanup = True
        self._banner("E2E cleanup: cancel bookings, then remove this run's CouchDB docs")
        self._refresh_run_ids()
        try:
            discovered = self._discover_run_bookings()
        except Exception as exc:
            discovered = []
            self.cleanup_failed = True
            self.log(f"  {YELLOW}mongo discovery failed: {type(exc).__name__}{RESET}")
        if discovered:
            self.log(f"  found {len(discovered)} booking(s) of this run by client_id in Mongo")
        self.cancel_new()
        self.log(
            f"  cancelled {len(self.cancel_ok)} still-open booking(s) of {len(self.e2e_booking_ids)}"
        )
        if self.recovery:
            # No token (the client secret is never stored): nothing can be cancelled through
            # the API, so the Mongo compare-and-set is the only way to keep the worker from
            # writing this run's still-open rows.
            if self.mongo_on():
                try:
                    scrubbed = self._scrub_open_rows()
                    self.log(
                        f"  scrubbed {scrubbed} open row(s) of this run (cancelled, PII cleared)"
                    )
                except Exception as exc:
                    self.cleanup_failed = True
                    self.log(f"  {YELLOW}scrub failed: {type(exc).__name__}{RESET}")
            else:
                self.log(
                    f"  {YELLOW}no Mongo in recovery: nothing can stop the worker from writing "
                    f"rows it has not handled yet, and idleness cannot be proven (only the "
                    f"leftover check below counts); the manifest is kept if that fails{RESET}"
                )

        if not self._wait_worker_settled():
            open_ids = self._open_booking_ids()
            listed = ", ".join(open_ids[:30]) + (
                f" (+{len(open_ids) - 30} more)" if len(open_ids) > 30 else ""
            )
            basis = "open rows" if self.mongo_on() else "no --mongo-uri: all tracked ids"
            self.e2e_result(
                "worker settled before cleanup",
                False,
                f"not settled within {self.cleanup_timeout:.0f}s; still-open booking_ids "
                f"({basis}): {listed or 'none listed'}",
            )
            # Last attempt through the API, then stop the worker from writing the rest.
            self.cancel_new(only=open_ids, force=True)
            if self.mongo_on():
                try:
                    scrubbed = self._scrub_open_rows()
                    self.log(
                        f"  scrubbed {scrubbed} open row(s) of this run (cancelled, PII cleared)"
                    )
                except Exception as exc:
                    self.cleanup_failed = True
                    self.log(f"  {YELLOW}scrub failed: {type(exc).__name__}{RESET}")
            else:
                self.log(
                    f"  {YELLOW}no --mongo-uri: open rows cannot be scrubbed; the worker may "
                    f"still write docs later (purge below only sees what exists now){RESET}"
                )
        self._log_cancel_summary()

        purged = False
        try:
            purged = self.purge_run_docs()
        except Exception as exc:
            self.e2e_result(
                "cleanup leaves no CouchDB docs of this run in the test shelter",
                False,
                f"could not verify: {type(exc).__name__}: {redact_text(exc)}",
            )
        info = self.couch.info() or {}
        if self.baseline_doc_count is not None:
            self.log(
                f"  doc_count baseline={self.baseline_doc_count} final={info.get('doc_count')} "
                "(informational; other writers may change it)"
            )
        if self.mongo_on():
            assert self.mongo is not None and self.created_client_id
            try:
                for orphan in self.e2e_orphan_ids:
                    self.mongo.delete_orphan(orphan, self.created_client_id)
                self._discover_run_bookings()
                if self.mongo.open_rows(self.owned_rows_filter()):
                    self._scrub_open_rows()  # e.g. a row the worker re-queued meanwhile
                stale = self.staged_count()  # judged before this run's own leftovers go
                self.e2e_result(
                    "no committed=false rows left in Mongo after the run",
                    stale == 0,
                    f"rows={stale}",
                )
                staged_gone = self.mongo.delete_staged(
                    self.e2e_booking_ids, self.created_client_id, self.e2e_shelter
                )
                if purged:
                    done = self.mongo.delete_groups(
                        self.e2e_booking_ids,
                        ["cancelled", "rejected", "written"],
                        self.created_client_id,
                        self.e2e_shelter,
                    )
                    self.log(
                        f"  deleted {done} settled + {staged_gone} staged external_bookings "
                        "row(s) of this run"
                    )
                else:
                    self.log(
                        f"  {YELLOW}kept this run's settled external_bookings rows (PII "
                        f"cleared): they hold the reserved doc ids that prove ownership for "
                        f"a retry; deleted {staged_gone} staged row(s){RESET}"
                    )
            except Exception as exc:
                self.cleanup_failed = True
                self.log(f"  {YELLOW}mongo cleanup failed: {type(exc).__name__}{RESET}")
        else:
            self.log(
                f"  {YELLOW}no --mongo-uri: cancelled external_bookings rows (PII cleared) "
                f"of this run stay in Mongo; a request that timed out cannot be found by "
                f"client_id (CouchDB docs are still purged, by the stricter no-Mongo ownership rule){RESET}"
            )
        self.cleanup_done = True

    def _refresh_run_ids(self) -> None:
        """Collect the evacuee/household ids the worker reserved on this run's Mongo rows.

        Called while the rows exist (after every scenario and before each purge) and only
        ever adds, so the ids survive later PII clearing / row deletion.
        """
        if not self.mongo_on():
            return
        assert self.mongo is not None
        try:
            evacuees, households = self.mongo.reserved_ids(self.owned_rows_filter())
        except Exception as exc:
            self.log(f"  {YELLOW}could not read this run's doc ids: {type(exc).__name__}{RESET}")
            return
        before = (len(self.run_evacuee_ids), len(self.run_household_ids))
        self.run_evacuee_ids |= evacuees
        self.run_household_ids |= households
        if (len(self.run_evacuee_ids), len(self.run_household_ids)) != before:
            self._save_manifest()

    def _created_during_run(self, doc: Dict[str, Any]) -> bool:
        """`created_at` (ISO, set by the worker) is not older than run start - skew."""
        try:
            created = dt.datetime.fromisoformat(str(doc["created_at"]).replace("Z", "+00:00"))
        except (KeyError, ValueError):
            return False  # no reliable timestamp: not ours
        return created.tzinfo is not None and created >= self.run_started - CLOCK_SKEW

    def _owned_by_this_run(self, doc: Dict[str, Any], kind: str) -> bool:
        """Fail-closed proof that `doc` (kind: evacuee | household | audit) is this run's.

        `created_by` starting with "partner:" is NOT proof: every partner client and every
        earlier run shares it, and a random CID can collide with a real person, so a prefix
        match could delete real data (the tombstone then syncs to kiosk/staff devices).
        Candidates found by tracked CID are therefore only candidates.
        """
        if doc.get("_id") in self.e2e_planted_ids:  # planted by this run under its own id
            return True
        creator = str(doc.get("created_by", ""))
        if not creator.startswith("partner:"):
            return False
        if not self.use_provided_credentials and creator != ADMIN_CLIENT_CREATOR:
            return False
        if kind == "evacuee" and doc.get("registered_via") != "api":
            return False
        if self.mongo_on():
            if kind == "audit":  # audit docs are only fetched for already-proven targets
                return True
            ids = self.run_evacuee_ids if kind == "evacuee" else self.run_household_ids
            return doc.get("_id") in ids
        # No Mongo: the CID must be one this run registered AND the doc must be new.
        # (Households/audits are only reached through an owned evacuee / target.)
        if kind == "evacuee" and (doc.get("person_id") or {}).get("number") not in self.e2e_cids:
            return False
        return self._created_during_run(doc)

    def _discover_proven(self) -> int:
        """Prove ownership of this run's docs and add them to `self.proven`; returns how
        many candidates were left alone. Only ever adds.

        Candidates: evacuees by tracked CID (not proof) and by the ids the worker reserved
        on this run's Mongo rows; households of proven evacuees plus the reserved ones;
        audit docs targeting ANY proven id (including docs that are already deleted, so an
        audit left behind by a failed delete is still found); the planted duplicates.
        """
        skipped = 0
        proven_before = len(self.proven)
        candidates: Dict[str, Dict[str, Any]] = {}
        listed = sorted(self.e2e_cids)
        for start in range(0, len(listed), 100):  # candidates by tracked CID (not proof)
            for doc in self.couch.find(
                {"type": "evacuee", "person_id.number": {"$in": listed[start : start + 100]}}
            ):
                candidates[doc["_id"]] = doc
        for doc_id, doc in self.couch.get_many(sorted(self.run_evacuee_ids)).items():
            if doc.get("type") == "evacuee":  # candidates by reserved id (Mongo mode)
                candidates[doc_id] = doc
        house_ids: set = set()
        for doc_id, doc in candidates.items():
            if not self._owned_by_this_run(doc, "evacuee"):
                skipped += 1
                continue
            self.proven[doc_id] = "evacuee"
            if doc.get("household_id"):
                house_ids.add(doc["household_id"])
        house_ids |= self.run_household_ids
        house_ids |= {i for i, kind in self.proven.items() if kind == "household"}
        for house_id, doc in self.couch.get_many(sorted(house_ids)).items():
            if doc.get("type") != "household":
                continue
            if self._owned_by_this_run(doc, "household"):
                self.proven[house_id] = "household"
            else:
                skipped += 1
        targets = sorted(
            {i for i, kind in self.proven.items() if kind in ("evacuee", "household")}
            | self.run_evacuee_ids  # reserved/recorded ids: their docs may be gone already
            | self.run_household_ids
        )
        for start in range(0, len(targets), 100):
            for doc in self.couch.find(
                {"type": "audit", "target_id": {"$in": targets[start : start + 100]}}
            ):
                if self._owned_by_this_run(doc, "audit"):
                    self.proven[doc["_id"]] = "audit"
                else:
                    skipped += 1
        for planted_id in self.e2e_planted_ids:  # ids this run generated itself
            self.proven.setdefault(planted_id, "planted")
        if len(self.proven) != proven_before:
            self._save_manifest()
        return skipped

    # --------------------------------------------------------- signals + recovery
    def _say(self, text: str) -> None:
        """Print from a signal handler: a raw write, since `print` is not re-entrant."""
        try:
            os.write(1, (text + "\n").encode("utf-8", "replace"))
        except OSError:
            pass

    def _on_signal(self, signum: int, _frame: Any) -> None:
        name = signal.Signals(signum).name
        now = time.monotonic()
        last = self._last_signal_at.get(signum)
        if last is not None and now - last < SIGNAL_DEBOUNCE_SECONDS:
            # Duplicate delivery of one key press. The window is measured from the last
            # COUNTED signal, so mashing Ctrl-C still counts about once a second.
            return
        self._last_signal_at[signum] = now
        if self._phase == "run":
            self._phase = "cleanup"  # every later signal counts as a cleanup-phase one
            self._say(
                f"\n{YELLOW}{name}: stopping the run; cleanup runs first (a further {name} "
                f"says it is in progress, one more aborts it and keeps the manifest).{RESET}"
            )
            raise RunInterrupted(signum)
        self._cleanup_signals += 1
        if self._cleanup_signals == 1:
            self._say(
                f"\n{YELLOW}{name}: cleanup is in progress and is being finished, not "
                f"interrupted. Press again to ABORT it (CouchDB docs / Mongo rows may stay "
                f"behind; the manifest is kept for --e2e-cleanup-from).{RESET}"
            )
            return
        self._aborted = True
        self._say(f"\n{RED}{name}: aborting cleanup.{RESET}")
        raise CleanupAborted(signum)

    def _install_signal_handlers(self) -> Dict[int, Any]:
        """SIGINT/SIGTERM -> normal cleanup (e2e / recovery mode only, main thread only).
        SIGKILL cannot be handled: the manifest is the recovery path for that."""
        previous: Dict[int, Any] = {}
        if threading.current_thread() is not threading.main_thread():
            return previous
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.signal(signum, self._on_signal)
        return previous

    @staticmethod
    def _restore_signal_handlers(previous: Dict[int, Any]) -> None:
        for signum, handler in previous.items():
            try:
                signal.signal(signum, handler)
            except (ValueError, OSError):
                pass

    def recovery_command(self) -> str:
        """The exact command that finishes this run. Never contains a secret value."""
        ctx = self.cli_context
        parts = [
            "uv run --with pymongo python3" if ctx.get("mongo_uri") else "python3",
            shlex.quote(str(ctx.get("script") or sys.argv[0])),
            "--e2e-cleanup-from",
            shlex.quote(self.manifest.path if self.manifest else "<manifest>"),
            "--base-url",
            shlex.quote(str(ctx.get("base_url", ""))),
            "--api-prefix",
            shlex.quote(str(ctx.get("api_prefix", ""))),
            "--couch-url",
            shlex.quote(str(ctx.get("couch_url", ""))),
        ]
        if ctx.get("mongo_uri"):
            parts += ["--mongo-uri", shlex.quote(str(ctx["mongo_uri"]))]
        if ctx.get("confirm"):
            parts += ["--i-know-this-writes-to", shlex.quote(str(ctx["confirm"]))]
        if not self.use_provided_credentials:
            parts += ["--admin-secret", '"$EXTERNAL_API_SECRET"']  # the variable, not its value
        return " ".join(parts)

    def _print_recovery(self, reason: str) -> None:
        if self.manifest is None:
            return
        self.log(f"{YELLOW}{reason}{RESET}")
        self.log(
            f"{BOLD}Manifest kept (synthetic test CIDs and ids, no secrets; keep it private):"
            f"{RESET} {self.manifest.path}"
        )
        self.log(
            "To finish the cleanup (set -a; . ./.env; set +a first, for COUCHDB_USER / "
            "COUCHDB_PASSWORD / EXTERNAL_API_SECRET):"
        )
        self.log(f"  {self.recovery_command()}")

    def _finalize_manifest(self) -> None:
        """Delete the manifest after a SUCCESSFUL cleanup (all cleanup checks passed and
        the client revoked); otherwise keep it and print how to finish."""
        if self.manifest is None:
            return
        data_may_exist = bool(
            self.e2e_cids or self.e2e_booking_ids or self.e2e_planted_ids or self.e2e_orphan_ids
        ) or bool(self.proven)
        cleaned = self.cleanup_done and not self.cleanup_failed
        if (cleaned or not data_may_exist) and self.revocation_ok and not self._aborted:
            self.manifest.remove()
            self.log(f"Cleanup verified: manifest {self.manifest.path} removed.")
            return
        why = []
        if data_may_exist and not cleaned:
            why.append("cleanup did not complete cleanly")
        if not self.revocation_ok:
            why.append("the admin client was not revoked")
        self._print_recovery("Not everything is verified clean: " + "; ".join(why or ["aborted"]))

    def revoke_for_recovery(self) -> bool:
        """Revoke the admin-created client by its row id (idempotent). True = nothing left
        to do; False = could not revoke (the manifest is kept)."""
        if self.use_provided_credentials:
            self.log("  client was provided by the operator: not ours to revoke")
            return True
        if self.keep_client:
            self.log("  --keep-client: client not revoked")
            return True
        if not self.created_client_row_id:
            self.log(
                f"  {YELLOW}no client row id in the manifest (the run died before the client "
                f"was recorded): the client was NOT revoked{RESET}"
            )
            return True
        status, data = self.http_request(
            "POST",
            f"/v1/admin/thirdparty-clients/{self.created_client_row_id}/revoke",
            headers={"Authorization": f"Bearer {self.admin_secret}"},
        )
        client = data.get("client", {}) if isinstance(data, dict) else {}
        if status == 200 and client.get("is_active") is False:
            self.e2e_result("admin client revoked (is_active=False)", True)
            return True
        if status == 404:
            self.log("  client no longer exists (already deleted): nothing to revoke")
            return True
        self.e2e_result(
            "admin client revoked (is_active=False)",
            False,
            f"HTTP {status} (is --admin-secret / --base-url right? the client is NOT revoked)",
        )
        return False

    def run_cleanup_only(self) -> int:
        """`--e2e-cleanup-from`: finish a run that died. Sends no booking."""
        start_time = time.time()
        self._phase = "cleanup"  # a signal here is a cleanup-phase one
        self._in_cleanup = True
        previous = self._install_signal_handlers()
        try:
            try:
                self.log(f"\n{BOLD}E2E recovery cleanup (run {self.run_id}){RESET}")
                self.log(
                    f"{BOLD}API: {redact_url(self.base_url)}  |  CouchDB: "
                    f"{redact_url(self.couch.base_url)}/{self.couch.database}  |  Mongo: "
                    f"{'on' if self.mongo else 'off'}  |  tracked: {len(self.e2e_cids)} CIDs, "
                    f"{len(self.e2e_booking_ids)} bookings{RESET}"
                )
                if self.couch.info() is None:
                    self.log(
                        f"{RED}ERROR: CouchDB database {self.couch.database} not reachable; "
                        f"nothing was changed.{RESET}"
                    )
                    self._print_recovery("Nothing was cleaned.")
                    return 1
                try:
                    self.e2e_cleanup()
                except Exception as exc:
                    self.e2e_result("cleanup", False, f"{type(exc).__name__}: {redact_text(exc)}")
                self.revocation_ok = self.revoke_for_recovery()
                code = self._finish(start_time)
                self._finalize_manifest()
                return code
            except CleanupAborted:
                self._print_recovery("Recovery cleanup aborted.")
                return 130
        finally:
            self._restore_signal_handlers(previous)

    # -------------------------------------------------------------------- run
    def run_e2e(self) -> int:
        start_time = time.time()
        previous = self._install_signal_handlers()
        try:
            try:
                code = self._run_e2e_body(start_time)
            except RunInterrupted as sig:
                cleanup_failed = self.cleanup_failed  # an interrupt is not a cleanup failure
                self.e2e_result(
                    "run completed without a signal",
                    False,
                    f"{sig} received: scenarios stopped, cleanup ran (see above)",
                )
                self.cleanup_failed = cleanup_failed
                self._finish(start_time)
                code = 128 + sig.signum
            self._finalize_manifest()
            return code
        except CleanupAborted as sig:
            self._print_recovery(f"Run aborted by {sig} during cleanup.")
            return 128 + sig.signum
        except Exception as exc:  # crash outside the guarded cleanup: keep the manifest
            self.log(f"{RED}e2e run crashed: {type(exc).__name__}: {redact_text(exc)}{RESET}")
            self._print_recovery("The run crashed.")
            return 1
        finally:
            self._restore_signal_handlers(previous)

    def _run_e2e_body(self, start_time: float) -> int:
        self.log(
            f"\n{BOLD}================================================================={RESET}"
        )
        self.log(
            f"{BOLD}{CYAN}E2E: partner bookings API -> Mongo -> worker -> CouchDB (#597 / CR-169){RESET}"
        )
        self.log(
            f"{BOLD}API: {redact_url(self.base_url)}  |  test shelter: {self.e2e_shelter}{RESET}"
        )
        self.log(
            f"{BOLD}CouchDB: {redact_url(self.couch.base_url)}/{self.couch.database}  |  "
            f"Mongo checks: {'on' if self.mongo else 'off (API-behaviour only)'}{RESET}"
        )
        if self.manifest is not None:
            self.log(
                f"{BOLD}Manifest: {self.manifest.path} (synthetic test CIDs + ids, no secrets; "
                f"keep it private; removed after a verified cleanup){RESET}"
            )
        self.log(f"{BOLD}================================================================={RESET}")

        status, _ = self.http_request("GET", self.partner_path("/external/locations"))
        if status == 0:
            self.log(f"{RED}ERROR: Cannot connect to API at {redact_url(self.base_url)}.{RESET}")
            return 1
        info = self.couch.info()
        if info is None:
            self.log(
                f"{RED}ERROR: CouchDB database {self.couch.database} not reachable "
                f"(check URL/credentials; the shelter must be seeded).{RESET}"
            )
            return 1
        self.baseline_doc_count = info.get("doc_count")

        try:
            if not self.test_issue_215_auth() or not self.access_token:
                self.log(f"{RED}Cannot continue without a token.{RESET}")
                return self._finish(start_time)
            if "booking-write" not in self.token_scopes:
                self.e2e_result("token has booking-write scope", False, str(self.token_scopes))
                return self._finish(start_time)
            try:
                for scenario in (
                    self.scenario_group_of_three,
                    self.scenario_duplicate_group,
                    self.scenario_cancel_after_written,
                    self.scenario_race,
                    self.scenario_big_group,
                    self.scenario_couch_side_duplicate,
                    self.scenario_partial_group,
                    self.scenario_checked_in,
                    self.scenario_sweeper,
                ):
                    try:
                        scenario()
                    except PreflightError as exc:  # nothing was sent; go on with the next one
                        self.e2e_result(f"{scenario.__name__}: CID pre-flight", False, str(exc))
                    finally:
                        self._refresh_run_ids()  # rows exist now; keep their ids for cleanup
            except Exception as exc:  # keep going to cleanup; report the type only
                self.e2e_result(
                    "scenario run aborted", False, f"{type(exc).__name__}: {redact_text(exc)}"
                )
            finally:
                try:
                    self.e2e_cleanup()
                except Exception as exc:
                    self.e2e_result("cleanup", False, f"{type(exc).__name__}: {redact_text(exc)}")
        finally:
            self._phase = "cleanup"
            if not self._aborted:  # an aborted run leaves the revocation to the recovery run
                before = len(self.results)
                self.test_cleanup_and_revocation()
                self.revocation_ok = all(passed for _, _, passed, _ in self.results[before:])
        return self._finish(start_time)

    def _finish(self, start_time: float) -> int:
        code = self.print_summary(time.time() - start_time)
        if self.timing_lines:
            self.log(f"{BOLD}{CYAN}" + self.timing_lines[0] + f"{RESET}")
            for line in self.timing_lines[1:]:
                self.log(line)
            self.log("")
        return code


def run_e2e_from_args(
    parser: argparse.ArgumentParser,
    args: argparse.Namespace,
    client_id: str,
    client_secret: str,
) -> int:
    """Validate the e2e safety rules, then run the e2e suite. Returns the exit code."""
    shelter = (args.e2e_shelter_code or "").strip()
    if not shelter:
        parser.error("--e2e needs --e2e-shelter-code (a dedicated TEST shelter).")
    if not 1 <= args.e2e_big_size <= 100:
        parser.error("--e2e-big-size must be between 1 and 100.")
    guard = e2e_target_guard(parser, args)  # idempotent; main() already ran it first
    if guard is not None:
        return guard

    couch_user, couch_password = couch_credentials(parser, args)
    mongo, mongo_error = connect_mongo(args, require=bool(nonlocal_hosts(e2e_target_hosts(args))))
    if mongo_error:
        return 2

    runner = E2ERunner(
        base_url=args.base_url,
        admin_secret=args.admin_secret,
        shelter_code=shelter,
        keep_client=args.keep_client,
        verbose=args.verbose,
        client_id=client_id or None,
        client_secret=client_secret or None,
        api_prefix=args.api_prefix.strip(),
        skip_booking_writes=False,
        checked_in_cid=None,
        e2e_shelter=shelter,
        couch=CouchAdmin(args.couch_url, couch_user, couch_password, f"shelter_{shelter.lower()}"),
        mongo=mongo,
        group_timeout=args.e2e_timeout,
        big_size=args.e2e_big_size,
        big_timeout=args.e2e_big_timeout,
        big_budget=args.e2e_big_budget,
        race_rounds=args.e2e_race_rounds,
        cleanup_timeout=args.e2e_cleanup_timeout,
        skip_big=args.skip_e2e_big,
    )
    fingerprint = target_fingerprint(args)
    if mongo is None:  # the run really is without Mongo (local only): record that
        fingerprint["mongo"] = fingerprint["mongo_db"] = None
    runner.cli_context = {
        "script": sys.argv[0],
        "base_url": redact_url(args.base_url),
        "api_prefix": args.api_prefix.strip(),
        "couch_url": redact_url(args.couch_url),
        "mongo_uri": redact_text(args.mongo_uri) if mongo is not None else "",
        "confirm": args.i_know_this_writes_to,
    }
    try:  # BEFORE the first request that can create data
        manifest_path = runner.attach_manifest(args.e2e_manifest or None, fingerprint)
    except FileExistsError:
        print(
            f"{RED}Refusing: the manifest path already exists (it is never overwritten). "
            f"Pick another --e2e-manifest, or finish/remove the old run first.{RESET}",
            file=sys.stderr,
        )
        return 2
    except OSError as exc:
        print(
            f"{RED}Refusing: cannot create the recovery manifest ({type(exc).__name__}); "
            f"nothing was sent.{RESET}",
            file=sys.stderr,
        )
        return 2
    del manifest_path  # printed by the run banner
    return runner.run_e2e()


def couch_credentials(parser: argparse.ArgumentParser, args: argparse.Namespace) -> Tuple[str, str]:
    """CouchDB admin credentials from the environment or the dotenv file (never printed)."""
    dotenv = read_env_file(args.couch_env_file)
    user = os.getenv("COUCHDB_USER") or dotenv.get("COUCHDB_USER", "")
    password = os.getenv("COUCHDB_PASSWORD") or dotenv.get("COUCHDB_PASSWORD", "")
    if not user or not password:
        parser.error(
            "CouchDB credentials missing: set COUCHDB_USER / COUCHDB_PASSWORD "
            "(or provide them in the --couch-env-file)."
        )
    return user, password


def connect_mongo(args: argparse.Namespace, require: bool) -> Tuple[Optional[MongoProbe], bool]:
    """(probe, abort). `require` (a non-local target, or a recovery of a run that used
    Mongo) turns a missing pymongo / unreachable Mongo into an abort instead of dropping
    to the weaker no-Mongo mode."""
    if not args.mongo_uri:
        return None, False
    try:
        return MongoProbe(args.mongo_uri), False
    except ImportError:
        print(
            f"{RED if require else YELLOW}pymongo is not installed — "
            f"{'aborting' if require else 'Mongo assertions off'} "
            f"(try: uv run --with pymongo python3 {sys.argv[0]} ...){RESET}",
            file=sys.stderr,
        )
    except Exception as exc:
        print(
            f"{RED if require else YELLOW}Mongo unreachable ({type(exc).__name__}) — "
            f"{'aborting' if require else 'Mongo assertions off'}{RESET}",
            file=sys.stderr,
        )
    return None, require


def run_cleanup_from_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> int:
    """`--e2e-cleanup-from PATH`: finish a run that died, sending no booking."""
    guard = e2e_target_guard(parser, args)  # same guard: non-local needs --mongo-uri etc.
    if guard is not None:
        return guard
    try:
        data = RunManifest.load(args.e2e_cleanup_from)
    except ManifestError as exc:
        print(f"{RED}Refusing --e2e-cleanup-from: {exc}.{RESET}", file=sys.stderr)
        return 2
    now = target_fingerprint(args)
    mismatches = [
        f"{key}: manifest={data['targets'].get(key)!r} now={now[key]!r}"
        for key in ("api", "couch", "mongo", "mongo_db")
        if data["targets"].get(key) != now[key]
    ]
    given_shelter = (args.e2e_shelter_code or "").strip()
    if given_shelter and given_shelter.lower() != data["shelter"].lower():
        mismatches.append(f"shelter: manifest={data['shelter']!r} now={given_shelter!r}")
    if mismatches:
        print(
            f"{RED}Refusing --e2e-cleanup-from: the targets given now do not match the "
            f"manifest ({'; '.join(mismatches)}). Nothing was contacted.{RESET}",
            file=sys.stderr,
        )
        return 2
    couch_user, couch_password = couch_credentials(parser, args)
    mongo, mongo_error = connect_mongo(args, require=True)  # the run used Mongo: so must we
    if mongo_error:
        return 2
    shelter = data["shelter"]
    runner = E2ERunner(
        base_url=args.base_url,
        admin_secret=args.admin_secret,
        shelter_code=shelter,
        keep_client=args.keep_client,
        verbose=args.verbose,
        client_id=None,
        client_secret=None,
        api_prefix=args.api_prefix.strip(),
        skip_booking_writes=False,
        checked_in_cid=None,
        e2e_shelter=shelter,
        couch=CouchAdmin(args.couch_url, couch_user, couch_password, data["couch_database"]),
        mongo=mongo,
        cleanup_timeout=args.e2e_cleanup_timeout,
        recovery=True,
    )
    runner.load_manifest(RunManifest(args.e2e_cleanup_from), data)
    runner.cli_context = {
        "script": sys.argv[0],
        "base_url": redact_url(args.base_url),
        "api_prefix": args.api_prefix.strip(),
        "couch_url": redact_url(args.couch_url),
        "mongo_uri": redact_text(args.mongo_uri) if mongo is not None else "",
        "confirm": args.i_know_this_writes_to,
    }
    return runner.run_cleanup_only()


def main():
    parser = argparse.ArgumentParser(
        description="Smoke test Smart Shelter Partner API (Issues #214 to #220 + M2 EXT-008..011)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Staging example:\n"
            "  export PARTNER_API_BASE_URL=https://shelter.importstar.dev\n"
            "  export PARTNER_API_PREFIX=/public-api\n"
            "  export PARTNER_CLIENT_ID=m6-warehouse-logistics\n"
            "  export PARTNER_CLIENT_SECRET=tps_...\n"
            "  python3 scripts/smoke_test_partner_api.py\n"
        ),
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv(
            "PARTNER_API_BASE_URL",
            os.getenv("FASTAPI_URL", "https://shelter.importstar.dev"),
        ),
        help=("Public origin (env: PARTNER_API_BASE_URL; default: https://shelter.importstar.dev)"),
    )
    parser.add_argument(
        "--api-prefix",
        default=os.getenv("PARTNER_API_PREFIX", "/public-api"),
        help=(
            "Path prefix before /external/* "
            "(env: PARTNER_API_PREFIX; staging default /public-api; local FastAPI: empty)"
        ),
    )
    parser.add_argument(
        "--client-id",
        default=os.getenv("PARTNER_CLIENT_ID", ""),
        help="Partner OAuth2 client_id from SA UI (env: PARTNER_CLIENT_ID)",
    )
    parser.add_argument(
        "--client-secret",
        default=os.getenv("PARTNER_CLIENT_SECRET", ""),
        help="Partner OAuth2 client_secret shown once at create (env: PARTNER_CLIENT_SECRET)",
    )
    parser.add_argument(
        "--admin-secret",
        default=os.getenv("EXTERNAL_API_SECRET", "dev-external-secret"),
        help=(
            "EXTERNAL_API_SECRET for admin client create/revoke "
            "(only when --client-id/--client-secret are omitted; local FastAPI)"
        ),
    )
    parser.add_argument(
        "--shelter-code",
        default=os.getenv("PARTNER_SHELTER_CODE") or None,
        help="Specific location_code to test (env: PARTNER_SHELTER_CODE; default: auto)",
    )
    parser.add_argument(
        "--skip-booking-writes",
        action="store_true",
        help="Do not create a test booking (EXT-008/009 happy path); negative checks still run",
    )
    parser.add_argument(
        "--checked-in-cid",
        default=os.getenv("PARTNER_CHECKED_IN_CID", ""),
        help="13-digit CID of a person already checked in, to verify the EXT-011 200 path "
        "(env: PARTNER_CHECKED_IN_CID)",
    )
    parser.add_argument(
        "--keep-client",
        action="store_true",
        help="Do not revoke the admin-created client after testing (admin mode only)",
    )
    e2e = parser.add_argument_group(
        "end-to-end mode (issue #597; see the script header for the full guide)"
    )
    e2e.add_argument(
        "--e2e",
        action="store_true",
        help="Run the API -> Mongo -> worker -> CouchDB booking scenarios INSTEAD of "
        "the read-only smoke sections (writes up to 100 households + evacuees)",
    )
    e2e.add_argument(
        "--e2e-shelter-code",
        default=os.getenv("PARTNER_E2E_SHELTER_CODE") or None,
        help="Dedicated TEST shelter code for e2e writes (env: PARTNER_E2E_SHELTER_CODE; "
        "required with --e2e)",
    )
    e2e.add_argument(
        "--i-know-this-writes-to",
        default="",
        metavar="HOST[,HOST]",
        help="Allow e2e writes to non-localhost hosts; list every non-local API/CouchDB host",
    )
    e2e.add_argument(
        "--couch-url",
        default=os.getenv("PARTNER_E2E_COUCH_URL", "http://localhost:5984"),
        help="CouchDB URL reachable from this machine (env: PARTNER_E2E_COUCH_URL)",
    )
    e2e.add_argument(
        "--couch-env-file",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"),
        help="dotenv file to read COUCHDB_USER / COUCHDB_PASSWORD from when they are "
        "not in the environment (default: repo-root .env; values are never printed)",
    )
    e2e.add_argument(
        "--mongo-uri",
        default=os.getenv("PARTNER_E2E_MONGO_URI", ""),
        help="Optional Mongo URI (needs pymongo) for committed=false / PII assertions and "
        "the sweeper case, e.g. mongodb://localhost:27017/tentdb (env: PARTNER_E2E_MONGO_URI)",
    )
    e2e.add_argument(
        "--e2e-big-size",
        type=int,
        default=100,
        help="Size of the timing group (default 100 = MAX_PERSONS)",
    )
    e2e.add_argument(
        "--skip-e2e-big", action="store_true", help="Skip the large-group timing scenario"
    )
    e2e.add_argument(
        "--e2e-timeout",
        type=float,
        default=30,
        help="Seconds the worker gets to write/cancel the small groups (default 30)",
    )
    e2e.add_argument(
        "--e2e-big-timeout",
        type=float,
        default=300,
        help="Seconds the worker gets for the large group (default 300)",
    )
    e2e.add_argument(
        "--e2e-big-budget",
        type=float,
        default=None,
        help="Optional: fail the large-group check when 201 -> all-in-CouchDB exceeds this",
    )
    e2e.add_argument(
        "--e2e-manifest",
        default="",
        metavar="PATH",
        help="Recovery manifest of this run (default: smoke-e2e-<runid>.json in the system "
        "temp dir, mode 0600, never overwritten). Holds synthetic test CIDs and ids, no "
        "secrets; keep it private. Removed after a verified cleanup",
    )
    e2e.add_argument(
        "--e2e-cleanup-from",
        default="",
        metavar="PATH",
        help="Cleanup-only mode: finish a run that died, from its manifest, sending no "
        "booking. Give the same --base-url / --couch-url / --mongo-uri as the run (they "
        "must match the manifest); --admin-secret revokes the admin-created client",
    )
    e2e.add_argument(
        "--e2e-cleanup-timeout",
        type=float,
        default=180,
        help="Seconds cleanup waits for the worker to settle before it records a FAIL, "
        "cancels/scrubs this run's still-open rows and purges anyway (default 180)",
    )
    e2e.add_argument(
        "--e2e-race-rounds",
        type=int,
        default=3,
        help="Rounds of the concurrent overlapping-CID race (default 3)",
    )
    e2e.add_argument(
        "--require-578",
        action="store_true",
        help="No-op (kept for old invocations): the #578 cases are plain assertions now",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Show detailed HTTP requests and debug responses",
    )

    args = parser.parse_args()

    if args.e2e_cleanup_from and args.e2e:
        parser.error("--e2e-cleanup-from replaces --e2e (it only finishes a finished run).")
    if args.e2e_manifest and not args.e2e:
        parser.error("--e2e-manifest needs --e2e.")
    if args.e2e_cleanup_from:  # cleanup-only: its own guard + manifest match, then exit
        sys.exit(run_cleanup_from_args(parser, args))
    if args.e2e:  # before anything else: no connection, no echo of target URLs
        guard = e2e_target_guard(parser, args)
        if guard is not None:
            sys.exit(guard)

    client_id = (args.client_id or "").strip()
    client_secret = (args.client_secret or "").strip()
    if bool(client_id) ^ bool(client_secret):
        parser.error(
            "Provide both --client-id and --client-secret "
            "(or PARTNER_CLIENT_ID and PARTNER_CLIENT_SECRET), or neither for admin mode."
        )

    if not client_id and "localhost" not in args.base_url and "127.0.0.1" not in args.base_url:
        print(
            f"{YELLOW}Warning:{RESET} admin provision mode against {redact_url(args.base_url)} "
            "usually fails — /v1/admin/* is not public. "
            "Set PARTNER_CLIENT_ID + PARTNER_CLIENT_SECRET instead.",
            file=sys.stderr,
        )

    if args.e2e:
        sys.exit(run_e2e_from_args(parser, args, client_id, client_secret))

    runner = SmokeTestRunner(
        base_url=args.base_url,
        admin_secret=args.admin_secret,
        shelter_code=args.shelter_code,
        keep_client=args.keep_client,
        verbose=args.verbose,
        client_id=client_id or None,
        client_secret=client_secret or None,
        api_prefix=args.api_prefix.strip(),
        skip_booking_writes=args.skip_booking_writes,
        checked_in_cid=args.checked_in_cid,
    )

    exit_code = runner.run_all()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
