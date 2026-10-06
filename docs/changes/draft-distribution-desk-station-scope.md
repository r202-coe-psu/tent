---
id: draft
title: Distribution Desk (Station 4) — หน้าเดียว 5 ขั้นแทนหน้าจอ 13–17, role ต่อขั้น, การเลือกตั๋วของจุดแจก และยอดของยืมตอนปิดรอบ
status: proposed
date: 2026-10-06
updated: 2026-10-06
requested_by: ทีม frontend (รับช่วง `/onsite/distribution` ต่อ)
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/changes/CR-121-spec-ticket.md §5 ตาราง Screen/Role (หน้าจอ 13–17), FR-DST-05, FR-LON-02
  - docs/prd/role-permission-matrix.md (แถวแจกอาหาร — RM:85)
  - docs/data/schema.md §2.29 (`destination_location`), §2.30 (กติกา shift close ของ `is_returnable`)
  - docs/sitemap.md (ยังไม่มี `/onsite/distribution`)
  - schema_v — ไม่เปลี่ยน
  - frontend/src/routes/(protected)/onsite/distribution/+page.ts (guard)
  - frontend/src/lib/features/distribution/application/food-supplies/auth.ts
  - frontend/src/lib/features/distribution/ui/frontline/FrontlineStationPage.svelte
---

# Distribution Desk (Station 4) — ขอบเขตหน้าจอและ role

