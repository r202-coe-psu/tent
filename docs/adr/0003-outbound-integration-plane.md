# 0003. Outbound Integration Plane (FastAPI calls partner systems on behalf of the staff app)

## Context & Decision

ADR-0002 covers the **inbound** plane: partner systems call us (`/external/*`, OAuth2 client credentials, MongoDB projections). The M5 hospital-referral integration ([draft CR referral-m5](../changes/draft-referral-m5-hospital-integration.md)) is the first case where **we call a partner**: shelter staff send referrals to MOPH's M5 system, follow MOPH's review, report the vehicle leaving and withdraw transfers. M6 central-warehouse withdrawals ([draft CR central-warehouse-m6](../changes/draft-central-warehouse-m6-withdrawal.md), implemented 2026-11-12) follow the same shape — see "M6" below.

Constraints that shaped the design:

- M5 issues one `client_id` / `client_secret` per integrating system (OAuth2 client credentials, 24 h tokens). The secret must not reach the browser or the SvelteKit Node process.
- M5 has no webhook and no plan for one (D5-4): status changes must be polled (TRF-003/004).
- FastAPI runs several processes (`FASTAPI_WORKERS`, default 4) and has no scheduler.
- FastAPI holds no CouchDB credentials (ADR-0002 §7). The CouchDB system of record is written by the BFF (user actions) and the sync worker (asynchronous results).

Decisions:

1. **FastAPI owns every outbound call** under the internal prefix `/v1/integrations/*`, protected by the Bearer `EXTERNAL_API_SECRET` (BFF and worker only; nginx does not expose it). Partner credentials live in FastAPI env only (`M5_BASE_URL`, `M5_CLIENT_ID`, `M5_CLIENT_SECRET`).
2. **Browser → SvelteKit BFF → FastAPI → partner.** The browser never calls FastAPI or the partner (CR-063). The BFF authorises the staff session and shelter scope, and assembles any PII payload server-side (the browser never sends national IDs).
3. **Token cache per process.** Verified on M5 staging (2026-11-11): re-issuing a token does not revoke older ones, so each process keeps its own token, refreshes ≥ 60 s before expiry and retries once on 401. `invalid_client` / 403 open a 5-minute circuit (no automatic retry, per the M5 guide).
4. **Health gate.** `GET /v1/integrations/status` (cached 45 s) → BFF `GET /api/back-office/integrations/status` (3 s timeout) → UI. Any state other than `ready` disables the partner-backed action; the internal-only alternative (M5: "tracking" mode) stays available, including in edge mode where FastAPI is unreachable.
5. **Polling is scheduled by the sync worker**, not FastAPI: the worker POSTs `/v1/integrations/m5/sync` every `M5_SYNC_INTERVAL_S` (default 45). FastAPI refreshes a MongoDB snapshot collection (`m5_transfers`) and bumps `rev` when it changes.
6. **Results reach CouchDB through the worker.** The worker applies rows with `rev > applied_rev` to the CouchDB documents (referrals in `central_ops`, leave movements in `shelter_{code}`) idempotently, then compare-and-sets `applied_rev`. This is the same buffer pattern as `external_bookings` (ADR-0002 §7), in the opposite direction. Because several writers share the snapshot row, writes use field-level `$set` / atomic `$inc` only.
7. **Audit without payload.** Every outbound call writes `m5_outbound_logs` (endpoint, ids, HTTP status, error code, actor, duration) and never the request/response body or PII.
8. **Idempotent create.** The partner idempotency key is derived from our own id (`TENT-{shelter_code}-{batch_id}`), so a retry replays instead of duplicating. If the partner answers "key in use with a different body", FastAPI fetches the existing transfer by its code and records it instead of failing.

### M6 (central warehouse, 2026-11-12)

M6 reuses decisions 1–8 with these differences:

- **Separate client, no shared outbound layer.** `apiapp/modules/integrations_m6/client.py` (`HttpM6Client`) is its own class, not a shared `infrastructure/outbound/` module. M6 tokens are two-part: a 1 h access token renewed with AUTH-002 ≥ 60 s before expiry, and a refresh token that rotates on every AUTH-001 / AUTH-002 (stored over the old one; `invalid_grant` falls back to AUTH-001). A second 401 in a row opens the 5-minute circuit like `invalid_client`; a 403 is a per-request refusal (`M6_FORBIDDEN`) and does not.
- **Shared status route.** `GET /v1/integrations/status` stays in `integrations_m5/router.py` and returns `{m5, m6}`; the two checks run concurrently. The M6 check is a token plus one RES-001 read; a key with no `resource_types` counts as `credential_invalid`. The BFF status route admits either the referral audience or the central-warehouse audience.
- **Snapshot + worker apply.** `m6_withdrawals` (key `TENT-{shelter_code}-{ulid}`) is the system of record for withdrawals — there is no CouchDB doc for them. The worker POSTs `/v1/integrations/m6/sync` every `M6_SYNC_INTERVAL_S` (default 45) and applies rows with `rev > applied_rev`: an `in_transit` (or missed-to-`received`) withdrawal becomes a shelter donation `donation:m6-{request_code}` (`channel: m6`).
- **Outbox for the reverse write.** When that donation becomes `received`, the worker inserts `m6_confirm_outbox`; FastAPI's sync sends RES-007 and retries with backoff (30 s × 2ⁿ, cap 1 h). This is the first outbound call triggered by a CouchDB change rather than by a user.
- **Audit:** `m6_outbound_logs`, same rule as decision 7.
- **No payload replay.** A repeated RES-005 with a known `external_ref` is answered from Mongo (`200`) without calling M6 again.

## Considered Options

- **Call M5 from the SvelteKit BFF**: rejected — puts the partner secret in the Node process next to the CouchDB admin credential, and duplicates token handling for M6.
- **Poll from FastAPI** (background task): rejected — every FastAPI process would poll; the worker is already the single long-running scheduler.
- **Give FastAPI CouchDB write access**: rejected — keeps ADR-0002's separation; the worker already owns asynchronous CouchDB writes.
- **Share one token via MongoDB**: not needed while tokens are not revoked on re-issue; revisit if a partner revokes older tokens.

## Consequences

- New FastAPI module `apiapp/modules/integrations_m5` and MongoDB collections `m5_transfers`, `m5_outbound_logs` (`tent_model`).
- New worker loop `worker/inbound/m5_transfers.py` with settings `FASTAPI_INTERNAL_URL`, `EXTERNAL_API_SECRET`, `M5_SYNC_INTERVAL_S`.
- `httpx` is a runtime dependency of the backend.
- Partner status reaches staff within one sync interval plus one worker poll (≈ 45–50 s).
- Production gate: partner env stays unset until every reader of the new CouchDB shapes is live (M5: referral reader `schema_v` 3).
- M6 adds `apiapp/modules/integrations_m6`, the key `m6` under `/v1/integrations/status`, MongoDB collections `m6_withdrawals`, `m6_confirm_outbox`, `m6_outbound_logs`, env `M6_BASE_URL` / `M6_CLIENT_ID` / `M6_CLIENT_SECRET` (FastAPI) and `M6_SYNC_INTERVAL_S` (worker loop `worker/inbound/m6_withdrawals.py`).
- M6 production gate: donation reader `schema_v` 12 (`channel: m6`) must be live before the M6 env and worker loop are turned on.
