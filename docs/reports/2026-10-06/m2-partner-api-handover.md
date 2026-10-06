---
title: M2 ⇄ Shelter API — เอกสารส่งมอบ (EXT-001, EXT-002, EXT-008–EXT-011)
status: as-built
version: 1.0
created: 2026-10-06
updated: 2026-10-06
audience: ทีมพัฒนา M2 (ระบบประเมินความพร้อมและจัดการกลุ่มเปราะบาง)
note: ตอบสเปก A_M2_API_SERVICES_SHELTER_V1.0 (20 ส.ค. 2569) — ส่งไฟล์นี้ฉบับเดียวได้; CR-154
---

# M2 ⇄ Shelter API — เอกสารส่งมอบ

## สรุป

- **บริการทั้ง 3 ตัวในสเปก M2 v1.0 พร้อมใช้งาน:**
  - ดึงรายการศูนย์
  - จองศูนย์ พร้อมยกเลิกและดูสถานะ
  - ตรวจสอบการเข้าพัก
- **Auth และรูปแบบ response ใช้ร่วมกับระบบพันธมิตรรายอื่น (M6/M7):**
  - Auth เป็น OAuth2 client credentials → JWT Bearer
  - response อยู่ใน envelope `{status, message, result}`
  - error ให้ใช้ฟิลด์ `code` เป็นหลัก
- **มีส่วนที่ต่างจากสเปก v1.0** ทั้ง path, ชื่อฟิลด์ และ envelope ดูตารางเทียบใน §2
- **การจองเป็นแบบ "รับเข้าคิว"** — `201 BOOKED` หมายถึงระบบรับคำขอแล้ว และจะลงทะเบียนเข้าศูนย์ภายในประมาณ 10 วินาที ผลสุดท้ายดูได้จาก §6

---

## 1. สภาพแวดล้อมและ credentials

| สภาพแวดล้อม | Base URL |
| --- | --- |
| Staging | `https://shelter.importstar.dev` |
| Production | `https://shelter.psu.ac.th` |

ทุก path ด้านล่างต่อท้าย base URL นี้

**Credentials:** ทีม Shelter จะออก `client_id` / `client_secret` ให้ M2 แยกต่างหาก (ไม่แจกในเอกสารนี้) โดย client ของ M2 ได้ scope ดังนี้

| Scope | ใช้กับ |
| --- | --- |
| `location-read` | EXT-002 รายการศูนย์ |
| `booking-write` | EXT-008 / EXT-009 / EXT-010 จอง · ยกเลิก · ดูสถานะ |
| `residency-read` | EXT-011 ตรวจสอบการเข้าพัก |

`booking-write` และ `residency-read` เป็นข้อมูลส่วนบุคคล (PDPA) และออกให้เป็นรายกรณี

---

## 2. เทียบกับสเปก A_M2_API_SERVICES_SHELTER_V1.0

| สเปก M2 v1.0 | Endpoint ที่ใช้จริง | การเปลี่ยนแปลง |
| --- | --- | --- |
| Auth: `Authorization: Bearer <token>` (service account) | ขอ token ที่ `POST /public-api/external/token` แล้วใช้ `Authorization: Bearer <access_token>` | token อายุ 3600 วินาที ต้องขอใหม่เมื่อหมดอายุ (§3) |
| 3.1 `GET /api/v1/shelters?status=open` | `GET /public-api/external/locations?status=open` | ผลอยู่ใน `result` (ไม่ใช่ `data`) และชื่อฟิลด์เปลี่ยนตามตารางด้านล่าง |
| 3.2 `POST /api/v1/shelters/booking` | `POST /public-api/external/bookings` | `shelter_id` → `location_code` · `status` → `booking_status` |
| — | `POST /public-api/external/bookings/{booking_id}/cancel` | **เพิ่มใหม่** — ยกเลิกการจอง |
| — | `GET /public-api/external/bookings/{booking_id}` | **เพิ่มใหม่** — ดูสถานะการจอง |
| 3.3 `GET /api/v1/persons/shelter-residency?cid=` | `GET /public-api/external/persons/shelter-residency?cid=&purpose=` | **บังคับ `purpose`** · `status` → `residency_status` |
| Error `{ "error": { "code", "message" } }` | `{ "status", "message", "code" }` | อ่าน `code` จากระดับบนสุดของ body (§4) |

**ชื่อฟิลด์ที่เปลี่ยน**

| สเปก M2 | ระบบ Shelter |
| --- | --- |
| `shelter_id` | `location_code` |
| `shelter_name` | `name_th` |
| `lat` / `long` | `latitude` / `longitude` |
| `status` (การจอง) | `booking_status` |
| `status` (การเข้าพัก) | `residency_status` |

---

## 3. ขอ access token — EXT-001