> **สรุป (TL;DR)**
> - **เปลี่ยนอะไร:** รับรองหน้า `/onsite/distribution` แบบ 1 หน้า 5 ขั้น (as-built, PR #312) แทนหน้าจอแยก 13–17 ของ CR-121; กำหนด role ต่อขั้นให้ไม่ขัดกันระหว่าง CR-121 / role matrix / VDU; นิยามว่าจุดแจกเห็นตั๋วไหน; ยืนยันกติกายอดของยืมตอนปิดรอบ
> - **ทำไม:** spec 3 ที่ (CR-121 §5, RM:85, schema VDU 14/§2.33) ให้ role ไม่ตรงกัน; โค้ดเลือกไปแล้วแต่ไม่มี doc รองรับ; route ใน CR-121 (`/scan`, `/reconcile`, `/onsite/loans`, `/onsite/returns`) ไม่มีและไม่มีแผนสร้าง
> - **dev ต้อง build:** route guard ระดับหน้า + filter ตั๋วตามจุดแจก; ที่เหลือคือ doc ตามโค้ด
> - **กระทบ:** scope + role/permission (change-management §2) — ไม่เปลี่ยนรูป doc

## Why

**As-built (`develop`, PR #312):** `/onsite/distribution` = `FrontlineStationPage` มี 5 แท็บ: 1 รับของถึงจุดแจก · 2 แจกอาหารปรุงสุก · 3 จ่ายพัสดุ & ยืม · 4 รับคืนสิ่งของ · 5 ปิดรอบ & คืนของ. guard ระดับ route = `requireAuth` อย่างเดียว; role ตรวจในปุ่ม (`canPerformFrontlineDistribution` = SA, REG, SC, SM; รับคืนแบบ PHYSICAL = `canReceivePhysicalStock` = WH, SC, SM).

**ความขัดแย้งของ role:**

| ขั้น | CR-121 §5 | role matrix | schema / VDU | โค้ด |
| --- | --- | --- | --- | --- |
| 1–3 แจก | REG, SC, SM (+ Shift Pass) — ไม่มี SA, KS | RM:85 แจกอาหาร = SA, SM, KS; REG "—" | — | SA, REG, SC, SM |
| 4 รับคืน | WH, SC, **REG** — ไม่มี SM | `warehouse_staff` ไม่อยู่ใน 10 canonical roles (RM §1.1) | §2.33 PHYSICAL **ปฏิเสธ REG**; VDU 14 `receive` = WH, SC, SM, SA | WH, SC, SM (REG เห็นแต่กดไม่ได้) |
| 5 ปิดรอบ | REG, SC, SM (ไม่มี Shift Pass) | — | — | SA, REG, SC, SM |

**ยอดของยืมตอนปิดรอบ:** FR-DST-05 / CR-121:213,664 ส่ง "ของที่เหลือ **รวมของยืมที่ได้คืน**" กลับคลัง 100% แล้วคลังเขียน `receive` อีกรอบ — แต่ FR-LON-02 ของยืมที่คืนที่เคาน์เตอร์เขียน `receive` เข้าคลังทันทีแล้ว → นับซ้ำ. โค้ดเลือกไว้: ของยืมนับเป็น "แจกออก" ตอนปิดรอบ (`remaining_in_hand = allocated − distributed`) และไม่รวมของที่คืนเคาน์เตอร์.

**จุดแจกเห็นตั๋วไหน:** ตั๋วชี้ปลายทางด้วย `destination_location = distribution_point:{zone}` (§2.29) แต่ CR-128 ให้ shelter มี `food_distribution_points[{id,name}]` — ไม่มีนิยามว่าเชื่อมกันอย่างไร. โค้ดแสดงทุกตั๋วของ shelter.

## Change

### Requirements
- **FR-DDS-01** — รับรอง `/onsite/distribution` เป็นหน้าเดียว 5 ขั้น ครอบหน้าจอ 13, 14, 15, 16 และ 17 ของ CR-121 §5; แก้ตาราง §5 ให้ชี้ route เดียว และตัด `/onsite/distribution/scan`, `/onsite/distribution/reconcile`, `/onsite/loans`, `/onsite/returns` ออก. หน้าจอ 18 (`/onsite/scan-check-in-out`) คงเดิม
- **FR-DDS-02** — role ขั้น 1–3 และ 5 > [NEEDS DECISION: (A) SA, REG, SC, SM — ตามโค้ด และแก้ RM:85 ให้ REG/SC แจกได้ (KS ไม่แจก — ครัวจบที่ส่งเข้าคลัง), (B) ตาม RM:85 (SA, SM, KS) — แก้โค้ดและ CR-121 §5]
- **FR-DDS-03** — role ขั้น 4 > [NEEDS DECISION: (A) รับคืนแบบ PHYSICAL (มีของ → `receive`) = WH, SC, SM, SA ตาม §2.33/VDU 14; REG ทำได้แค่ค้นหา/ดูยอดค้าง และแก้ CR-121 §5 หน้าจอ 17 ตัด REG, (B) ให้ REG รับคืนได้ — ต้องแก้ §2.33 และ VDU 14 (stable-ish)]
- **FR-DDS-04** — route guard: `+page.ts` ต้องใช้ guard ที่ยอมรับ **union** ของ role ทุกขั้น (ตาม FR-DDS-02/03 ที่เคาะ) แล้วซ่อน/ปิดปุ่มรายขั้นตาม role ใน UI; ผู้ใช้นอก union ถูก redirect
- **FR-DDS-05** — Volunteer Shift Pass > [NEEDS DECISION: (A) ตัดออกจาก V1 — ผู้ใช้ทุกคนต้องมีบัญชี staff (`distributed_by` = user id), (B) คงไว้ — ต้องมี CR แยกนิยามการ auth ของ Shift Pass]
- **FR-DDS-06** — ยอดของยืมตอนปิดรอบ: `distribution_log` ที่ `is_returnable=true` นับเป็น **แจกออก** ใน `distributed_qty`; ยอดส่งคืนคลังตอนปิดรอบ (`returned_qty`) = ของที่ยังไม่ได้แจกเท่านั้น; ของยืมที่คืนภายหลังเข้าคลังผ่าน FR-LON-02 (เคาน์เตอร์) หรือ bulk pool (CR-134) เท่านั้น — แก้ข้อความ CR-121:213,664 ("รวมของยืมที่ได้คืน") ให้ตรง
- **FR-DDS-07** — ตั๋วที่จุดแจกเห็น > [NEEDS DECISION: (A) ทุกตั๋ว food/supplies ของ shelter ที่เลือก (as-built), (B) ให้ผู้ใช้เลือกจุดแจก (`food_distribution_points[].id`) แล้ว filter `destination_location = distribution_point:{id}` — ต้องกำหนดว่า `{zone}` ใน §2.29 = `food_distribution_points[].id`]

### Acceptance
- ตาราง CR-121 §5 + RM ระบุ route และ role ของ Station 4 ตรงกันทุกขั้น
- ผู้ใช้ role นอก union เปิด `/onsite/distribution` → redirect
- REG (ถ้า FR-DDS-03 A) เห็นแท็บรับคืนแต่ปุ่มรับคืนแบบมีของถูกปิดพร้อมข้อความ
- ตั๋ว supplies ที่มีของยืม 10 ชิ้น แจก 10 คืนเคาน์เตอร์ 4 → ปิดรอบ: `distributed_qty=10`, `returned_qty=0`, ไม่มีการ `receive` ซ้ำ 4 ชิ้น

## Impact
- docs: CR-121 §5 + ข้อความ FR-DST-05; RM:85; sitemap.md เพิ่ม `/onsite/distribution`; schema.md §2.29 (ถ้า FR-DDS-07 B), §2.30 กติกา FR-DDS-06
- code: `onsite/distribution/+page.ts` guard ใหม่; `auth.ts` ตาม FR-DDS-02/03; filter จุดแจกใน `FrontlineStationPage` (ถ้า FR-DDS-07 B)
- ไม่กระทบรูป doc / VDU (ยกเว้น FR-DDS-03 B)

## Migration
N/A

## Decision log
- 2026-10-06 — proposed (หลังตรวจ as-built `/onsite/distribution` เทียบ CR-121 / RM / schema)
