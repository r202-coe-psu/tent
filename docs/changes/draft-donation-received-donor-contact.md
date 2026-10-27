---
id: draft
title: "รายการของบริจาคที่รับแล้ว + ข้อมูลติดต่อผู้บริจาคแบบปิดบางส่วน (#821)"
status: proposed
date: 2026-10-28
updated: 2026-10-28
requested_by: "GitHub #821 (roleplay 23/10/69 feedback) · epic #826"
decided_by: "owner"
layer: volatile
affects:
  - frontend/src/routes/(protected)/back-office/stock-donations/+page.svelte · components/received-donations-list.svelte (ใหม่)
  - frontend/src/lib/components/pending-review-board.svelte · pending-review-detail.svelte (โหมดอ่านอย่างเดียว)
  - frontend/src/lib/features/donations (domain `donation-queue.ts`, `donor-contact.ts` ใหม่, data `back-office-queue.ts`, application `queries.ts`)
  - frontend/src/routes/api/back-office/donations/+server.ts (`?status=received` แบบแบ่งหน้า)
  - frontend/src/lib/server/shelter-access-design.ts · features/shelters/server/provisioner.ts · server/shelters.admin.ts · scripts/redeploy-access.ts · scripts/seed/registry-shelters.ts (Mango index ใหม่)
  - frontend/src/lib/features/operations/ui/receive-stock-form.svelte (อีเมล walk-in)
  - role/permission — ใครเห็นข้อมูลติดต่อผู้บริจาค (docs/prd/role-permission-matrix.md ถ้า owner ให้เพิ่ม `shelter_manager`)
