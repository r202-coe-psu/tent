---
id: draft
title: Kiosk walk-in registration — เสียบบัตรแล้วไม่พบข้อมูล → ลงทะเบียนใหม่ที่ตู้ (stay status `kiosk_registered`)
status: proposed
date: 2026-09-27
created: 2026-09-27
updated: 2026-09-27
requested_by: ทีม kiosk (branch feat/pre-register_kiosk)
decided_by: Project Owner (รอเคาะ)
layer: volatile
amends:
  - docs/changes/draft-kiosk-pre-registration-check-in.md §3 (แถว "ลงทะเบียน walk-in ที่ kiosk" ย้ายจากนอกขอบเขต → ในขอบเขต เฉพาะช่องทางบัตร) · §1 ข้อ 3 (PDPA — อ่านเฉพาะเลข 13 หลัก → อ่านเต็มหลังได้ consent)
  - docs/features/smart-card-registration-spec.md FR-CARD-01..04 (สร้าง evacuee จากบัตรกลับมา แต่ผ่านปุ่ม + consent และใช้สถานะใหม่)
affects:
  - docs/data/schema.md §1.1 evacuee — `current_stay.status` += `kiosk_registered` · occupancy metrics table · household status derive
  - schema_v evacuee 10 → 11
  - docs/data/schema.md shelter `feature_flags` += `kiosk_walk_in_registration_enabled` (additive, ไม่ bump shelter schema_v — ตาม pattern `kiosk_phone_check_in_enabled`)
  - docs/data/api-contract.md §2.1 — lookup `can_register` + outcome `kiosk_registered` · endpoint ใหม่ `POST /api/v1/scanner/kiosk/register`
  - docs/features/kiosk-walk-in-registration-implementation-plan.md (แผน implement + impact map ราย file)
  - frontend/src/lib/features/people/{domain,data,ui} (enum, labels, badge, derive, Station 1 transitions)
  - frontend/src/lib/features/kiosk/{domain,data,server,ui} · frontend/src/routes/kiosk/** · frontend/src/routes/api/v1/scanner/kiosk/{lookup,register}
  - frontend/src/lib/features/scanners/server.ts (reuse `processCardScan` mapping) · features/shelters (flag)
  - frontend/src/lib/features/{system-overview,public-portal,public-register,dashboard}/domain (occupancy/forecast sets)
  - worker/src/worker/projectors/evacuee.py · backend/apiapp/modules/{external,shelter,transparency,evacuee}
  - scanner_client/app/{manager,scard}.py · scanner_client/tests
why: >
  ผู้ประสบภัยที่ไม่ได้ลงทะเบียนล่วงหน้าเสียบบัตรที่ kiosk แล้วได้แค่ "ไม่พบข้อมูล" ต้องไปต่อคิว Station 1
  และให้เจ้าหน้าที่พิมพ์ข้อมูลจากบัตรเองทั้งหมด kiosk มีเครื่องอ่านชิปอยู่แล้ว จึงสร้าง record เบื้องต้นจากบัตรได้ทันที
  โดยให้ผู้ใช้กดยืนยันเองก่อน และติดสถานะแยกให้เจ้าหน้าที่รู้ว่ายังไม่ได้ตรวจสอบ
migration: purely additive enum — doc schema_v ≤10 อ่านได้โดยไม่ backfill; เขียนใหม่ stamp schema_v 11
---

# ร่าง CR: Kiosk walk-in registration (`kiosk_registered`)

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** ช่องทางบัตรประชาชนของ kiosk — ถ้าเลข 13 หลักไม่มี record ใด ๆ ในศูนย์ ให้แสดงปุ่ม「ลงทะเบียนใหม่」→ หน้า consent → อ่านชิปเต็ม (ชื่อ เพศ วันเกิด ที่อยู่ รูป) → สร้าง `evacuee` ใหม่ `current_stay.status = 'kiosk_registered'`, `registered_via: 'kiosk'`, `household_id: null`, `phone: null`
> - **เพื่อใคร / ทำไม:** walk-in ไม่ต้องให้เจ้าหน้าที่พิมพ์ข้อมูลบัตรเอง · Station 1 เห็นคิว「ลงทะเบียนที่ตู้ (รอยืนยัน)」แยกชัด แล้วเติมเบอร์/ครัวเรือนก่อนส่งต่อ (`kiosk_registered → arriving`)
> - **Dev ต้อง build:** enum ใหม่ + label/badge/metric ทุกจุด · lookup แยก "ไม่มี record" กับ "มีแต่ไม่เข้าเงื่อนไข" · endpoint `POST /api/v1/scanner/kiosk/register` · UI consent/เสียบบัตร/ผล · `scanner_client` อ่านเต็มเมื่ออยู่หน้าลงทะเบียน · Station 1 รับ `kiosk_registered` เป็นสถานะต้นทาง
> - **กระทบ schema / scope:** evacuee `schema_v 10 → 11` (additive) · shelter flag ใหม่ (additive) · กลับทิศบางส่วนของ draft kiosk pre-registration check-in §1.3/§3 · อยู่นอก phase ปัจจุบัน → backlog จนกว่าเจ้าของสั่ง

---

## 1. Why

1. **Walk-in ยังเป็นส่วนใหญ่ในวันเกิดเหตุ:** kiosk ปัจจุบัน (draft kiosk pre-registration check-in) รับเฉพาะผู้จองทางเว็บ walk-in ที่เสียบบัตรได้แค่ข้อความ「ไม่พบผู้ลงทะเบียนล่วงหน้าในศูนย์นี้」
2. **ข้อมูลบัตรมีอยู่แล้วที่เครื่อง:** `scanner_client` อ่านชิปได้ครบ (`read_all_data`) และโค้ดแปลงบัตร → `card_snapshot` ของ CR-097 ยังอยู่ (`scanners/server.ts` `processCardScan`, `people.ts` `createKioskEvacueeFromCard`)
3. **แก้ปัญหาเดิมของ CR-097 ที่ทำให้ถูกยกเลิก:**
   - record ซ้อนกับผู้จองเว็บ → ปุ่มแสดงเฉพาะเมื่อ **ไม่มี record ใดเลย** ของเลขบัตรนี้ในศูนย์ (FR-KWR-02)
   - ปะปนกับผู้จองล่วงหน้าใน `pre_registered` → ใช้สถานะแยก `kiosk_registered` (FR-KWR-20)
   - PDPA อ่านเกินจำเป็น → อ่านเต็มเฉพาะหลังผู้ใช้กดลงทะเบียนและยินยอม (FR-KWR-10..12)
4. **ทำไมเป็น stay status ไม่ใช่แค่ `registered_via`:** `registered_via` บอกช่องทาง ไม่บอกตำแหน่งใน pipeline · ถ้าใช้ `arriving` + `registered_via:'kiosk'` คิว screening/zone จะรับคนที่ยังไม่มีเบอร์และครัวเรือนต่อทันที (ข้าม Station 1) — สถานะแยกทำให้ทุก query บังคับได้ด้วย status เดียว

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
| — (พิมพ์ QR label: Q4 พักไว้ ไม่อยู่ในรอบนี้) | Kiosk edge/offline                                                                             |

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
| FR-KWR-18  | Doc ที่สร้าง: `schema_v: 11`, `registered_via:'kiosk'`, `current_stay:{status:'kiosk_registered', zone:null, since:now}`, `household_id:null`, `phone:null`, `country:'THAILAND'`, `person_id:{cardType:'national_id', number}`, ชื่อ/เพศ/`birth_year` (พ.ศ.)/`age` จากบัตร, `card_snapshot` ตาม `cardSnapshotSchema` (รวมที่อยู่ + `photo_base64`) + `consented_at` (ts ที่กดยินยอม, additive), `privacy:{search_excluded:false}`, `created_by` = principal ของเครื่อง |
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
| FR-KWR-41 | สำเร็จ → สีเขียว「ลงทะเบียนสำเร็จ กรุณาไปพบเจ้าหน้าที่ที่จุดลงทะเบียน」+ ชื่อ (นามสกุลปิดบางส่วน) + ปุ่มพิมพ์ QR label (⏸ Q4 พักไว้ — ยังไม่ทำ)                                          |
| FR-KWR-42 | เสียบบัตรซ้ำ (FR-KWR-03) → สีเหลือง「ท่านลงทะเบียนที่ตู้แล้ว กรุณาไปพบเจ้าหน้าที่」+ พิมพ์ QR ซ้ำได้ (⏸ Q4 พักไว้ — ยังไม่ทำ) · ไม่สร้าง doc ใหม่                                        |
| FR-KWR-43 | 409 `KIOSK_REGISTRATION_BLOCKED` → 「กรุณาติดต่อเจ้าหน้าที่」 · 503 → 「ระบบไม่พร้อม ลองใหม่」                                                                                           |
| FR-KWR-44 | ใช้งานครบโดยไม่ scroll ที่ 1024×600 และ 540×960 (FR-KPC-13)                                                                                                                              |

---

## 5. Acceptance

- **AC-KWR-01** flag ปิด: ไม่พบ record → ไม่มีปุ่มลงทะเบียน · เรียก `/register` ตรง → 403
- **AC-KWR-02** flag เปิด, เลขบัตรไม่มีในศูนย์ → ปุ่มขึ้น → consent → เสียบบัตร → doc ใหม่ `kiosk_registered` + `card_snapshot` ครบ + `schema_v 11`
- **AC-KWR-03** กดยกเลิกที่ consent → ไม่มีการอ่านเต็ม (log scanner_client ไม่มี `read_all_data`) ไม่มี doc
- **AC-KWR-04** เสียบบัตรซ้ำหลังลงทะเบียน → outcome `kiosk_registered` ไม่เกิด doc ที่ 2 · เรียก `/register` ซ้ำ → 200 `created:false`
- **AC-KWR-05** เลขบัตรมี record staff/`checked_out`/`cancelled` → ไม่มีปุ่ม · `/register` → 409
- **AC-KWR-06** อ่านเต็มได้เลขบัตรไม่ตรง lookup → ไม่สร้าง doc
- **AC-KWR-07** Station 1 เห็นแถว → เติมเบอร์ + ครัวเรือน → `arriving` · household ที่มีแต่สมาชิก `kiosk_registered` derive เป็น `pre-registered` ไม่ใช่ `cancelled`
- **AC-KWR-08** Dashboard Forecast นับเพิ่ม 1 · Present/Kitchen ไม่เปลี่ยน · `/external/v1` residency ของ CID นี้ → 404
- **AC-KWR-09** Couch ล่มระหว่าง lookup/register → 503 ไม่สร้าง doc
- **DoD:** `pnpm lint` · `pnpm check` 0 error · `pnpm test` · `svelte-autofixer` ทุก `.svelte` ที่แตะ · `uv run pytest` (`backend/`, `worker/`, `scanner_client/`) · ทดสอบบน kiosk จริงตามแผน §8

---

## 6. Impact

รายละเอียดราย file (~40 จุด) อยู่ใน [implementation plan §3](../features/kiosk-walk-in-registration-implementation-plan.md#3-impact-map). สรุป:

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

- **evacuee schema_v 10 → 11:** purely additive enum `kiosk_registered` · doc เดิมอ่านได้ไม่ต้อง backfill · เขียนใหม่ stamp 11 · `validate_doc_update` ไม่มี enum stay status (ไม่ต้อง redeploy design doc) · view `occupancy` emit status ตรงตัว → key ใหม่โผล่เอง
- **shelter `feature_flags.kiosk_walk_in_registration_enabled`:** additive, ไม่มี key = `false`, ไม่ bump
- **Mongo projection:** `public_*` รับค่า status ใหม่เป็น string อยู่แล้ว · backend set ที่ enumerate ต้องอัปเดตก่อน deploy worker ที่เขียนค่านี้ (ลำดับ deploy: backend → frontend)

---

## 8. ข้อเสนอให้ Project Owner เคาะ

ทุกข้อด้านล่างเป็น **ข้อเสนอของทีม kiosk** — ยังไม่มีข้อใดเคาะ · ค่าที่เสนอเขียนลง requirement ข้างบนแล้ว ถ้า PO เคาะต่างให้แก้ FR ที่อ้าง

| #   | คำถาม                                                                                                    | ข้อเสนอของทีม                                                                                                               | FR                   |
| :-- | :------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :------------------- |
| Q1  | มี shelter flag เปิด/ปิด walk-in ที่ kiosk หรือเปิดทุกศูนย์                                              | flag ค่าเริ่มต้นปิด (ทีมยังหารืออยู่)                                                                                       | FR-KWR-01            |
| Q2  | นับ `kiosk_registered` ใน occupancy ชุดไหน                                                               | Forecast เท่านั้น (เหมือน `arriving`)                                                                                       | FR-KWR-22            |
| Q3  | kiosk ลงทะเบียนแบบบัตรละ 1 คน หรือเสียบต่อกันหลายใบเป็นครอบครัว                                          | A — บัตรละ 1 คน `household_id: null` · Station 1 รวมครัวเรือน (§8.1)                                                        | FR-KWR-23, FR-KWR-31 |
| Q4  | พิมพ์ QR label ให้ walk-in หลังลงทะเบียนไหม                                                              | พักไว้ ไม่อยู่ในรอบนี้                                                                                                      | FR-KWR-41/42         |
| Q5  | เลขบัตรที่มี record `cancelled`/`checked_out` อยู่แล้ว — ให้ kiosk เปิด record เดิมใช้ใหม่แบบ CR-097 ไหม | ไม่เปิดใช้ใหม่ — ส่งไปเจ้าหน้าที่                                                                                           | FR-KWR-04/17         |
| Q6  | เจ้าหน้าที่ยกเลิก/ปฏิเสธ `kiosk_registered` ได้ไหม                                                       | ได้ — ใช้ flow ยกเลิก pre-registration เดิม → `cancelled` (audit `previous_status` ตามค่าจริง)                              | FR-KWR-21            |
| Q7  | เก็บหลักฐาน consent ไหม และลบรูปจากบัตรเมื่อไร                                                           | เก็บ `card_snapshot.consented_at` · ลบ `photo_base64` ตอน Station 1 submit โดยย้ายรูปไป `evacuee.photo`                     | FR-KWR-18, FR-KWR-33 |
| Q8  | `kiosk_registered` เข้าคิวคัดกรองสุขภาพได้เลยไหม                                                         | ไม่ได้ — ต้องผ่าน Station 1 ก่อน                                                                                            | FR-KWR-26            |
| Q10 | ชื่อสถานะ                                                                                                | `kiosk_registered` (ทางเลือกอื่น: `kiosk_walk_in`, `kiosk_pending`, `self_registered`, หรือไม่เพิ่มสถานะ — ดู Decision log) | FR-KWR-20            |
| Q11 | ข้อมูลที่อ่านจากบัตรหลัง consent                                                                         | เต็มแบบ CR-097 (ชื่อ เพศ วันเกิด ที่อยู่ รูป) · ทางเลือกอื่น: ขั้นต่ำ (ไม่เก็บที่อยู่/รูป)                                  | FR-KWR-10, FR-KWR-18 |
| Q12 | ถามเบอร์โทรบน kiosk ไหม                                                                                  | ไม่ถาม — `phone: null` ให้ Station 1 เติม                                                                                   | FR-KWR-18, FR-KWR-31 |
| Q13 | วิธี track การเปลี่ยน                                                                                    | draft CR ไฟล์นี้ + implementation plan                                                                                      | —                    |

### 8.1 Q3 — ทางเลือกเรื่องครัวเรือน (ทีมเสนอ A)

| ทางเลือก                                       | kiosk ทำอะไร                                                                                                                                                                     | ข้อดี                                                                                                           | ข้อเสีย                                                                                                                                   |
| :--------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **A. บัตรละ 1 คน** ⭐ เสนอ                     | สร้าง evacuee ทีละคน `household_id: null`                                                                                                                                        | ง่ายสุด · ไม่มี field ใหม่                                                                                      | Station 1 ต้องค้นหาและรวมสมาชิกทีละคนเอง (`PullPreRegisteredDialog`)                                                                      |
| **B. เสียบต่อเนื่อง + group id**               | หลังลงทะเบียนสำเร็จมีปุ่ม「ลงทะเบียนคนในครอบครัวต่อ」→ consent + เสียบบัตรคนถัดไป · ทุกคนในรอบเดียวกันได้ `card_snapshot.kiosk_group_id` เดียวกัน · **ไม่สร้าง `household` doc** | Station 1 ดึงทั้งกลุ่มได้ครั้งเดียว แล้วสร้างครัวเรือนตอน submit · ไม่มีครัวเรือนที่ยังไม่ผ่านการตรวจค้างในระบบ | เพิ่ม field (additive ใน `card_snapshot`) · kiosk flow ยาวขึ้น                                                                            |
| **C. เสียบต่อเนื่อง + สร้าง household ที่ตู้** | สร้าง `household` จริง (label อัตโนมัติ, หัวหน้า = คนแรก) แล้วผูกทุกคน                                                                                                           | Station 1 เห็นครัวเรือนทันที                                                                                    | ครัวเรือนยังไม่ผ่านการตรวจ (คนแปลกหน้าที่ต่อคิวกันอาจถูกรวม) · ยกเลิกแล้วเหลือ household กำพร้า · ที่อยู่ตามบัตรไม่ใช่ Residence (CR-106) |

ทุกทางเลือก: เด็กหรือคนที่ไม่มีบัตร Station 1 เป็นคนเพิ่ม · consent ต้องทำรายคน (เจ้าของบัตรแต่ละใบ) · FR-KWR-23 (derive ไม่ตกเป็น `cancelled`) ยังต้องมีไว้กันพลาด แม้ A/B จะไม่ผูกครัวเรือนที่ kiosk

---

## Decision log

- 2026-09-27 — proposed โดยทีม kiosk · ข้อเสนอทั้งหมดอยู่ใน §8 (Q1–Q8, Q10–Q13) รอ Project Owner เคาะ · Q3 ทีมเสนอ A (B group id / C สร้าง household ที่ตู้ — เหตุผลที่ไม่เสนอ §8.1)
- ทางเลือกที่ทีมไม่เสนอ (PO เลือกแทนได้): ใช้ `arriving` + `registered_via:'kiosk'` โดยไม่เพิ่ม status (ไม่ bump schema_v แต่คิว screening/zone จะรับคนที่ยังไม่ผ่าน Station 1) · ชื่อ `kiosk_walk_in` / `kiosk_pending` / `self_registered`
