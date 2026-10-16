---
id: CR-149
title: Kiosk walk-in registration — เสียบบัตรแล้วไม่พบข้อมูล → ลงทะเบียนใหม่ที่ตู้ (stay status `kiosk_registered`)
status: approved
date: 2026-09-27
created: 2026-09-27
updated: 2026-10-15 # ทีม kiosk ขอเลิกกรอง registered_via ของหัวหน้าใน FR-KWR-83 · 2026-10-13 ข้อเสนอแก้ไข §9 approved โดย Dev/Team Lead Soravit Sukkarn (รับ requirement จากหัวหน้าโครงการเมื่อวาน 2026-10-12)
requested_by: ทีม kiosk (branch feat/pre-register_kiosk)
decided_by: Jakee Indapanya (GitHub net-lynx), Project Owner — อนุมัติ 2026-10-03 (Asia/Bangkok)
decision_date: 2026-10-03
layer: volatile
amends:
  - docs/changes/14-kiosk/CR-151-kiosk-pre-registration-check-in.md §3 (แถว "ลงทะเบียน walk-in ที่ kiosk" ย้ายจากนอกขอบเขต → ในขอบเขต เฉพาะช่องทางบัตร) · §1 ข้อ 3 (PDPA — อ่านเฉพาะเลข 13 หลัก → อ่านเต็มหลังได้ consent)
  - docs/features/smart-card-registration-spec.md FR-CARD-01..04 (สร้าง evacuee จากบัตรกลับมา แต่ผ่านปุ่ม + consent และใช้สถานะใหม่)
