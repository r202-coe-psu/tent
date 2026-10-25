---
id: draft
title: แยกโหมด "อาหาร | สิ่งของ" ที่โต๊ะแจกของ `/onsite/distribution` — แก้ CR-159 FR-DDS-01 (หน้าเดียว 5 ขั้น)
status: proposed
date: 2026-10-25
updated: 2026-10-25
requested_by: feedback tester (roleplay ที่จุดแจก) — หน้า 5 ขั้นที่อาหารกับสิ่งของปนกันสับสน โดยเฉพาะบนมือถือ
decided_by: <เจ้าของโครงการ — รอ approve>
layer: volatile
affects:
  - docs/changes/03-C-supply/CR-159-onsite-distribution.md §A (FR-DDS-01 แก้ → หน้าเดียว 2 โหมด; FR-DDS-02/03/07 ต้องเคาะว่าคงเดิม)
  - docs/changes/03-C-supply/CR-121-spec-ticket.md §5 (ตาราง Screen/Role หน้าจอ 13–17 — ยังชี้ route เดียว ไม่ต้องแก้ ถ้า OPEN-2 = ไม่มี route ใหม่)
  - docs/data/schema.md §2.29 `requisition_ticket.requisition_type` (อ้างอิงเท่านั้น — ไม่แก้)
  - schema_v — ไม่เปลี่ยน (ไม่มี field/doc ใหม่; แยกโหมดด้วย `requisition_type` ที่มีอยู่)
  - frontend/src/routes/(protected)/onsite/distribution/+page.svelte, +page.ts (อ่าน `?mode=` ถ้า OPEN-2 = A)
  - frontend/src/lib/features/distribution/ui/frontline/FrontlineStationPage.svelte (mode switch + ชุดขั้นต่อโหมด)
  - frontend/src/lib/features/distribution/ui/frontline/ShiftReconciliationCard.svelte (ปิดรอบ filter ตามโหมด)
  - frontend/src/lib/features/distribution/ui/model/ticket-filters.ts (+ test) — filter ตั๋วตาม `requisition_type`
  - frontend/e2e/distribution/* (distribution-desk-flow, -handover, -returns-close, -access, -volunteer; pages/)
---

# แยกโหมด "อาหาร | สิ่งของ" ที่โต๊ะแจกของ (`/onsite/distribution`)

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** หน้า `/onsite/distribution` เปลี่ยนจาก 5 ขั้นเรียงเดียว (อาหาร+สิ่งของปน) เป็น **สวิตช์โหมดบนสุด
>   "อาหาร | สิ่งของ"** — โหมดอาหาร 3 ขั้น, โหมดสิ่งของ 4 ขั้น; แต่ละโหมดเห็นเฉพาะตั๋ว `requisition_type` ของตัวเอง
> - **ทำไม:** tester (roleplay) สับสนกับหน้า 5 ขั้นที่ตั๋วอาหารกับสิ่งของปนกัน โดยเฉพาะบนมือถือ
> - **dev ต้อง build:** mode switch + ชุดขั้นต่อโหมด + filter ตั๋ว/ปิดรอบตาม `requisition_type` ใน `FrontlineStationPage`; ปรับ e2e
> - **กระทบ:** แก้ CR-159 FR-DDS-01 (scope หน้าจอ); role/กติกาแจก/schema ไม่เปลี่ยน; **ไม่ bump `schema_v`**

---

## Why

- CR-159 FR-DDS-01 รับรองหน้าเดียว 5 ขั้น (as-built PR #312): 1 รับของถึงจุดแจก · 2 แจกอาหารปรุงสุก ·
  3 จ่ายพัสดุ & ยืม · 4 รับคืนสิ่งของ · 5 ปิดรอบ & คืนของ — ขั้น 1 และ 5 รวมตั๋ว food กับ supplies ไว้ด้วยกัน
- feedback tester (roleplay ที่จุดแจก): สลับไปมาระหว่างงานอาหารกับสิ่งของในหน้าเดียวสับสน; บนมือถือแท็บ 5 อันแน่น
  และรายการตั๋วในขั้น 1/5 ปนสองประเภท
- ในหน้างาน คนแจกอาหารกับคนแจกสิ่งของมักเป็นคนละโต๊ะ/คนละช่วงเวลา → แยกโหมดตรงกับงานจริง
- ตั๋วมี `requisition_type` (`food` | `supplies`, schema.md §2.29) อยู่แล้ว → แยกได้โดยไม่แตะข้อมูล

**บริบท — งาน UI ที่ทำคู่กันโดยไม่มี CR (ไม่เปลี่ยน spec, อ้างไว้เท่านั้น):**

- มือถือ: auto-scroll ไปขั้นที่เลือก + แท็บแบบกะทัดรัด
- แสดงจำนวนครั้งที่รับซ้ำ (repeat count) ของผู้รับ
- ตัวระบุของยืมตอนรับคืนอ่านง่ายขึ้น (readable return identifiers)

## Change

### Before → after

|                    | ก่อน (CR-159 FR-DDS-01)                     | หลัง                                                                                     |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| โครงหน้า           | หน้าเดียว 5 ขั้น                            | หน้าเดียว + สวิตช์โหมด "อาหาร \| สิ่งของ" บนสุด                                         |
| โหมดอาหาร          | —                                           | 1 รับของถึงจุดแจก (food) · 2 แจกอาหารปรุงสุก · 3 ปิดรอบ (food)                           |
| โหมดสิ่งของ        | —                                           | 1 รับของถึงจุดแจก (supplies) · 2 จ่ายพัสดุ & ยืม-คืน · 3 รับคืนสิ่งของ · 4 ปิดรอบ & คืนของ (supplies) |
| ตั๋วในขั้นรับของ/ปิดรอบ | food + supplies ปนกัน                  | เฉพาะ `requisition_type` ของโหมดปัจจุบัน                                                 |
| route              | `/onsite/distribution`                      | `/onsite/distribution` เดิม (± `?mode=` ตาม OPEN-2)                                       |
| role / กติกาแจก / schema | CR-159 FR-DDS-02/03, §B, §C            | ไม่เปลี่ยน (ตาม OPEN-4)                                                                 |

### Requirements

- **FR-DFS-01** — แก้ CR-159 FR-DDS-01: `/onsite/distribution` ยังเป็นหน้าเดียว (ครอบหน้าจอ 13–17 ของ CR-121 §5) แต่มี
  **สวิตช์โหมด** "อาหาร | สิ่งของ" อยู่บนสุดของหน้า เหนือแถบขั้น; เลือกได้ครั้งละหนึ่งโหมด
- **FR-DFS-02** — โหมด **อาหาร** แสดง 3 ขั้นตามลำดับ:
  1. รับของถึงจุดแจก — เฉพาะตั๋ว `requisition_type = 'food'`
  2. แจกอาหารปรุงสุก — กติกา CR-159 §B, §C เดิมทั้งหมด
  3. ปิดรอบ — เฉพาะตั๋ว `requisition_type = 'food'`
- **FR-DFS-03** — โหมด **สิ่งของ** แสดง 4 ขั้นตามลำดับ:
  1. รับของถึงจุดแจก — เฉพาะตั๋ว `requisition_type = 'supplies'`
  2. จ่ายพัสดุ & ยืม-คืน
  3. รับคืนสิ่งของ
  4. ปิดรอบ & คืนของ — เฉพาะตั๋ว `requisition_type = 'supplies'`; กติกายอดของยืม CR-159 FR-DDS-06 เดิม
- **FR-DFS-04** — ขั้นใดของโหมดหนึ่งต้อง **ไม่แสดง** ตั๋ว/รายการของอีกโหมด (รวมรายการที่รอรับของ, ยอดปิดรอบ, ตัวนับ)
- **FR-DFS-05** — สลับโหมดไม่เขียนข้อมูลใด ๆ และไม่ทิ้งงานที่บันทึกแล้ว; ถ้ามีฟอร์มที่กรอกค้าง (ยังไม่ยืนยัน) ให้ถามยืนยันก่อนสลับ
- **FR-DFS-06** — โหมดเริ่มต้นเมื่อเข้าหน้า > [NEEDS DECISION: OPEN-1]
- **FR-DFS-07** — โหมดใน URL > [NEEDS DECISION: OPEN-2]
- **FR-DFS-08** — การบอกว่าอีกโหมดมีงานค้าง > [NEEDS DECISION: OPEN-3]
- **FR-DFS-09** — role ต่อขั้น > [NEEDS DECISION: OPEN-4] (เสนอ: ตาม CR-159 FR-DDS-02/03 เดิม ผูกกับขั้น ไม่ผูกกับโหมด)
- **FR-DFS-10** — FR-DDS-07 (ตั๋วที่จุดแจกเห็น) > [NEEDS DECISION: OPEN-5]

### Acceptance

- [ ] เปิด `/onsite/distribution` เห็นสวิตช์ "อาหาร | สิ่งของ" เหนือแถบขั้น
- [ ] โหมดอาหารมี 3 ขั้น (รับของ · แจกอาหารปรุงสุก · ปิดรอบ); โหมดสิ่งของมี 4 ขั้น (รับของ · จ่ายพัสดุ & ยืม-คืน · รับคืน · ปิดรอบ & คืนของ)
- [ ] shelter มีตั๋ว food 1 ใบ + supplies 1 ใบ สถานะรอรับ → โหมดอาหาร ขั้น 1 เห็นเฉพาะใบ food; โหมดสิ่งของ ขั้น 1 เห็นเฉพาะใบ supplies
- [ ] ปิดรอบในโหมดอาหารไม่แตะ/ไม่แสดงตั๋ว supplies และกลับกัน
- [ ] สลับโหมดระหว่างกรอกจำนวนค้าง → มี dialog ยืนยัน; ยกเลิกแล้วค่าที่กรอกยังอยู่
- [ ] role ที่เปิดแต่ละขั้นได้ตรงกับ CR-159 FR-DDS-02/03 (ถ้า OPEN-4 = ไม่เปลี่ยน)
- [ ] ใช้งานได้ที่ความกว้างมือถือ (360 px) โดยสวิตช์โหมด + แถบขั้นไม่ล้นจอ
- [ ] unit test: filter ตั๋วตาม `requisition_type` ต่อโหมด/ขั้น; e2e ของ desk ผ่านหลังปรับตามโหมด

## Open points — ให้เจ้าของโครงการเคาะ

| #      | เรื่อง                                   | ทางเลือก                                                                                                   | เสนอ (default)                                                                                                    |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| OPEN-1 | โหมดเริ่มต้นเมื่อเข้าหน้า               | (A) จำโหมดล่าสุดต่อเครื่อง (`localStorage`) · (B) อาหารก่อนเสมอ · (C) โหมดที่มีงานค้าง                     | **A** แล้ว fallback **B** ครั้งแรก/อ่าน storage ไม่ได้ — โต๊ะหนึ่งมักทำโหมดเดียวทั้งกะ; C ทำให้หน้าเปลี่ยนเองจนงง |
| OPEN-2 | โหมดอยู่ใน URL (`?mode=food\|supplies`) | (A) มี — deep link / QR ติดโต๊ะ / e2e เปิดตรงได้, URL ชนะค่าที่จำไว้ · (B) ไม่มี state ใน URL             | **A** — ไม่มี route ใหม่ (CR-121 §5 ไม่ต้องแก้); ค่าที่ไม่รู้จัก → ใช้ default ตาม OPEN-1                          |
| OPEN-3 | บอกงานค้างของอีกโหมด                    | (A) badge ตัวเลขบนสวิตช์โหมด (ตั๋วรอรับของ + ตั๋วรอปิดรอบ ของโหมดนั้น) · (B) badge จุดไม่มีตัวเลข · (C) ไม่แสดง | **A** — นับเฉพาะงานที่ต้องลงมือ (รอรับของถึงจุดแจก, รอปิดรอบ); ไม่นับผู้รับที่ยังไม่มารับ                         |
| OPEN-4 | role ต่อขั้น (CR-159 FR-DDS-02/03)      | (A) ไม่เปลี่ยน — gate ผูกกับขั้นเดิม · (B) gate ระดับโหมด                                                   | **A** — route guard FR-DDS-04 (union SA, SM, DST) เดิม; ไม่เปลี่ยน role/permission จึงไม่กระทบ RM                 |
| OPEN-5 | FR-DDS-07 (filter ตั๋วตามจุดแจก)        | (A) คงสถานะ NEEDS DECISION เดิม — ถ้าเคาะ filter จุดแจก ให้ใช้ภายในแต่ละโหมด · (B) ผูกจุดแจกกับโหมด          | **A** — สองเรื่องตั้งฉากกัน: โหมด filter ตาม `requisition_type`, จุดแจก filter ตาม `destination_location`          |
| OPEN-6 | e2e / tests                              | ปรับ page object ใน `frontend/e2e/distribution/pages/` ให้เลือกโหมดก่อนเลือกขั้น                          | ปรับ spec เดิม (flow, handover, returns-close, access, volunteer) ใน PR เดียวกับ UI; เพิ่ม unit test filter ต่อโหมด + e2e สลับโหมด 1 เคส |

## Impact

- **Docs:** CR-159 §A — FR-DDS-01 ถูกแก้โดย CR นี้ (เมื่อ approve ให้เพิ่มบรรทัดชี้มาที่ CR นี้ใต้ FR-DDS-01 แบบเดียวกับที่
  CR-191 ชี้ใน §C); CR-121 §5 ไม่ต้องแก้ถ้า OPEN-2 ไม่เพิ่ม route
- **Code:** `FrontlineStationPage.svelte` (mode switch, ชุดขั้นต่อโหมด), `ShiftReconciliationCard.svelte` (ปิดรอบตามโหมด),
  `ui/model/ticket-filters.ts` (filter ตาม `requisition_type`), route `+page.svelte`/`+page.ts` (ถ้า OPEN-2 = A)
- **Tests:** unit `ticket-filters.test.ts`; e2e `frontend/e2e/distribution/*` และ page objects
- **ไม่กระทบ:** schema / `schema_v`, VDU, `distribution_log`, กติกา CR-159 §B/§C/CR-191, role/permission, worker/FastAPI,
  back-office ตั๋ว (`/back-office/...` ยังเห็นทุกประเภท)

## Migration

N/A — ไม่มีการเปลี่ยนรูปร่าง doc ที่ persist; **ไม่ bump `schema_v`**. ค่าที่จำโหมด (ถ้า OPEN-1 = A) เป็น per-device
convenience ใน browser storage เท่านั้น อ่านไม่ได้ → ใช้ default

## Decision log

- 2026-10-25 — proposed. เจ้าของโครงการเคาะแล้ว: track ด้วย CR ไฟล์แยกที่แก้ CR-159 (draft รอ approve); ดีไซน์ = สวิตช์
  "อาหาร | สิ่งของ" + โหมดอาหาร 3 ขั้น / โหมดสิ่งของ 4 ขั้น. รอเคาะ OPEN-1..6
