---
id: CR-029
title: Household Schema — เพิ่มฟิลด์สถานะ (status) และฟิลด์จุดหมายเช็คเอาต์ (checkout_destination) เพื่อรองรับวงจรชีวิตครัวเรือน (T-04/T-06); schema_v 3 → 4
status: proposed
date: 2026-07-01
updated: 2026-07-03
requested_by: development team B
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §1.3
  - docs/task-breakdown/02-people.md T-04, T-05, T-06
  - schema_v 3 → 4
  - frontend/src/lib/features/people/domain/people.ts
---

# CR-029 — Household status field

> [!NOTE]
> **สรุป (TL;DR):** เพิ่มฟิลด์ `status` และ `checkout_destination` ในเอกสาร `household` เพื่อรองรับวงจรสถานะการเช็คอิน/เช็คเอาต์และเก็บสถิติจุดหมายปลายทางตามสเปก T-06 · Bump `schema_v` ของ household จาก 3 ➔ 4 · ปรับปรุงหน้าจอลงทะเบียน (Stage 3) หน้า Check-in (inline screening) และหน้า Check-out (บังคับปลายทาง) · กำหนดแนวทางการทำ Migration ข้อมูลเก่าแบบถอยหลังเข้ากันได้ (Backward Compatibility)

## Why

ในระบบรับคนเข้าศูนย์ (`docs/task-breakdown/02-people.md` §T-06) กำหนดให้ครัวเรือนมีวงจรสถานะ (`pre-registered` ➔ `arriving` ➔ `checked-in` ➔ `checked-out` / `cancelled`) และเมื่อทำ Check-out จะต้องระบุและบันทึกจุดหมายปลายทาง (`checkout_destination`) เสมอ แต่ในสเปกฐานข้อมูลและโค้ดปัจจุบันยังไม่มีฟิลด์สำหรับจัดเก็บข้อมูลส่วนนี้ ทำให้ระบบไม่สามารถเก็บประวัติการเช็คอิน-เอาต์ในระดับครัวเรือน หรือแสดงผลความเปรียบต่างระหว่าง "การจองล่วงหน้า (Reserved)" และ "การพักจริง (Occupied)" บนแดชบอร์ดตามเกณฑ์ความสำเร็จ (DoD) ของ T-04 และ T-06 ได้ จึงจำเป็นต้องปรับปรุงสเปกและโครงสร้างโมเดล

## Change

### 1. Database Schema (`docs/data/schema.md` §1.3)

**Before (schema_v: 3):**
- ไม่มีฟิลด์ `status` และ `checkout_destination` ในเอกสาร `household`

**After (schema_v: 4):**
- เพิ่มฟิลด์ `status` และ `checkout_destination` ในเอกสาร `household` โดยมีรายละเอียดการปรับปรุงดังนี้:

| Field | ชนิด | req | สถานะการเปลี่ยนแปลง | คำอธิบาย / หมายเหตุ |
| --- | --- | --- | --- | --- |
| `status` | enum(`pre-registered`, `arriving`, `checked-in`, `checked-out`, `cancelled`) | req | **[NEW]** | สถานะปัจจุบันของครัวเรือน (ค่าเริ่มต้นคือ `'arriving'` สำหรับกรณีลงทะเบียนทั่วไป หรือ `'pre-registered'` เมื่อลงล่วงหน้า) |
| `checkout_destination` | {`type`:enum(`returned_home`,`transferred_shelter`,`referred_facility`,`other`), `destination_name`:str?, `notes`:str?} \| null | opt | **[NEW]** | รายละเอียดปลายทางหลังจากเช็คเอาต์ออกจากศูนย์พักพิง (ต้องระบุค่าเมื่อ `status = 'checked-out'`) |

---

### 2. Creation Paths & Status Lifecycle (T-04)

การประยุกต์ใช้เพื่อรองรับ 3 Creation Paths ใน WBS T-04:

