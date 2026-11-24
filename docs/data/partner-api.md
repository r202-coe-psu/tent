---
title: Partner Data API — Location Master (EXT-002 / EXT-003)
status: active
version: 1.1
created: 2026-10-21
updated: 2026-11-24
note: decision sync 2026-11-24 — เอกสารส่งมอบ partner (M2 / M6 / M7) ของข้อมูลศูนย์ v1.1 แทน redirect stub เดิม · endpoint อื่น (EXT-001, EXT-004–012) ยังอ้าง api-contract.md §5.3 · ต้นฉบับคำขอ partner (ODT v1.0) ที่ docs/source/B_Data_We_Request_From_Partner_Systems.odt เป็น immutable archive — อย่าแก้
---

# Partner Data API — Location Master (EXT-002 / EXT-003) · v1.1

> **สรุป (TL;DR)**
> - v1.1 ขยายข้อมูลศูนย์ใน `GET /external/locations` (EXT-002) และ `GET /external/locations/{location_code}` (EXT-003) ตามที่ M2/M6/M7 ต้องใช้
> - **key เดิม 4 ตัวเปลี่ยนค่า:** `accepts_delivery` เป็นค่าที่คำนวณแล้ว (เดิม `true` เสมอ) · `name_short`, `operating_org`, `delivery_note` เริ่มมีค่า (เดิม `null` เสมอ)
> - **key ใหม่ทั้งหมดเป็นแบบเพิ่ม (additive)** ไม่เปลี่ยนชื่อหรือลบ key เดิม · client ต้องรับ key ที่ไม่รู้จักได้และรับมือ `null` ได้ทุก field ที่ระบุว่า nullable
> - endpoint, auth, scope และรูปแบบ error ไม่เปลี่ยน

---

## 1. Changelog

| Version | วันที่ | การเปลี่ยนแปลง |
| --- | --- | --- |
| 1.0 | 2026-08-16 | ข้อกำหนดตาม partner ODT (`B_Data_We_Request_From_Partner_Systems.odt`) |
| 1.1 | 2026-11-24 | ดู §1.1 และ §1.2 |

### 1.1 ค่าของ key เดิมที่เปลี่ยน (behavior change — ตรวจ logic ฝั่ง client)

| Key | v1.0 | v1.1 | ผลกับ client |
| --- | --- | --- | --- |
| `accepts_delivery` | `true` ทุกศูนย์ | `true` เฉพาะศูนย์ที่ `is_active = true` **และ** `is_external = false` **และ** `location_status ≠ "closed"` | M6 จะเห็นปลายทางจัดส่งน้อยลง — ศูนย์ที่ปิด / ถูกปิดใช้งาน / บริหารในระบบอื่น เป็น `false` |
| `name_short` | `null` เสมอ | ชื่อย่อที่เจ้าหน้าที่กรอก หรือ `null` | ใช้แสดงบนแผนที่ได้ — fallback เป็น `name_th` เมื่อ `null` |
| `operating_org` | `null` เสมอ | หน่วยงานที่ดูแลที่เจ้าหน้าที่กรอก หรือ `null` | — |
| `delivery_note` | `null` เสมอ | ข้อจำกัดการเข้าถึงที่เจ้าหน้าที่กรอก หรือ `null` | — |

### 1.2 Key ใหม่ (additive)

- **EXT-002 และ EXT-003:** `site_kind`, `project_level`, `occupancy_forecast`, `capacity_available`, `parking_vehicle_types`
- **EXT-003 เท่านั้น:** `external_url`, `parking_points`, `donation_points`, `area_m2`, `area_type`, `power_source`,
  `water_source`, `communications`, `vhf_channel`, `central_kitchen`, `helipad`, `logistics_area_m2`, `toilets`,
  `showers`, `risk`, `vulnerable_groups`, `pet_policy`, `luggage_policy`, `zones`

---

## 2. ข้อกำหนดร่วม

| หัวข้อ | ค่า |
| --- | --- |
| Auth | `Authorization: Bearer <access_token>` จาก `POST /external/token` (EXT-001, `client_credentials`) |
| Scope | `location-read` |
| Response สำเร็จ | `{ "status": 200, "message": "Found Data.", "result": … }` (EXT-002 มี `pagination` เพิ่ม) |
| Error | `401 invalid_token` · `403 insufficient_scope` · `404 location_not_found` · `422 validation_error` — key off `code` ไม่เทียบ `message` |
| เวลา | ISO 8601 พร้อมเขตเวลา |

