---
title: Partner Data API — As-Built (EXT-001–EXT-011)
status: as-built
version: 2.0
created: 2026-10-06
updated: 2026-10-06
audience: M2 Vulnerable-group Readiness / M6 Resource Logistics / M7 Command Center (EOC) partners
note: Self-contained as-built for partner integration; email this file alone (smoke-test script, if wanted, is attached separately — §18). v2.0 รวม EXT-008–011 (M2, CR-154) เข้ากับฉบับ 2026-09-10 (v1.6, EXT-001–007).
---

# Partner Data API — เอกสารส่งมอบ As-Built (EXT-001–EXT-011)

เอกสารนี้อธิบาย **พฤติกรรมจริงของ API** ที่ Smart Shelter เปิดให้ระบบพันธมิตร (M2 / M6 / M7) เรียกใช้ และเป็น **สัญญา as-built ที่ใช้ผูก integration สำหรับ M2/M6/M7** — พอส่งไฟล์นี้ฉบับเดียวโดยไม่ต้องอ้างเอกสารภายในอื่น

**วันที่เอกสาร:** 2026-10-06 · **เวอร์ชัน:** 2.0

**ใครใช้ส่วนไหน:** M6/M7 ใช้ EXT-001–007 (§2–§11) · M2 ใช้ EXT-001, EXT-002 และ EXT-008–011 (§2, §5, §12–§15)

---

## 1. สภาพแวดล้อม (Environments)

| สภาพแวดล้อม | Base URL |
| --- | --- |
| Staging | `https://shelter.importstar.dev` |
| Production | `https://shelter.psu.ac.th` |

ทุก path ด้านล่างต่อท้าย base URL นี้

**Credentials:** ทีมปฏิบัติการ Shelter ออก `client_id` / `client_secret` และกำหนด `allowed_scopes` ต่อโมดูล (M2/M6/M7) **แยกต่างหาก** — ประสานทีม Shelter; ไม่แจก secret ในเอกสารนี้

ตัวอย่าง curl ด้านล่างใช้ staging base URL

---

## 2. การยืนยันตัวตน — EXT-001

| | |
| --- | --- |
| Method / Path | `POST /public-api/external/token` |
| Auth | ไม่ต้องมี Bearer — ส่ง credentials ใน body |
| Headers | `Content-Type: application/json` |
| Grant | `grant_type` = `"client_credentials"` เท่านั้น |

### Request

```bash
curl -sS -X POST 'https://shelter.importstar.dev/public-api/external/token' \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "<issued-by-shelter>",
    "client_secret": "<issued-by-shelter>"
  }'
```

### Success (200)

```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "module_name": "M6",
  "scopes": ["location-read", "location-stock-read", "occupancy-read"]
}
```

- `module_name` เป็น `M2` / `M6` / `M7` ตามโมดูลของ client และ `scopes` ตามที่ทีม Shelter กำหนด
- JWT อายุประมาณ **3600 วินาที** (`expires_in`)
- เรียก endpoint อื่นด้วย header: `Authorization: Bearer <access_token>`
- ไม่มี refresh token — เมื่อหมดอายุให้ขอ token ใหม่
- GET endpoints ไม่ต้องส่ง body / ไม่บังคับ `Content-Type`

### Error codes (EXT-001)

| HTTP | `code` | เมื่อไหร่ |
| --- | --- | --- |
| 400 | `unsupported_grant_type` | `grant_type` ไม่ใช่ `client_credentials` |
| 401 | `invalid_client` | `client_id` ไม่รู้จัก / ไม่ active / `client_secret` ผิด (ข้อความเดียวกันเพื่อไม่ leak enumeration) |

รูปแบบ error ดู §4.2

---

## 3. ตาราง Scope

| Scope | Endpoint ที่ต้องใช้ |
| --- | --- |
| `location-read` | EXT-002, EXT-003, EXT-006 (บังคับ) — M2 ใช้ EXT-002 |
| `location-stock-read` | EXT-004 |
| `occupancy-read` | EXT-005; EXT-006 (optional — เปิด field `result.occupancy_total` ระดับบน) |
| `occupancy-pii-read` | EXT-007 — **ไม่เปิดให้โดยค่าเริ่มต้น** (ดู §11) |
| `booking-write` | EXT-008, EXT-009, EXT-010 (จอง · ยกเลิก · ดูสถานะ) — **ออกเป็นรายกรณี** (PDPA) |
| `residency-read` | EXT-011 — **ออกเป็นรายกรณี** (PDPA) |

โทเคนที่ไม่มี scope ที่ต้องการจะได้ HTTP 403 `insufficient_scope` (EXT-007–011 ตรวจ scope ภายใน use case และ log ก่อนแล้วค่อยตอบ — ดู §11 และ §12–§15)

---

## 4. แบบแผนร่วม (Shared conventions)

### 4.1 Success envelope

endpoint อ่านข้อมูล (EXT-002–007, EXT-010, EXT-011) คืนรูป:

```json
{
  "status": 200,
  "message": "Found Data.",
  "result": { }
}
```

`result` เป็น object หรือ array ตาม endpoint

endpoint เขียน (EXT-008, EXT-009) ใช้ envelope เดียวกันแต่ `message` ต่างกัน: `201` `"Booking accepted."` / `200` `"Booking cancelled."`