why: walk-in บันทึกเบอร์และอีเมลผู้บริจาคแล้ว แต่หลังรับเข้าคลังไม่มีหน้าไหนให้เห็นอีก เจ้าหน้าที่ติดต่อกลับไม่ได้ (#821)
migration: ไม่เปลี่ยนรูปร่าง doc — ไม่ bump `schema_v` · เพิ่ม Mango index ต่อ shelter DB (provision / redeploy-access)
---

# draft-donation-received-donor-contact — รายการที่รับแล้ว + ข้อมูลติดต่อผู้บริจาค

## สรุป

- **เปลี่ยน:** เพิ่มตัวกรอง "รับแล้ว" ในแท็บ "รายการของบริจาค" (`/back-office/stock-donations?tab=list&filter=received`) เรียงใหม่สุดก่อน · ชื่อ / เบอร์ / อีเมลผู้บริจาคแสดงแบบ**ปิดบางส่วน** · ข้อมูลเต็มเห็นในหน้ารายละเอียดหลังกด "แสดงข้อมูลติดต่อ"
- **เพื่อ:** ให้เจ้าหน้าที่หาใบบริจาคที่รับแล้วและติดต่อผู้บริจาคกลับได้ โดยไม่เปิดข้อมูลส่วนบุคคลให้เห็นทั้งหน้า (PDPA: data minimization, least privilege)
- **dev ต้อง build:** API `?status=received` แบ่งหน้าด้วย bookmark + Mango index ใหม่ · รายการ (แถบค้นหา / การ์ด / ตาราง เหมือนตัวกรองอื่น) · โหมดอ่านอย่างเดียวของหน้ารายละเอียด · อีเมลใน walk-in หน้าคลัง
- **กระทบ:** ไม่เปลี่ยน schema · เพิ่ม index ต่อ shelter DB · กำหนดสิทธิ์ดูข้อมูลติดต่อผู้บริจาค

## Requirements

**รายการ "รับแล้ว"**
- **FR-1** — ตัวกรอง "รับแล้ว" แสดง `donation` ที่ `status = received` ของศูนย์ที่ทำงานอยู่ เรียง `received_at` ใหม่สุดก่อน
- **FR-2** — แบ่งหน้าจาก server หน้าละ 20 รายการ (`RECEIVED_PAGE_SIZE`) ด้วย CouchDB bookmark · ปุ่ม "โหลดเพิ่ม" (ไม่ใช้เลขหน้า — bookmark กระโดดไปหน้า N ไม่ได้, `skip` ช้าลงตามข้อมูล)
- **FR-3** — query ใช้ Mango index `donation-received-by-received-at` (`allow_fallback: false`) · DB ที่ยังไม่มี index ตอบ 503 พร้อมข้อความ "ยังไม่พร้อมแสดงรายการที่รับแล้ว"
- **FR-4** — หน้าตาเหมือนตัวกรองอื่นของ queue: แถบค้นหา · การ์ด (< md) · ตาราง 4 คอลัมน์ (md+): ผู้ส่งและรหัสคำขอ / รายการที่รับ / ติดต่อผู้บริจาค / การจัดการ

**ปิดข้อมูลบางส่วน**
- **FR-5** — ในรายการ: ชื่อ = ชื่อแรก + นามสกุลรูปแบบ `maskLastName` (`ใ****`) · เบอร์ = `xxx-xxx-1234` (`mask_phone`) · อีเมล = `s***i@example.com` (`mask_email`) · ไม่มีค่า = "ไม่ระบุเบอร์โทร" / "ไม่ระบุอีเมล"
- **FR-6** — หน้ารายละเอียดของใบที่รับแล้ว (อ่านอย่างเดียว — ไม่มีปุ่มอนุมัติ / ปฏิเสธ / ส่งต่อ): แสดงแบบปิดก่อน · ปุ่ม "แสดงข้อมูลติดต่อ" → ชื่อเต็ม, เบอร์เต็ม (ลิงก์ `tel:`), อีเมลเต็ม
- **FR-7** — คิวรอประเมิน (ไม่ใช่โหมดอ่านอย่างเดียว) แสดงข้อมูลติดต่อเต็มเหมือนเดิม — ผู้ตรวจต้องติดต่อผู้บริจาคระหว่างตัดสิน

**ค้นหา**
- **FR-8** — ช่องค้นหาในรายการ "รับแล้ว": เลขใบ, ชื่อผู้บริจาค (ชื่อเต็ม แม้หน้าจอแสดงแบบปิด), ชื่อสินค้า, เบอร์ (ตัวเลข ≥ 4 หลัก ไม่สนขีด / `+66`) · ค้นในรายการที่โหลดแล้ว และบอกจำนวน "พบ X จาก N รายการที่โหลดแล้ว"
  > [NEEDS DECISION: ค้นฝั่ง server ทั้งศูนย์ (ต้องเพิ่ม API / index) ในเฟสนี้ หรือเฟสถัดไป]

**สิทธิ์**
- **FR-9** — เข้าถึงได้เฉพาะบทบาทที่ผ่าน `authorizeWarehouse` (เหมือน API บริจาค back-office อื่น)
  > [NEEDS DECISION: ให้ `shelter_manager` เห็นด้วยหรือไม่]
- **FR-10** — (เสนอ) API รายการส่งเฉพาะค่าที่ปิดแล้ว · ข้อมูลติดต่อเต็มจาก endpoint ของใบ (`GET /api/back-office/donations/{id}/contact`, `Cache-Control: no-store`) · บันทึก audit ว่าใครดูใบไหนเมื่อไร
  > [NEEDS DECISION: ทำ FR-10 ในเฟสนี้หรือไม่ — ตอนนี้ปิดฝั่ง UI เท่านั้น, API รายการยังส่งค่าเต็ม]

**walk-in หน้าคลัง**
- **FR-11** — `receive-stock-form.svelte` เพิ่มช่อง "อีเมล (ไม่บังคับ)" ตรวจรูปแบบอีเมล เก็บใน `donor.email` เหมือน walk-in ในหน้ารับบริจาค

**ตามหาของ (เสนอ — เฟส 2)**
- **FR-12** — แสดงเลขล็อต (`stock_ledger.lot_no`) ของแต่ละใบ จาก ledger `reason = receive`, `ref_id = donation:{id}` (ใช้ index เดิม `['type','ref_id','item_id','reason']`) · หน้ารายละเอียดแสดงสินค้า / จำนวน / ล็อต / หมดอายุ / จุดจัดเก็บ / คงเหลือ
- **FR-13** — ค้นด้วยเลขล็อต (`L-YYMMDD-XXX`) → ใบบริจาค (ต้องเพิ่ม index บน `lot_no`) · ลิงก์ไปประวัติคลัง (#811)
  > [NEEDS DECISION: FR-12 / FR-13 อยู่ใน CR นี้หรือแยก]

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ใบที่รับแล้ว | ไม่มีหน้าให้ดู | ตัวกรอง "รับแล้ว" + หน้ารายละเอียดอ่านอย่างเดียว |
| ข้อมูลติดต่อผู้บริจาค walk-in | ไม่เห็นหลังรับเข้าคลัง | รายการ: ปิดบางส่วน · รายละเอียด: กดดูเต็ม |
| ค้นหา | — | เลขใบ / ชื่อ / สินค้า / เบอร์ |
| walk-in หน้าคลัง | เก็บแค่เบอร์ | เบอร์ + อีเมล |
| shelter DB | — | Mango index `donation-received-by-received-at` |

## Acceptance

- **AC-1** — ใบ `status = received` ของศูนย์ขึ้นในตัวกรอง "รับแล้ว" ใหม่สุดก่อน · หน้าละ 20 · "โหลดเพิ่ม" ได้หน้าถัดไปจนหมด
- **AC-2** — รายการไม่แสดงนามสกุล / เบอร์ / อีเมลเต็ม (ตรวจได้จากหน้าจอ)
- **AC-3** — หน้ารายละเอียดเห็นค่าเต็มหลังกด "แสดงข้อมูลติดต่อ" เท่านั้น · คิวรอประเมินยังเห็นเต็มเหมือนเดิม
- **AC-4** — ค้นด้วยเลขใบ, นามสกุลเต็ม, ชื่อสินค้า, 4 หลักท้ายของเบอร์ เจอใบที่ตรง · ไม่เจอ = ข้อความ "ไม่พบรายการที่ตรงกับ …"
- **AC-5** — ผู้ไม่ผ่าน `authorizeWarehouse` เรียก `?status=received` → 403
- **AC-6** — DB ที่ไม่มี index → 503 พร้อมข้อความ ไม่สแกนทั้ง DB
- **AC-7** — walk-in จากหน้าคลังที่ใส่อีเมล → `donor.email` ถูกเก็บ · อีเมลผิดรูปแบบ → บันทึกไม่ได้

## Impact

- **Gate:** implement ได้เมื่อ CR approve · deploy ต้อง provision index ลงทุก shelter DB (`redeploy-access`) ก่อนเปิดใช้ ไม่งั้นตัวกรองตอบ 503
- **ไม่ต้องแก้:** `donation` schema / `schema_v` · FastAPI / Mongo / projection · worker
- **PII:** ข้อมูลติดต่ออยู่ใต้ retention ของ PII ผู้บริจาคเดิม · หลังพ้น retention ระบบเหลือแค่ชื่อ ปุ่ม "แสดงข้อมูลติดต่อ" ไม่มีอะไรให้แสดง
- **สถานะงาน:** UI ของ FR-1 – FR-9 ทำแล้วใน branch `feat/821-received-filter` · FR-10 – FR-13 ยังไม่ทำ

## Migration

- ไม่มี migration ของข้อมูล · ไม่ bump `schema_v`
- index ใหม่: `{ fields: [type desc, status desc, received_at desc, _id desc] }`, ddoc `donation-received-list` — provisioner สร้างให้ศูนย์ใหม่ · ศูนย์เดิมใช้ `scripts/redeploy-access.ts`

## Why

- ข้อมูลถูกเก็บแล้วแต่ไม่มีที่ให้ใช้ — เจ้าหน้าที่ต้องติดต่อผู้บริจาคกลับ (ขอบคุณ, แจ้งของเสีย, ใบเสร็จ)
- ปิดบางส่วนเป็นค่าเริ่มต้นเพราะหน้ารายการเปิดดูบ่อยและเห็นได้จากข้างหลัง · รูปแบบเดียวกับที่ระบบใช้อยู่ (`maskLastName`, `mask_phone`, `mask_email`)
- อยู่ในแท็บ "รายการของบริจาค" ไม่สร้างหน้าใหม่ — เป็นที่ที่เจ้าหน้าที่ดูใบบริจาคอยู่แล้ว
- โหลดเพิ่มแทนเลขหน้า — CouchDB bookmark ต่อหน้าก่อนเสมอ
- ตัดทิ้ง: แสดงข้อมูลเต็มในรายการ · แสดงในประวัติคลังอย่างเดียว (#811 ยังแสดงแค่รหัส `donation:…`)

## Decision log

- 2026-10-28 — ร่างโดยทีม D จากการรีวิวงานใน `feat/821-received-filter` · ยังไม่มีการตัดสินของ owner บันทึกใน #821 (โค้ดอ้าง "owner decision A1" — ขอ owner ยืนยัน)
