---
id: draft
title: "รายการของบริจาคที่รับแล้ว + ข้อมูลติดต่อผู้บริจาคแบบปิดบางส่วน (#821)"
status: proposed
date: 2026-10-28
updated: 2026-10-28
requested_by: "GitHub #821 (roleplay 23/10/69 feedback) · epic #826"
decided_by: "Jackyzaz"
layer: volatile
affects:
  - frontend/src/routes/(protected)/back-office/stock-donations/+page.svelte · components/received-donations-list.svelte (ใหม่)
  - frontend/src/lib/components/pending-review-board.svelte · pending-review-detail.svelte (โหมดอ่านอย่างเดียว)
  - frontend/src/lib/features/donations (domain `donation-queue.ts`, `donor-contact.ts` ใหม่, data `back-office-queue.ts`, application `queries.ts`)
  - frontend/src/routes/api/back-office/donations/+server.ts (`?status=received` แบบแบ่งหน้า)
  - frontend/src/lib/server/shelter-access-design.ts · features/shelters/server/provisioner.ts · server/shelters.admin.ts · scripts/redeploy-access.ts · scripts/seed/registry-shelters.ts (Mango index ใหม่)
  - frontend/src/lib/features/operations/ui/receive-stock-form.svelte (อีเมล walk-in)
  - frontend/src/routes/api/back-office/donations/[id]/contact/+server.ts (ใหม่ — ข้อมูลติดต่อเต็ม + audit)
  - frontend/src/lib/features/operations (lot ของใบบริจาคจาก `stock_ledger`)
  - Mango index สำหรับค้นหาฝั่ง server และค้นเลขล็อต (ต่อ shelter DB)
  - role/permission — ไม่เปลี่ยน: ใช้ `authorizeWarehouse` เดิม (warehouse_staff, shelter_manager, system_admin)