### 4.2 Error envelope — ให้ดูที่ `code` เป็นหลัก

สำหรับ path ภายใต้ `/public-api/external/token` และ `/public-api/external/*` ร่างกาย error เป็น:

```json
{
  "status": 401,
  "message": "…",
  "code": "invalid_client"
}
```

บางกรณีมีฟิลด์เพิ่ม:

```json
{
  "status": 404,
  "message": "…",
  "code": "location_not_found",
  "result": []
}
```

| ฟิลด์ | หมายเหตุ |
| --- | --- |
| `status` | HTTP status ซ้ำใน body |
| `message` | ข้อความอ่านได้ — **อย่า hard-code เทียบ string**; อาจเปลี่ยนได้ |
| `code` | **คีย์หลักสำหรับ logic ฝั่ง partner** |
| `detail` | มีเมื่อระบบต้องการคำอธิบายเพิ่ม (เช่น EXT-007 ปฏิเสธ scope) |
| `result` | มีบางกรณี เช่น `location_not_found` → `result: []` |

**รหัสที่ใช้บ่อย**

| HTTP | `code` | ความหมาย |
| --- | --- | --- |
| 400 | `unsupported_grant_type` | grant ไม่รองรับ (EXT-001) |
| 400 | `missing_purpose` | ไม่ส่ง `purpose` (EXT-007, EXT-011) |
| 401 | `invalid_client` | credentials ไม่ผ่าน (EXT-001) |
| 401 | `invalid_token` | ไม่มี / หมดอายุ / JWT ใช้ไม่ได้ |
| 403 | `insufficient_scope` | โทเคนไม่มี scope ที่ต้องการ |
| 404 | `location_not_found` | ไม่พบ `location_code` (EXT-003–005, EXT-007; EXT-008 รวมกรณีศูนย์ถูกปิดถาวร) |
| 404 | `booking_not_found` | ไม่พบ booking (EXT-009, EXT-010) — รวมกรณี booking ของ client อื่น |
| 404 | `residency_not_found` | ไม่พบการเข้าพัก (EXT-011) — รวมกรณีจองแล้วแต่ยังไม่ check-in |
| 409 | `location_not_bookable` | ศูนย์ปิด หรือไม่รับการจองล่วงหน้า (EXT-008) |
| 409 | `duplicate_booking` | เลขบัตรนี้มีการจองหรือเข้าพักอยู่แล้วที่ **ศูนย์เดียวกัน** (EXT-008) |
| 409 | `booking_not_cancellable` | ยกเลิกไปแล้ว ถูกปฏิเสธแล้ว หรือผู้จองรายงานตัวที่ศูนย์แล้ว (EXT-009) |
| 422 | `validation_error` | ข้อมูลไม่ครบหรือรูปแบบไม่ถูกต้อง (EXT-008, EXT-009, EXT-011) |
| 500 | `internal_error` | ระบบขัดข้อง ให้ลองใหม่ภายหลัง |

> **ไม่มี rate limit HTTP 429** บน partner plane ในรุ่นนี้

### 4.3 Nullability

หลายฟิลด์อาจเป็น `null` เมื่อข้อมูลต้นทางไม่มี เช่น:

- `latitude` / `longitude`
- `address`, `name_short`, `location_subtype`
- `province_code` / `district_code` / `subdistrict_code` (แปลจากชื่อเขต — ถ้า map ไม่เจอ → `null`)
- `contact_phone`, `contact_name`, `operating_org`, `delivery_note`
- `opened_at` / `closed_at`
- stock: `m6_reference_id`, `m6_item_code` (**มักเป็น `null`**)

Partner ควร treat เป็น optional และไม่ fail เมื่อเป็น `null`

### 4.4 Location Master lifecycle (soft delete)

แยก **สถานะปฏิบัติการ** กับ **สถานะทะเบียน**:

| สถานการณ์ | `location_status` | `is_active` |
| --- | --- | --- |
| เปิดปกติ / เต็ม / สแตนด์บาย | `open` / `full` / `standby` | `true` |
| ปิดศูนย์ตามปฏิบัติการ | `closed` | ยังเป็น **`true`** |
| ลบ/เก็บถาวรจากทะเบียน | (คงค่าสุดท้าย) | **`false`** |

ปิดปฏิบัติการ **ไม่** ทำให้ record หายจากรายการ active — อย่าถือว่า `closed` ⇒ `is_active=false`

- EXT-002 ค่าเริ่มต้น: คืนเฉพาะ `is_active=true`
- ส่ง `include_inactive=true` เพื่อรวมรายการที่ archive แล้ว

### 4.5 ค่าที่พบได้บ่อยในรุ่นนี้

| Field | พฤติกรรม as-built |
| --- | --- |
| `location_type` | ส่วนใหญ่เป็น `"shelter"` |
| `m6_reference_id` | มักเป็น `null` (รอ catalog alignment) |
| `source` (stock) | มักเป็น `"direct_donation"` |
| `unit_ratio` | คงที่ `1` |
| `type_code` | `food` \| `genaral` \| `medical-equipment` \| `medication` (`genaral` = สะกดตาม M6) |
| `updated_by_role` (EXT-005) | คงที่ `"ระบบนับอัตโนมัติ (Sync Worker)"` |
| `critical_items[].level` | เฉพาะ `"low"` หรือ `"critical"` — **ไม่ส่ง `"normal"`**; คำนวณฝั่งเซิร์ฟเวอร์จาก stock + reorder threshold ของศูนย์ (ดู §9) |

