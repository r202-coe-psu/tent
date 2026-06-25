---
id: CR-011
title: "Household Schema & UI — เพิ่มฟิลด์ที่อยู่ครอบครัวหลัก (Primary Household Address)"
status: proposed
date: 2026-06-25
requested_by: development team B
decided_by: project owner 
layer: volatile
affects:
  - docs/data/schema.md §1.3 — schema_v 1 → 2 (เพิ่มที่อยู่ครอบครัวหลัก)
  - frontend/src/lib/features/people/domain/people.ts
  - frontend/src/lib/features/people/domain/people.test.ts
  - frontend/src/lib/features/people/ui/household-form.svelte
---

# CR-011 — Household Schema & UI: Primary Household Address Fields

## Why

### 1. ปัญหาที่เจอ (Problem Encountered)
ในการออกแบบหน้าจอ UI สำหรับการจัดการข้อมูลครอบครัว (Household) และขั้นตอนการลงทะเบียนผู้ประสบภัย (Registration Flow Stage 3) พบว่าหน้าจอการกรอกข้อมูลครอบครัวมีฟิลด์สำหรับระบุ **"ที่อยู่ครอบครัวหลัก" (Primary Household Address)** เพื่อระบุที่พักเดิมของผู้อพยพ ได้แก่:
* บ้านเลขที่ (House No. / `address_no`)
* หมู่ที่ / ตรอก / ซอย / ถนน (Moo / Alley / Lane / Road / `village_no`)
* ตำบล / แขวง (Subdistrict / Khwaeng / `subdistrict`)
* อำเภอ / เขต (District / Khet / `district`)
* จังหวัด (Province / `province`)
* รหัสไปรษณีย์ (Postal Code / `postal_code`)

อย่างไรก็ดี ในโครงสร้างข้อมูลข้อกำหนด (Spec) ปัจจุบันตามเอกสาร `docs/data/schema.md` §1.3 สำหรับข้อมูลครอบครัว (`household:{ulid}`) มีเพียงฟิลด์ `zone` (โซนที่จัดสรรให้พักในศูนย์อพยพ) และไม่มีฟิลด์โครงสร้างที่อยู่เดิมเหล่านี้ระบุไว้เลย (Specification Gap) ส่งผลให้ข้อมูลที่กรอกผ่านหน้าจอ UI ไม่สามารถถูกส่งและจัดเก็บลงสู่ฐานข้อมูล CouchDB/PouchDB ได้อย่างสมบูรณ์

### 2. เหตุผลที่เปลี่ยน (Reason for Change)
* **ความครบถ้วนสมบูรณ์ของข้อมูล (Data Completeness):** ที่อยู่เดิมของผู้อพยพเป็นข้อมูลสำคัญในการคัดกรอง การติดต่อติดตามตัวในระยะยาวหลังจากปิดศูนย์อพยพ และการรายงานผลส่งต่อไปยังหน่วยงานด้านสวัสดิการหรือหน่วยงานภายนอก
* **ลดความซ้ำซ้อนด้วยหลักการแชร์ข้อมูลในครอบครัว (Shared Family Address):** การจัดเก็บที่อยู่ไว้ที่ระดับ Household (ไม่ใช่บันทึกรายคน) ช่วยลดความซ้ำซ้อนของข้อมูล และสอดคล้องกับพฤติกรรมใน UI ที่ระบุว่า *"การแก้ไขที่อยู่จะอัปเดตข้อมูลของทุกคนในครอบครัวอัตโนมัติ"* เมื่อแก้ไขที่ระดับครัวเรือน ข้อมูลสมาชิกในครอบครัวทั้งหมดก็จะได้รับการอ้างอิงข้อมูลที่อยู่นี้ตรงกันทันที
* **ป้องกันข้อมูลสูญหาย (Prevent Data Loss):** ทำให้ Data Contract ระหว่าง UI Form, Zod validation schema, และ Database Model มีความสอดคล้องกันอย่างถูกต้อง

## Change

### 3. วิธีการเปลี่ยนแปลง (Proposed Changes)
* **Before**: เอกสารครอบครัว (`household`) มีเพียงฟิลด์ `label`, `head_evacuee_id`, `zone`, `pets`, `notes` และมีเวอร์ชัน `schema_v: 1`
* **After**: เพิ่มฟิลด์ที่อยู่แบบ Flat fields อยู่ที่ Root ของเอกสาร `household` และปรับ `schema_v` เป็น `2`