### 2.1 Query ของ EXT-002 (`GET /external/locations`)

| Param | ชนิด | เงื่อนไข | คำอธิบาย |
| --- | --- | --- | --- |
| `status` | Text | ไม่บังคับ | กรองตาม `location_status` (`open` \| `full` \| `standby` \| `closed` \| `unknown`) |
| `updated_since` | Timestamp | ไม่บังคับ | เฉพาะแถวที่ `updated_at` ≥ ค่านี้ |
| `include_inactive` | Boolean | ไม่บังคับ | `true` = รวมศูนย์ที่ `is_active = false` (ค่าเริ่มต้น `false`) |
| `accepts_booking` | `true` \| `false` | ไม่บังคับ | กรองตามกติกา `accepts_booking` · ค่าอื่น → 422 |
| `page` / `limit` | Number | ไม่บังคับ | ค่าเริ่มต้น `1` / `50` (`limit` ≤ 200) |

---

## 3. Data Dictionary — EXT-002 (ต่อหนึ่งศูนย์) และ EXT-003

EXT-003 คืนทุก field ของ EXT-002 บวก §4

| Field | ชนิด | เงื่อนไข | คำอธิบาย | ตัวอย่าง |
| --- | --- | --- | --- | --- |
| `location_code` | Text | บังคับ | รหัสศูนย์ คงที่ตลอดอายุ ไม่นำกลับมาใช้ซ้ำ | `SH001` |
| `name_th` | Text | บังคับ | ชื่อทางการ | `ศูนย์พักพิงโรงเรียนหาดใหญ่วิทยาลัย` |
| `name_short` | Text\|null | ไม่บังคับ | ชื่อย่อสำหรับแผนที่ (≤64) — **v1.1 มีค่าแล้ว** | `รร.หาดใหญ่วิทยาลัย` |
| `location_type` | Text | บังคับ | ชุดอ้างอิงเดียวกับ M6 — ปัจจุบัน `shelter` เสมอ | `shelter` |
| `location_subtype` | Text\|null | ไม่บังคับ | ประเภทอาคาร (code จาก master data ของ Shelter) | `school` |
| `site_kind` | Text | บังคับ | **ใหม่** ประเภทศูนย์ — `evacuation_center` (ศูนย์อพยพ), `host_house` (บ้านพี่เลี้ยง), `test_center` (ศูนย์ทดสอบ) · **รายการ code เพิ่มได้ในอนาคต** — client ต้องรับ code ที่ไม่รู้จักได้ | `evacuation_center` |
| `project_level` | Text\|null | ไม่บังคับ | **ใหม่** ระดับศูนย์ `community` \| `lao` \| `provincial` | `provincial` |
| `location_status` | Text | บังคับ | `open` \| `full` \| `standby` \| `closed` \| `unknown` (`unknown` = บริหารในระบบอื่น — ห้ามตีความเป็น open หรือ closed) | `open` |
| `latitude` / `longitude` | Number\|null | บังคับ* | WGS84 · `null` เมื่อศูนย์ยังไม่ปักหมุด | `7.008612` |
| `address` | Text\|null | บังคับ* | ที่อยู่ประกอบจากเลขที่/หมู่/ตำบล/อำเภอ/จังหวัด | `12 หมู่ 3 ต.คอหงส์ อ.หาดใหญ่ จ.สงขลา` |
| `subdistrict_code` / `district_code` / `province_code` | Text\|null | บังคับ* | รหัสกรมการปกครอง 6 / 4 / 2 หลัก · `null` เมื่อจับคู่ชื่อไม่ได้ | `901104` |
| `capacity` | Number | บังคับ | ความจุ (คน) · ศูนย์ที่บริหารในระบบอื่น = ค่าที่กรอก หรือ `0` | `500` |
| `contact_name` / `contact_phone` | Text\|null | ไม่บังคับ / บังคับ* | ผู้ติดต่อตามที่เจ้าหน้าที่กรอก | `074-000000` |
| `operating_org` | Text\|null | ไม่บังคับ | หน่วยงานที่ดูแล (≤200) — **v1.1 มีค่าแล้ว** | `เทศบาลนครหาดใหญ่` |
| `accepts_booking` | Boolean | บังคับ | จองแทนประชาชนได้ (EXT-008) | `true` |
| `accepts_delivery` | Boolean | บังคับ | รับการจัดส่งได้ — **v1.1 คำนวณ** (§1.1) | `true` |
| `delivery_note` | Text\|null | ไม่บังคับ | ข้อจำกัดการเข้าถึงสำหรับรถส่งของ (≤500) — **v1.1 มีค่าแล้ว** | `รถบรรทุกเกิน 6 ล้อเข้าไม่ได้` |
| `opened_at` / `closed_at` | Timestamp\|null | ไม่บังคับ | เวลาเปิด / ปิดศูนย์ | `2026-08-09T06:00:00+07:00` |
| `is_active` | Boolean | บังคับ | `false` = ถูกปิดใช้งานแต่ยังอยู่ในทะเบียน | `true` |
| `is_external` | Boolean | บังคับ | บริหารในระบบอื่น | `false` |
| `occupancy_total` | Number | บังคับ | ผู้พักที่อยู่ในศูนย์จริง (`active` + `room_confirmed`) — ความหมายเดิม | `312` |
| `occupancy_forecast` | Number\|null | ไม่บังคับ | **ใหม่** ยอดคาดการณ์ = อยู่ในศูนย์ + ลงทะเบียนล่วงหน้า + กำลังเดินทางมา + ออกชั่วคราว · `null` ดู §6 | `340` |
| `capacity_available` | Number\|null | ไม่บังคับ | **ใหม่** `max(0, capacity − occupancy_forecast)` · `null` เมื่อ `is_external` หรือ `occupancy_forecast = null` · ใช้อ้างอิงเท่านั้น (ศูนย์ที่เต็มยังรับจองได้) | `160` |
| `parking_vehicle_types` | Array\<Text\> | บังคับ | **ใหม่** ประเภทรถที่ศูนย์รับได้ `motorcycle` \| `car` \| `truck` \| `boat` · `[]` = ไม่มีข้อมูลหรือไม่มีที่จอด | `["car","truck"]` |
| `updated_at` | Timestamp | บังคับ | เวลาที่แถวเปลี่ยนล่าสุด (รวมตอนยอดผู้พักเปลี่ยน) | `2026-11-24T09:15:00+07:00` |