---

## 5. EXT-002 — รายการสถานที่ (Location list)

| | |
| --- | --- |
| Method / Path | `GET /public-api/external/locations` |
| Scope | `location-read` |

### Query parameters

| Param | Type | Default | ความหมาย |
| --- | --- | --- | --- |
| `status` | string | — | กรอง `location_status` (`open`/`closed`/`full`/`standby`) |
| `updated_since` | datetime (ISO-8601) | — | คืนเฉพาะที่ `updated_at >=` ค่านี้ เช่น `2026-08-11T00:00:00+07:00` |
| `include_inactive` | bool | `false` | รวม `is_active=false` |
| `page` | int | `1` | หน้าข้อมูลที่ต้องการ (เริ่มต้นที่ 1) |
| `limit` | int | `50` | จำนวนรายการต่อหน้า (สูงสุด 200) |

### Example

```bash
curl -sS 'https://shelter.importstar.dev/public-api/external/locations?page=1&limit=50&updated_since=2026-08-11T00:00:00%2B07:00' \
  -H 'Authorization: Bearer <access_token>'
```

### Success (ย่อ)

```json
{
  "status": 200,
  "message": "Found Data.",
  "result": [
    {
      "location_code": "SH001",
      "name_th": "ศูนย์พักพิงตัวอย่าง",
      "name_short": "ตัวอย่าง",
      "location_type": "shelter",
      "location_subtype": "school",
      "location_status": "open",
      "latitude": 7.0065,
      "longitude": 100.4965,
      "address": "…",
      "subdistrict_code": "900101",
      "district_code": "9001",
      "province_code": "90",
      "capacity": 200,
      "contact_phone": null,
      "contact_name": null,
      "operating_org": null,
      "accepts_delivery": true,
      "delivery_note": null,
      "opened_at": "2026-08-01T08:00:00+00:00",
      "closed_at": null,
      "is_active": true,
      "occupancy_total": 42,
      "updated_at": "2026-09-10T04:12:00+00:00"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 42,
    "total_pages": 1
  }
}
```

### `result[]` fields

| Field | Type | Null? | หมายเหตุ |
| --- | --- | --- | --- |
| `location_code` | string | no | รหัสศูนย์ (เช่น `SH001`) |
| `name_th` | string | no | |
| `name_short` | string\|null | yes | |
| `location_type` | string | no | มัก `"shelter"` |
| `location_subtype` | string\|null | yes | เช่น school/temple |
| `location_status` | string | no | `open`/`closed`/`full`/`standby` |
| `latitude` / `longitude` | number\|null | yes | |
| `address` | string\|null | yes | |
| `subdistrict_code` / `district_code` / `province_code` | string\|null | yes | รหัส DOPA 2/4/6 หลัก |
| `capacity` | int | no | |
| `contact_phone` / `contact_name` | string\|null | yes | |
| `operating_org` | string\|null | yes | |
| `accepts_delivery` | bool | no | |
| `delivery_note` | string\|null | yes | |
| `opened_at` / `closed_at` | datetime\|null | yes | |
| `is_active` | bool | no | ดู §4.4 |
| `occupancy_total` | int | no | ยอดผู้พัก |
| `updated_at` | datetime | no | |

---

## 6. EXT-003 — รายละเอียดสถานที่

| | |
| --- | --- |
| Method / Path | `GET /public-api/external/locations/{location_code}` |
| Scope | `location-read` |

`result` = ฟิลด์เดียวกับ EXT-002 **บวก** `facilities: string[]`

### Example

```bash
curl -sS 'https://shelter.importstar.dev/public-api/external/locations/SH001' \
  -H 'Authorization: Bearer <access_token>'
```

### Success (ย่อ)

```json
{
  "status": 200,
  "message": "Found Data.",
  "result": {
    "location_code": "SH001",
    "name_th": "ศูนย์พักพิงตัวอย่าง",
    "name_short": "ตัวอย่าง",
    "location_type": "shelter",
    "location_subtype": "school",
    "location_status": "open",
    "latitude": 7.0065,
    "longitude": 100.4965,
    "address": "…",
    "subdistrict_code": "900101",
    "district_code": "9001",
    "province_code": "90",
    "capacity": 200,
    "contact_phone": null,
    "contact_name": null,
    "operating_org": null,
    "accepts_delivery": true,
    "delivery_note": null,
    "opened_at": "2026-08-01T08:00:00+00:00",
    "closed_at": null,
    "is_active": true,
    "occupancy_total": 42,
    "updated_at": "2026-09-10T04:12:00+00:00",
    "facilities": ["ห้องน้ำ", "ไฟฟ้า", "น้ำประปา"]
  }
}
```

404 → `code: location_not_found`

---

## 7. EXT-004 — สต็อกต่อศูนย์

| | |
| --- | --- |
| Method / Path | `GET /public-api/external/locations/{location_code}/stock` |
| Scope | `location-stock-read` |

### Example

```bash
curl -sS 'https://shelter.importstar.dev/public-api/external/locations/SH001/stock' \
  -H 'Authorization: Bearer <access_token>'
```

