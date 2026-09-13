---
title: Partner Data API — As-Built (EXT-001–EXT-007)
status: as-built
version: 1.2
created: 2026-09-10
updated: 2026-09-11
audience: M6 Resource Logistics / M7 Command Center (EOC) partners
note: Self-contained as-built for partner integration; email this file alone.
---

# Partner Data API — เอกสารส่งมอบ As-Built (EXT-001–EXT-007)

เอกสารนี้อธิบาย **พฤติกรรมจริงของ API** ที่ Smart Shelter เปิดให้ระบบพันธมิตร (M6 / M7) เรียกใช้ และเป็น **สัญญา as-built ที่ใช้ผูก integration สำหรับ M6/M7** — พอส่งไฟล์นี้ฉบับเดียวโดยไม่ต้องอ้างเอกสารภายในอื่น

**วันที่เอกสาร:** 2026-09-11 · **เวอร์ชัน:** 1.2

---

## 1. สภาพแวดล้อม (Environments)

| สภาพแวดล้อม | Base URL |
| --- | --- |
| Staging | `https://shelter.importstar.dev` |
| Production | `https://shelter.psu.ac.th` |

ทุก path ด้านล่างต่อท้าย base URL นี้

**Credentials:** ทีมปฏิบัติการ Shelter ออก `client_id` / `client_secret` และกำหนด `allowed_scopes` ต่อโมดูล (M6/M7) **แยกต่างหาก** — ประสานทีม Shelter; ไม่แจก secret ในเอกสารนี้

ตัวอย่าง curl ด้านล่างใช้ staging base URL

---

## 2. การยืนยันตัวตน — EXT-001

| | |
| --- | --- |
| Method / Path | `POST /api/auth/token-third-party` |
| Auth | ไม่ต้องมี Bearer — ส่ง credentials ใน body |
| Headers | `Content-Type: application/json` |
| Grant | `grant_type` = `"client_credentials"` เท่านั้น |

### Request

```bash
curl -sS -X POST 'https://shelter.importstar.dev/api/auth/token-third-party' \
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
| `location-read` | EXT-002, EXT-003, EXT-006 (บังคับ) |
| `location-stock-read` | EXT-004 |
| `occupancy-read` | EXT-005; EXT-006 (optional — เปิด field `result.occupancy_total` ระดับบน) |
| `occupancy-pii-read` | EXT-007 — **ไม่เปิดให้โดยค่าเริ่มต้น** (ดู §11) |

โทเคนที่ไม่มี scope ที่ต้องการจะได้ HTTP 403 `insufficient_scope` (ยกเว้น EXT-007 ที่ log ก่อนแล้วค่อยตอบ — ดู §11)

---

## 4. แบบแผนร่วม (Shared conventions)

### 4.1 Success envelope

endpoint อ่านข้อมูล (EXT-002–007) คืนรูป:

```json
{
  "status": 200,
  "message": "Found Data.",
  "result": { }
}
```

`result` เป็น object หรือ array ตาม endpoint

### 4.2 Error envelope — ให้ดูที่ `code` เป็นหลัก

สำหรับ path ภายใต้ `/api/auth/token-third-party` และ `/api/thirdparty/*` ร่างกาย error เป็น:

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
| 400 | `missing_purpose` | ไม่ส่ง `purpose` (EXT-007) |
| 401 | `invalid_client` | credentials ไม่ผ่าน (EXT-001) |
| 401 | `invalid_token` | ไม่มี / หมดอายุ / JWT ใช้ไม่ได้ |
| 403 | `insufficient_scope` | โทเคนไม่มี scope ที่ต้องการ |
| 404 | `location_not_found` | ไม่พบ `location_code` |

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
| Method / Path | `GET /api/thirdparty/locations` |
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
curl -sS 'https://shelter.importstar.dev/api/thirdparty/locations?page=1&limit=50&updated_since=2026-08-11T00:00:00%2B07:00' \
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
| Method / Path | `GET /api/thirdparty/locations/{location_code}` |
| Scope | `location-read` |

`result` = ฟิลด์เดียวกับ EXT-002 **บวก** `facilities: string[]`

### Example

```bash
curl -sS 'https://shelter.importstar.dev/api/thirdparty/locations/SH001' \
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
| Method / Path | `GET /api/thirdparty/locations/{location_code}/stock` |
| Scope | `location-stock-read` |

### Example

```bash
curl -sS 'https://shelter.importstar.dev/api/thirdparty/locations/SH001/stock' \
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
| Method / Path | `GET /api/thirdparty/locations/{location_code}/occupancy` |
| Scope | `occupancy-read` |

### Example

```bash
curl -sS 'https://shelter.importstar.dev/api/thirdparty/locations/SH001/occupancy' \
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
| Method / Path | `GET /api/thirdparty/summary` |
| Scope | `location-read` **บังคับ**; `occupancy-read` **ถ้ามี** จะเติมยอดรวม |

### Example

```bash
curl -sS 'https://shelter.importstar.dev/api/thirdparty/summary' \
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
| Method / Path | `GET /api/thirdparty/locations/{location_code}/occupants` |
| Scope | `occupancy-pii-read` |
| Query | `purpose` (**บังคับ**) — เหตุผลการเข้าถึง (PDPA)<br>`page` (int, default `1`)<br>`limit` (int, default `50`, สูงสุด `200`) |

### Example

```bash
curl -sS 'https://shelter.importstar.dev/api/thirdparty/locations/SH001/occupants?purpose=eoc-ops-check&page=1&limit=50' \
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
      "age_range": "60-69",
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
| `age_range` | string | no | ช่วงอายุ เช่น `0-4`, `5-17`, `18-59`, `60-69`, `70+` |
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

## 12. สิ่งที่ตั้งใจยังไม่มีใน release นี้

- Rate limit / HTTP 429 บน partner plane
- Catalog ID ร่วม M6 (`m6_reference_id` ที่ไม่เป็น null)
- การ map `type_code` ที่รับประกัน 100% จากทุกหมวดสินค้าภายใน (เป็น best-effort)

---

## 13. แยกจาก External plane เดิม (`/external/v1`)

| | Partner Data API (เอกสารนี้) | Legacy External (`/external/v1`) |
| --- | --- | --- |
| ผู้ใช้หลัก | M6 / M7 ตามสัญญา EXT-* | หน่วยงานอื่น (เช่น M2) |
| Auth | OAuth2 client_credentials → Bearer JWT | `X-API-Key` หรือ Bearer อื่น |
| Prefix | `/api/auth/token-third-party`, `/api/thirdparty/*` | `/external/v1/*` |
| Error shape | `{ status, message, code?, … }` | `{ error: { code, message } }` |

อย่าสลับ credentials / path ระหว่างสอง plane

---

## 14. Checklist ฝั่ง Partner

1. ขอ `client_id` / `client_secret` + scopes จากทีม Shelter (ออกแยกจากเอกสารนี้)
2. `POST /api/auth/token-third-party` (`Content-Type: application/json`) แล้วเก็บ `access_token` จนใกล้หมดอายุ
3. เรียก EXT-002…006 ด้วย `Authorization: Bearer …`
4. แยก logic ตาม `code` ไม่ใช่ตามข้อความ `message`
5. รองรับ `null` ในฟิลด์ภูมิศาสตร์/ติดต่อ/DOPA/stock M6 ids
6. อย่าถือว่าปิดศูนย์ ⇒ `is_active=false`
7. อย่ารอ EXT-007 ข้อมูลบุคคลในรุ่นนี้