```bash
curl -sS -X POST 'https://shelter.importstar.dev/public-api/external/token' \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "<issued-by-shelter>",
    "client_secret": "<issued-by-shelter>"
  }'
```

**200**

```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "module_name": "M2",
  "scopes": ["location-read", "booking-write", "residency-read"]
}
```

- เรียก endpoint อื่นด้วย header `Authorization: Bearer <access_token>`
- ไม่มี refresh token — เมื่อหมดอายุให้ขอ token ใหม่
- `401 invalid_client` หมายถึง `client_id` / `client_secret` ไม่ถูกต้อง หรือ client ถูกเพิกถอน

---

## 4. แบบแผนร่วม

**Success**

```json
{ "status": 200, "message": "Found Data.", "result": { } }
```

**Error** — ให้ใช้ `code` ในการตัดสินใจ และไม่ควรเทียบข้อความใน `message` เพราะอาจเปลี่ยนได้

```json
{ "status": 409, "message": "…", "code": "duplicate_booking" }
```

| HTTP | `code` | ใช้กับ | ความหมาย |
| --- | --- | --- | --- |
| 400 | `missing_purpose` | EXT-011 | ไม่ส่ง `purpose` |
| 401 | `invalid_token` | ทุกตัว | ไม่มี token / token หมดอายุ / token ไม่ถูกต้อง |
| 403 | `insufficient_scope` | ทุกตัว | client ไม่มี scope ที่ endpoint ต้องการ |
| 404 | `location_not_found` | EXT-008 | ไม่พบศูนย์ หรือศูนย์ถูกปิดถาวร |
| 404 | `booking_not_found` | EXT-009 / EXT-010 | ไม่พบ booking (รวมกรณี booking ของ client อื่น) |
| 404 | `residency_not_found` | EXT-011 | ไม่พบการเข้าพัก (รวมกรณีจองแล้วแต่ยังไม่ check-in) |
| 409 | `location_not_bookable` | EXT-008 | ศูนย์ปิด หรือไม่รับการจองล่วงหน้า |
| 409 | `duplicate_booking` | EXT-008 | เลขบัตรนี้มีการจองหรือเข้าพักอยู่แล้วที่ **ศูนย์เดียวกัน** |
| 409 | `booking_not_cancellable` | EXT-009 | ยกเลิกไปแล้ว ถูกปฏิเสธแล้ว หรือผู้จองไปรายงานตัวที่ศูนย์แล้ว |
| 422 | `validation_error` | ทุกตัว | ข้อมูลไม่ครบหรือรูปแบบไม่ถูกต้อง |
| 500 | `internal_error` | ทุกตัว | ระบบขัดข้อง ให้ลองใหม่ภายหลัง |

**รูปแบบข้อมูล**
- วันเวลาเป็น ISO 8601 พร้อม offset `+07:00`
- พิกัดเป็น WGS 84
- ทุกการเรียก EXT-008 ถึง EXT-011 ถูกบันทึกเพื่อการตรวจสอบตาม PDPA (บันทึกตัวตน client, IP และผลลัพธ์ โดยไม่บันทึกเลขบัตรประชาชน)

---

## 5. EXT-002 — รายการศูนย์ (แทน get-list-shelter)

```bash
curl -sS 'https://shelter.importstar.dev/public-api/external/locations?status=open' \
  -H 'Authorization: Bearer <access_token>'
```

**Query parameters**
- `status` — `open` | `full` | `standby` | `closed` ถ้าไม่ส่งจะได้ทุกสถานะ
- `page` / `limit` — ค่าเริ่มต้น 1 / 50 และ `limit` สูงสุด 200

**200 (ย่อ)**

```json
{
  "status": 200,
  "message": "Found Data.",
  "result": [
    {
      "location_code": "SH014",
      "name_th": "ศูนย์พักพิงโรงเรียนหาดใหญ่วิทยาลัย",
      "location_status": "open",
      "latitude": 7.0086,
      "longitude": 100.4747,
      "capacity": 300,
      "occupancy_total": 120,
      "is_active": true
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1, "total_pages": 1 }
}
```

`result[]` มีฟิลด์มากกว่าที่แสดงในตัวอย่าง เช่น ที่อยู่ ผู้ติดต่อ และวันเปิด/ปิดศูนย์ M2 ใช้เฉพาะฟิลด์ที่ต้องการได้ ส่วน `latitude` / `longitude` อาจเป็น `null` เมื่อศูนย์ยังไม่มีพิกัด

ศูนย์ที่สถานะ `full` ยังรับการจองได้ (§6)

---

## 6. การจองศูนย์ — EXT-008 / EXT-009 / EXT-010

### 6.1 EXT-008 จองศูนย์ (แทน booking-shelter)

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

**201**