### Success (ย่อ)

```json
{
  "status": 200,
  "message": "Found Data.",
  "result": {
    "location_code": "SH001",
    "updated_at": "2026-09-10T04:12:00+00:00",
    "items": [
      {
        "m6_reference_id": null,
        "m6_item_code": null,
        "name_th": "ข้าวสาร",
        "type_code": "food",
        "unit_label": "กก.",
        "unit_ratio": 1,
        "quantity_on_hand": 120,
        "source": "direct_donation"
      }
    ]
  }
}
```

### `result`

| Field | Type | หมายเหตุ |
| --- | --- | --- |
| `location_code` | string | |
| `updated_at` | datetime | **ระดับ location เท่านั้น** (ไม่มี `updated_at` ต่อรายการสินค้า) |
| `items[]` | array | |

### `items[]`

| Field | Type | Null? | หมายเหตุ |
| --- | --- | --- | --- |
| `m6_reference_id` | int\|null | yes | มัก `null` |
| `m6_item_code` | string\|null | yes | จาก SKU ถ้ามี |
| `name_th` | string | no | |
| `type_code` | string | no | enum M6 (รวม `genaral`) |
| `unit_label` | string | no | |
| `unit_ratio` | number | no | คงที่ `1` |
| `quantity_on_hand` | number | no | รวม 0 |
| `source` | string | no | มัก `direct_donation` |

404 → `location_not_found`

---

## 8. EXT-005 — ผู้พักพิงรวม (Occupancy)

| | |
| --- | --- |
| Method / Path | `GET /public-api/external/locations/{location_code}/occupancy` |
| Scope | `occupancy-read` |

### Example

```bash
curl -sS 'https://shelter.importstar.dev/public-api/external/locations/SH001/occupancy' \
  -H 'Authorization: Bearer <access_token>'
```

### Success (ย่อ)

```json
{
  "status": 200,
  "message": "Found Data.",
  "result": {
    "location_code": "SH001",
    "capacity": 200,
    "occupancy_total": 42,
    "breakdown": {
      "male": 18,
      "female": 24,
      "child_under_5": 3,
      "elderly_over_60": 5,
      "pregnant": 1,
      "bedridden": 0,
      "disabled": 2
    },
    "updated_at": "2026-09-10T04:12:00+00:00",
    "updated_by_role": "ระบบนับอัตโนมัติ (Sync Worker)"
  }
}
```

กลุ่มใน `breakdown` **ซ้อนทับได้** — ผลรวมไม่จำเป็นต้องเท่า `occupancy_total`

404 → `location_not_found`

---

## 9. EXT-006 — สรุปข้ามศูนย์ (Summary)

| | |
| --- | --- |
| Method / Path | `GET /public-api/external/summary` |
| Scope | `location-read` **บังคับ**; `occupancy-read` **ถ้ามี** จะเติมยอดรวม |

### Example

```bash
curl -sS 'https://shelter.importstar.dev/public-api/external/summary' \
  -H 'Authorization: Bearer <access_token>'
```

### Success (ย่อ)

```json
{
  "status": 200,
  "message": "Found Data.",
  "result": {
    "generated_at": "2026-09-10T06:00:00+00:00",
    "location_count": 1,
    "occupancy_total": 42,
    "capacity_total": 200,
    "locations": [
      {
        "location_code": "SH001",
        "name_th": "ศูนย์พักพิงตัวอย่าง",
        "location_status": "open",
        "latitude": 7.0065,
        "longitude": 100.4965,
        "capacity": 200,
        "occupancy_total": 42,
        "critical_items": [
          {
            "name_th": "น้ำดื่ม",
            "quantity_on_hand": 0,
            "unit_label": "ลัง",
            "level": "critical"
          }
        ],
        "updated_at": "2026-09-10T04:12:00+00:00"
      }
    ]
  }
}
```

- `result.occupancy_total` (ระดับบน) เป็น `null` ถ้าโทเคน **ไม่มี** `occupancy-read`
- `locations[].occupancy_total` มี**เสมอ** แม้ไม่มี scope นั้น

### `critical_items[]` (as-built)

Alert คำนวณ **ฝั่งเซิร์ฟเวอร์** จากสต็อกของศูนย์เทียบ reorder threshold ที่ตั้งไว้ — partner ไม่ต้องคำนวณเอง

| Field | Type | หมายเหตุ |
| --- | --- | --- |
| `name_th` | string | |
| `quantity_on_hand` | number | |
| `unit_label` | string | |
| `level` | `"low"` \| `"critical"` | **ไม่มี `"normal"`** — ส่งเฉพาะรายการที่แจ้งเตือน; qty ≤ 0 → `critical`; ต่ำกว่า threshold → `low`; สต็อกปกติไม่ปรากฏใน array |

---

## 10. EXT-007 — รายละเอียดผู้พัก (Occupants)

| | |
| --- | --- |
| Method / Path | `GET /public-api/external/locations/{location_code}/occupants` |
| Scope | `occupancy-pii-read` |
| Query | `purpose` (**บังคับ**) — เหตุผลการเข้าถึง (PDPA)<br>`page` (int, default `1`)<br>`limit` (int, default `50`, สูงสุด `200`) |

### Example

