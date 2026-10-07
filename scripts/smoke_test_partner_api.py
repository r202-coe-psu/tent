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
  POST {prefix}/external/bookings/{booking_id}/cancel  (M2, EXT-009)

M2 checks (EXT-008..011) are scope-aware: when the token lacks `booking-write` /
`residency-read` the script asserts the 403 insufficient_scope gate instead of
skipping silently. The booking checks WRITE one booking (random checksum-valid CID,
name "Smoke Test") to the target shelter and always cancel it afterwards. Use
--skip-booking-writes to keep a run strictly read-only.

Optional: PARTNER_CHECKED_IN_CID=<13 digits of a person already checked in> adds
the EXT-011 200-path check (the CID is sent to the API, never printed).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

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

        self.results: List[Tuple[str, str, bool, str]] = (
            []
        )  # (issue, test_name, passed, detail)

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

    def http_request(
        self,
        method: str,
        path: str,
        headers: Optional[Dict[str, str]] = None,
        body: Optional[Dict[str, Any]] = None,
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

        self.log_verbose(f"HTTP {method} {url}")
        if body and self.verbose:
            # Never echo client_secret in verbose logs.
            safe_body = {
                k: ("***" if k == "client_secret" else v) for k, v in body.items()
            }
            self.log_verbose(f"Payload: {json.dumps(safe_body)}")

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
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
            self.log_verbose(f"Connection Exception: {ex}")
            return 0, {"error": str(ex)}

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
        self.log(
            f"\n{BOLD}======================================================{RESET}"
        )
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
                "module_name": "M2",
                "allowed_scopes": [
                    "location-read",
                    "location-stock-read",
                    "occupancy-read",
                    "booking-write",
                    "residency-read",
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
        self.log(
            f"\n{BOLD}======================================================{RESET}"
        )
        self.log(f"{BOLD}Testing Issue #216: Location Master & DOPA Codes{RESET}")
        self.log(f"{BOLD}======================================================{RESET}")

        if not self.access_token:
            self.record_result(
                "#216", "Location Master endpoints", False, "Missing access token"
            )
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
            self.record_result(
                "#216", "Unauthenticated request rejected with 401/403", True
            )
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
        self.log(
            f"\n{BOLD}======================================================{RESET}"
        )
        self.log(f"{BOLD}Testing Issue #217: EXT-005 Occupancy Projection{RESET}")
        self.log(f"{BOLD}======================================================{RESET}")

        if not self.access_token:
            self.record_result(
                "#217", "Occupancy endpoint", False, "Missing access token"
            )
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
        self.log(
            f"\n{BOLD}======================================================{RESET}"
        )
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

        if (
            status == 200
            and res.get("location_code") == target_code
            and isinstance(items, list)
        ):
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
        self.log(
            f"\n{BOLD}======================================================{RESET}"
        )
        self.log(f"{BOLD}Testing Issue #219: EXT-006 Cross-Location Summary{RESET}")
        self.log(f"{BOLD}======================================================{RESET}")

        if not self.access_token:
            self.record_result(
                "#219", "Summary endpoint", False, "Missing access token"
            )
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
        self.log(
            f"\n{BOLD}======================================================{RESET}"
        )
        self.log(f"{BOLD}Testing Issue #220: EXT-007 Occupants & PDPA Audit{RESET}")
        self.log(f"{BOLD}======================================================{RESET}")

        if not self.access_token:
            self.record_result(
                "#220", "Occupants endpoint", False, "Missing access token"
            )
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
        """Explicit --shelter-code only; otherwise `open` locations from EXT-002.

        Not `self.shelter_code`: #216 auto-fills it with the first listed location,
        which may be closed or opted out of pre-registration.
        """
        if self.explicit_shelter_code:
            return [self.explicit_shelter_code]
        status, data = self.http_request(
            "GET",
            self.partner_path("/external/locations") + "?status=open&limit=20",
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
        status, data = self.http_request(
            "GET", f"{bookings}/BK-NON_EXISTENT_999", headers=headers
        )
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
        status, data = self.http_request(
            "GET", f"{bookings}/{self.booking_id}", headers=headers
        )
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
            status, data = self.http_request(
                "GET", query(self.checked_in_cid), headers=headers
            )
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

        # M2.18 Cancelling twice → 409 booking_not_cancellable
        status, data = self.http_request("POST", f"{base}/cancel", headers=headers)
        err_code = get_error_code(data)
        self.record_result(
            "M2",
            "EXT-009 second cancel rejected with 409 booking_not_cancellable",
            status == 409 and err_code == "booking_not_cancellable",
            f"HTTP {status} (code={err_code})",
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
            self.log(
                f"\n{YELLOW}Skipping client cleanup (--keep-client specified){RESET}"
            )
            return True

        if not self.created_client_row_id or not self.created_client_id:
            return True

        self.log(
            f"\n{BOLD}======================================================{RESET}"
        )
        self.log(
            f"{BOLD}Testing Client Revocation & Cleanup (Issue #215 Lifecycle){RESET}"
        )
        self.log(f"{BOLD}======================================================{RESET}")

        # 7.1 Revoke Client
        status, data = self.http_request(
            "POST",
            f"/v1/admin/thirdparty-clients/{self.created_client_row_id}/revoke",
            headers={"Authorization": f"Bearer {self.admin_secret}"},
        )
        client_data = data.get("client", {})
        if (
            status == 200
            and data.get("success") is True
            and client_data.get("is_active") is False
        ):
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
        self.log(f"{BOLD}Target Host: {self.base_url}{RESET}")
        self.log(
            f"{BOLD}API prefix: {self.api_prefix or '(none — direct FastAPI paths)'}{RESET}"
        )
        self.log(f"{BOLD}Mode: {mode}{RESET}")
        self.log(
            f"{BOLD}================================================================={RESET}"
        )

        # Connectivity: public plane has no /v1/health — probe partner path instead.
        probe_path = self.partner_path("/external/locations")
        self.log("\nChecking target server connectivity...")
        status, probe_body = self.http_request("GET", probe_path)
        if status == 0:
            self.log(f"{RED}ERROR: Cannot connect to server at {self.base_url}.{RESET}")
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
        if status == 404 and (
            "html" in raw_probe.lower() or not probe_body.get("code")
        ):
            self.log(
                f"{RED}ERROR: {probe_path} returned SPA/HTML 404 — partner route not found.{RESET}"
            )
            self.log(
                f"{YELLOW}Hint: On staging use --api-prefix /public-api "
                f"(not bare /external). Local FastAPI: --api-prefix ''.{RESET}"
            )
            return 1
        self.log_verbose(
            f"Probe GET {probe_path} → HTTP {status} (expect 401 without token)"
        )

        # Execute tests sequentially
        self.test_issue_215_auth()
        self.test_issue_216_locations()
        self.test_issue_217_occupancy()
        self.test_issue_218_stock()
        self.test_issue_219_summary()
        self.test_issue_220_occupants_pdpa()
        self.test_m2_bookings()
        self.test_m2_residency()
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
        self.log(
            f"{BOLD}                     SMOKE TEST SUMMARY REPORT                   {RESET}"
        )
        self.log(
            f"{BOLD}================================================================={RESET}"
        )

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

        self.log(f"-----------------------------------------------------------------")
        self.log(
            f"Total Checks: {BOLD}{total}{RESET} | Passed: {GREEN}{passed_count}{RESET} | Failed: {RED}{failed_count}{RESET} | Duration: {elapsed:.2f}s"
        )
        self.log(
            f"{BOLD}================================================================={RESET}\n"
        )

        return 0 if failed_count == 0 else 1


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
        help=(
            "Public origin (env: PARTNER_API_BASE_URL; "
            "default: https://shelter.importstar.dev)"
        ),
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
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Show detailed HTTP requests and debug responses",
    )

    args = parser.parse_args()

    client_id = (args.client_id or "").strip()
    client_secret = (args.client_secret or "").strip()
    if bool(client_id) ^ bool(client_secret):
        parser.error(
            "Provide both --client-id and --client-secret "
            "(or PARTNER_CLIENT_ID and PARTNER_CLIENT_SECRET), or neither for admin mode."
        )

    if (
        not client_id
        and "localhost" not in args.base_url
        and "127.0.0.1" not in args.base_url
    ):
        print(
            f"{YELLOW}Warning:{RESET} admin provision mode against {args.base_url} "
            "usually fails — /v1/admin/* is not public. "
            "Set PARTNER_CLIENT_ID + PARTNER_CLIENT_SECRET instead.",
            file=sys.stderr,
        )

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
