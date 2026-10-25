---
id: CR-192
title: จับเวลาให้บริการแต่ละ station (Station 1/2/3) ด้วย doc `station_log`
status: approved
date: 2026-10-24
requested_by: Soravit Sukkarn — จาก demo day เทศบาล 4 (15/10/2026), issue #589
decided_by: Soravit Sukkarn (Team Lead)
decision_date: 2026-10-25
layer: volatile
affects:
  - docs/data/schema.md §1 (เพิ่ม §1.x `station_log` · schema_v 1) · §7 (view `station_logs_by_station`) · §8 ข้อ 1–2 (whitelist + append-only)
  - schema_v ของ type อื่นไม่เปลี่ยน (`movement`, `screening`, `evacuee` คงเดิม)
  - frontend/src/lib/server/shelter-access-design.ts (`allowed` + `appendOnly`)
  - frontend/src/lib/features/shelters/domain/{views.ts,view-manifest.ts} (view ใหม่ · manifest v3 → v4)
  - frontend/src/lib/features/kiosk/server/kiosk-check-in.server.ts (kiosk เขียน log ฝั่ง server)
  - frontend/src/lib/features/people/{domain,data,application} (staff Station 1/2/3 เขียน log)
  - frontend/src/routes/api/back-office/shelter/[code]/dashboard/station-times/+server.ts (ใหม่)
  - frontend/src/routes/(protected)/back-office/evacuee-management/dashboard-tab.svelte (section กราฟใหม่ต่อท้าย tab ภาพรวม)
  - ไฟล์ใหม่ (สร้างใน PR โค้ด): feature slice สำหรับ summary + component กราฟ
---

# จับเวลาให้บริการแต่ละ station ด้วย `station_log`

## สรุป (TL;DR)

- **เปลี่ยน:** เพิ่ม doc type `station_log` (append-only) บันทึกเวลา `start` / `complete` ต่อ evacuee ต่อ station พร้อม `channel` (`kiosk` | `staff`)
- **ทำไม:** ปัจจุบันไม่มีเวลาเริ่มที่ไหนเลย และ `current_stay.since` ถูกเขียนทับ; Station 1 และ kiosk report-in ไม่เขียน movement/audit → วัดเวลาให้บริการและแยกช่องทางไม่ได้ (demo day จับมือ: kiosk ≤ 1 นาที/คน, Station 1 ผ่าน staff 6–7 นาที/คน)
- **Build:** doc type + validate rule + view `_design/app` (manifest v4) + BFF route สรุปเวลาเฉลี่ยต่อ station × channel + เขียน log จาก kiosk BFF และ staff UI
- **กระทบ:** `schema.md` §1/§7/§8 · `shelter-access-design.ts` · ไม่ bump `schema_v` ของ type เดิม · ไม่แตะ worker/Mongo/FastAPI

## Scope

**In scope**

- เก็บเวลา `start`/`complete` ของ Station 1, 2, 3 ต่อ evacuee
- สรุปเวลาให้บริการเฉลี่ยต่อ station แยก channel (staff dashboard ต่อศูนย์)
- แสดงจำนวนคิวค้าง ณ ปัจจุบันต่อ station (derive จาก state เดิม)

**Out of scope**

- เวลารอคิว (queue-entry timestamp) และ backlog ย้อนหลังตามช่วงเวลา
- ประวัติการเปลี่ยน `current_stay.status` ทุกครั้ง (status history ทั่วไป) — แยก CR หากต้องการ
- Station 4 (Distribution, CR-159) และ station อื่นนอก intake pipeline ตาม ADR-0001
- Projection ลง Mongo / public / partner API (ยังเป็น operational data ตาม `couchdb-mongodb-sync.md` บรรทัด 313)
- การ backfill เวลาของ evacuee ที่ผ่าน station ไปแล้วก่อน release

## Definitions