```bash
curl -sS 'https://shelter.importstar.dev/public-api/external/locations/SH001/occupants?purpose=eoc-ops-check&page=1&limit=50' \
  -H 'Authorization: Bearer <access_token>'
```

### พฤติกรรม as-built

1. ต้องมี Bearer JWT ที่ valid
2. ต้องส่ง `purpose` ที่ไม่ว่าง — ไม่ส่ง → 400 `missing_purpose`
3. ต้องมี scope `occupancy-pii-read` — ไม่มี → 403 `insufficient_scope` พร้อม `detail` ว่าต้องอนุมัติเป็นรายกรณี
4. ทุก attempt ถูกเขียน audit log ไม่ว่าจะอนุญาตหรือไม่
5. **เมื่อได้รับ scope แล้ว** ระบบจะคืนรายการผู้พักพิงปัจจุบัน (สถานะ active) จาก MongoDB projection plane โดยปกปิดนามสกุล (Masking) และระบุช่วงอายุตามมาตรฐาน PDPA พร้อมข้อมูล `pagination`

### Success เมื่อมี scope

```json
{
  "status": 200,
  "message": "Found Data.",
  "result": [
    {
      "occupant_ref": "OCC-01HXYZ1234567890ABCDEF",
      "name_masked": "สมชาย ใ.",
      "age_range": "60+",
      "gender": "male",
      "care_flags": ["bedridden"],
      "checked_in_at": "2026-08-10T18:40:00+00:00"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1,
    "total_pages": 1
  }
}
```

### `result[]` fields

| Field | Type | Null? | หมายเหตุ |
| --- | --- | --- | --- |
| `occupant_ref` | string | no | รหัสอ้างอิงภายใน (ไม่ใช่เลขบัตรประชาชน) |
| `name_masked` | string | no | ชื่อจริง + อักษรแรกของนามสกุล เช่น `สมชาย ใ.` |
| `age_range` | string | no | ช่วงอายุ เช่น `<1`, `1-5`, `6-11`, `12-19`, `20-59`, `60+` (หรือ `unknown`) |
| `gender` | string\|null | yes | `male` \| `female` \| `other` |
| `care_flags` | string[] | no | หมวดความต้องการพิเศษ เช่น `["bedridden"]` |
| `checked_in_at` | datetime\|null | yes | เวลาที่เริ่มเข้าพัก |

---

## 11. EXT-007 — Denied by default (การควบคุมสิทธิ์ตาม PDPA)

| ข้อ | สถานะรุ่นนี้ |
| --- | --- |
| Scope `occupancy-pii-read` | **ไม่ถูกมอบโดยค่าเริ่มต้น** ให้ client ใดๆ |
| การเรียกโดยไม่มี scope | **403** + บันทึก audit log |
| การเรียกโดยมี scope | **200 + รายการผู้พักพิงจริง** ที่สถานะ active พร้อม pagination |
| มาตรการคุ้มครองข้อมูล (PDPA) | บังคับส่ง `purpose` ทุกครั้ง, Mask นามสกุล, ระบุช่วงอายุ (ไม่ระบุอายุจริงหรือเลขบัตรประชาชน) |

การเปิดใช้งานจริงต้องผ่านการอนุมัติสิทธิ์เป็นรายกรณี — ประสานทีม Shelter

---

## 12. EXT-008 — จองศูนย์ (M2)

| | |
| --- | --- |
| Method / Path | `POST /public-api/external/bookings` |
| Scope | `booking-write` |
| Headers | `Authorization: Bearer <access_token>`, `Content-Type: application/json` |

### Request

```bash
curl -sS -X POST 'https://shelter.importstar.dev/public-api/external/bookings' \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "location_code": "SH014",
    "cid": "1909800123458",
    "first_name": "สมชาย",
    "last_name": "ใจดี",
    "phone": "0812345678"
  }'
```

| ฟิลด์ | ชนิด | บังคับ | เงื่อนไข |
| --- | --- | --- | --- |
| `location_code` | string | ✔ | รหัสศูนย์จาก EXT-002 |
| `cid` | string(13) | ✔ | ตัวเลข 13 หลัก ผ่าน checksum ของบัตรประชาชน ห้ามมีขีดหรือช่องว่าง |
| `first_name` | string | ✔ | ห้ามว่าง |
| `last_name` | string | ✔ | ห้ามว่าง |
| `phone` | string | ✔ | เบอร์ไทย 9–10 หลัก รับรูปแบบ `+66…` ได้ (ระบบแปลงเป็น `0…` ให้) |

### Success (201)

```json
{
  "status": 201,
  "message": "Booking accepted.",
  "result": { "booking_id": "BK-01M48AM8KGVN69C4Z6K7K38ZZR", "location_code": "SH014", "booking_status": "BOOKED" }
}
```

### พฤติกรรม as-built

- **`201 BOOKED` แปลว่ารับเข้าคิวแล้ว** — ระบบลงทะเบียนผู้จองเข้าศูนย์แบบ asynchronous ภายในประมาณ 10 วินาที เก็บ `booking_id` ไว้ใช้กับ EXT-009 / EXT-010 ผลสุดท้ายดูได้จาก EXT-010
- **ตรวจซ้ำแยกต่อศูนย์** — เลขบัตรเดียวกันจองศูนย์เดียวกันซ้ำ (หรือมีการเข้าพักค้างอยู่) → `409 duplicate_booking`; จองศูนย์อื่นได้
- **ศูนย์สถานะ `full` ยังจองได้** — `closed` หรือศูนย์ที่ปิดรับจองล่วงหน้า → `409 location_not_bookable`; ไม่พบหรือถูกปิดถาวร (`is_active=false`) → `404 location_not_found`
- ตรวจ scope ก่อนตรวจข้อมูล — ไม่มี `booking-write` → `403 insufficient_scope`