\* ODT กำหนดเป็นบังคับ แต่ Shelter อาจยังไม่มีค่า — client ต้องรับ `null` ได้

---

## 4. Data Dictionary — field เพิ่มของ EXT-003 (detail)

| Field | ชนิด | คำอธิบาย |
| --- | --- | --- |
| `facilities` | Array\<Text\> | ข้อความสิ่งอำนวยความสะดวก (เดิม v1.0) เช่น `"ห้องน้ำ 12 ห้อง"` |
| `external_url` | Text\|null | ลิงก์ไประบบต้นทางของศูนย์ที่ `is_external = true` (https) |
| `parking_points` | Array\<Object\> | จุดจอดรถที่ปักหมุดแล้ว — §4.1 |
| `donation_points` | Array\<Object\> | จุดรับของในศูนย์ที่ปักหมุดแล้ว — §4.2 · `[]` = ใช้ตำแหน่งศูนย์เป็นจุดรับของ |
| `area_m2` | Number\|null | พื้นที่ปิดรวม (m²) |
| `area_type` | Text\|null | `indoor` \| `outdoor` \| `hybrid` |
| `power_source` | Text\|null | `city_grid` \| `generator` \| `solar` |
| `water_source` | Text\|null | `city_water` \| `water_tank` \| `groundwater` |
| `communications` | Array\<Text\> | `cellular` \| `wifi` \| `vhf_radio` |
| `vhf_channel` | Text\|null | ช่องวิทยุ VHF |
| `central_kitchen` | Boolean\|null | มีครัวกลาง · `null` = ไม่ได้ระบุ |
| `helipad` | Boolean\|null | มีลานจอดเฮลิคอปเตอร์ · `null` = ไม่ได้ระบุ |
| `logistics_area_m2` | Number\|null | พื้นที่ขนถ่าย / โลจิสติกส์ (m²) |
| `toilets` | Object\|null | `{ male, female, accessible }` — จำนวนห้องน้ำ (Number\|null) |
| `showers` | Number\|null | จำนวนห้องอาบน้ำ |
| `risk` | Object\|null | `{ elevation_m: Number\|null, constraints: Text\|null, secondary_muster_point: Text\|null }` — ความสูงพื้นที่ (m), ข้อจำกัด/ความเสี่ยง, จุดรวมพลสำรอง |
| `vulnerable_groups` | Array\<Text\> | กลุ่มเปราะบางที่ศูนย์รองรับ **ตามที่เจ้าหน้าที่กรอก** (ไม่อนุมานจากข้อมูลอื่น) — code ปัจจุบัน: `bedridden`, `dialysis`, `wheelchair`, `psychiatric`, `elderly_dependent`, `infant`, `young_child`, `pregnant`, `vision_impaired`, `hearing_impaired` (เพิ่มได้ในอนาคต) |
| `pet_policy` | Object\|null | `{ policy: "no_pets"\|"conditional"\|null, categories: [{ category: "small_general"\|"large_dog"\|"livestock", conditions: [Text], max_capacity: Number\|null }] }` · `conditions` เป็น code เงื่อนไขของแต่ละหมวด |
| `luggage_policy` | Object\|null | `{ limitation: "no_limit"\|"limited"\|null, max_per_family: Number\|null, rules: [Text], rules_other: Text\|null }` · `rules`: `valuables_self_responsibility`, `no_hazardous_items`, `no_large_appliances`, `has_temp_storage_service` |
| `zones` | Array\<Object\> | โซนในศูนย์ — §4.3 |