#### Interface `Household` ใน `domain/people.ts`:
```typescript
export interface Household extends BaseDoc {
	type: 'household';
	label: string;
	head_evacuee_id: string | null;
	zone: string | null;
	pets: PetGroup[];
	notes?: string;
	address_no?: string;
	village_no?: string;
	subdistrict?: string;
	district?: string;
	province?: string;
	postal_code?: string;
}
```

#### การปรับปรุง Domain & UI Layer:
1. **Domain Layer**: อัปเดต `householdInputSchema` ใน `people.ts` ให้รองรับการตรวจสอบฟิลด์ที่อยู่ทั้ง 6 แบบเลือกกรอกได้ (optional) และปรับปรุงฟังก์ชัน `createHousehold` ให้แมปฟิลด์เหล่านี้ลงในตัวเอกสาร `household` (พร้อมอัปเดตเวอร์ชัน `schema_v` เป็น 2)
2. **UI Layer**: ปรับปรุงฟอร์มครอบครัว (เช่น ใน Stage 3 ในการลงทะเบียน) ให้มี Input elements ทั้ง 6 ช่องเชื่อมต่อกับ Zod schema และบันทึกข้อมูลเข้าฐานข้อมูล PouchDB/CouchDB
3. **Test Layer**: อัปเดตยูนิตเทสต์ใน `people.test.ts` เพื่อครอบคลุมการตรวจสอบฟิลด์ที่อยู่และทดสอบ `schema_v` เป็น 2

## Impact

### 4. ไฟล์ที่ได้รับผลกระทบ (Affected Files)
* **`docs/data/schema.md`** §1.3 — เพิ่มฟิลด์ที่อยู่และปรับ `schema_v` ของ household เป็น 2
* **`docs/changes/_index.md`** — บันทึกดัชนี CR-011
* **`frontend/src/lib/features/people/domain/people.ts`** — อัปเดต Type interface, `householdInputSchema`, และ `createHousehold` factory (ปรับ `schema_v` เป็น 2)
* **`frontend/src/lib/features/people/domain/people.test.ts`** — อัปเดตยูนิตเทสต์ให้ตรวจสอบฟิลด์ที่อยู่และ `schema_v: 2`
* **`frontend/src/lib/features/people/ui/household-form.svelte`** — เพิ่มฟิลด์ UI Input ทั้ง 6 ฟิลด์เชื่อมกับฟอร์มครอบครัวหลัก

## Migration

### 5. สิ่งที่ต้องปรับ Spec (Spec Updates & Migration)

#### 5.1 รายละเอียดการปรับเอกสาร Spec `docs/data/schema.md` §1.3 (Household)
ในตารางฟิลด์ของเอกสาร `household` ให้เพิ่มและปรับปรุงดังนี้:

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `schema_v` | int | req | bump `1` → `2` |
| `address_no` | str\|null | opt | บ้านเลขที่ เช่น `"123/45"` |
| `village_no` | str\|null | opt | หมู่ที่ / ตรอก / ซอย / ถนน เช่น `"หมู่ 2"` |
| `subdistrict` | str\|null | opt | ตำบล / แขวง เช่น `"หาดใหญ่"` |
| `district` | str\|null | opt | อำเภอ / เขต เช่น `"หาดใหญ่"` |
| `province` | str\|null | opt | จังหวัด เช่น `"สงขลา"` |
| `postal_code` | str\|null | opt | รหัสไปรษณีย์ เช่น `"90110"` |

#### 5.2 การจัดการกับข้อมูลที่บันทึกไปแล้ว (Migration Strategy)
* **Schema version bump:** `household` schema version 1 → 2
* **Backward Compatibility (Lazy migration on read):**
  เมื่ออ่านเอกสารครอบครัวเดิมที่มี `schema_v == 1` ระบบจะมองฟิลด์ที่อยู่เหล่านี้เป็น `undefined` ซึ่งปลอดภัยและสอดคล้องกับการทำงานแบบ Schema-less ของฐานข้อมูล โดยไม่ส่งผลกระทบต่อข้อมูลเดิม และไม่มีความจำเป็นต้องเขียนสคริปต์ย้ายข้อมูล (Batch script)

## Decision log
- 2026-06-25 — proposed (ริเริ่มเสนอ Change Request เพื่อปิด Gap ระหว่างการออกแบบ UI และฐานข้อมูล Spec)
- 2026-06-25 — aligned code implementation: ตัดสินใจเก็บฟิลด์ในรูปแบบแบนราบ (Flat fields) อยู่ที่ระดับ Root ของเอกสาร เพื่อความเรียบง่ายและลดความซับซ้อนในการทำแบบสอบถามและการทำดัชนี (Indexing)