### Error codes (EXT-008)

| HTTP | `code` |
| --- | --- |
| 401 | `invalid_token` |
| 403 | `insufficient_scope` |
| 404 | `location_not_found` |
| 409 | `location_not_bookable`, `duplicate_booking` |
| 422 | `validation_error` |

---

## 13. EXT-010 — ดูสถานะการจอง (M2)

| | |
| --- | --- |
| Method / Path | `GET /public-api/external/bookings/{booking_id}` |
| Scope | `booking-write` |

```bash
curl -sS 'https://shelter.importstar.dev/public-api/external/bookings/BK-01M48AM8KGVN69C4Z6K7K38ZZR' \
  -H 'Authorization: Bearer <access_token>'
```

### Success (200)

```json
{
  "status": 200,
  "message": "Found Data.",
  "result": {
    "booking_id": "BK-01M48AM8KGVN69C4Z6K7K38ZZR",
    "location_code": "SH014",
    "booking_status": "BOOKED",
    "reject_reason": null,
    "created_at": "2026-10-06T16:50:00.120000+07:00",
    "updated_at": "2026-10-06T16:50:03.480000+07:00"
  }
}
```

| `booking_status` | ความหมาย |
| --- | --- |
| `BOOKED` | การจองมีผล (อยู่ในคิว หรือลงทะเบียนเข้าศูนย์แล้ว) |
| `CANCELLED` | ยกเลิกแล้ว — แสดงทันทีที่ขอยกเลิกสำเร็จ แม้ระบบยังประมวลผลการยกเลิกไม่เสร็จ |
| `REJECTED` | ระบบปฏิเสธตอนลงทะเบียน — ดู `reject_reason` (`duplicate` = พบการจองหรือการเข้าพักของเลขบัตรนี้ที่ศูนย์เดียวกันผ่านช่องทางอื่น) |

ถ้าเคยขอยกเลิกแล้วแต่ยกเลิกไม่สำเร็จ เพราะผู้จองไปรายงานตัวที่ศูนย์ก่อน สถานะจะกลับเป็น `BOOKED` และมี `reject_reason: "not_cancellable"`

อ่านได้เฉพาะ booking ของ client ตัวเอง — booking ของ client อื่นตอบ `404 booking_not_found` (แยกไม่ออกจากกรณีไม่มีอยู่จริง)

---

## 14. EXT-009 — ยกเลิกการจอง (M2)

| | |
| --- | --- |
| Method / Path | `POST /public-api/external/bookings/{booking_id}/cancel` |
| Scope | `booking-write` |
| Body | ไม่บังคับ — ส่งว่างได้ หรือ `{ "reason": "…" }` (≤ 200 ตัวอักษร) |

```bash
curl -sS -X POST 'https://shelter.importstar.dev/public-api/external/bookings/BK-01M48AM8KGVN69C4Z6K7K38ZZR/cancel' \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Content-Type: application/json' \
  -d '{ "reason": "ผู้จองแจ้งยกเลิก" }'
```

### Success (200)

```json
{
  "status": 200,
  "message": "Booking cancelled.",
  "result": { "booking_id": "BK-01M48AM8KGVN69C4Z6K7K38ZZR", "booking_status": "CANCELLED" }
}
```

### พฤติกรรม as-built

- ยกเลิกได้เฉพาะ booking ของ client ตัวเอง และเฉพาะตอนที่ผู้จองยังไม่ได้รายงานตัวที่ศูนย์ — ไม่เข้าเงื่อนไข → `409 booking_not_cancellable`
- ยกเลิกซ้ำ ยกเลิก booking ที่ถูกปฏิเสธแล้ว หรือที่มีคำขอยกเลิกอยู่แล้ว → `409 booking_not_cancellable`
- `reason` เกิน 200 ตัวอักษร → `422 validation_error`
- ไม่พบ booking (รวมของ client อื่น) → `404 booking_not_found`

---

## 15. EXT-011 — ตรวจสอบการเข้าพัก (M2)

| | |
| --- | --- |
| Method / Path | `GET /public-api/external/persons/shelter-residency` |
| Scope | `residency-read` |
| Query | `cid` (**บังคับ**, 13 หลัก) · `purpose` (**บังคับ**) — วัตถุประสงค์ ใช้บันทึกตาม PDPA |

```bash
curl -sS -G 'https://shelter.importstar.dev/public-api/external/persons/shelter-residency' \
  --data-urlencode 'cid=1909800123458' \
  --data-urlencode 'purpose=ประเมินความพร้อมกลุ่มเปราะบาง' \
  -H 'Authorization: Bearer <access_token>'
```

### พฤติกรรม as-built (ตามลำดับการตรวจ)

