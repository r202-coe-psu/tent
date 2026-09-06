# 0002. Partner Integration Architecture (OAuth2 Scoped Credentials & MongoDB Read Projection Plane)

## Context & Decision

External partner systems (M6 Resource Logistics and M7 Command Center / EOC) require machine-to-machine access to Smart Shelter data via 7 standardized endpoints (`EXT-001` through `EXT-007`) specified in [B_Data_We_Request_From_Partner_Systems.odt](file:///home/jakee/Projects/tent/docs/source/B_Data_We_Request_From_Partner_Systems.odt).

To maintain high throughput, sub-second latency for command dashboards, strict PDPA compliance, and protect our operational CouchDB database from N+1 query storms during disaster operations, we established the following architectural decisions:

1. **OAuth2 Scoped Client Credentials (`EXT-001`)**:
   - Implement `POST /api/auth/token-third-party` using `grant_type: "client_credentials"`.
   - Store machine credentials in a dedicated MongoDB collection `third_party_clients` (storing `client_id`, `client_secret_hash`, `module_name`, `allowed_scopes`, and `is_active`).
   - Issue short-lived, cryptographically signed JWT access tokens (lifetime 3,600s) embedding specific scopes (`location-read`, `location-stock-read`, `occupancy-read`, `occupancy-pii-read`).
   - Reject arbitrary access without valid scopes; audit token issuances.

2. **Decoupled MongoDB Read Projection Plane**:
   - Serve all third-party endpoints strictly from FastAPI backed by MongoDB, completely isolated from internal CouchDB instances.
   - Extend the Python Sync Worker to project aggregated shelter inventory balances into a new collection `shelter_stocks` for `EXT-004`.
   - Extend `public_shelters` in MongoDB with `occupancy_total` and `occupancy_breakdown` (`male`, `female`, `child_under_5`, `elderly_over_60`, `pregnant`, `bedridden`, `disabled`), continuously computed by the worker from CouchDB evacuee documents.

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

## Considered Options

- **Static API Key (`X-API-Key`) without token endpoint**: Rejected because partner systems (M6/M7) have established OAuth2 client implementations expecting 3600s tokens, and static keys lack granular per-request scope verification.
- **On-demand CouchDB queries via SvelteKit BFF**: Rejected because M7 Command Center dashboards poll or maintain open views continuously; querying multi-database CouchDB views live for stock and demographics would trigger N+1 request storms and collapse operational nodes during an active flood event.
- **Immediate CouchDB schema rewrite for M6 item IDs and DOPA codes**: Rejected to avoid breaking active intake forms, registration kiosks, and operational workflows; translation at the projection/API layer achieves full interoperability without risk.

## Consequences

- New MongoDB collections: `third_party_clients`, `shelter_stocks`, and `third_party_access_logs`.
- Sync Worker responsibilities expanded to aggregate stock balances and demographic groups.
- `PublicShelter` schema expanded to embed real-time occupancy counts and operational metadata.
- FastAPI gains a dedicated `/api/thirdparty` and `/api/auth` routing plane matching the partner contract exactly.