| Station | Pipeline (ADR-0001) | `start` = | `complete` = |
| --- | --- | --- | --- |
| 1 | Registration / Report-in | **staff:** เปิดหน้ากรอกข้อมูล — ฟอร์ม walk-in เปล่า หรือหน้า report-in ของผู้ลงทะเบียนล่วงหน้า · **kiosk:** lookup สำเร็จ (QR / บัตร / ThaiD ยืนยันตัวตนแล้ว) หรืออ่านบัตรสำหรับ walk-in | บันทึก evacuee เป็น `current_stay.status = arriving` สำเร็จ |
| 2 | Medical Screening (เมื่อ `enable_medical_screening`) | staff เปิดฟอร์ม screening ของ evacuee | บันทึก `screening` doc สำเร็จ |
| 3 | Zoning | staff เปิดหน้า zoning ของ evacuee | บันทึก movement `check_in` สำเร็จ |

**Flow แบบ hybrid:** Station 1 ทำได้ทั้ง `kiosk` และ `staff`; Station 2 และ 3 เป็น `staff` เสมอ

**Walk-in:** ตอนเปิดฟอร์มยังไม่มี `evacuee_id` → client ถือเวลาเปิดฟอร์มไว้ แล้วเขียน `start` (`occurred_at` = เวลาเปิดฟอร์ม) พร้อม `complete` ตอนบันทึกสำเร็จ; ฟอร์มที่ปิดทิ้งโดยไม่บันทึกไม่มี log

**Stale window** = 2 ชั่วโมง: `start` ที่ไม่มี `complete` และเก่ากว่า 2 ชั่วโมง = เลิกกลางคัน (abandoned)

**Visit** = คู่ `start` → `complete` ของ `(evacuee_id, station)` โดย `complete` แรกที่ `occurred_at ≥ start`, ก่อน `start` ถัดไปของ key เดียวกัน และห่างจาก `start` ไม่เกิน stale window

- `duration = complete.occurred_at − start.occurred_at` (derive ตอนสรุป ไม่ persist)
- `start` ที่ไม่มี `complete` และอายุ ≤ stale window = visit ค้าง (`open_visits`, ไม่นับในค่าเฉลี่ย)
- `start` ที่ไม่มี `complete` และอายุ > stale window = abandoned (ไม่นับทั้งค่าเฉลี่ยและ `open_visits`)
- `complete` ที่ไม่มี `start` = นับเป็น throughput แต่ไม่นับในค่าเฉลี่ย

## Requirements

### Data — `station_log`

- **FR-STL-01** — เพิ่ม doc type `station_log` ใน `shelter_{shelter_code}` · `_id = station_log:{ulid}` · append-only (`created_at = updated_at`)
- **FR-STL-02** — Field ตามตาราง Schema ด้านล่าง; `station` นอก `1|2|3`, `action` นอก `start|complete`, `channel` นอก `kiosk|staff` = reject (Zod ฝั่ง client); `station` 2 หรือ 3 ต้องเป็น `channel = 'staff'` (Zod ฝั่ง client)
- **FR-STL-03** — `validate_doc_update` ต้องรับ type นี้ใน whitelist (`allowed`) และปฏิเสธ update/delete (เพิ่มใน `appendOnly`)
- **FR-STL-04** — เขียน log ล้มเหลว **ต้องไม่ block** การทำงานหลักของ station (report-in / screening / zoning สำเร็จได้โดยไม่มี log) และต้องแจ้ง staff ด้วย toast แบบ warning ข้อความ "บันทึกข้อมูลสำเร็จ แต่ระบบบันทึกเวลาการให้บริการขัดข้อง" (ไม่ใช้ error toast เพื่อไม่ให้ staff กดบันทึกซ้ำ)

### Write path