1. ต้องมี Bearer JWT ที่ valid
2. ต้องส่ง `purpose` ที่ไม่ว่าง — ไม่ส่ง → `400 missing_purpose` (ตรวจก่อน scope)
3. ต้องมี scope `residency-read` — ไม่มี → `403 insufficient_scope`
4. `cid` ต้องเป็นตัวเลข 13 หลัก — ไม่ใช่ → `422 validation_error`
5. ไม่พบเลขบัตร หรือ **จองแล้วแต่ยังไม่ได้ check-in** → `404 residency_not_found`

ทุก attempt (ทั้งที่อนุญาตและปฏิเสธ) ถูกเขียน audit log พร้อม `purpose` โดยไม่บันทึกเลขบัตร

### Success (200)

```json
{
  "status": 200,
  "message": "Found Data.",
  "result": {
    "location_code": "SH014",
    "name_th": "ศูนย์พักพิงโรงเรียนหาดใหญ่วิทยาลัย",
    "checkin_datetime": "2026-08-20T14:30:00+07:00",
    "residency_status": "CHECKED_IN",
    "stay_status": "active",
    "in_zone": false
  }
}
```

| ฟิลด์ | ความหมาย |
| --- | --- |
| `residency_status` | `CHECKED_IN` เมื่อยังพักอยู่ในศูนย์ (รวมกรณีออกชั่วคราว) ส่วนกรณีอื่นเป็น `CHECKED_OUT` |
| `stay_status` | สถานะละเอียดภายในระบบ (ข้อมูลเสริม) |
| `in_zone` | `true` เมื่อเจ้าหน้าที่ยืนยันว่าผู้พักถึงโซนที่พักแล้ว |

ถ้าเลขบัตรเดียวกันมีประวัติหลายศูนย์ ระบบเลือกศูนย์ที่ยังพักอยู่ก่อน ถ้าไม่มีเลือกประวัติที่อัปเดตล่าสุด

> **รูปแบบเวลา:** EXT-008–011 ตอบเวลาเป็น ISO 8601 พร้อม offset `+07:00` ส่วน EXT-002–007 ในตัวอย่างข้างต้นเป็น `+00:00` — parse ด้วย timezone-aware parser

### การบันทึกตาม PDPA (EXT-008–011)

ทุกการเรียกถูกบันทึกเพื่อการตรวจสอบ: ตัวตน client, IP และผลลัพธ์ — **ไม่บันทึกเลขบัตรประชาชน เบอร์โทร หรือชื่อ**

---

## 16. สิ่งที่ตั้งใจยังไม่มีใน release นี้

- Rate limit / HTTP 429 บน partner plane
- Catalog ID ร่วม M6 (`m6_reference_id` ที่ไม่เป็น null)
- การ map `type_code` ที่รับประกัน 100% จากทุกหมวดสินค้าภายใน (เป็น best-effort)

---

## 17. แยกจาก Legacy External plane (`/external/v1`) — soft-deprecated สำหรับงานใหม่

`/external/v1` ยังมีในระบบ (API-key plane สำหรับ SA API Keys UI และ endpoint needs / occupants / announcements / faqs) แต่เป็น **legacy / do-not-use-for-new-integrations**. งาน partner ใหม่ใช้ plane `/external` (OAuth2) ตามเอกสารนี้ — ไม่ใช่ `/external/v1`.

> **M2 ย้ายมาอยู่บน plane OAuth แล้ว (CR-154):** `GET /external/v1/shelters` และ `GET /external/v1/persons/shelter-residency` ถูกลบ ให้ใช้ EXT-002 (§5) และ EXT-011 (§15) แทน

| | Partner Data API (เอกสารนี้) | Legacy External (`/external/v1`) |
| --- | --- | --- |
| สถานะ | **ใช้สำหรับงานใหม่** (M6 / M7 ตามสัญญา EXT-*) | **Legacy** — คงไว้; อย่าใช้สำหรับ integration ใหม่ |
| Auth | OAuth2 client_credentials → Bearer JWT | `X-API-Key` หรือ Bearer อื่น |
| Prefix | `/public-api/external/token`, `/public-api/external/*` (เช่น `/locations`, `/summary`) | `/public-api/external/v1/*` |
| Error shape | `{ status, message, code?, … }` | `{ error: { code, message } }` |

อย่าสลับ credentials / path ระหว่างสอง plane — `/external/v1/...` ≠ `/external/token` / `/external/locations`

---

## 18. Smoke test

สคริปต์ `scripts/smoke_test_partner_api.py` (ในรีโป Shelter — **ไม่รวมในไฟล์นี้ ขอแนบแยก**) ตรวจ endpoint EXT-001–011 แบบ end-to-end ผ่าน HTTP จริง ใช้ยืนยันว่า credentials และ scope ที่ได้รับใช้งานได้ก่อนเริ่มเชื่อมต่อ

### 18.1 สิ่งที่ตรวจ (ส่วน M2)

