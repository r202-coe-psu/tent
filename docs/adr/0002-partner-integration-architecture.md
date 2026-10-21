# 0002. Partner Integration Architecture (OAuth2 Scoped Credentials & MongoDB Read Projection Plane)

## Context & Decision

External partner systems (M6 Resource Logistics and M7 Command Center / EOC) require machine-to-machine access to Smart Shelter data via 7 standardized endpoints (`EXT-001` through `EXT-007`; later extended to `EXT-012` by CR-154 and CR-181) specified in [B_Data_We_Request_From_Partner_Systems.odt](file:///home/jakee/Projects/tent/docs/source/B_Data_We_Request_From_Partner_Systems.odt).

To maintain high throughput, sub-second latency for command dashboards, strict PDPA compliance, and protect our operational CouchDB database from N+1 query storms during disaster operations, we established the following architectural decisions:

1. **OAuth2 Scoped Client Credentials (`EXT-001`)**:
   - Implement `POST /external/token` using `grant_type: "client_credentials"`.
   - Store machine credentials in a dedicated MongoDB collection `third_party_clients` (storing `client_id`, `client_secret_hash`, `module_name`, `allowed_scopes`, and `is_active`).
   - Issue short-lived, cryptographically signed JWT access tokens (lifetime 3,600s) embedding specific scopes (`location-read`, `location-stock-read`, `occupancy-read`, `occupancy-pii-read`; **#736** adds `occupant-search`; **CR-154** adds `booking-write`, `residency-read`; **CR-182** adds `booking-bypass`).
   - Reject arbitrary access without valid scopes; audit token issuances.

2. **Decoupled MongoDB Read Projection Plane**:
   - Serve all third-party endpoints strictly from FastAPI backed by MongoDB, completely isolated from internal CouchDB instances.
   - Extend the Python Sync Worker to project aggregated shelter inventory balances into a new collection `shelter_stocks` for `EXT-004`.
   - Extend `public_shelters` in MongoDB with `occupancy_total` and `occupancy_breakdown` (`male`, `female`, `gender_unspecified` [added by decision sync 2026-10-09, see `docs/data/schema.md` §9.1], `child_under_5`, `elderly_over_60`, `pregnant`, `bedridden`, `disabled`), continuously computed by the worker from CouchDB evacuee documents.

3. **Location Master Lifecycle & Soft Delete (`EXT-002`, `EXT-003`)**:
   - Alter worker projector to prevent hard-deleting closed shelters from MongoDB. When a shelter is closed or standby, preserve the document with `location_status: "closed"` and `is_active: true`. Only mark `is_active: false` upon actual administrative archival or deletion.
   - Implement query filtering for `updated_since` and `include_inactive`.

4. **DOPA Administrative Code Mapping Layer**:
   - Provide a zero-cost lookup layer in FastAPI translating internal text-based administrative names (e.g. "สงขลา", "หาดใหญ่") to standardized 2-digit (`province_code`), 4-digit (`district_code`), and 6-digit (`subdistrict_code`) DOPA codes without breaking existing CouchDB schemas.

5. **Stock Mapping & Thresholds (`EXT-004`, `EXT-006`)**:
   - Map internal item categories to M6's enum (`food`, `genaral`, `medical-equipment`, `medication`).
   - Supply `m6_reference_id: null` and `source: "direct_donation"` pending future catalog alignment.
   - Derive `critical_items` dynamically in `EXT-006` from inventory reorder thresholds: items with `qty <= 0` emit `level: "critical"`, items below reorder threshold emit `level: "low"`, omitting healthy stock items to prevent payload bloat.

6. **Restricted PII Access & Audit Logging (`EXT-007`)**:
   - Scaffold the occupant detail endpoint requiring `occupancy-pii-read` and mandatory query parameter `purpose`.
   - Set default access to disabled (return HTTP 403 Forbidden with standardized reason).
   - Log all attempts (including caller identity, IP, target shelter, and purpose) to `third_party_access_logs`.

7. **M2 Booking & Residency + person search (`EXT-008`–`EXT-012`, [CR-154](../changes/10-eoc/CR-154-m2-partner-booking-residency.md))**:
   - Add partner module `M2` (vulnerable-group assessment system) to the same OAuth2 plane instead of the legacy `/external/v1` API-key plane; M2's shelter list reuses `EXT-002`.
   - `EXT-008`–`EXT-010` (`POST /external/bookings`, `.../{id}/cancel`, `GET .../{id}`, scope `booking-write`) are the plane's only write path: FastAPI inserts into the MongoDB buffer `external_bookings`; the sync worker's inbound loop creates `household` + `evacuee` (`pre_registered`, `registered_via: api`) in `shelter_{code}` and then clears PII from the buffer. FastAPI still never holds CouchDB credentials. **เส้นทางเขียนแบบกลุ่ม (CR-169):** `POST` หนึ่งครั้งรับ `persons[]` (1–100 คน) และคืน `booking_id` กลุ่มเดียว (`BK-{ulid}`) ร่วมกันทุกแถว; แต่ละคนเป็นหนึ่งแถว (`_id` = `BP-{ulid}`, `person_seq`, `group_size`). Mongo standalone ใช้ transaction ไม่ได้ จึง API insert แถวทั้งหมดด้วย `committed = false` แล้ว flip เป็น `committed = true` เมื่อครบ (201); ถ้า duplicate ตอบ 409 `duplicate_booking` (`detail` = `persons[i]`) และลบแถวที่ staged ไว้. Worker อ่านเฉพาะแถวที่ committed และเขียน `household` + `evacuee` หนึ่งชุดต่อคน โดยใส่ `booking_ref = booking_id` (`schema_v` 14). Sweeper ลบกลุ่มที่ไม่ครบค้างเกิน 60 วินาที
   - **Bookability and bypass ([CR-182](../changes/10-eoc/CR-182-partner-accepts-booking-bypass.md), #751):** `EXT-008` accepts a booking only when `accepts_booking` holds: `location_status != "closed"` AND `raw_data.feature_flags.accepts_pre_registration == true` (a missing flag is not bookable); otherwise 409 `location_not_bookable`. The same rule is published as `accepts_booking` on `EXT-002`/`EXT-003` (and as the `?accepts_booking=` filter on `EXT-002`). The scope `booking-bypass`, used together with `booking-write`, lets an EOC client skip every acceptance condition including `closed`, but never "not found" / inactive (404). It applies automatically only when the rule fails, and is recorded: access log `status = "granted_bypass"` and `external_bookings.bypass = true`.
   - `EXT-011` (`GET /external/persons/shelter-residency`, scope `residency-read`) follows the `EXT-007` pattern: mandatory `purpose`, every attempt logged to `third_party_access_logs`, lookup by `national_id_hash` only.
   - `EXT-012` (`POST /external/persons/search`, scope `occupant-search`, #736) follows the same pattern: mandatory `purpose` (query), the search text travels in the JSON body (never the URL), every attempt logged to `third_party_access_logs` without the query text, no `search_audits` row. It reuses the public search rules and masking, hides `cancelled` people and returns no `family_members`.
   - `booking-write`, `booking-bypass`, `residency-read` and `occupant-search` are sensitive scopes: never preset, granted per case by a system admin.

## Considered Options

- **Static API Key (`X-API-Key`) without token endpoint**: Rejected because partner systems (M6/M7) have established OAuth2 client implementations expecting 3600s tokens, and static keys lack granular per-request scope verification.
- **On-demand CouchDB queries via SvelteKit BFF**: Rejected because M7 Command Center dashboards poll or maintain open views continuously; querying multi-database CouchDB views live for stock and demographics would trigger N+1 request storms and collapse operational nodes during an active flood event.
- **Immediate CouchDB schema rewrite for M6 item IDs and DOPA codes**: Rejected to avoid breaking active intake forms, registration kiosks, and operational workflows; translation at the projection/API layer achieves full interoperability without risk.

## Consequences

- New MongoDB collections: `third_party_clients`, `shelter_stocks`, and `third_party_access_logs`.
- Sync Worker responsibilities expanded to aggregate stock balances and demographic groups.
- `PublicShelter` schema expanded to embed real-time occupancy counts and operational metadata.
- FastAPI gains a dedicated `/external` routing plane matching the partner contract exactly.
- **As-built partner handover (2026-09-10):** รายงาน as-built ส่งมอบ (2026-09-10) ถูกลบออกจาก repo แล้ว (commit `4374bcc20`) — แหล่งอ้างอิงของ integration คือ [api-contract.md](../data/api-contract.md) §5.3; stub ที่ [docs/data/partner-api.md](../data/partner-api.md) คงไว้เพื่อลิงก์เดิม. ODT ใน `docs/source/` เป็น immutable archive (ไม่แก้).