### 4.1 `parking_points[]`

| Field | ชนิด | คำอธิบาย |
| --- | --- | --- |
| `id` | Text | รหัสจุด คงที่ |
| `name` | Text | ชื่อจุด |
| `note` | Text\|null | หมายเหตุ |
| `geo` | `{ lat, lng }` | พิกัด WGS84 |
| `vehicles` | `[{ type, max_capacity }]` | `type`: `motorcycle` \| `car` \| `truck` \| `boat` · `max_capacity`: Number\|null |

### 4.2 `donation_points[]`

| Field | ชนิด | คำอธิบาย |
| --- | --- | --- |
| `id` | Text | รหัสจุด คงที่ |
| `name` | Text | ชื่อจุด |
| `types` | Array\<Text\> | ประเภทของที่รับ: `general`, `baby_food`, `food_dry`, `cooked_food`, `food_cold`, `medical_supplies`, `drinking_water` |
| `geo` | `{ lat, lng }` | พิกัด WGS84 |
| `location_note` | Text\|null | คำอธิบายตำแหน่ง |

### 4.3 `zones[]`

| Field | ชนิด | คำอธิบาย |
| --- | --- | --- |
| `code` | Text\|null | รหัสโซน |
| `name` | Text\|null | ชื่อโซน |
| `type` | Text | `general` \| `male` \| `female` \| `vulnerable` \| `pet` \| `quarantine` |
| `capacity` | Number\|null | ความจุของโซน |
| `status` | Text | `active` \| `closed` |
| `present` | Number\|null | ผู้พักที่อยู่ในโซนขณะนี้ (`active` + `room_confirmed` + `temporary_leave`) · `null` ดู §6 |

---

## 5. ตัวอย่าง

### 5.1 EXT-002 (หนึ่งรายการ)

```json
{
  "location_code": "SH001",
  "name_th": "ศูนย์พักพิงโรงเรียนหาดใหญ่วิทยาลัย",
  "name_short": "รร.หาดใหญ่วิทยาลัย",
  "location_type": "shelter",
  "location_subtype": "school",
  "location_status": "open",
  "latitude": 7.008612,
  "longitude": 100.474733,
  "address": "12 หมู่ 3 ต.คอหงส์ อ.หาดใหญ่ จ.สงขลา",
  "subdistrict_code": "901104",
  "district_code": "9011",
  "province_code": "90",
  "capacity": 500,
  "contact_phone": "074-000000",
  "contact_name": "หัวหน้าศูนย์พักพิง",
  "operating_org": "เทศบาลนครหาดใหญ่",
  "accepts_booking": true,
  "accepts_delivery": true,
  "delivery_note": "รถบรรทุกเกิน 6 ล้อเข้าไม่ได้",
  "opened_at": "2026-08-09T06:00:00+07:00",
  "closed_at": null,
  "is_active": true,
  "is_external": false,
  "occupancy_total": 312,
  "site_kind": "evacuation_center",
  "project_level": "provincial",
  "occupancy_forecast": 340,
  "capacity_available": 160,
  "parking_vehicle_types": ["car", "truck"],
  "updated_at": "2026-11-24T09:15:00+07:00"
}
```

### 5.2 EXT-003 (เฉพาะ field ที่เพิ่มจาก 5.1)