| Endpoint | กรณีที่ตรวจ |
| --- | --- |
| EXT-008 จอง | `201 BOOKED` และ `booking_id` ขึ้นต้น `BK-` · body ว่างและ CID ผิด checksum → 422 · ศูนย์ที่ไม่มีอยู่ → 404 · CID เดิมที่ศูนย์เดิม → 409 `duplicate_booking` · ไม่มี token ถูกปฏิเสธ |
| EXT-010 สถานะ | อ่านกลับได้ `BOOKED` พร้อมเวลา `+07:00` · อ่านได้ `CANCELLED` ทันทีหลังยกเลิก · id ที่ไม่มี → 404 |
| EXT-009 ยกเลิก | `reason` เกิน 200 ตัวอักษร → 422 · ยกเลิกสำเร็จ 200 · ยกเลิกซ้ำ → 409 `booking_not_cancellable` |
| EXT-011 การเข้าพัก | ไม่ส่ง `purpose` → 400 · CID รูปแบบผิด → 422 · CID ที่ไม่รู้จักและ CID ที่จองแล้วแต่ยังไม่ check-in → 404 · กรณี 200 ตรวจเมื่อระบุ `--checked-in-cid` |

ส่วน EXT-001–007 (token, location, stock, occupancy, summary, occupants) ตรวจในสคริปต์เดียวกัน ถ้า token ไม่มี scope `booking-write` / `residency-read` สคริปต์ตรวจว่าได้ 403 `insufficient_scope` แล้วข้ามส่วนที่เหลือของกลุ่มนั้น

### 18.2 วิธีรัน

```bash
export PARTNER_API_BASE_URL=https://shelter.importstar.dev
export PARTNER_API_PREFIX=/public-api
export PARTNER_CLIENT_ID=<issued-by-shelter>
export PARTNER_CLIENT_SECRET=<issued-by-shelter>
python3 scripts/smoke_test_partner_api.py
```

| ตัวเลือก | ใช้ทำอะไร |
| --- | --- |
| `--skip-booking-writes` | ไม่สร้าง booking ทดสอบ รันแบบอ่านอย่างเดียว (ยังตรวจกรณี error) |
| `--shelter-code <code>` (`PARTNER_SHELTER_CODE`) | บังคับศูนย์ที่ใช้จอง ถ้าไม่ระบุจะลองศูนย์สถานะ `open` ทีละที่จนกว่าจะรับจอง |
| `--checked-in-cid <13 หลัก>` (`PARTNER_CHECKED_IN_CID`) | ตรวจ EXT-011 กรณี 200 กับคนที่ check-in แล้ว (ระบบไม่แสดง CID ในผลลัพธ์) |
| `-v` | แสดง request / response ละเอียด (ซ่อน `client_secret`) |

Exit code เป็น `0` เมื่อผ่านทั้งหมด และ `1` เมื่อมีข้อที่ไม่ผ่าน

### 18.3 ผลกระทบต่อข้อมูล

- การรันปกติ**สร้าง booking จริง 1 รายการ** ด้วย CID สุ่มที่ผ่าน checksum และชื่อ "Smoke Test" แล้วยกเลิกทุกครั้งเมื่อจบ ถ้า worker ลงทะเบียนเข้าศูนย์ไปก่อนการยกเลิก จะมีผู้พักสถานะ `pre_registered` ค้างจนกว่าระบบจะประมวลผลการยกเลิก
- ใช้ `--skip-booking-writes` เมื่อไม่ต้องการเขียนข้อมูล

### 18.4 สถานะการตรวจสอบ

| สภาพแวดล้อม | ผล |
| --- | --- |
| Local (FastAPI + worker) | ผ่าน 33 จาก 33 ข้อ เมื่อ 2026-10-06 (ส่วน M2 16 ข้อ) |
| Staging | ยังไม่ได้รัน |

**ยังไม่ครอบคลุม:** `invalid_token` (ตรวจแค่ 401/403 เมื่อไม่มี token) · `location_not_bookable` (ไม่มีเคสบังคับให้เกิด) · `internal_error` · ผลสุดท้ายหลัง worker ลงทะเบียน (เช่น `REJECTED` / `duplicate`)

---

## 19. Checklist ฝั่ง Partner

1. ขอ `client_id` / `client_secret` + scopes จากทีม Shelter (ออกแยกจากเอกสารนี้)
2. `POST /public-api/external/token` (`Content-Type: application/json`) แล้วเก็บ `access_token` จนใกล้หมดอายุ
3. เรียก EXT-002…006 (M6/M7) หรือ EXT-002, EXT-008…011 (M2) ด้วย `Authorization: Bearer …`
4. แยก logic ตาม `code` ไม่ใช่ตามข้อความ `message`
5. รองรับ `null` ในฟิลด์ภูมิศาสตร์/ติดต่อ/DOPA/stock M6 ids
6. อย่าถือว่าปิดศูนย์ ⇒ `is_active=false`
7. อย่ารอ EXT-007 ข้อมูลบุคคลในรุ่นนี้
8. (M2) จองศูนย์ด้วย EXT-008 แล้วเก็บ `booking_id`; รอประมาณ 10 วินาทีแล้วยืนยันผลด้วย EXT-010
9. (M2) ถ้าผู้จองเปลี่ยนใจก่อนไปถึงศูนย์ ยกเลิกด้วย EXT-009
10. (M2) ตรวจการเข้าพักด้วย EXT-011 (ต้องส่ง `purpose`) — ได้ 404 `residency_not_found` จนกว่าเจ้าหน้าที่ศูนย์จะ check-in
11. (M2) ใช้ `booking_status` / `residency_status` (ไม่ใช่ `status`) และ `location_code` (ไม่ใช่ `shelter_id`) — ต่างจากสเปก A_M2_API_SERVICES_SHELTER_V1.0
