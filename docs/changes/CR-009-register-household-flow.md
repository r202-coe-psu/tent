---
id: CR-009
title: "Register Flow — แยกการจัดการ Household ไป Stage 3 (Search เดิม = ลูกบ้าน / Create ใหม่ = หัวหน้าบ้าน)"
status: approved
date: 2026-06-24
amended: 2026-06-25
requested_by: development team B
decided_by: product owner
layer: volatile
affects:
  - docs/task-breakdown/02-people.md — T-04 (Description, Flow Path A, DoD)
  - docs/changes/CR-001-people-dod-permission-sync.md — Phase 1B diagram (household optional → mandatory)
  - frontend/src/lib/features/register/ui/stage2-registration.svelte
  - frontend/src/lib/features/register/ui/stage3-head-of-household.svelte
  - frontend/src/lib/features/register/domain/schema.ts
  - frontend/src/routes/api/register/+server.ts
---

# CR-009 — Register Flow: Household Management

> Request change จากทีม B เพื่อให้ปรับ design ของ flow การลงทะเบียนใหม่ — product owner รับและจะปรับให้ตามที่ request มา รายละเอียดต้นทางอยู่ใน [`docs/question/register-household-flow.md`](../question/register-household-flow.md)

## Why

ในขั้นตอน Stage 2 (ข้อมูลผู้ประสบภัย) ของการลงทะเบียน พบปัญหาการตรวจสอบว่า **"มี Household นี้ในระบบแล้วหรือไม่"** — ถ้าผู้ใช้พิมพ์ชื่อ/รายละเอียดผิดเพี้ยน (Typo) ระบบจะค้นหาไม่เจอ และนำไปสู่การสร้าง Household ซ้ำซ้อน

เหตุผลที่ต้องเปลี่ยน:

1. **ลดข้อมูลซ้ำซ้อน (Deduplication):** บังคับให้ค้นหาและเลือกจากฐานข้อมูลก่อน ป้องกันการสร้าง Household ซ้ำจาก Typo
2. **ความสัมพันธ์แม่นยำ (Accurate Relationships):** แยก flow ชัดเจน ช่วยผูกความสัมพันธ์ **ลูกบ้าน** ↔ **หัวหน้าบ้าน** เข้ากับ Household ได้ถูกต้อง
3. **UX ดีขึ้น:** ลดความสับสน, แยกส่วนการจัดการที่อยู่ออกชัดเจน, ลดภาระการกรอกฟอร์มที่อยู่ยาวๆ ซ้ำ หากบ้านหลังนั้นมีข้อมูลอยู่แล้ว

## Change

### 1. ย้ายตำแหน่งฟอร์ม Household (Stage Move)

| | Before | After |
| --- | --- | --- |
| ตำแหน่งฟอร์มที่อยู่ (Household) | Stage 2 (ข้อมูลผู้ประสบภัย) | **Stage 3 (จัดการตั้งค่าหัวหน้าครอบครัว)** |

### 2. ปรับการจัดการ Household เป็น 2 Box (ทางเลือก) ใน Stage 3

| Box | การทำงาน | ผลลัพธ์ (Role assign) |
| --- | --- | --- |
| **Box 1 — Search / Select Household** | ค้นหาบ้านเดิมจากระบบก่อน (AutoComplete จากบ้านเลขที่/ชื่อ) เมื่อเลือกได้ | ระบบผูกบุคคลที่ลงทะเบียนเป็น **"ลูกบ้าน" (Member)** ทันที |
| **Box 2 — Create New Household** | กรณีค้นหาไม่เจอ กรอกข้อมูลที่อยู่ใหม่ตาม flow ปกติ เมื่อบันทึก | ระบบผูกบุคคลที่ลงทะเบียนเป็น **"หัวหน้าบ้าน" (Head)** ทันที |

### 3. Spec update — `docs/task-breakdown/02-people.md` (T-04)