| Path | บทบาท (Who) | เงื่อนไขการสร้าง (When) | สถานะเริ่มต้น (Initial Status) | การออก ID & QR | การจัดโซน (Zone Allocation) |
| --- | --- | --- | --- | --- | --- |
| **Path A — สร้าง ณ จุดรับ** | VOL | ครอบครัวมาถึงพร้อมกัน | `arriving` | ออกทันที (T-05) | แนะนำโซนทันที (non-blocking) และ Check-in ต่อ |
| **Path B — Pre-registration** | SM / VOL (backoffice) | รับแจ้งล่วงหน้าว่าจะมา | `pre-registered` | ออกทันที (ส่ง/พิมพ์ล่วงหน้าได้) | จองโซนล่วงหน้าได้ (Reserved, ไม่นับ Occupancy) |
| **Path C — Post-arrival grouping** | SM / VOL | ผู้อพยพเช็คอินแยกกันแล้วมารวมกลุ่ม | `checked-in` | ออกทันที | ใช้โซนที่เข้าพักอยู่เดิม |

---

### 3. Lifecycle Transitions & Occupancy Impact (T-06)

ความสอดคล้องกันของสถานะและผลกระทบต่อ Occupancy:

| สถานะปัจจุบัน (From) | สถานะถัดไป (To) | ตัวกระตุ้น (Trigger / Action) | ผลกระทบต่อความจุศูนย์ (Occupancy / Reservation) | รายละเอียด (Audit logging) |
| --- | --- | --- | --- | --- |
| — | `pre-registered` | SM/VOL ทำ Pre-registration | Reserved +N (จองพื้นที่) | บันทึก Timestamp + Actor |
| `pre-registered` | `checked-in` | สแกน QR / ค้นหา เพื่อ Check-in จริง | Reserved -N, Occupancy +N | บันทึก Timestamp + Actor (เจ้าหน้าที่) |
| `pre-registered` | `cancelled` | SM ยกเลิกการจองที่หมดเวลา/ไม่มา | Reserved -N | บันทึก Actor |
| — | `arriving` | VOL บันทึกข้อมูล ณ จุดรับ | ไม่มีผลกระทบ | บันทึก Timestamp + Actor |
| `arriving` | `checked-in` | ทำ screening + ยืนยัน Check-in | Occupancy +N | บันทึก Timestamp + Actor |
| `checked-in` | `checked-out` | ทำการ Check-out ครัวเรือน | Occupancy -N (ลดลงตามจำนวนจริง) | บังคับระบุ `checkout_destination` + Timestamp + Actor |

---

### 4. Checkout Destination Constraints (T-06)

การตรวจสอบความถูกต้องและข้อบังคับข้อมูลจุดหมายปลายทางในการเช็คเอาต์:

| ปลายทาง (`checkout_destination.type`) | ฟิลด์ที่บังคับกรอกเพิ่มเติม | ตัวอย่าง / คำอธิบาย |
| --- | --- | --- |
| `returned_home` (กลับบ้าน) | — (ไม่ต้องกรอกฟิลด์เพิ่ม) | ผู้อพยพเดินทางกลับภูมิลำเนาเดิม |
| `transferred_shelter` (ย้ายศูนย์อพยพอื่น) | `destination_name` (รหัสหรือชื่อศูนย์ปลายทาง) | บังคับกรอกชื่อ/รหัสศูนย์อพยพปลายทางที่จะส่งตัวไป |
| `referred_facility` (ส่งตัวไปสถานพยาบาล/อื่น) | `destination_name` (ชื่อสถานที่ช่วยเหลือปลายทาง) | บังคับกรอกชื่อโรงพยาบาล, วัด, หรือสถานพักพิงของญาติ |
| `other` (อื่นๆ) | `notes` (หมายเหตุคำอธิบายเหตุผล) | บังคับระบุคำอธิบาย/เหตุผลอื่นประกอบการเช็คเอาต์ |

---

### 5. Domain Layer (`frontend/src/lib/features/people/domain/people.ts`)

- เพิ่มและอัปเดต Zod Schemas (`householdStatusSchema` และ `checkoutDestinationSchema`)
- อัปเดต `Household` interface และ Zod input schema (`householdInputSchema`) โดยให้ `status` มีค่าเริ่มต้นเป็น `'arriving'` และ `checkout_destination` มีค่าเริ่มต้นเป็น `null`
- อัปเดต `createHousehold` factory function ให้ตั้ง `schema_v` เป็น `4`

---

### 6. Requirements (R-29-1 ถึง R-29-9)