```json
{
  "facilities": ["ห้องน้ำ 16 ห้อง", "ห้องอาบน้ำ 4 ห้อง", "ครัวกลาง", "ไฟฟ้าสำรอง (เครื่องปั่นไฟ)"],
  "external_url": null,
  "parking_points": [
    {
      "id": "01JPARK0000000000000000001",
      "name": "ลานจอดหน้าอาคาร",
      "note": null,
      "geo": { "lat": 7.0087, "lng": 100.4749 },
      "vehicles": [{ "type": "truck", "max_capacity": 2 }]
    }
  ],
  "donation_points": [
    {
      "id": "01JSTOR0000000000000000001",
      "name": "โรงอาหาร",
      "types": ["food_dry", "drinking_water"],
      "geo": { "lat": 7.0085, "lng": 100.4746 },
      "location_note": "ประตู 2"
    }
  ],
  "area_m2": 850.0,
  "area_type": "indoor",
  "power_source": "generator",
  "water_source": "water_tank",
  "communications": ["cellular", "vhf_radio"],
  "vhf_channel": "CH 7",
  "central_kitchen": true,
  "helipad": false,
  "logistics_area_m2": 120.0,
  "toilets": { "male": 6, "female": 8, "accessible": 2 },
  "showers": 4,
  "risk": {
    "elevation_m": 12.0,
    "constraints": "น้ำท่วมทางเข้าเมื่อฝนหนัก",
    "secondary_muster_point": "ลานวัดคอหงส์"
  },
  "vulnerable_groups": ["wheelchair", "pregnant"],
  "pet_policy": {
    "policy": "conditional",
    "categories": [{ "category": "small_general", "conditions": [], "max_capacity": 10 }]
  },
  "luggage_policy": {
    "limitation": "limited",
    "max_per_family": 2,
    "rules": ["no_hazardous_items"],
    "rules_other": null
  },
  "zones": [
    { "code": "Z1", "name": "โซนหญิง", "type": "female", "capacity": 40, "status": "active", "present": 31 },
    { "code": "Z2", "name": "โซนกักตัว", "type": "quarantine", "capacity": 10, "status": "closed", "present": 0 }
  ]
}
```

---

## 6. หมายเหตุการใช้งาน

- **ค่า `null` / `[]` ช่วงหลัง deploy v1.1:** Shelter ประมวลผลข้อมูลศูนย์ทุกแห่งใหม่อัตโนมัติหลัง deploy ระหว่างนั้น
  field ใน §4 (ยกเว้น `facilities`, `external_url`, `parking_points`, `donation_points`) อาจเป็น `null` / `[]` และ
  `occupancy_forecast` / `capacity_available` / `zones[].present` อาจเป็น `null` ชั่วคราว — client ต้องแสดง "ไม่มีข้อมูล" ไม่ใช่ `0`
- **ศูนย์ที่บริหารในระบบอื่น (`is_external = true`):** ไม่มีข้อมูล §4 ส่วนใหญ่ (`null` / `[]`), `capacity_available = null`,
  `accepts_delivery = false`, `accepts_booking = false`
- **`site_kind` และ code ใน enum อื่น (`vulnerable_groups`, `location_subtype`)** มาจาก master data ของ Shelter — เพิ่มได้โดยไม่แจ้งล่วงหน้า
  client ต้องไม่ error เมื่อเจอ code ที่ไม่รู้จัก
- **`test_center` (ศูนย์ทดสอบ)** เป็นประเภทศูนย์ปกติ ไม่ถูกกรองออกจาก EXT-002/003/006 — กรองฝั่ง client ถ้าไม่ต้องการ
- **`updated_since`** ครอบคลุมทุก field ใหม่ — แถวที่ข้อมูลศูนย์หรือยอดผู้พักเปลี่ยนจะมี `updated_at` ใหม่
- **ดึงข้อมูลเต็มหนึ่งครั้งหลัง deploy v1.1:** การประมวลผลใหม่หลัง deploy ไม่รับประกันว่า `updated_at` ของทุกแถวจะขยับ
  client ที่ซิงก์แบบ incremental (`updated_since`) ต้องเรียก EXT-002 โดยไม่ส่ง `updated_since` หนึ่งรอบ (พร้อม
  `include_inactive=true` ถ้าเก็บศูนย์ที่ปิดใช้งานด้วย) เพื่อรับ key ใหม่และค่าใหม่ของ `accepts_delivery` ครบทุกศูนย์

## 7. Endpoint อื่น

EXT-001 (token), EXT-004 (stock), EXT-005 (occupancy), EXT-006 (summary), EXT-007 (occupants), EXT-008–011 (booking /
residency), EXT-012 (person search) **ไม่เปลี่ยนใน v1.1** — ดู [api-contract.md](./api-contract.md) §5.3 และ
[ADR 0002](../adr/0002-partner-integration-architecture.md)