- **FR-STL-10** — Kiosk: BFF ฝั่ง server เขียน log ด้วย `channel = 'kiosk'`, `device_id` จาก scanner principal ที่ authenticate แล้ว, `created_by = kiosk:{device_id}`; ห้ามรับ `channel`/`device_id` จาก body ของ kiosk
- **FR-STL-11** — Kiosk `start` เขียนเมื่อ lookup สำเร็จ; `complete` เขียนใน flow check-in หลังเขียน `current_stay` สำเร็จ (ต่อสมาชิกที่เลือกแต่ละคน)
- **FR-STL-12** — Staff: เขียน log จาก browser ด้วย `channel = 'staff'` ผ่าน repository ของ feature `people` (เหมือน path เขียน evacuee/movement/screening ที่ใช้อยู่)
- **FR-STL-13** — Staff `start` ของ evacuee ที่มีอยู่แล้ว (report-in, screening, zoning) ต้อง idempotent ต่อการเปิดหน้าซ้ำ/refresh: ไม่เขียน `start` ใหม่ถ้ามี `start` ของ `(evacuee_id, station)` ที่ยังไม่มี `complete` **และอายุ ≤ stale window**; ถ้า `start` เดิมเก่ากว่า stale window ให้เขียน `start` ใหม่
- **FR-STL-14** — ไม่เปลี่ยน payload หรือ semantics ของ `evacuee`, `movement`, `screening`, `audit` (additive เฉพาะ doc ใหม่)
- **FR-STL-15** — `validate_doc_update` ไม่ตรวจค่า `channel` ใน CR นี้ (ตรวจแค่ whitelist + append-only ตาม FR-STL-03); `channel = 'staff'` มาจากโค้ดหน้า staff ไม่ได้ verify ฝั่ง server — staff ที่มี session เขียน `channel = 'kiosk'` ปลอมได้ (security concern: #850)
- **FR-STL-16** — Bulk zoning (`bulkApplyZone` ในหน้า `/onsite/zoning`) เขียนเฉพาะ Station 3 `complete` ต่อคน ไม่เขียน `start` → นับเป็น throughput ไม่นับในค่าเฉลี่ย

### Summary

- **FR-STL-20** — เพิ่ม view `station_logs_by_station` ใน `_design/app` (`SHELTER_DASHBOARD_VIEWS`) และ bump `SHELTER_VIEW_MANIFEST` v3 → v4
- **FR-STL-21** — เพิ่ม BFF route `GET /api/back-office/shelter/[code]/dashboard/station-times` (pattern เดียวกับ `dashboard/registrations`: scope guard, `checkViewDeployment`, `adminRaw`) คืนต่อ `(station, channel)`: `visits`, `avg_duration_sec`, `open_visits`; query view ด้วย `startkey`/`endkey` ตามช่วงวันที่ (`?from`/`?to`) และดึงเกินปลายช่วง 1 วันเพื่อจับ `complete` ที่ข้ามเที่ยงคืน; visit นับตามวันที่ของ `start`
- **FR-STL-22** — การ pair `start`/`complete` ทำใน domain function (pure, มี unit test) เรียกจาก BFF ไม่ทำใน CouchDB map (join ข้าม doc ไม่ได้)
- **FR-STL-23** — แสดงคิวค้าง ณ ปัจจุบันต่อ station โดย derive จาก state เดิม (`classifyScreeningQueueTab`, `classifyZoningQueueTab`, คิว Station 1 จาก status) — ไม่เพิ่ม field
- **FR-STL-24** — ไม่เพิ่ม tab: แสดงใน tab ภาพรวม (`?tab=dashboard`) ของ `/back-office/evacuee-management` เป็น section ใหม่ต่อจาก section ล่างสุดเดิม ใช้ช่วงวันที่ของ dashboard เดิม (CR-170)
- **FR-STL-25** — กราฟความเร็วแยกต่อ station: Station 1, Station 2, Station 3 — เวลาให้บริการเฉลี่ยตามช่วงวันที่
- **FR-STL-26** — กราฟแยกตาม channel: `staff` vs `kiosk` (มีผลกับ Station 1 เท่านั้น เพราะ Station 2/3 เป็น `staff` เสมอ)
- **FR-STL-27** — แสดงจำนวน visit, visit ค้าง และคิวค้าง ณ ปัจจุบันต่อ station ประกอบกราฟ

## Schema — `station_log` · **schema_v 1**

`_id` = `station_log:{ulid}` · append-only · อยู่ใน `shelter_{shelter_code}`

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `evacuee_id` | str | req | evacuee ที่รับบริการ |
| `station` | int (`1`,`2`,`3`) | req | ตาม pipeline ADR-0001 |
| `action` | enum(`start`,`complete`) | req | — |
| `channel` | enum(`kiosk`,`staff`) | req | ช่องทางที่ให้บริการ step นี้ (ไม่ใช่ `registered_via`) |
| `device_id` | str | opt | ใส่เมื่อ `channel = 'kiosk'` (scanner device) |
| `occurred_at` | ts | req | เวลาเหตุการณ์จริง (ไม่ใช่เวลา sync) |

**Mango index:** `(evacuee_id, station, occurred_at)` — ใช้หา `start` ค้างของ evacuee ตาม FR-STL-13 (คนละตัวกับ view)

**View `station_logs_by_station`:** map emit `[YYYY-MM-DD(+07) ของ occurred_at, station, channel, evacuee_id]` → `{action, occurred_at}`; ไม่มี reduce (pair ใน BFF) — date-first ตาม pattern `registrations_by_date_status` เพื่อ filter ช่วงวันที่ใน CouchDB

## Impact

- **Docs:** `schema.md` §1 (section ใหม่), §7 (view + index), §8 ข้อ 1–2; frontmatter `updated:` + `note:`; `docs/changes/_index.md` เมื่อ approve
- **Code:** `shelter-access-design.ts`, `views.ts` + `view-manifest.ts`, kiosk check-in server, feature `people` (write path), BFF route + feature slice summary
- **Deploy:** `_design/app` เปลี่ยนจาก CI/CD เท่านั้น (single writer) — view ใหม่ต้องถูก deploy ก่อน route ใช้งานได้ (`checkViewDeployment` ตรวจให้)
- **Role/permission:** ไม่เพิ่มหรือเปลี่ยน role — ผู้เขียน `station_log` = เครื่อง kiosk (Station 1, device auth ผ่าน BFF) และ `registration_staff` (Station 1–3) ตาม guard ของหน้าที่มีอยู่แล้ว; อ่าน dashboard ตาม guard เดิมของ `/back-office/evacuee-management` (`requireEvacueeRegistration`)
- **Performance:** log เพิ่ม ~2 doc ต่อ station ต่อ evacuee (≤ 6 doc/คน); worker ไม่เปลี่ยน (ไม่มี branch สำหรับ type นี้ → ไม่ rescan ไม่ bump `PROJECTION_VERSION`)
- **PII:** ไม่มี PII (อ้าง `evacuee_id` เท่านั้น) — retention เดียวกับ `movement` (เก็บถึงจบโครงการ)

## Acceptance

- [ ] Kiosk check-in 1 คน → มี `station_log` Station 1 `start` + `complete` (`channel = kiosk`, `device_id` ตรง scanner) และ `duration ≥ 0`
- [ ] Staff report-in → Station 1 log `channel = staff`; เปิดหน้าซ้ำ/refresh ไม่เพิ่ม `start` ซ้ำ
- [ ] Screening บันทึก → Station 2 `complete`; Zoning `check_in` → Station 3 `complete`
- [ ] Bulk zoning → Station 3 `complete` ต่อคน ไม่มี `start`
- [ ] `start` ค้างเกิน 2 ชั่วโมงแล้วเปิดหน้าใหม่ → เขียน `start` ใหม่; duration ไม่ pair กับ `start` เก่า และ `start` เก่าไม่นับใน `open_visits`
- [ ] เขียน log ล้ม → report-in/screening/zoning ยังสำเร็จ + มี warning toast ตามข้อความใน FR-STL-04
- [ ] `station_log` update/delete ถูก `validate_doc_update` ปฏิเสธ; type ที่ไม่อยู่ใน whitelist ยังถูก reject เหมือนเดิม
- [ ] BFF `station-times` คืนค่าเฉลี่ยถูกต้องบน fixture (มี visit ปกติ, `start` ค้าง ≤ 2 ชม., `start` abandoned > 2 ชม., `complete` ไม่มี `start`, `complete` ข้ามเที่ยงคืน) และแยก channel ถูก
- [ ] Domain function pair/average มี unit test; view map ทดสอบด้วย `mapFn(doc, emit)`; BFF route มี `server.test.ts`
- [ ] หน้า summary ผ่าน `svelte-autofixer`; `pnpm check`/`pnpm test` ผ่านใน Lefthook

## Migration

N/A — doc type ใหม่ schema_v 1, additive; ไม่ backfill. evacuee ที่ผ่าน station ก่อน release ไม่มี log (ไม่นับในสรุป).

## Why

- ตัวเลข demo day (kiosk ≤ 1 นาที, Station 1 ผ่าน staff 6–7 นาที เป็นคอขวด) จับด้วยมือ; ต้องการให้ระบบเก็บเอง (MOM ระบุ ปานกลาง)
- **ไม่ reuse `audit`:** enum action ไม่ครอบคลุม station; ข้อมูลจริง 2026-10-24 (local seed `shelter_sh001`–`sh003`) มี `audit` 11 doc ทั้งหมดเป็น `manual_adjust` ของ `donation` — ไม่มี audit ของ evacuee เลย
- **ไม่ reuse `movement`:** ไม่มี field station/channel; Station 1 และ kiosk report-in ไม่เขียน movement (ADR-0001); ขยาย movement ต้องเพิ่ม action + field + schema_v และแก้นิยาม movement = presence event — แยก doc ใหม่กระทบข้อมูลเดิมน้อยกว่า
- **ไม่ใช้ `registered_via`:** บอกแหล่งสร้าง record ไม่ใช่ช่องทางที่ให้บริการ step (CR-149 บรรทัด 65: "registered_via บอกช่องทาง ไม่บอกตำแหน่งใน pipeline") — คน pre-register ผ่าน web แล้ว report-in ที่ kiosk ยังเป็น `web`
- **`current_stay.since`:** snapshot ถูกเขียนทับ ไม่ใช่ประวัติ
- **ซ้ำโดยตั้งใจ:** `complete` ของ Station 2/3 ซ้ำกับ `screening.screened_at` และ movement `check_in.occurred_at`; เก็บซ้ำเพื่อให้ pair จากแหล่งเดียว และเพราะ movement เขียนแบบ best-effort (`people.remote.ts` กลืน error) จึงอาจมีช่องว่าง
- **ชื่อ `station_log` ไม่ใช่ `status_log`:** doc นี้เก็บเฉพาะ start/complete ของ station ไม่ใช่ประวัติ `current_stay.status` ทุกครั้ง
- **Summary ใน CouchDB view + BFF:** worker/Mongo ไม่มี aggregation pipeline; sync spec ห้ามส่ง operational data ขึ้น Mongo; view เป็น pattern เดิมของ dashboard

## Decision log

- 2026-10-24 — proposed (issue #589, PR #852)
- 2026-10-24 — owner เลือก track ด้วย Draft CR file
- 2026-10-24 — owner เลือก doc type ใหม่ (ไม่รวมใน `movement`) แบบ 2 log ต่อ visit (`start`/`complete`) ชื่อ `station_log`
- 2026-10-24 — owner เคาะ: flow hybrid (Station 1 kiosk หรือ staff, Station 2/3 staff เสมอ) · `start` ของ staff = เปิดหน้ากรอกข้อมูล (walk-in หรือ report-in) · dashboard อยู่ใน tab ภาพรวมของ `/back-office/evacuee-management` (ไม่เพิ่ม tab) ต่อท้าย section เดิม มีกราฟต่อ station และกราฟ staff vs kiosk
- 2026-10-24 — owner เคาะ: ไม่เพิ่มกฎ `channel` ใน `validate_doc_update` ตอนนี้ → เปิด issue security concern แยก · role = kiosk + `registration_staff` ตามระบบเดิม (ไม่เปลี่ยน permission)
- 2026-10-25 — approved โดย Soravit Sukkarn (Team Lead) · รันเลข CR-192
- 2026-10-25 — แก้ตาม review PR #852 (approved โดย Soravit Sukkarn): stale window 2 ชม. (FR-STL-13, `open_visits`) · view key date-first + ดึงเกิน 1 วัน (FR-STL-21) · bulk zoning = `complete` อย่างเดียว (FR-STL-16) · ข้อความ warning toast (FR-STL-04) · แยกคำอธิบาย Mango index กับ view · `station` เป็น int