- **R-29-1** — **Zod Schema & Types**: ใน `people.ts` ต้องเพิ่มและส่งออก Zod Schema สำหรับ `status` (enum ของ `pre-registered`, `arriving`, `checked-in`, `checked-out`, `cancelled`) และ `checkout_destination` (type เป็น enum: `returned_home`, `transferred_shelter`, `referred_facility`, `other`; destination_name และ notes เป็น optional text)
- **R-29-2** — **Household Interface Update**: `Household` interface ต้องมีฟิลด์ `status` และ `checkout_destination` ตามสเปก schema
- **R-29-3** — **Factory Update**: ฟังก์ชัน `createHousehold` ต้องกำหนด `schema_v: 4` และตั้งค่า default ให้ `status` และ `checkout_destination` กรณีไม่มีส่งเข้ามา
- **R-29-4** — **Automatic Solo Household**: เมื่อลงทะเบียนผู้ประสบภัยคนเดียว (Solo Evacuee) ระบบต้องเรียก `createHousehold` เพื่อสร้างครัวเรือนขนาด 1 คนโดยอัตโนมัติ (ให้ `head_evacuee_id = evacuee._id` และตั้งชื่อครอบครัวอิงตามชื่อผู้ลงทะเบียน เช่น `"ครอบครัวสมชาย ใจดี"`)
- **R-29-5** — **Validation (Block Duplicates)**: ในขั้นตอนการเพิ่มสมาชิกหรือหัวหน้าในฟอร์มครอบครัว (`household-form.svelte`) หากพบว่าบุคคลดังกล่าวเป็นสมาชิกของครัวเรือนอื่นที่มีสถานะแอคทีฟอยู่ (ไม่ใช่ `cancelled` หรือ `checked-out`) ระบบต้องแสดงแจ้งเตือน (Toast สีแดง) และไม่ยอมให้ทำรายการต่อ
- **R-29-6** — **Vulnerability & Screening Inline**: หน้า Check-in ต้องมี UI ค้นหา/สแกน QR Code ครัวเรือน และแสดงฟอร์มประเมินความเปราะบาง (Screening: vulnerability flags & special needs) บนหน้าตรวจรับแบบ inline
- **R-29-7** — **Non-blocking Zone Suggestion**: ระบบจะแนะนำโซนที่เหมาะสมในหน้า Check-in (จากเกณฑ์ T-09) แบบแจ้งเตือน (warning-only/non-blocking) เจ้าหน้าที่สามารถยืนยันเลือกหรือ override เปลี่ยนโซนได้โดยไม่ต้องรอการยืนยันจากโซน
- **R-29-8** — **Checkout Destination Constraint**: เมื่อทำ Check-out ครัวเรือน ระบบต้องบังคับให้เลือก `checkout_destination.type` และกรอกข้อมูลที่จำเป็นตามเงื่อนไข (ระบุชื่อศูนย์เมื่อย้ายศูนย์, ระบุชื่อสถานที่เมื่อส่งตัว, หรือระบุหมายเหตุเมื่อเลือกอื่นๆ) ก่อนที่จะทำการบันทึก
- **R-29-9** — **Status Transition Logging**: บันทึกวันเวลา (timestamp) และชื่อเจ้าหน้าที่ผู้ดำเนินการลงในเอกสารทุกครั้งที่มีการเปลี่ยนสถานะครัวเรือน (`pre-registered` ➔ `checked-in` / `checked-in` ➔ `checked-out`)

---

### 7. WBS DoD Alignments

เพื่อให้ WBS สอดคล้องกับการเปลี่ยนแปลงนี้ DoD ของ T-04, T-05, T-06 ใน `docs/task-breakdown/02-people.md` จะต้องได้รับการอัปเดตตามรายละเอียดในตารางนี้:

| Task ID | Feature Name | การปรับปรุง Definition of Done (DoD) จาก CR-029 |
| --- | --- | --- |
| **T-04** | Household create + attach members + head | - เพิ่มการรองรับ 3 Creation Path และเซตสถานะเริ่มต้น (`arriving` / `pre-registered` / `checked-in`) อัตโนมัติ<br>- บังคับใช้เงื่อนไข Solo Evacuee = household ขนาด 1 คน (head = ตัวเอง)<br>- ตรวจสอบ validation เพื่อป้องกันการจองซ้อน (1 person พักใน active household ได้เพียงแห่งเดียว)<br>- บันทึก status ลง CouchDB พร้อม `schema_v: 4` |
| **T-05** | Household Shelter ID/QR generation | - ต้องออก QR Code ระดับ household ทันทีที่ถูกบันทึก (รวมทั้งกรณีที่สร้างขึ้นเป็น `pre-registered` ด้วย)<br>- แสดงผล QR Code บนโมบายล์และหน้าพิมพ์ slip/card |
| **T-06** | Household search + check-in/out | - รองรับ Lifecycle Transition: `pre-registered -> checked-in`, `checked-in -> checked-out`, `pre-registered -> cancelled`<br>- ตรวจจับการสแกน QR และค้นหาเพื่อทำ Check-in โดยมี screening inline<br>- บังคับระบุ `checkout_destination` เสมอก่อน Check-out และตรวจสอบฟิลด์ตามเงื่อนไขที่กำหนด<br>- ปรับลด/เพิ่ม occupancy หลังการเคลื่อนไหว (movement) ทันที |

---

### 8. Acceptance Criteria (DoD)

- [ ] Zod schema ใน `people.ts` ตรวจสอบความถูกต้องของข้อมูล `Household` schema_v 4 ผ่าน
- [ ] เมื่อสร้าง Solo Evacuee ระบบสร้างครัวเรือนขนาด 1 คนโดยอัตโนมัติสำเร็จ
- [ ] การเลือกบุคคลที่มีสถานะอยู่ในครัวเรือนแอคทีฟอื่นแสดงผลแจ้งเตือนและบล็อกไม่ให้เพิ่มสำเร็จ
- [ ] หน้า Check-in แสดงประวัติและข้อมูล screening แบบ inline และสามารถเปลี่ยนสถานะเป็น `checked-in` พร้อมบันทึกผู้ดำเนินการ
- [ ] หน้า Check-out บังคับให้เลือกปลายทางและกรอกข้อมูลที่กำหนดสำเร็จ ก่อนอัปเดตเป็น `checked-out` และหักยอด Occupancy
- [ ] ตรรกะ lazy migration (`migrateHouseholdV3ToV4`) แปลงเอกสาร schema_v 1-3 มาเป็น v4 โดยไม่มีปัญหา
- [ ] Unit test สำหรับการจำลองสแกนและเปลี่ยนสถานะ และเช็คเงื่อนไขห้ามครอบครัวซ้ำซ้อนผ่านทั้งหมด

## Impact

**Docs:**
- `docs/data/schema.md` §1.3 — ปรับปรุงตารางฟิลด์และบันทึก Migration ของ household เป็น v4
- `docs/task-breakdown/02-people.md` — อัปเดต WBS Wording และ WBS DoD ของ T-04, T-05, T-06

**Code & Tests:**
- `frontend/src/lib/features/people/domain/people.ts`
- `frontend/src/lib/features/people/ui/household-form.svelte`
- `frontend/src/lib/features/people/ui/household-form-members-section.svelte`
- `frontend/src/lib/features/people/ui/household-register-form.svelte`
- `frontend/src/routes/(protected)/back-office/households/[mode]/[[id]]/`
- `frontend/src/lib/features/people/domain/people.test.ts`

## Migration

เมื่อทำการอัปเกรดฐานข้อมูลไปยัง `schema_v: 4` การอ่านข้อมูลแบบ Offline-first จะใช้แนวทาง **Read-on-open (Lazy Migration)** เพื่อคงสภาพย้อนหลังของเอกสารรุ่น v1-v3 โดยไม่มีผลกระทบต่อตัวระบบหลัก:

```typescript
function migrateHouseholdV3ToV4(doc: any): Household {
	if (doc.schema_v && doc.schema_v < 4) {
		return {
			...doc,
			schema_v: 4,
			status: doc.status || 'checked_in', // หากไม่มีสถานะ ให้ default เป็น checked_in
			checkout_destination: doc.checkout_destination || null
		};
	}
	return doc;
}
```

## Decision log

- 2026-07-03 — proposed 