```json
{
  "status": 201,
  "message": "Booking accepted.",
  "result": { "booking_id": "BK-01M48AM8KGVN69C4Z6K7K38ZZR", "location_code": "SH014", "booking_status": "BOOKED" }
}
```

- **`201 BOOKED` แปลว่ารับเข้าคิวแล้ว** ระบบจะลงทะเบียนผู้จองเข้าศูนย์ภายในประมาณ 10 วินาที ให้เก็บ `booking_id` ไว้ใช้กับ EXT-009 / EXT-010
- **การตรวจซ้ำทำแยกต่อศูนย์** เลขบัตรเดียวกันจองศูนย์เดียวกันซ้ำจะได้ `409 duplicate_booking` แต่จองศูนย์อื่นได้
- **ศูนย์สถานะ `full` ยังจองได้** ส่วนศูนย์ `closed` หรือศูนย์ที่ปิดรับจองล่วงหน้าจะได้ `409 location_not_bookable`

### 6.2 EXT-010 ดูสถานะการจอง

```bash
curl -sS 'https://shelter.importstar.dev/public-api/external/bookings/BK-01M48AM8KGVN69C4Z6K7K38ZZR' \
  -H 'Authorization: Bearer <access_token>'
```

**200**

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
| `CANCELLED` | ยกเลิกแล้ว |
| `REJECTED` | ระบบปฏิเสธตอนลงทะเบียน — ดู `reject_reason` (`duplicate` = พบการจองหรือการเข้าพักของเลขบัตรนี้ที่ศูนย์เดียวกันผ่านช่องทางอื่น) |

ถ้าเคยขอยกเลิกแล้วแต่ยกเลิกไม่สำเร็จ เพราะผู้จองไปรายงานตัวที่ศูนย์ก่อน สถานะจะกลับเป็น `BOOKED` และมี `reject_reason: "not_cancellable"`

### 6.3 EXT-009 ยกเลิกการจอง (เพิ่มจากสเปก)

```bash
curl -sS -X POST 'https://shelter.importstar.dev/public-api/external/bookings/BK-01M48AM8KGVN69C4Z6K7K38ZZR/cancel' \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Content-Type: application/json' \
  -d '{ "reason": "ผู้จองแจ้งยกเลิก" }'
```

- `reason` ไม่บังคับ ยาวได้ไม่เกิน 200 ตัวอักษร และส่ง body ว่างได้
- **200** `result: { "booking_id": "…", "booking_status": "CANCELLED" }`
- ยกเลิกได้เฉพาะ booking ของ client ตัวเอง และเฉพาะตอนที่ผู้จองยังไม่ได้รายงานตัวที่ศูนย์ ถ้าไม่เข้าเงื่อนไขจะได้ `409 booking_not_cancellable`

---

## 7. EXT-011 ตรวจสอบการเข้าพัก (แทน get-person-shelter-residency)

```bash
curl -sS -G 'https://shelter.importstar.dev/public-api/external/persons/shelter-residency' \
  --data-urlencode 'cid=1909800123458' \
  --data-urlencode 'purpose=ประเมินความพร้อมกลุ่มเปราะบาง' \
  -H 'Authorization: Bearer <access_token>'
```

| Query | บังคับ | หมายเหตุ |
| --- | --- | --- |
| `cid` | ✔ | ตัวเลข 13 หลัก |
| `purpose` | ✔ | วัตถุประสงค์ของการตรวจสอบ ใช้บันทึกตาม PDPA ถ้าไม่ส่งจะได้ `400 missing_purpose` |

**200**

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

- ได้ `404 residency_not_found` ในกรณีต่อไปนี้:
  - ไม่พบเลขบัตร
  - **จองแล้วแต่ยังไม่ได้ check-in**
- ถ้าเลขบัตรเดียวกันมีประวัติหลายศูนย์ ระบบจะเลือกศูนย์ที่ยังพักอยู่ก่อน ถ้าไม่มีจะเลือกประวัติที่อัปเดตล่าสุด

---

## 8. ลำดับการใช้งานที่แนะนำ

1. ขอ token (§3) แล้วเก็บไว้ใช้จนหมดอายุ
2. ดึงรายการศูนย์ที่เปิดอยู่ (§5) ให้ผู้ใช้เลือก
3. จองศูนย์ (§6.1) แล้วเก็บ `booking_id`
4. ถ้าต้องการยืนยันผล ให้เรียก §6.2 หลังจองประมาณ 10 วินาที
5. ถ้าผู้จองเปลี่ยนใจก่อนไปถึงศูนย์ ให้ยกเลิก (§6.3)
6. ตรวจสอบว่าผู้จองเข้าพักแล้วหรือยังด้วย §7 ระบบจะตอบ 404 จนกว่าเจ้าหน้าที่ศูนย์จะ check-in
