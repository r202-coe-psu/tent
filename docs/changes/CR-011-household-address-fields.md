---
id: CR-011
title: "Household Schema — เพิ่มฟิลด์ที่อยู่ครอบครัวหลัก (Primary Household Address) + municipality_zone + community"
status: proposed
date: 2026-06-25
requested_by: development team B
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §1.3 — schema_v 1 → 2 (ลบ zone, เพิ่ม municipality_zone + community + ที่อยู่ 6 ฟิลด์)
  - docs/data/schema.md §3.3 — master_data: เพิ่ม type municipality_zone + community
  - frontend/src/lib/features/people/domain/people.ts
  - frontend/src/lib/features/people/domain/people.test.ts
  - frontend/src/lib/features/people/ui/household-form.svelte
---

# CR-011 — Household Schema & UI: Primary Household Address + Zone/Community Fields

## Why

### 1. ปัญหาที่เจอ (Problem Encountered)

ในการออกแบบหน้าจอ UI สำหรับการจัดการข้อมูลครอบครัว (Household) พบปัญหาหลายจุด:

1. **Specification Gap:** โครงสร้างข้อมูล `household` ใน `docs/data/schema.md` §1.3 ไม่มีฟิลด์ที่อยู่เดิม (`address_no`, `subdistrict`, ฯลฯ) ทำให้ข้อมูลที่กรอกผ่าน UI ไม่สามารถบันทึกลง PouchDB/CouchDB ได้

2. **Zone Ambiguity:** ฟิลด์ `zone` ใน `household` ไม่ชัดเจน — ชื่อซ้ำกับ `evacuee.current_stay.zone` (โซนในศูนย์อพยพ) แต่ความหมายต่างกัน:
   - `evacuee.current_stay.zone` = โซนพักในศูนย์อพยพ (เช่น "อาคาร A")
   - `household.zone` ควรหมายถึง **เขตทางภูมิศาสตร์ของที่อยู่เดิม** (เช่น เขต 1–4 ของเทศบาลนครหาดใหญ่)

3. **Missing Community Field:** ไม่มีฟิลด์ระบุ "ชุมชน" ซึ่งเป็นหน่วยงานบริหารย่อยของเทศบาล (101–102 ชุมชนในหาดใหญ่) มีประโยชน์สำหรับการรายงาน/ติดตาม

### 2. เหตุผลที่เปลี่ยน (Reason for Change)

* **Data Completeness:** ที่อยู่เดิมของผู้อพยพจำเป็นสำหรับการติดตามหลังปิดศูนย์และรายงานส่งหน่วยงานภายนอก
* **Shared Family Address:** เก็บที่อยู่ระดับ Household ลดความซ้ำซ้อน — แก้ครั้งเดียวอัปเดตทุกคนในครอบครัว
* **Clarity:** เปลี่ยน `zone` → `municipality_zone` กันความสับสนกับ `current_stay.zone` ของ evacuee
* **Administrative Granularity:** ชุมชน (`community`) เป็นหน่วยงานบริหารย่อยของเทศบาล — ใช้วางแผนการช่วยเหลือและรายงานตามเขต

## Change

### 3. วิธีการเปลี่ยนแปลง

* **Before:**
  - `household` มีฟิลด์ `zone` (ความหมายคลุมเครือ) และไม่มีฟิลด์ที่อยู่หรือชุมชน
  - `schema_v: 1`
* **After:**
  - ลบ `zone` ออก; เพิ่ม `municipality_zone` + `community` (ค่าจาก `master_data` — CR-012)
  - เพิ่มฟิลด์ที่อยู่แบบ flat 6 ฟิลด์
  - `schema_v: 2`

#### Interface `Household` ใน `domain/people.ts`:
```typescript
export interface Household extends BaseDoc {
	type: 'household';
	label: string;
	head_evacuee_id: string | null;
	municipality_zone: string | null; // code จาก master_data:municipality_zone (เขต 1-4)
	community: string | null;         // code จาก master_data:community (ชุมชน, filter by zone)
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
1. **Domain Layer:** อัปเดต `householdInputSchema` ให้รองรับ `municipality_zone`, `community`, และฟิลด์ที่อยู่ 6 ฟิลด์ (optional); อัปเดต `createHousehold` factory ให้ map ฟิลด์ใหม่ลงเอกสาร (พร้อม `schema_v: 2`)
2. **UI Layer:** เพิ่ม dropdown `municipality_zone` (4 ตัวเลือก จาก master_data) และ dropdown `community` (filter ตาม zone ที่เลือก); เพิ่ม Input 6 ช่องที่อยู่
3. **Test Layer:** อัปเดตยูนิตเทสต์ครอบคลุมฟิลด์ใหม่และ `schema_v: 2`

## Impact

### 4. ไฟล์ที่ได้รับผลกระทบ

* **`docs/data/schema.md`** §1.3 — ลบ `zone`, เพิ่ม `municipality_zone` + `community` + ที่อยู่ 6 ฟิลด์, bump `schema_v` 1→2; §3.3 master_data types
* **`docs/changes/_index.md`** — บันทึกดัชนี CR-011
* **`frontend/src/lib/features/people/domain/people.ts`** — อัปเดต Type interface, `householdInputSchema`, `createHousehold` factory
* **`frontend/src/lib/features/people/domain/people.test.ts`** — อัปเดตยูนิตเทสต์
* **`frontend/src/lib/features/people/ui/household-form.svelte`** — เพิ่ม dropdown zone/community + Input ที่อยู่ 6 ฟิลด์

### 5. Dependency

* **CR-012 (Master Data Engine)** — `municipality_zone` และ `community` dropdown ใน UI ต้องการข้อมูลจาก `master_data:municipality_zone` และ `master_data:community` ใน `registry` DB; Phase 1 ของ CR-012 ต้อง implement ก่อน household-form จึง wire dropdown ได้

## Migration

### 6. Migration Strategy

* **Schema version bump:** `household` schema_v 1 → 2
* **ลบ `zone`:** ไม่มีข้อมูล production ณ วันที่ bump — ไม่ต้อง backfill
* **Backward Compatibility:** doc เดิม (schema_v 1) ไม่มีฟิลด์ใหม่ = `undefined` → ปลอดภัย, ไม่ต้อง migration script

## Decision log
- 2026-06-25 — proposed (CR-011 เพื่อปิด gap ระหว่าง UI form กับ DB schema)
- 2026-06-25 — rename `zone` → `municipality_zone`; เพิ่ม `community`; ตัดสินใจ flat fields ที่ root เพื่อความเรียบง่าย
- 2026-06-25 — `municipality_zone` + `community` เป็น code string (ไม่ใช่ label) — lookup label จาก `master_data` ตอน render; ค่าใน DB คือ code เพื่อให้ query/index ง่าย
- 2026-06-25 — บอก CR-012 ให้เพิ่ม master_type `municipality_zone` + `community` (รวม seeding data จาก Wikipedia); household-form wires dropdown หลัง CR-012 Phase 1 done