affects:
  - docs/data/schema.md §1.1 evacuee — `current_stay.status` += `kiosk_registered` · occupancy metrics table · household status derive
  - schema_v evacuee 11 → 12
  - docs/data/schema.md shelter `feature_flags` += `kiosk_walk_in_registration_enabled` (additive, ไม่ bump shelter schema_v — ตาม pattern `kiosk_phone_check_in_enabled`)
  - docs/data/api-contract.md §2.1 — lookup `can_register` + outcome `kiosk_registered` · endpoint ใหม่ `POST /api/v1/scanner/kiosk/register`
  - frontend/src/lib/features/people/{domain,data,ui} (enum, labels, badge, derive, Station 1 transitions)
  - frontend/src/lib/features/kiosk/{domain,data,server,ui} · frontend/src/routes/kiosk/** · frontend/src/routes/api/v1/scanner/kiosk/{lookup,register}
  - frontend/src/lib/features/scanners/server.ts (reuse `processCardScan` mapping) · features/shelters (flag)
  - frontend/src/lib/features/{system-overview,public-portal,public-register,dashboard}/domain (occupancy/forecast sets)
  - worker/src/worker/projectors/evacuee.py · backend/apiapp/modules/{external,shelter,transparency,evacuee}
  - scanner_client/app/{manager,scard}.py · scanner_client/tests
  - (§9 proposed) frontend/src/lib/features/kiosk/server/kiosk-register.server.ts · domain/walk-in-address.ts · application/walk-in-registration.ts · walk-in-session.svelte.ts · ui/kiosk-register-phone.svelte (+ tests)
  - (§9 proposed) frontend/src/routes/api/v1/kiosk/register/+server.ts · frontend/src/routes/kiosk/register/{phone,done}/+page.svelte
  - (§9 proposed) frontend/src/lib/features/people/domain/people.ts (`createKioskEvacueeFromCard` → `arriving`, `createKioskWalkInHousehold`, `autoHouseholdLabel`)
  - (§9 proposed) kiosk/app/scard.py (`split_card_address`) · kiosk/tests/test_card_address.py
why: >
  ผู้ประสบภัยที่ไม่ได้ลงทะเบียนล่วงหน้าเสียบบัตรที่ kiosk แล้วได้แค่ "ไม่พบข้อมูล" ต้องไปต่อคิว Station 1
  และให้เจ้าหน้าที่พิมพ์ข้อมูลจากบัตรเองทั้งหมด kiosk มีเครื่องอ่านชิปอยู่แล้ว จึงสร้าง record เบื้องต้นจากบัตรได้ทันที
  โดยให้ผู้ใช้กดยืนยันเองก่อน และติดสถานะแยกให้เจ้าหน้าที่รู้ว่ายังไม่ได้ตรวจสอบ
migration: >
  purely additive enum — doc schema_v ≤11 อ่านได้โดยไม่ backfill; เขียนใหม่ stamp schema_v 12.
  ร่างเดิมเขียน 10→11; CR-148 ใช้ schema_v 11 ไปแล้วบน develop (2026-10-03)
note: >
  ไฟล์แผน implement docs/features/kiosk-walk-in-registration-implementation-plan.md ไม่มีใน repo
  จึงไม่ได้อยู่ใน change นี้
---

# CR-149: Kiosk walk-in registration (`kiosk_registered`)

> **สถานะ:** approved เป็น spec เมื่อ 2026-10-03 (Asia/Bangkok) โดย Project Owner Jakee Indapanya (GitHub net-lynx) · ยังไม่ implement

> **ข้อเสนอแก้ไข 2026-10-12/13 (approved โดย Team Lead):** §9 ด้านล่าง — Soravit Sukkarn (Team Lead) อนุมัติแล้ว โดยรับ requirement จากหัวหน้าโครงการเมื่อ 2026-10-12: บล็อกเบอร์ซ้ำ · walk-in ได้ household จากที่อยู่บนบัตร/ThaiD และเข้าครัวเรือนที่ที่อยู่ตรงกัน · walk-in เป็น `arriving` + พิมพ์ QR · แก้ Q3 / Q4 / FR-KWR-18..21 / FR-KWR-26 / FR-KWR-31 / FR-KWR-41..42

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** ช่องทางบัตรประชาชนของ kiosk — ถ้าเลข 13 หลักไม่มี record ใด ๆ ในศูนย์ ให้แสดงปุ่ม「ลงทะเบียนใหม่」→ หน้า consent → อ่านชิปเต็ม (ชื่อ เพศ วันเกิด ที่อยู่ รูป) → สร้าง `evacuee` ใหม่ `current_stay.status = 'kiosk_registered'`, `registered_via: 'kiosk'`, `household_id: null`, `phone: null`
> - **เพื่อใคร / ทำไม:** walk-in ไม่ต้องให้เจ้าหน้าที่พิมพ์ข้อมูลบัตรเอง · Station 1 เห็นคิว「ลงทะเบียนที่ตู้ (รอยืนยัน)」แยกชัด แล้วเติมเบอร์/ครัวเรือนก่อนส่งต่อ (`kiosk_registered → arriving`)
> - **Dev ต้อง build:** enum ใหม่ + label/badge/metric ทุกจุด · lookup แยก "ไม่มี record" กับ "มีแต่ไม่เข้าเงื่อนไข" · endpoint `POST /api/v1/scanner/kiosk/register` · UI consent/เสียบบัตร/ผล · `scanner_client` อ่านเต็มเมื่ออยู่หน้าลงทะเบียน · Station 1 รับ `kiosk_registered` เป็นสถานะต้นทาง
> - **กระทบ schema / scope:** evacuee `schema_v 11 → 12` (additive; CR-148 ใช้ 10→11 ไปแล้ว) · shelter flag ใหม่ (additive) · กลับทิศบางส่วนของ draft kiosk pre-registration check-in §1.3/§3 · อยู่นอก phase ปัจจุบัน → backlog จนกว่าเจ้าของสั่ง implement

---

## 1. Why

1. **Walk-in ยังเป็นส่วนใหญ่ในวันเกิดเหตุ:** kiosk ปัจจุบัน (draft kiosk pre-registration check-in) รับเฉพาะผู้จองทางเว็บ walk-in ที่เสียบบัตรได้แค่ข้อความ「ไม่พบผู้ลงทะเบียนล่วงหน้าในศูนย์นี้」
2. **ข้อมูลบัตรมีอยู่แล้วที่เครื่อง:** `scanner_client` อ่านชิปได้ครบ (`read_all_data`) และโค้ดแปลงบัตร → `card_snapshot` ของ CR-097 ยังอยู่ (`scanners/server.ts` `processCardScan`, `people.ts` `createKioskEvacueeFromCard`)
3. **แก้ปัญหาเดิมของ CR-097 ที่ทำให้ถูกยกเลิก:**
   - record ซ้อนกับผู้จองเว็บ → ปุ่มแสดงเฉพาะเมื่อ **ไม่มี record ใดเลย** ของเลขบัตรนี้ในศูนย์ (FR-KWR-02)
   - ปะปนกับผู้จองล่วงหน้าใน `pre_registered` → ใช้สถานะแยก `kiosk_registered` (FR-KWR-20)
   - PDPA อ่านเกินจำเป็น → อ่านเต็มเฉพาะหลังผู้ใช้กดลงทะเบียนและยินยอม (FR-KWR-10..12)
4. **ทำไมเป็น stay status ไม่ใช่แค่ `registered_via`:** `registered_via` บอกช่องทาง ไม่บอกตำแหน่งใน pipeline · ถ้าใช้ `arriving` + `registered_via:'kiosk'` คิว screening/zone จะรับคนที่ยังไม่มีเบอร์และครัวเรือนต่อทันที (ข้าม Station 1) — สถานะแยกทำให้ทุก query บังคับได้ด้วย status เดียว · Project Owner เคาะให้ใช้ชื่อ `kiosk_registered` (Q10)

---

## 2. ก่อน → หลัง

| หัวข้อ                          | ก่อน                                                      | หลัง                                                                                    |
| :------------------------------ | :-------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| เสียบบัตร ไม่พบ record          | 404 `PRE_REGISTRATION_NOT_FOUND` → 「ลองอีกครั้ง / กลับ」 | 404 เดิม + `can_register` · ถ้า `true` แสดงปุ่ม「ลงทะเบียนใหม่」                        |
| ข้อมูลที่อ่านจากชิป             | เลข 13 หลักเท่านั้น                                       | เลข 13 หลัก (lookup) · อ่านเต็มแบบ CR-097 **หลัง consent** เท่านั้น                     |
| Doc ที่ kiosk สร้าง             | ไม่สร้าง                                                  | `evacuee` ใหม่ `kiosk_registered` + `card_snapshot`                                     |
| `current_stay.status`           | 9 ค่า                                                     | 10 ค่า (+ `kiosk_registered`)                                                           |
| เสียบบัตรซ้ำหลังลงทะเบียนที่ตู้ | ไม่พบ (lookup กรอง `registered_via:'web'`)                | outcome `kiosk_registered` → หน้าจอสีเหลือง「ลงทะเบียนที่ตู้แล้ว กรุณาไปพบเจ้าหน้าที่」 |
| Station 1                       | ไม่เห็น kiosk walk-in                                     | คิว/Badge「ลงทะเบียนที่ตู้ (รอยืนยัน)」→ เติมข้อมูล → `arriving`                        |

**ไม่เปลี่ยน:** device auth (`X-Device-Id`/`X-Device-Secret`) · QR / เบอร์โทร flow · web pre-registration report-in (`pre_registered → arriving`) · `_id` pattern `evacuee:{ulid}` · envelope

---

## 3. ขอบเขต

| ในขอบเขต                                      | นอกขอบเขต                                                                                      |
| :-------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| ช่องทางบัตรประชาชน (smart-card) เท่านั้น      | ลงทะเบียนใหม่จากช่องทาง QR / เบอร์โทร / ThaiD                                                  |
| สร้าง evacuee รายบุคคล (`household_id: null`) | สร้าง/เลือกครัวเรือนบน kiosk · เพิ่มสมาชิกที่ไม่มีบัตร                                         |
| Station 1 ยืนยันและเติมข้อมูล → `arriving`    | กรอกเบอร์ / คัดกรองสุขภาพบน kiosk                                                              |
| Shelter flag เปิด/ปิด (FR-KWR-01)             | ค้นใน Unassigned pool (Mongo) จาก kiosk — ให้ Station 1 federated search (CR-115) จับตอนยืนยัน |
| — (พิมพ์ QR label: มติ Q4 พักไว้ ไม่อยู่ในรอบนี้) | Kiosk edge/offline                                                                             |

---

## 4. Requirements

รหัส `FR-KWR-*` (Kiosk Walk-in Registration)

### 4.1 การเปิดใช้งาน

| ID        | Requirement                                                                                                                                                                                                                                            |
| :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KWR-01 | เพิ่ม `shelter.feature_flags.kiosk_walk_in_registration_enabled` (bool, default `false`, ไม่มี key = `false`) · `POST /api/v1/scanner/kiosk/config` คืน `walk_in_registration_enabled` · toggle อยู่ในหน้า shelter basic info ข้าง flag phone check-in |

### 4.2 Lookup — แยก "ไม่มี record" (ช่องทางบัตร)

| ID        | Requirement                                                                                                                                                                                                                                                                               |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KWR-02 | `lookup` `source:'smart-card'`: ถ้า `_find` (`type:'evacuee'`, `person_id.number`, `shelter_code` ของเครื่อง) ได้ **0 doc** และ flag เปิด → 404 `PRE_REGISTRATION_NOT_FOUND` พร้อม `can_register: true` · กรณีอื่นทุกกรณี `can_register: false` (field additive; client เดิมไม่อ่านก็ได้) |
| FR-KWR-03 | ถ้าพบ doc ที่ `current_stay.status = 'kiosk_registered'` → 200 `{ kind: 'kiosk_registered', shelter_code, member: KioskEvacueeSummary }` (นามสกุลปิดบางส่วนตาม FR-KPC-28, ไม่มี `phone`/`person_id`/ที่อยู่)                                                                              |
| FR-KWR-04 | พบ doc อื่นที่ไม่เข้าเงื่อนไข report-in (staff-registered, `checked_out`, `cancelled`, `transferred`, `deceased`) → 404 เดิม `can_register: false` → หน้าจอ「กรุณาติดต่อเจ้าหน้าที่」ไม่มีปุ่มลงทะเบียน                                                                                   |
| FR-KWR-05 | Couch `_find` ล้มเหลว → 503 (fail-closed) ห้ามตีความเป็น "ไม่พบ"                                                                                                                                                                                                                          |

### 4.3 Consent และอ่านบัตรเต็ม

| ID        | Requirement                                                                                                                                                                                                             |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KWR-10 | กด「ลงทะเบียนใหม่」→ หน้า consent แสดงรายการข้อมูลที่จะอ่าน (ชื่อ-นามสกุล, เลขบัตร, เพศ, วันเกิด, ที่อยู่ตามบัตร, รูปถ่าย) และวัตถุประสงค์ · ปุ่ม「ยินยอมและลงทะเบียน」/「ยกเลิก」 · ยกเลิก = กลับ `/kiosk` ไม่อ่านบัตร |
| FR-KWR-11 | หลังยินยอม → หน้า「เสียบบัตรค้างไว้」 · `scanner_client` อ่านเต็ม (`read_all_data`) **เฉพาะเมื่อหน้าปัจจุบันเป็น path ลงทะเบียน** · path อื่นยังอ่านเลข 13 หลักอย่างเดียว                                               |
| FR-KWR-12 | เลขบัตรจากการอ่านเต็มต้องตรงกับเลขที่ lookup ไว้ · ไม่ตรง → แสดง「บัตรไม่ตรงกับที่ค้นหา」และกลับ `/kiosk` ไม่สร้าง doc                                                                                                  |
| FR-KWR-13 | ข้อมูลบัตรเต็มอยู่ใน memory ของ browser/`scanner_client` เท่านั้น ห้าม log ห้ามเขียนดิสก์ · ล้างเมื่อสำเร็จ ยกเลิก หรือ idle timeout                                                                                    |
| FR-KWR-14 | Idle timeout 60 วินาที (FR-KPC-14) ใช้กับหน้า consent, เสียบบัตร และผล                                                                                                                                                  |

### 4.4 Endpoint `POST /api/v1/scanner/kiosk/register`

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| :--------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KWR-15  | Body = `smartCardDataSchema` + `consent: true` (literal) · ผิด schema → 400 `INVALID_GATE_INPUT`                                                                                                                                                                                                                                                                                                                                                                        |
| FR-KWR-16  | Device auth เดียวกับ `/kiosk/*` · shelter มาจากเครื่องเท่านั้น · flag ปิด → 403 `KIOSK_METHOD_DISABLED` · rate limit ต่อเครื่อง → 429 `KIOSK_RATE_LIMITED` + `retry-after` · `cache-control: no-store`                                                                                                                                                                                                                                                                  |
| FR-KWR-17  | Server ค้นเลขบัตรซ้ำก่อนเขียนทุกครั้ง: ไม่มี → สร้าง (201) · มี `kiosk_registered` → 200 คืน doc เดิม `created:false` (idempotent) · มี record อื่น → 409 `KIOSK_REGISTRATION_BLOCKED` · Couch error → 503                                                                                                                                                                                                                                                              |
| FR-KWR-18  | Doc ที่สร้าง: `schema_v: 12`, `registered_via:'kiosk'`, `current_stay:{status:'kiosk_registered', zone:null, since:now}`, `household_id:null`, `phone:null`, `country:'THAILAND'`, `person_id:{cardType:'national_id', number}`, ชื่อ/เพศ/`birth_year` (พ.ศ.)/`age` จากบัตร, `card_snapshot` ตาม `cardSnapshotSchema` (รวมที่อยู่ + `photo_base64`) + `consented_at` (ts ที่กดยินยอม, additive), `privacy:{search_excluded:false}`, `created_by` = principal ของเครื่อง |
| FR-KWR-19  | Response: `{ shelter_code, created, member: KioskEvacueeSummary, qr_payload: 'evacuee:<ULID>' }` · ไม่มี PII เกิน FR-KPC-25                                                                                                                                                                                                                                                                                                                                             |
| FR-KWR-19a | `scanner_client` allowlist เติม credential ให้ path นี้ (FR-KPC-06)                                                                                                                                                                                                                                                                                                                                                                                                     |

### 4.5 สถานะ `kiosk_registered`

| ID        | Requirement                                                                                                                                                                                                     |
| :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KWR-20 | เพิ่ม `kiosk_registered` ใน `current_stay.status` · label ไทย「ลงทะเบียนที่ตู้ (รอยืนยัน)」 · badge สีโทน pending (amber) แยกจาก `pre_registered`                                                               |
| FR-KWR-21 | Transition ที่อนุญาต: `kiosk_registered → arriving` (Station 1 ยืนยันเสร็จ) · `kiosk_registered → cancelled` (เจ้าหน้าที่ปฏิเสธ/ยกเลิก — Q6) · ห้าม kiosk report-in (`checkInSelectedMembers`) promote สถานะนี้ |
| FR-KWR-22 | Occupancy: นับใน **Forecast** · ไม่นับ Present / In-zone / Kitchen / `daily_calc` (Q2)                                                                                                                          |
| FR-KWR-23 | `deriveHouseholdStatus`: สมาชิก `kiosk_registered` ให้ผลเท่ากับ `pre_registered` (ไม่เพิ่ม household enum) — กันพลาดทุกทางเลือกของ Q3 — ห้าม fall through เป็น `cancelled`                                      |
| FR-KWR-24 | Booking gate (`ACTIVE_HOLD_STATUSES`) นับ `kiosk_registered` เป็น hold → web booking เลขบัตรเดียวกันถูกจับว่าซ้ำ                                                                                                |
| FR-KWR-25 | External CID residency (`/external/v1`) ถือ `kiosk_registered` เป็น "ยังไม่เข้าพัก" (404 เหมือน `pre_registered`)                                                                                               |
| FR-KWR-26 | ไม่เข้าคิวคัดกรองสุขภาพ/จัดโซน จนกว่าเป็น `arriving` (Q8)                                                                                                                                                       |

### 4.6 Station 1

| ID        | Requirement                                                                                                                                                                                                                                 |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-KWR-30 | คิว「รอรับรายงานตัว」แสดง `kiosk_registered` (badge FR-KWR-20 + `RegisteredViaBadge kiosk`) · channel filter kiosk นับรวม                                                                                                                   |
| FR-KWR-31 | เปิดแถว `kiosk_registered` → flow report-in/registration shell เดียวกับ `pre_registered`: autofill Step 2/3 จาก `card_snapshot` (CR-097 as-built) · บังคับกรอกเบอร์ (หรือ「ไม่มี」) และครัวเรือน · submit → `arriving` + ผูก `household_id` |
| FR-KWR-32 | Federated anti-dupe (CR-115) ทำงานกับ record นี้ตอนเปิด — พบใน Unassigned pool → เจ้าหน้าที่ claim/merge ก่อน submit                                                                                                                        |
| FR-KWR-33 | Station 1 submit (`kiosk_registered → arriving`): ย้ายรูปจาก `card_snapshot.photo_base64` เป็น `image:{ulid}` แล้วตั้ง `evacuee.photo` · ลบ `photo_base64` ออกจาก `card_snapshot` ในการเขียนเดียวกัน · field อื่นใน `card_snapshot` คงไว้   |

### 4.7 หน้าจอ kiosk

| ID        | Requirement                                                                                                                                                                              |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KWR-40 | ไม่พบ + `can_register:true` → กล่องสีเหลือง「ไม่พบข้อมูลลงทะเบียนล่วงหน้า」+ ปุ่มหลัก「ลงทะเบียนใหม่」+ ปุ่ม「กลับ」 · `can_register:false` → ข้อความ「กรุณาติดต่อเจ้าหน้าที่」+「กลับ」 |
| FR-KWR-41 | สำเร็จ → สีเขียว「ลงทะเบียนสำเร็จ กรุณาไปพบเจ้าหน้าที่ที่จุดลงทะเบียน」+ ชื่อ (นามสกุลปิดบางส่วน) + ปุ่มพิมพ์ QR label (มติ Q4: พักไว้ — ยังไม่ทำในรอบนี้)                              |
| FR-KWR-42 | เสียบบัตรซ้ำ (FR-KWR-03) → สีเหลือง「ท่านลงทะเบียนที่ตู้แล้ว กรุณาไปพบเจ้าหน้าที่」+ พิมพ์ QR ซ้ำได้ (มติ Q4: พักไว้ — ยังไม่ทำในรอบนี้) · ไม่สร้าง doc ใหม่                            |
| FR-KWR-43 | 409 `KIOSK_REGISTRATION_BLOCKED` → 「กรุณาติดต่อเจ้าหน้าที่」 · 503 → 「ระบบไม่พร้อม ลองใหม่」                                                                                           |
| FR-KWR-44 | ใช้งานครบโดยไม่ scroll ที่ 1024×600 และ 540×960 (FR-KPC-13)                                                                                                                              |

---

## 5. Acceptance

- **AC-KWR-01** flag ปิด: ไม่พบ record → ไม่มีปุ่มลงทะเบียน · เรียก `/register` ตรง → 403
- **AC-KWR-02** flag เปิด, เลขบัตรไม่มีในศูนย์ → ปุ่มขึ้น → consent → เสียบบัตร → doc ใหม่ `kiosk_registered` + `card_snapshot` ครบ + `schema_v 12`
- **AC-KWR-03** กดยกเลิกที่ consent → ไม่มีการอ่านเต็ม (log scanner_client ไม่มี `read_all_data`) ไม่มี doc
- **AC-KWR-04** เสียบบัตรซ้ำหลังลงทะเบียน → outcome `kiosk_registered` ไม่เกิด doc ที่ 2 · เรียก `/register` ซ้ำ → 200 `created:false`
- **AC-KWR-05** เลขบัตรมี record staff/`checked_out`/`cancelled` → ไม่มีปุ่ม · `/register` → 409
- **AC-KWR-06** อ่านเต็มได้เลขบัตรไม่ตรง lookup → ไม่สร้าง doc
- **AC-KWR-07** Station 1 เห็นแถว → เติมเบอร์ + ครัวเรือน → `arriving` · household ที่มีแต่สมาชิก `kiosk_registered` derive เป็น `pre-registered` ไม่ใช่ `cancelled`
- **AC-KWR-08** Dashboard Forecast นับเพิ่ม 1 · Present/Kitchen ไม่เปลี่ยน · `/external/v1` residency ของ CID นี้ → 404
- **AC-KWR-09** Couch ล่มระหว่าง lookup/register → 503 ไม่สร้าง doc
- **DoD:** `pnpm lint` · `pnpm check` 0 error · `pnpm test` · `svelte-autofixer` ทุก `.svelte` ที่แตะ · `uv run pytest` (`backend/`, `worker/`, `scanner_client/`) · ทดสอบบน kiosk จริง (ไฟล์แผน implement ไม่อยู่ใน change นี้)

---

## 6. Impact

ไฟล์แผน implement `docs/features/kiosk-walk-in-registration-implementation-plan.md` ไม่มีใน repo จึงไม่ได้อยู่ใน change นี้. สรุป:

| พื้นที่          | กระทบ                                                                                                                                                                                            |
| :--------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec             | `schema.md` §1.1 (enum, occupancy table, derive, migration) + shelter `feature_flags` · `api-contract.md` §2.1 · `smart-card-registration-spec.md` · draft kiosk pre-registration check-in §1/§3 |
| people           | `stayStatusSchema`, `STATUS_LABELS`, badge/short-label maps, `deriveHouseholdStatus`, `promoteReportIn`, `submitFamilyReportIn`, queue view/navigation, intake-search, cancel                    |
| kiosk            | lookup branch, `/register` route, consent/insert/result UI, config flag                                                                                                                          |
| metrics          | system-overview, public-portal transparency/stay-status, booking gate, dashboard occupancy                                                                                                       |
| worker / backend | external residency guard, Forecast sets (shelter, transparency), public stay labels                                                                                                              |
| scanner_client   | full-read path trigger, allowlist, tests                                                                                                                                                         |

---

## 7. Migration

- **evacuee schema_v 11 → 12:** purely additive enum `kiosk_registered` · doc เดิมอ่านได้ไม่ต้อง backfill · เขียนใหม่ stamp 12 · `validate_doc_update` ไม่มี enum stay status (ไม่ต้อง redeploy design doc) · view `occupancy` emit status ตรงตัว → key ใหม่โผล่เอง
- ร่างเดิมระบุ `schema_v 10 → 11` · บน `develop` วันที่ 2026-10-03 [CR-148](../00-baseline/CR-148-pre-register-validation-and-fields.md) stamp evacuee `schema_v 11` ไปแล้ว (`religion_other`, `disability_other_detail`) ดังนั้น enum นี้ใช้เลขถัดไป
- **shelter `feature_flags.kiosk_walk_in_registration_enabled`:** additive, ไม่มี key = `false`, ไม่ bump
- **Mongo projection:** `public_*` รับค่า status ใหม่เป็น string อยู่แล้ว · backend set ที่ enumerate ต้องอัปเดตก่อน deploy worker ที่เขียนค่านี้ (ลำดับ deploy: backend → frontend)

---

## 8. มติ Project Owner

Project Owner Jakee Indapanya (GitHub net-lynx) เคาะทุกข้อด้านล่างเมื่อ **2026-10-03 (Asia/Bangkok)** ตรงตามข้อเสนอของทีม kiosk. ค่าเหล่านี้เป็นข้อกำหนดแล้ว และถูกเข้ารหัสไว้ใน requirement ด้านบน.

| #   | คำถาม                                                                                                    | มติ                                                                                                                         | FR                   |
| :-- | :------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :------------------- |
| Q1  | มี shelter flag เปิด/ปิด walk-in ที่ kiosk หรือเปิดทุกศูนย์                                              | flag ต่อศูนย์ `kiosk_walk_in_registration_enabled` ค่าเริ่มต้นปิด (ไม่มี key = `false`)                                     | FR-KWR-01            |
| Q2  | นับ `kiosk_registered` ใน occupancy ชุดไหน                                                               | Forecast เท่านั้น (ไม่นับ Present / In-zone / Kitchen / `daily_calc`)                                                       | FR-KWR-22            |
| Q3  | kiosk ลงทะเบียนแบบบัตรละ 1 คน หรือเสียบต่อกันหลายใบเป็นครอบครัว                                          | A — บัตรละ 1 คน `household_id: null` · Station 1 รวมครัวเรือนภายหลัง (§8.1) · ไม่ใช้ B และไม่ใช้ C                          | FR-KWR-23, FR-KWR-31 |
| Q4  | พิมพ์ QR label ให้ walk-in หลังลงทะเบียนไหม                                                              | พักไว้ ไม่อยู่ในรอบนี้                                                                                                      | FR-KWR-41/42         |
| Q5  | เลขบัตรที่มี record `cancelled`/`checked_out` อยู่แล้ว — ให้ kiosk เปิด record เดิมใช้ใหม่แบบ CR-097 ไหม | ไม่เปิดใช้ใหม่ — ส่งไปเจ้าหน้าที่ · ไม่มีปุ่มลงทะเบียน                                                                      | FR-KWR-04/17         |
| Q6  | เจ้าหน้าที่ยกเลิก/ปฏิเสธ `kiosk_registered` ได้ไหม                                                       | ได้ — ใช้ flow ยกเลิก pre-registration เดิม → `cancelled` (audit `previous_status` ตามค่าจริง)                              | FR-KWR-21            |
| Q7  | เก็บหลักฐาน consent ไหม และลบรูปจากบัตรเมื่อไร                                                           | เก็บ `card_snapshot.consented_at` · ตอน Station 1 submit ย้าย `photo_base64` ไป `evacuee.photo` แล้วลบออกจาก `card_snapshot` ในการเขียนเดียวกัน · field อื่นคงไว้ | FR-KWR-18, FR-KWR-33 |
| Q8  | `kiosk_registered` เข้าคิวคัดกรองสุขภาพได้เลยไหม                                                         | ไม่ได้ — ต้องเป็น `arriving` ก่อน (ผ่าน Station 1)                                                                          | FR-KWR-26            |
| Q10 | ชื่อสถานะ                                                                                                | `kiosk_registered` · ไม่ใช้ `arriving` + `registered_via` อย่างเดียว · ไม่ใช้ชื่อ `kiosk_walk_in`, `kiosk_pending`, `self_registered` | FR-KWR-20            |
| Q11 | ข้อมูลที่อ่านจากบัตรหลัง consent                                                                         | เต็มแบบ CR-097 (ชื่อ เพศ วันเกิด ที่อยู่ รูป) · ไม่ใช้ชุดขั้นต่ำ                                                            | FR-KWR-10, FR-KWR-18 |
| Q12 | ถามเบอร์โทรบน kiosk ไหม                                                                                  | ไม่ถาม — `phone: null` · Station 1 เติมเบอร์ (หรือ「ไม่มี」) ก่อน promote เป็น `arriving`                                   | FR-KWR-18, FR-KWR-31 |
| Q13 | วิธี track การเปลี่ยน                                                                                    | ไฟล์ CR นี้ · แผน implement ไม่มีใน repo จึงไม่ได้อยู่ใน change นี้                                                         | —                    |

### 8.1 Q3 — ครัวเรือน: เคาะทางเลือก A

| ทางเลือก                                       | kiosk ทำอะไร                                                                                                                                                                     | ข้อดี                                                                                                           | ข้อเสีย                                                                                                                                   |
| :--------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **A. บัตรละ 1 คน** ⭐ เคาะแล้ว                 | สร้าง evacuee ทีละคน `household_id: null`                                                                                                                                        | ง่ายสุด · ไม่มี field ใหม่                                                                                      | Station 1 ต้องค้นหาและรวมสมาชิกทีละคนเอง (`PullPreRegisteredDialog`)                                                                      |
| **B. เสียบต่อเนื่อง + group id** — ไม่ใช้      | หลังลงทะเบียนสำเร็จมีปุ่ม「ลงทะเบียนคนในครอบครัวต่อ」→ consent + เสียบบัตรคนถัดไป · ทุกคนในรอบเดียวกันได้ `card_snapshot.kiosk_group_id` เดียวกัน · **ไม่สร้าง `household` doc** | Station 1 ดึงทั้งกลุ่มได้ครั้งเดียว แล้วสร้างครัวเรือนตอน submit · ไม่มีครัวเรือนที่ยังไม่ผ่านการตรวจค้างในระบบ | เพิ่ม field (additive ใน `card_snapshot`) · kiosk flow ยาวขึ้น                                                                            |
| **C. เสียบต่อเนื่อง + สร้าง household ที่ตู้** — ไม่ใช้ | สร้าง `household` จริง (label อัตโนมัติ, หัวหน้า = คนแรก) แล้วผูกทุกคน                                                                                                           | Station 1 เห็นครัวเรือนทันที                                                                                    | ครัวเรือนยังไม่ผ่านการตรวจ (คนแปลกหน้าที่ต่อคิวกันอาจถูกรวม) · ยกเลิกแล้วเหลือ household กำพร้า · ที่อยู่ตามบัตรไม่ใช่ Residence (CR-106) |

ทุกทางเลือก: เด็กหรือคนที่ไม่มีบัตร Station 1 เป็นคนเพิ่ม · consent ต้องทำรายคน (เจ้าของบัตรแต่ละใบ) · FR-KWR-23 (derive ไม่ตกเป็น `cancelled`) ยังต้องมีไว้กันพลาด แม้ A จะไม่ผูกครัวเรือนที่ kiosk

---

## 9. ข้อเสนอแก้ไข 2026-10-12/13 (approved โดย Team Lead)

> **สถานะ:** approved โดย Soravit Sukkarn (Team Lead) — รับ requirement จากหัวหน้าโครงการเมื่อ 2026-10-12 · implement แล้วบน branch `refactor-kiosk-cleanup` · แผน: [`kiosk-walk-in-phone-duplicate-household-implementation-plan.md`](../../plans/kiosk-walk-in-phone-duplicate-household-implementation-plan.md), [`kiosk-feedback-walk-in-reprint-implementation-plan.md`](../../plans/kiosk-feedback-walk-in-reprint-implementation-plan.md)

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** (1) เบอร์ที่ walk-in กรอกซ้ำกับคนที่ยังอยู่ในศูนย์ → ไม่บันทึก (2) walk-in ได้ `household` จากที่อยู่บนบัตร/ThaiD — ที่อยู่ตรงกับครัวเรือนที่ตู้สร้างไว้ → เข้าครัวเรือนนั้น หัวหน้าคงเดิม (3) walk-in ได้สถานะ `arriving` ทันที (ตู้ไม่สร้าง `kiosk_registered`) และพิมพ์ QR label ที่หน้าสุดท้าย (4) `scanner_client` เก็บถนนจากชิปถูกช่อง
> - **เพื่อใคร/ทำไม:** walk-in ได้ QR เหมือนคนจองล่วงหน้า ไม่ต้องรอ Station 1 · ครอบครัวที่มาทีละคนรวมกันเอง · Station 1 ไม่ต้องพิมพ์ที่อยู่จากบัตรซ้ำ
> - **Dev ต้อง build:** ตรวจเบอร์ซ้ำ · household + join ใต้ lock ที่อยู่ · status `arriving` + response `qr_payload`/`label` · หน้า `/kiosk/register/done` พิมพ์ label · `split_card_address` ใน `scard.py`
> - **กระทบ schema:** ไม่ bump `schema_v` · ไม่มี field ใหม่ · `kiosk_registered` คงอยู่ใน enum ให้ doc เก่า แต่ตู้ไม่สร้างค่านี้อีก

**แก้ข้อเดิม:** Q3 (A → household จากที่อยู่ + merge) · Q4 (พักไว้ → พิมพ์ทันที) · Q8/Q10 (walk-in เข้า `arriving` ไม่ผ่าน `kiosk_registered`) · FR-KWR-18 (`household_id`, `current_stay.status`) · FR-KWR-19 (response) · FR-KWR-20/21 (ตู้ไม่สร้าง `kiosk_registered`) · FR-KWR-26 · FR-KWR-31 (Station 1 ไม่ต้องยืนยัน walk-in ก่อนคัดกรอง) · FR-KWR-41/42 (พิมพ์ QR)

### 9.1 เบอร์ซ้ำ

| ID        | Requirement                                                                                                                                                                                                             |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KWR-50 | `POST /api/v1/kiosk/register` (ทั้ง `source: 'smart-card'` และ `'thaid'`) ที่มี `phone` ≠ null ต้องตรวจว่ามี `evacuee` ใน shelter DB ของตู้ที่ `phone` เท่ากับเบอร์ canonical หรือรูป legacy `+66…` หรือไม่             |
| FR-KWR-51 | นับเป็นซ้ำเฉพาะ evacuee ที่ `current_stay.status` ∈ {`pre_registered`, `kiosk_registered`, `arriving`, `active`, `room_confirmed`, `temporary_leave`} · `checked_out` / `cancelled` / `transferred` / `deceased` ไม่นับ |
| FR-KWR-52 | ตรวจเฉพาะ `evacuee.phone` — ไม่ตรวจ `emergency_contact.phone` และไม่ตรวจข้ามศูนย์                                                                                                                                       |
| FR-KWR-53 | เบอร์ซ้ำ → `409 { error: { code: 'KIOSK_PHONE_DUPLICATE', message: 'เบอร์โทรศัพท์นี้ถูกใช้ลงทะเบียนแล้ว กรุณากรอกเบอร์อื่น หรือกด「ไม่มีเบอร์」' } }` และต้องไม่เขียน doc ใด ๆ (image / household / evacuee)            |
| FR-KWR-54 | ตรวจหลังเช็คเลขบัตรซ้ำ (FR-KWR-17) และก่อนเขียน image ภายใต้ lock `kiosk_reg_lock` เดิม                                                                                                                                 |
| FR-KWR-55 | ThaiD: เบอร์ซ้ำต้องคืน session (`releaseKioskSession`) ให้ตู้ส่งใหม่ด้วยเบอร์อื่นได้โดยไม่ต้องสแกน ThaiD ใหม่                                                                                                           |
| FR-KWR-56 | หน้า `/kiosk/register/phone`: ได้ `KIOSK_PHONE_DUPLICATE` → กลับไปที่ numpad (ว่าง) และแสดงข้อความจาก server ใต้ numpad จนกว่าผู้ใช้เริ่มพิมพ์เบอร์ใหม่ · ไม่มีปุ่ม「ลองอีกครั้ง」· idle timeout ทำงานต่อ               |

### 9.2 Household จากที่อยู่บนบัตร/ThaiD

| ID        | Requirement                                                                                                                                                                                               |
| :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KWR-60 | walk-in ที่บันทึกสำเร็จต้องมี `household_id` เสมอ: ที่อยู่ตรงกับครัวเรือนจากตู้ตาม §9.4 → ใช้ household นั้น · ไม่ตรง → สร้าง `household` ใหม่ 1 หลัง                                                     |
| FR-KWR-61 | `label` = `ครอบครัว{ชื่อ นามสกุล}` (`autoHouseholdLabel`) · `head_evacuee_id` = evacuee ที่ลงทะเบียน · `status` = `'arriving'`                                                                            |
| FR-KWR-62 | Residence: `address_no`, `village_no`, `subdistrict`, `district`, `province`, `postal_code` คัดจาก `card_snapshot` (หลังเติม `postal_code` จาก lookup) · `lane`/`road` ไม่ย้าย (คงอยู่ใน `card_snapshot`) |
| FR-KWR-63 | `housing_type`, `residence_landmark`, `municipality_zone`, `community`, `dorm_*` = `null` · `pets`/`vehicles` = `[]` · `assets` = `null` · `created_by` = `scanner:{device_id}`                           |
| FR-KWR-64 | ThaiD ที่ไม่มีที่อยู่ยังสร้าง household โดย Residence เป็น `null` ทั้งหมด                                                                                                                                 |
| FR-KWR-65 | ลำดับเขียน: household → evacuee · household เขียนไม่ได้ → ลบ image แล้วล้ม · evacuee เขียนไม่ได้ → ลบ household + image แล้วล้ม (ไม่เหลือ household กำพร้า)                                               |
| FR-KWR-66 | Station 1 จัดการ household จากตู้ด้วยพฤติกรรมเดิมของ `people.remote`: ย้ายเข้า family อื่น → household จากตู้ `cancelled` เมื่อว่าง · ยกเลิก walk-in → household `cancelled` เมื่อว่าง                    |

### 9.3 Walk-in เป็น `arriving` + พิมพ์ QR

| ID        | Requirement                                                                                                                                                                                                                                                                        |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KWR-70 | evacuee ที่ตู้สร้าง: `current_stay = { status: 'arriving', zone: null, since: now }` · `registered_via: 'kiosk'` · field อื่นตาม FR-KWR-18 · ตู้ไม่สร้าง `kiosk_registered` อีก (enum คงไว้ให้ doc เก่า)                                                                           |
| FR-KWR-71 | `POST /api/v1/kiosk/register` 200 → `{ status: 'created', evacuee_id, qr_payload: evacuee_id, label: { name, phone } }` · `cache-control: no-store`                                                                                                                                |
| FR-KWR-72 | หน้า `/kiosk/register/done` พิมพ์ QR label 1 ครั้งอัตโนมัติ (render + `printKioskLabels`, fallback `window.print` เมื่อเครื่องพิมพ์ unavailable) · มีปุ่ม「พิมพ์อีกครั้ง」และสถานะการพิมพ์ · พัก idle timeout ระหว่างพิมพ์ · ข้อความ: ลงทะเบียนสำเร็จ รับ QR Code แล้วไปจุดคัดกรอง |
| FR-KWR-73 | walk-in ที่ `arriving` แล้วเสียบบัตร/สแกน QR/ThaiD ซ้ำ → พิมพ์ QR ซ้ำได้แบบเดียวกับ pre-registration (CR-151 FR-KPC-101) · ไม่เขียน doc                                                                                                                                            |
| FR-KWR-74 | outcome `kiosk_registered` ของ lookup (FR-KWR-03) คงไว้สำหรับ doc เก่า                                                                                                                                                                                                             |

### 9.4 Merge ครัวเรือนเมื่อที่อยู่ตรงกัน

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                              |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KWR-80 | key ที่อยู่ = (`address_no`, `village_no`, `subdistrict`, `district`, `province`) จาก `card_snapshot` · trim + ยุบช่องว่างซ้ำ · `-` = ว่าง · ตัดคำนำหน้า (หมู่: `หมู่ที่`/`หมู่`/`ม.` · ตำบล: `ตำบล`/`แขวง`/`ต.` · อำเภอ: `อำเภอ`/`เขต`/`อ.` · จังหวัด: `จังหวัด`/`จ.`) · ไม่รวม `lane` และ `postal_code` · key ใช้ทั้งหา candidate และ lock (FR-KWR-85) |
| FR-KWR-81 | ถนน: เทียบ `card_snapshot.road` (ตัด `ถนน`/`ถ.`, `-` = ว่าง) **เฉพาะเมื่อทั้งสองฝั่งมีค่า** — ต่างกัน → ไม่ merge · ฝั่งใดว่าง (เช่น walk-in ทาง ThaiD ซึ่งไม่มีถนน) → ไม่ใช้ถนนตัดสิน                                                                                                                                                                   |
| FR-KWR-82 | ไม่มี `address_no` หรือไม่มี `subdistrict`/`district`/`province` → ไม่ merge (สร้างใหม่ตาม FR-KWR-60)                                                                                                                                                                                                                                                    |
| FR-KWR-83 | ครัวเรือนที่ merge ได้: ศูนย์เดียวกัน · `created_by` ขึ้นต้น `scanner:` · หัวหน้าเป็น evacuee ที่ `card_snapshot` key ตรงกัน (ช่องทางใดก็ได้ · แก้ 2026-10-15 เดิมต้องเป็น `registered_via: 'kiosk'`) · household `status` ∉ {`cancelled`, `checked_out`, `merged`} · มีหลายหลัง → `created_at` เก่าสุด                                                                                                                 |
| FR-KWR-84 | merge: `evacuee.household_id` = household นั้น · ไม่เปลี่ยน `head_evacuee_id` · refresh household status (`deriveHouseholdStatus`)                                                                                                                                                                                                                       |
| FR-KWR-85 | lock `kiosk_addr_lock:<sha256(shelter:key)>` (หลัง lock เลขบัตร) กัน 2 ตู้สร้าง 2 หลังพร้อมกัน · stale reclaim เหมือน lock เลขบัตร · รอ lock ไม่ได้ (10 ครั้ง × 200 ms) → 503                                                                                                                                                                            |
| FR-KWR-86 | evacuee เขียนไม่ได้ระหว่าง merge → ลบ image · **ไม่ลบ household เดิม**                                                                                                                                                                                                                                                                                   |

### 9.5 ที่อยู่จากชิปบัตร

| ID        | Requirement                                                                                                                                                                       |
| :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KWR-90 | `scanner_client` อ่านที่อยู่ชิป (`เลขที่#หมู่#ตรอก#ซอย#ถนน#ตำบล#อำเภอ#จังหวัด`): `lane` = ตรอก + ซอย (เว้นวรรค, ข้ามค่าว่าง/`-`) · `road` = ถนน — เดิม `road` = ซอย และไม่เก็บถนน |

### 9.6 Acceptance

- **AC-KWR-50** walk-in บัตรกรอกเบอร์ของคน `active` ในศูนย์ → 409 `KIOSK_PHONE_DUPLICATE` · DB ไม่มี doc ใหม่ · lock ถูกปล่อย
- **AC-KWR-51** เบอร์ที่เก็บแบบ `+66…` นับว่าซ้ำ · เบอร์ของคน `checked_out`/`cancelled`/`transferred`/`deceased` ใช้ได้
- **AC-KWR-52** ThaiD เบอร์ซ้ำ → 409 และ session ยังเป็น `completed`
- **AC-KWR-53** ตู้แสดงข้อความเบอร์ซ้ำใต้ numpad → กรอกเบอร์อื่นหรือ「ไม่มีเบอร์」→ บันทึกได้
- **AC-KWR-60** walk-in สำเร็จ → มี household 1 หลังที่ field ตรง FR-KWR-61..63 และ evacuee ผูกอยู่
- **AC-KWR-61** evacuee เขียนไม่ได้ → ไม่มี household / image เหลือใน DB
- **AC-KWR-62** Station 1 pull เข้า family อื่น / ยกเลิก ให้ผลตาม FR-KWR-66
- **AC-KWR-70** walk-in สำเร็จ → evacuee + household `arriving` · ตู้พิมพ์ label ที่มี QR `evacuee:<ULID>` · DB ไม่มี `kiosk_registered` ใหม่
- **AC-KWR-71** walk-in เสียบบัตรซ้ำ → พิมพ์ QR ซ้ำได้ ไม่มีการเขียน doc
- **AC-KWR-80** walk-in คนที่ 2 ที่ 5 ช่องตรง (รวมบัตร + ThaiD, `หมู่ที่ 3` = `3`) → household เดียวกับคนแรก หัวหน้า = คนแรก · บัตร + บัตรที่ถนนต่าง → household ใหม่ · ซอยต่างอย่างเดียว → merge · ที่อยู่ว่าง → household ใหม่
- **AC-KWR-81** evacuee เขียนไม่ได้ตอน merge → household เดิมยังอยู่ครบ
- **AC-KWR-90** อ่านบัตรที่มีซอยและถนน → `card_snapshot.lane` = ตรอก/ซอย, `road` = ถนน

### 9.7 Impact (ตรวจแล้ว 2026-10-12)

**ตัวเลขที่ไม่เปลี่ยน** (นับจาก evacuee ไม่ใช่ household): occupancy view, dashboard KPI「รอรายงานตัว」, system-overview per-site/summary, public booking gate, transparency metrics, worker projector

**ที่เปลี่ยน:**

1. back-office `household-tab` — walk-in ขึ้นเป็นแถว household · total +1 ต่อ walk-in ที่ไม่ได้ merge
2. **public `residence-match`** (`frontend/src/lib/features/public-register/residence-match.server.ts`) ค้น household สถานะ `pre_registered|arriving|checked_in` → household จากตู้จะถูกเสนอเป็น「เข้าร่วมครอบครัว」ให้คนที่ pre-register ออนไลน์จากที่อยู่เดียวกัน
3. system-overview household picker (limit 200/100) มีรายการเพิ่ม
4. kiosk household lookup — walk-in `arriving` แสดงในครัวเรือนแต่เลือก check-in ไม่ได้ (พิมพ์ซ้ำได้)
5. **walk-in นับเป็น `arriving` ทันที** — เข้าคิวคัดกรองโดยไม่ผ่านการยืนยันของ Station 1 · ตัวเลข Present/In-zone ตาม definition ของ `arriving` · คิว「ลงทะเบียนที่ตู้ (รอยืนยัน)」ไม่มีรายการใหม่ · Station 1 ยกเลิก/promote walk-in ใหม่ไม่ได้ เหมือน pre-registration ที่รายงานตัวแล้ว

> [DECISION: ข้อ 2 — ให้ residence-match เสนอ household ที่สร้างจากตู้ (ยังไม่ผ่าน Station 1) ได้ — อนุมัติโดย Team Lead ตาม requirement จากหัวหน้าโครงการ เพราะ join ต้องกดยืนยันและไม่เปิดเผย PII]

### 9.8 Why

1. Station 1 พิมพ์ที่อยู่จากบัตรซ้ำทุกคน ทั้งที่ตู้อ่านได้แล้ว
2. การติดต่อกลับและการพิมพ์ QR ด้วยเบอร์ต้องการเบอร์ที่ไม่ชนกันระหว่างคนที่ยังพักอยู่
3. feedback ทดสอบหน้างาน 2026-10-13: walk-in ไม่ได้ QR ต้องไปต่อคิว Station 1 · ครอบครัวที่ลงทะเบียนทีละคนแยกเป็นหลายครัวเรือน
4. **ตอบเหตุผลที่ §8.1 ปัดทางเลือก C:**
   - _ครัวเรือนที่ยังไม่ผ่านการตรวจ_ — merge เฉพาะครัวเรือนที่ตู้สร้างและที่อยู่ตามบัตรตรงกัน · Station 1 ย้ายสมาชิกออกได้
   - _household กำพร้า_ — rollback ตอนเขียน (FR-KWR-65) + Station 1 ยกเลิก household ที่ว่าง (FR-KWR-66)
   - _ที่อยู่ตามบัตร ≠ Residence (CR-106)_ — ใช้เป็นค่าเริ่มต้นของ Residence ที่ Station 1 แก้ได้ · ที่อยู่ตามบัตรจริงยังอยู่ใน `card_snapshot`

### 9.9 Risks

- **กลับเหตุผลของ §1 ข้อ 4** — walk-in เข้าคิวคัดกรองโดยยังไม่มีเจ้าหน้าที่ตรวจข้อมูลบัตร/เบอร์ · ยังแยกได้ด้วย `registered_via: 'kiosk'`
- **ที่อยู่ไม่มีซอยในการเทียบ** — บ้านเลขที่เดียวกันในตำบลเดียวกันที่ไม่มีหมู่และอยู่คนละซอยจะถูกรวม (ถนนช่วยแยกได้เฉพาะบัตร + บัตร) · ThaiD ไม่มีถนน → กรณีที่มี ThaiD ไม่เทียบถนน
- **ชิปบัตรเก็บถนนผิดช่องก่อนแก้** — walk-in ที่อ่านบัตรก่อน FR-KWR-90 มี `road` เป็นซอย → อาจไม่ merge กับคนที่อ่านหลังแก้
- **merge คนต่างครอบครัว** — หอพัก/คอนโด/วัด/ทะเบียนบ้านกลางที่ใช้ที่อยู่เดียวกันจะถูกรวม · Station 1 ย้ายออกได้
- lock เบอร์เป็นต่อเลขบัตร: 2 คนต่างบัตรที่กรอกเบอร์เดียวกันพร้อมกันอาจผ่านทั้งคู่ (โอกาสต่ำ)
- ครอบครัวที่ใช้เบอร์ร่วม: คนที่ 2 ต้องกด「ไม่มีเบอร์」แล้วให้ Station 1 เติมทีหลัง
- การตอบว่าเบอร์ซ้ำเปิดเผยว่าเบอร์นี้อยู่ในศูนย์ — ต้องผ่านบัตร/ThaiD + consent ก่อน และมี `kioskRegisterDeviceLimiter`

### 9.10 เลื่อนไปเฟสถัดไป

- ThaiD เก็บ `lane`/`road` จากที่อยู่ DOPA (ต้องได้ response จริงยืนยันรูปแบบ `house_address` ก่อน) → แล้วจึงเทียบซอย/ถนนครบทุกช่องทั้งบัตรและ ThaiD

### 9.11 Migration

ไม่เปลี่ยน shape ของ doc ไม่ bump `schema_v` · doc เก่าที่ `household_id: null` / `kiosk_registered` ยังอ่านได้และ Station 1 เลื่อนเป็น `arriving` ได้ตามเดิม

---

## Decision log

- 2026-09-27 — proposed โดยทีม kiosk · ข้อเสนอเดิมครอบคลุม Q1–Q8 และ Q10–Q13 · Q3 ทีมเสนอ A
- 2026-10-03 (Asia/Bangkok) — **Project Owner Jakee Indapanya (GitHub net-lynx) เคาะทุกข้อและอนุมัติ spec นี้ (`status: approved`)** · ยังไม่ implement
  - Q1: per-shelter feature flag `kiosk_walk_in_registration_enabled`, default off (missing key = false)
  - Q2: `kiosk_registered` นับใน Forecast เท่านั้น ไม่นับ Present / In-zone / Kitchen / `daily_calc`
  - Q3: ทางเลือก A — บัตรประชาชนหนึ่งใบ หนึ่งคน `household_id` null · Station 1 ผูกครัวเรือนทีหลัง · ไม่ใช้ B (group id) และไม่ใช้ C (สร้าง household ที่ตู้)
  - Q4: พิมพ์ QR label พักไว้ ไม่อยู่ในรอบนี้
  - Q5: record ที่ `cancelled` หรือ `checked_out` ของบัตรเดิมไม่ถูกเปิดใช้ใหม่ · ส่งไปเจ้าหน้าที่ · ไม่มีปุ่มลงทะเบียน
  - Q6: เจ้าหน้าที่ยกเลิก/ปฏิเสธ `kiosk_registered` → `cancelled` ได้ ด้วย flow ยกเลิก pre-registration เดิม · audit `previous_status` ตามค่าจริง
  - Q7: เก็บ `card_snapshot.consented_at` · ตอน Station 1 submit ย้าย `photo_base64` ไปเป็น image doc และ `evacuee.photo` แล้วลบ `photo_base64` ออกจาก `card_snapshot` ในการเขียนเดียวกัน · field อื่นใน `card_snapshot` คงไว้
  - Q8: `kiosk_registered` ไม่เข้าคิวคัดกรองสุขภาพหรือจัดโซนจนกว่าสถานะเป็น `arriving`
  - Q10: ชื่อสถานะคือ `kiosk_registered` · ไม่ใช้ `arriving` คู่กับ `registered_via` อย่างเดียว · ไม่เปลี่ยนชื่อเป็น `kiosk_walk_in`, `kiosk_pending`, หรือ `self_registered`
  - Q11: หลัง consent อ่านบัตรเต็มแบบ CR-097 (ชื่อ เพศ วันเกิด ที่อยู่ รูป) ไม่ใช่ชุดขั้นต่ำ
  - Q12: ไม่ถามเบอร์โทรบน kiosk · `phone` เป็น null · Station 1 เติมเบอร์ (หรือ「ไม่มี」) ก่อน promote เป็น `arriving`
  - Q13: track การเปลี่ยนด้วยไฟล์ CR นี้ · ไฟล์แผน `docs/features/kiosk-walk-in-registration-implementation-plan.md` ไม่มีใน repo จึงไม่ได้อยู่ใน change นี้
- 2026-10-03 — รันเลข CR-149 จาก `docs/changes/_index.md` บน `develop` (เลขที่จัดสรรล่าสุดคือ CR-148; ไม่ใช้ช่องว่าง 131–133 และ 144–147) · evacuee `schema_v` ที่ร่างไว้ 10→11 ถูก CR-148 ใช้ไปแล้ว จึงเป็น 11→12
- 2026-10-12 — ทีม kiosk เสนอ (proposed): บล็อกเบอร์ซ้ำ (ไม่ใช่เตือน) · เทียบเฉพาะ evacuee ในศูนย์ · สร้าง household ใหม่ให้ walk-in · นับเฉพาะสถานะ Forecast · ไม่ตรวจเบอร์ผู้ติดต่อฉุกเฉิน · ไม่มีที่อยู่ก็สร้าง household · ไม่ย้ายซอย/ถนน · ข้อความเบอร์ซ้ำแสดงใต้ numpad (§9.1–9.2)
- 2026-10-13 — ทีม kiosk เสนอเพิ่มจาก feedback หน้างาน (proposed): walk-in เป็น `arriving` + พิมพ์ QR ที่หน้าสุดท้าย · merge ครัวเรือนเมื่อบ้านเลขที่ + หมู่ + ตำบล + อำเภอ + จังหวัดตรงกัน (ถนนเทียบเฉพาะเมื่อมีทั้งสองฝั่ง · ไม่เทียบตรอก/ซอย) หัวหน้า = คนแรก — ไม่ใช้ "ทุกช่องบนบัตร" เพราะ ThaiD ไม่เก็บตรอก/ซอย/ถนน และยังไม่มี response DOPA จริงยืนยันรูปแบบ → เลื่อนไปเฟสถัดไป · แก้ `scard.py` ที่เก็บถนนผิดช่อง (§9.3–9.5)
- 2026-10-13 — รวมข้อเสนอเข้า CR นี้เป็น §9 แทนการเปิด draft CR ใหม่ (ถอด `draft-kiosk-walk-in-household-phone-duplicate.md`) · ส่วนเมนู「พิมพ์ QR」อยู่ใน CR-151 §15 / CR-152 §9 · label อยู่ใน CR-150 · ตรวจหน้าในกรอบอยู่ใน CR-158
- 2026-10-13 — Soravit Sukkarn (Team Lead) approved ข้อเสนอแก้ไข §9 ทั้งหมด โดยรับ requirement จากหัวหน้าโครงการเมื่อวาน (2026-10-12)
- 2026-10-15 — ทีม kiosk ขอเลิกกรอง `registered_via: 'kiosk'` ตอนหาครัวเรือนที่ merge ได้ (FR-KWR-83) ให้ตรงกับ scope ทั้งศูนย์ของ CR-151 FR-KPC-101/104 · ยังต้องเป็นครัวเรือนที่ตู้สร้าง (`created_by` ขึ้นต้น `scanner:`) และหัวหน้ามี `card_snapshot` key ตรงกัน