why: walk-in บันทึกเบอร์และอีเมลผู้บริจาคแล้ว แต่หลังรับเข้าคลังไม่มีหน้าไหนให้เห็นอีก เจ้าหน้าที่ติดต่อกลับไม่ได้ (#821)
migration: ไม่เปลี่ยนรูปร่าง doc — ไม่ bump `schema_v` · เพิ่ม Mango index ต่อ shelter DB (provision / redeploy-access)
---

# draft-donation-received-donor-contact — รายการที่รับแล้ว + ข้อมูลติดต่อผู้บริจาค

## สรุป

- **เปลี่ยน:** เพิ่มตัวกรอง "รับแล้ว" ในแท็บ "รายการของบริจาค" (`/back-office/stock-donations?tab=list&filter=received`) เรียงใหม่สุดก่อน · ชื่อ / เบอร์ / อีเมลผู้บริจาคแสดงแบบ**ปิดบางส่วน** · ข้อมูลเต็มเห็นในหน้ารายละเอียดหลังกด "แสดงข้อมูลติดต่อ"
- **เพื่อ:** ให้เจ้าหน้าที่หาใบบริจาคที่รับแล้วและติดต่อผู้บริจาคกลับได้ โดยไม่เปิดข้อมูลส่วนบุคคลให้เห็นทั้งหน้า (PDPA: data minimization, least privilege)
- **dev ต้อง build:** API `?status=received` แบ่งหน้าด้วย bookmark + Mango index ใหม่ · **ค้นหาฝั่ง server ทั้งศูนย์** · API รายการส่งเฉพาะค่าที่ปิดแล้ว + endpoint ข้อมูลติดต่อเต็มพร้อม audit · เลขล็อตของใบ + ค้นด้วยเลขล็อต · โหมดอ่านอย่างเดียวของหน้ารายละเอียด · อีเมลใน walk-in หน้าคลัง
- **กระทบ:** ไม่เปลี่ยน schema / `schema_v` · เพิ่ม Mango index ต่อ shelter DB · ไม่เปลี่ยน role / permission

## Requirements

**รายการ "รับแล้ว"**
- **FR-1** — ตัวกรอง "รับแล้ว" แสดง `donation` ที่ `status = received` ของศูนย์ที่ทำงานอยู่ เรียง `received_at` ใหม่สุดก่อน
- **FR-2** — แบ่งหน้าจาก server หน้าละ 20 รายการ (`RECEIVED_PAGE_SIZE`) ด้วย CouchDB bookmark · ปุ่ม "โหลดเพิ่ม" ไม่ใช้เลขหน้า
- **FR-3** — query ใช้ Mango index `donation-received-by-received-at` (`allow_fallback: false`) · DB ที่ยังไม่มี index ตอบ 503 พร้อมข้อความ "ยังไม่พร้อมแสดงรายการที่รับแล้ว"
- **FR-4** — หน้าตาเหมือนตัวกรองอื่นของ queue: แถบค้นหา · การ์ด (< md) · ตาราง 4 คอลัมน์ (md+): ผู้ส่งและรหัสคำขอ / รายการที่รับ / ติดต่อผู้บริจาค / การจัดการ

**ปิดข้อมูลบางส่วน**
- **FR-5** — ในรายการ: ชื่อ = ชื่อแรก + นามสกุลรูปแบบ `maskLastName` (`ใ****`) · เบอร์ = `xxx-xxx-1234` (`mask_phone`) · อีเมล = `s***i@example.com` (`mask_email`) · ไม่มีค่า = "ไม่ระบุเบอร์โทร" / "ไม่ระบุอีเมล"
- **FR-6** — หน้ารายละเอียดของใบที่รับแล้ว (อ่านอย่างเดียว — ไม่มีปุ่มอนุมัติ / ปฏิเสธ / ส่งต่อ): แสดงแบบปิดก่อน · ปุ่ม "แสดงข้อมูลติดต่อ" → ชื่อเต็ม, เบอร์เต็ม (ลิงก์ `tel:`), อีเมลเต็ม
- **FR-7** — คิวรอประเมิน (ไม่ใช่โหมดอ่านอย่างเดียว) แสดงข้อมูลติดต่อเต็มเหมือนเดิม

**ค้นหา**
- **FR-8** — ช่องค้นหาในรายการ "รับแล้ว" ค้นฝั่ง server **ทั้งศูนย์** (ไม่ใช่เฉพาะหน้าที่โหลดแล้ว): เลขใบ, ชื่อผู้บริจาค (ชื่อเต็ม แม้หน้าจอแสดงแบบปิด), ชื่อสินค้า, เบอร์ (ตัวเลข ≥ 4 หลัก ไม่สนขีด / `+66`), เลขล็อต (FR-13)
- **FR-8a** — ผลค้นหาแบ่งหน้าแบบเดียวกับรายการ (FR-2) · ไม่เจอ = "ไม่พบรายการที่ตรงกับ …"
- **FR-8b** — ค้นด้วยชื่อหรือเบอร์ได้ แต่ response ยังเป็นค่าที่ปิดแล้ว (FR-10)

**สิทธิ์**
- **FR-9** — เข้าถึงได้เฉพาะบทบาทที่ผ่าน `authorizeWarehouse`: `warehouse_staff`, `shelter_manager`, `system_admin` (เหมือน API บริจาค back-office อื่น)
- **FR-9a** — เห็นเฉพาะศูนย์ที่เลือก / ศูนย์ของผู้ใช้ · ไม่รวมหลายศูนย์ในรายการเดียว · `system_admin` ต้องส่งรหัสศูนย์ (ไม่ส่ง = 400) · ผู้ใช้อื่นขอศูนย์นอกสิทธิ์ = 403
- **FR-10** — API รายการ (และผลค้นหา) ส่ง**เฉพาะค่าที่ปิดแล้ว** · ห้ามมีชื่อเต็ม / เบอร์เต็ม / อีเมลเต็มใน response
- **FR-10a** — ข้อมูลติดต่อเต็มมาจาก endpoint ของใบ `GET /api/back-office/donations/{id}/contact` (`Cache-Control: no-store`, สิทธิ์ตาม FR-9/FR-9a) เรียกเมื่อกด "แสดงข้อมูลติดต่อ" เท่านั้น
- **FR-10b** — ทุกครั้งที่เรียก FR-10a บันทึก `audit` (§2.12) `action: other`, `target_type: donation`, `target_id`, `reason: "donor_contact_view"`, `created_by` = ผู้เรียก, `occurred_at` · ไม่เก็บค่าข้อมูลติดต่อใน audit

**walk-in หน้าคลัง**
- **FR-11** — `receive-stock-form.svelte` เพิ่มช่อง "อีเมล (ไม่บังคับ)" เก็บใน `donor.email` · ตรวจรูปแบบด้วย Zod ตัวเดียวกับ walk-in ในหน้ารับบริจาค (`z.string().trim().email().optional()`, `back-office.ts`) ใน `walkInDonationInputSchema` ทั้งที่ฟอร์มและตอนสร้างใบ (`createWalkInDonation`) · ว่าง = ไม่เก็บ

**ตามหาของ**
- **FR-12** — แสดงเลขล็อต (`stock_ledger.lot_no`) ของแต่ละใบ จาก ledger `reason = receive`, `ref_id = donation:{id}` (ใช้ index เดิม `['type','ref_id','item_id','reason']`) · หน้ารายละเอียดแสดงสินค้า / จำนวน / ล็อต / หมดอายุ / จุดจัดเก็บ / คงเหลือ
- **FR-13** — ค้นด้วยเลขล็อต (`L-YYMMDD-XXX`) → ใบบริจาค ผ่าน Mango index บน `stock_ledger.lot_no` · ลิงก์ไปประวัติคลัง (#811)

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ใบที่รับแล้ว | ไม่มีหน้าให้ดู | ตัวกรอง "รับแล้ว" + หน้ารายละเอียดอ่านอย่างเดียว |
| ข้อมูลติดต่อผู้บริจาค walk-in | ไม่เห็นหลังรับเข้าคลัง | รายการ: ปิดบางส่วน · รายละเอียด: กดดูเต็ม |
| ค้นหา | — | ฝั่ง server ทั้งศูนย์: เลขใบ / ชื่อ / สินค้า / เบอร์ / เลขล็อต |
| API รายการ / ผลค้นหา | — | ส่งเฉพาะค่าที่ปิดแล้ว |
| ข้อมูลติดต่อเต็ม | — | endpoint `/contact` ต่อใบ · ทุกครั้งที่เรียกเขียน `audit` |
| เลขล็อตของใบ | ไม่แสดง | หน้ารายละเอียดแสดงล็อต / หมดอายุ / จุดจัดเก็บ / คงเหลือ · ค้นด้วยเลขล็อตได้ |
| walk-in หน้าคลัง | เก็บแค่เบอร์ | เบอร์ + อีเมล |
| shelter DB | — | Mango index `donation-received-by-received-at` + index บน `stock_ledger.lot_no` (+ index สำหรับค้นหา ถ้าวิธีค้นที่เลือกต้องใช้) |

## Acceptance

- **AC-1** — ใบ `status = received` ของศูนย์ขึ้นในตัวกรอง "รับแล้ว" ใหม่สุดก่อน · หน้าละ 20 · "โหลดเพิ่ม" ได้หน้าถัดไปจนหมด
- **AC-2** — รายการไม่แสดงนามสกุล / เบอร์ / อีเมลเต็ม (ตรวจได้จากหน้าจอ)
- **AC-3** — หน้ารายละเอียดเห็นค่าเต็มหลังกด "แสดงข้อมูลติดต่อ" เท่านั้น · คิวรอประเมินยังเห็นเต็มเหมือนเดิม
- **AC-4** — ค้นด้วยเลขใบ, นามสกุลเต็ม, ชื่อสินค้า, 4 หลักท้ายของเบอร์, เลขล็อต เจอใบที่ตรง **แม้ใบนั้นยังไม่ได้โหลดขึ้นจอ** · ไม่เจอ = ข้อความ "ไม่พบรายการที่ตรงกับ …"
- **AC-5** — ผู้ไม่ผ่าน `authorizeWarehouse` เรียก `?status=received` หรือ `/contact` → 403 · `shelter_manager` และ `system_admin` เข้าได้ · ขอศูนย์นอกสิทธิ์ → 403
- **AC-5a** — response ของรายการและผลค้นหาไม่มีชื่อเต็ม / เบอร์เต็ม / อีเมลเต็ม (ตรวจจาก network)
- **AC-5b** — เรียก `/contact` หนึ่งครั้ง = audit หนึ่งแถวที่มีผู้เรียก ใบ และเวลา
- **AC-5c** — `system_admin` เรียกโดยไม่ส่งรหัสศูนย์ → 400 · รายการไม่มีใบของศูนย์อื่นปน
- **AC-5d** — response ของ `/contact` มี header `Cache-Control: no-store`
- **AC-6** — DB ที่ไม่มี index → 503 พร้อมข้อความ ไม่สแกนทั้ง DB
- **AC-7** — walk-in จากหน้าคลังที่ใส่อีเมล → `donor.email` ถูกเก็บ · อีเมลผิดรูปแบบ → บันทึกไม่ได้ · เว้นว่าง → บันทึกได้ ไม่มี `donor.email`
- **AC-8** — หน้ารายละเอียดแสดงเลขล็อตของแต่ละรายการที่รับเข้า · ค้นด้วยเลขล็อตเจอใบที่มาของล็อตนั้น

## Impact

- **Gate:** implement ได้เมื่อ CR approve · deploy ต้อง provision index ลงทุก shelter DB (`redeploy-access`) ก่อนเปิดใช้ ไม่งั้นตัวกรองตอบ 503
- **ไม่ต้องแก้:** `donation` schema / `schema_v` · `audit` schema (ใช้ `action: other`) · FastAPI / Mongo / projection · worker · role-permission matrix
- **PII:** ข้อมูลติดต่ออยู่ใต้ retention ของ PII ผู้บริจาคเดิม · หลังพ้น retention ระบบเหลือแค่ชื่อ ปุ่ม "แสดงข้อมูลติดต่อ" ไม่มีอะไรให้แสดง
- **สถานะงาน:** FR-1 – FR-7, FR-9, FR-9a ทำแล้วใน branch `feat/821-received-filter` · FR-8 ทำแล้วแบบค้นในหน้าที่โหลด ต้องเปลี่ยนเป็นฝั่ง server · FR-10 – FR-13 ยังไม่ทำ

## Migration

- ไม่มี migration ของข้อมูล · ไม่ bump `schema_v`
- index ใหม่: `{ fields: [type desc, status desc, received_at desc, _id desc] }`, ddoc `donation-received-list` · index บน `stock_ledger.lot_no` (FR-13) · index สำหรับค้นหา (FR-8) ถ้าวิธีที่เลือกต้องใช้
- ทุก index: provisioner สร้างให้ศูนย์ใหม่ · ศูนย์เดิมใช้ `scripts/redeploy-access.ts`

## Why

- ข้อมูลถูกเก็บแล้วแต่ไม่มีที่ให้ใช้ — เจ้าหน้าที่ต้องติดต่อผู้บริจาคกลับ (ขอบคุณ, แจ้งของเสีย, ใบเสร็จ)
- ปิดบางส่วนเป็นค่าเริ่มต้นเพราะหน้ารายการเปิดดูบ่อยและเห็นได้จากข้างหลัง · รูปแบบเดียวกับที่ระบบใช้อยู่ (`maskLastName`, `mask_phone`, `mask_email`)
- อยู่ในแท็บ "รายการของบริจาค" ไม่สร้างหน้าใหม่ — เป็นที่ที่เจ้าหน้าที่ดูใบบริจาคอยู่แล้ว
- โหลดเพิ่มแทนเลขหน้า — CouchDB bookmark ต่อจากหน้าก่อนเสมอ กระโดดไปหน้า N ไม่ได้ และ `skip` ช้าลงตามจำนวนข้อมูล
- ค้นฝั่ง server — ค้นในหน้าที่โหลดแล้วหาใบในหน้าถัดไปไม่เจอ (FR-8)
- ส่งเฉพาะค่าที่ปิดแล้ว — ปิดแค่บนจอ ค่าเต็มยังอยู่ใน response เปิด DevTools ก็เห็นทุกใบ · ดูค่าเต็มทีละใบผ่าน endpoint + audit เป็นแบบเดียวกับปุ่มดู PIN เครื่อง kiosk (FR-10)
- คิวรอประเมินยังเห็นเต็ม — ผู้ตรวจต้องติดต่อผู้บริจาคระหว่างตัดสิน (FR-7)
- เลขล็อต — ตามของจากใบบริจาคไปถึงล็อตในคลังได้ เช่น ของหมดอายุหรือมีปัญหา (FR-12, FR-13)
- ตัดทิ้ง: แสดงข้อมูลเต็มในรายการ · แสดงในประวัติคลังอย่างเดียว (#811 ยังแสดงแค่รหัส `donation:…`)

## Decision log

- 2026-10-28 — proposed (Team D): ร่างจากการรีวิวงานใน `feat/821-received-filter`
- 2026-10-28 — ตัดสินโดย Jackyzaz ([คอมเมนต์](https://github.com/r202-coe-psu/tent/pull/974#issuecomment-6468911552)) ข้อ 1–5:
  1. ค้นหาฝั่ง server ทั้งศูนย์ในเฟสนี้ (FR-8)
  2. `shelter_manager` และ `system_admin` เห็นรายการและข้อมูลติดต่อด้วย นอกจากฝ่ายคลัง (FR-9)
  3. ปิดข้อมูลตั้งแต่ฝั่ง server · ค่าเต็มเห็นเมื่อกด "แสดงข้อมูลติดต่อ" และบันทึกว่าใครดูใบไหน (FR-10)
  4. เลขล็อตและค้นด้วยเลขล็อตอยู่ใน CR นี้ (FR-12, FR-13)
  5. เห็นเฉพาะศูนย์ที่เลือก / ศูนย์ของผู้ใช้ ไม่รวมหลายศูนย์ (FR-9a)