- **Description:** ระบุชัดว่าการจัดการ/ตั้งค่า Household ย้ายไปอยู่ **Stage 3** เพื่อลดความสับสนกับฟอร์มข้อมูลบุคคลใน Stage 2
- **Flow — Path A (สร้าง ณ จุดรับ):** เพิ่มทางเลือกย่อย
  - **A.1 ค้นหาบ้านเดิม:** พบ → เลือกเพื่อผูกเป็น **ลูกบ้าน**
  - **A.2 สร้างบ้านใหม่:** ไม่พบ → กรอกที่อยู่ใหม่ ระบบผูกเป็น **หัวหน้าบ้าน** อัตโนมัติ (พร้อม emergency contact), validate → ออก Shelter ID + QR (T-05) เฉพาะกรณีสร้างใหม่
- **DoD เพิ่ม:**
  - API + UI ของ Stage 3 แบ่งแยก flow ค้นหาที่อยู่เดิม (ลูกบ้าน) และสร้างที่อยู่ใหม่ (หัวหน้าบ้าน) ชัดเจน
  - ระบบ assign role สมาชิก (ลูกบ้าน/หัวหน้าบ้าน) ตรงตามเงื่อนไขทางเลือกโดยอัตโนมัติ

## Impact

- `frontend/src/lib/features/register/ui/stage2-registration.svelte` — ถอดฟอร์ม/Input ที่เกี่ยวกับ Household ออก
- `frontend/src/lib/features/register/ui/stage3-head-of-household.svelte` — เพิ่ม component จัดการ Household แบ่งเป็น 2 Box (Search Box + Create Form)
- `frontend/src/lib/features/register/domain/schema.ts` — ปรับ Zod schema ตาม state ใหม่ (เลือกลูกบ้าน → ตรวจแค่ `household_id`; สร้างใหม่ → ตรวจข้อมูลที่อยู่ครบ)
- `frontend/src/routes/api/register/+server.ts` — ปรับ logic ฝั่งหลังบ้านรองรับ Stage 3 สองรูปแบบ บันทึกความสัมพันธ์ (ลูกบ้าน vs หัวหน้าบ้าน) ถูกต้อง + ส่งต่อ state Stage 2 → Stage 3 ใน Svelte store
- `docs/task-breakdown/02-people.md` — แก้ T-04 (Description, Flow Path A, DoD)
- `docs/changes/_index.md` — เพิ่มแถวบันทึก CR-009

## Migration

N/A — ไม่มีการ bump `schema_v` (ไม่เปลี่ยนรูปแบบ persisted document; เปลี่ยนเฉพาะ flow/UI และ validation รูปแบบ input)

## Decision log

- 2026-06-24 — proposed (request change จากทีม B ขอปรับ design flow ใหม่)
- 2026-06-24 — **approved** by product owner — รับและจะปรับ design ให้ตามที่ request มา
- 2026-06-25 — **amend:** Stage 3 บังคับทุก person — ไม่มี skip path; **household เป็น required ไม่ใช่ optional** (override CR-001 Phase 1B ที่บอกว่า "person อยู่โดยไม่มี household ได้"); solo evacuee = สร้าง household ใหม่ขนาด 1 คน (head_evacuee_id = ตัวเอง); แก้ไข task-breakdown/02-people.md T-04 DoD บรรทัดที่เกี่ยวข้องแล้ว — เหตุผล: ต้องการเก็บ address ของที่อยู่เดิม (CR-011) ซึ่งอยู่ระดับ household; person ที่ไม่มี household จะไม่มีที่เก็บ address

## Amendment (2026-06-25) — Household Mandatory

### สิ่งที่เปลี่ยน

| | Before (CR-001 / task-breakdown เดิม) | After (amend นี้) |
| --- | --- | --- |
| household requirement | optional — "person อยู่โดยไม่มี household ได้ตามปกติ" | **required** — ทุก person ต้องมี household |
| Stage 3 | 2 ทางเลือก (join / create) — implicit skip ได้ | 2 ทางเลือก (join / create) — **ไม่มี skip** |
| solo evacuee | `household_id = null` ได้ | สร้าง household ขนาด 1 คน (`head_evacuee_id = ตัวเอง`) |
| address storage | N/A | address เก็บใน household เสมอ (CR-011) |

### เหตุผล
- CR-011 เพิ่ม address fields ที่ระดับ household — ถ้า household optional จะมี person ที่ไม่มีที่เก็บ address
- CR-009 Stage 3 flow ไม่มี skip path อยู่แล้ว — amend นี้แค่ประกาศชัดเจนตาม intent เดิม
