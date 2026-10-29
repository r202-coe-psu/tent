---
id: draft
title: "รายการของบริจาคที่รับแล้ว + ข้อมูลติดต่อผู้บริจาคแบบปิดบางส่วน (#821)"
status: proposed
date: 2026-10-28
updated: 2026-10-29
requested_by: "GitHub #821 (roleplay 23/10/69 feedback) · epic #826"
decided_by: ""
layer: volatile
affects:
  - frontend/src/routes/(protected)/back-office/stock-donations/+page.svelte · components/received-donations-list.svelte (ใหม่)
  - frontend/src/lib/components/pending-review-board.svelte · pending-review-detail.svelte (โหมดอ่านอย่างเดียว)
  - frontend/src/lib/features/donations (domain `donation-queue.ts`, `donor-contact.ts` ใหม่, data `back-office-queue.ts`, application `queries.ts`)
  - frontend/src/routes/api/back-office/donations/+server.ts (`?status=received` แบบแบ่งหน้า — status อื่นทำงานเหมือนเดิม)
  - frontend/src/lib/server/shelter-access-design.ts · features/shelters/server/provisioner.ts · server/shelters.admin.ts · scripts/redeploy-access.ts · scripts/seed/registry-shelters.ts (Mango index ใหม่)
  - frontend/src/lib/features/operations/ui/receive-stock-form.svelte (อีเมล walk-in)
  - frontend/src/routes/api/back-office/donations/[query]/contact/+server.ts (ใหม่ — `POST` ข้อมูลติดต่อเต็ม + audit)
  - frontend/src/lib/features/operations (lot ของใบบริจาคจาก `stock_ledger`)
  - Mango index สำหรับค้นหาฝั่ง server และค้นเลขล็อต (ต่อ shelter DB)
  - docs/data/schema.md — §2.1 ข้อความ `lot.lot_no` (ใช้เป็นคีย์ค้นได้ ไม่ unique) · §Index `shelter_*` (index ใหม่ของ `donation` และ `stock_ledger`) · §2.12 `audit.reason = donor_contact_view` · ไม่ bump `schema_v`
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
- **FR-5** — ในรายการ ปิดค่าด้วย helper ใน `features/donations/domain/donor-contact.ts`: ชื่อ = ชื่อแรก + นามสกุลแบบ `maskLastName` (`$lib/utils/mask`) → `สมชาย ใ****` (`maskDonorName`) · เบอร์ = `xxx-xxx-1234` (`maskDonorPhone` — รูปเดียวกับ `maskLookupPhone` ใน `domain/tracking.ts`; ใช้ตัวนั้นแทนเมื่อ branch อยู่บน develop) · อีเมล = `s***i@example.com` (`maskDonorEmail`) · ไม่มีค่า = "ไม่ระบุเบอร์โทร" / "ไม่ระบุอีเมล" · ปิดค่าฝั่ง server ก่อนส่ง (FR-10)
- **FR-6** — หน้ารายละเอียดของใบที่รับแล้ว (อ่านอย่างเดียว — ไม่มีปุ่มอนุมัติ / ปฏิเสธ / ส่งต่อ): แสดงแบบปิดก่อน · ปุ่ม "แสดงข้อมูลติดต่อ" → ชื่อเต็ม, เบอร์เต็ม (ลิงก์ `tel:`), อีเมลเต็ม
- **FR-7** — คิวรอประเมิน (ไม่ใช่โหมดอ่านอย่างเดียว) แสดงข้อมูลติดต่อเต็มเหมือนเดิม

**ค้นหา**
- **FR-8** — ช่องค้นหาในรายการ "รับแล้ว" ค้นฝั่ง server **ทั้งศูนย์** (ไม่ใช่เฉพาะหน้าที่โหลดแล้ว): เลือกค้นด้วยเงื่อนไขอย่างใดอย่างหนึ่ง ไม่ต้องกรอกคู่กัน: เลขใบตรงเต็มค่า · ชื่อหรือนามสกุลตรงเต็มคำหลัง normalize (trim และยุบช่องว่างซ้ำ; ไม่ค้นบางส่วน) · เบอร์เต็มตรงค่าหลัง normalize รูปแบบขีด / ช่องว่าง / `+66` · เลือกสินค้าจากรายการเพื่อค้นด้วยรหัสสินค้า · เลขล็อตตรงเต็มค่า (FR-13)
- **FR-8a** — ผลค้นหาแบ่งหน้าแบบเดียวกับรายการ (FR-2) · ไม่เจอ = "ไม่พบรายการที่ตรงกับ …"
- **FR-8b** — อนุญาตให้เจ้าหน้าที่ใช้ผลค้นยืนยันชื่อหรือเบอร์ที่กรอกมาได้ แต่ response ยังเป็นค่าที่ปิดแล้ว (FR-10) · การค้นไม่ถือเป็นการเปิดข้อมูลเต็ม; ค่าเต็มเปิดผ่าน FR-10a พร้อม audit เท่านั้น
- **FR-8c** — ทุกวิธีค้นต้องมี index รองรับ · ไม่ใช้ `$regex` หรือโหลดรายการทั้งหมดมากรองใน application · ตรวจ `_explain` และ execution stats ว่าใช้ index จำกัดชุดข้อมูลตามเงื่อนไขค้น ไม่ใช่อ่านรายการทั้งศูนย์แล้วกรอง · index ไม่พร้อมตอบ 503 ตาม FR-3
- **FR-8d** — จำกัดอัตราค้นต่อผู้ใช้ที่ server ตามกลไก rate limit เดิม · เมื่อเกินตอบ 429 · บันทึกผู้ค้น ศูนย์ ประเภทเงื่อนไข เวลา และผลสำเร็จ/ถูกจำกัด โดยไม่เก็บชื่อ เบอร์ หรือข้อความค้นดิบใน log

**สิทธิ์**
- **FR-9** — เข้าถึงได้เฉพาะบทบาทที่ผ่าน `authorizeWarehouse`: `warehouse_staff`, `shelter_manager`, `system_admin` (เหมือน API บริจาค back-office อื่น)
- **FR-9a** — `?status=received` เห็นเฉพาะศูนย์ที่เลือก / ศูนย์ของผู้ใช้ · ไม่รวมหลายศูนย์ในรายการเดียว · `system_admin` ต้องส่งรหัสศูนย์ (ไม่ส่ง = 400) · ผู้ใช้อื่นขอศูนย์นอกสิทธิ์ = 403 · **กฎนี้ใช้กับ `status=received` เท่านั้น** — status อื่น (คิวรอประเมิน ฯลฯ) ทำงานเหมือนเดิม: `system_admin` เห็นทุกศูนย์รวมกัน
- **FR-10** — API รายการ (และผลค้นหา) ส่ง**เฉพาะค่าที่ปิดแล้ว** · ห้ามมีชื่อเต็ม / เบอร์เต็ม / อีเมลเต็มใน response
- **FR-10a** — ข้อมูลติดต่อเต็มมาจาก endpoint ของใบ `POST /api/back-office/donations/{query}/contact` · `{query}` = `booking_ref` หรือ `_id` หาใบด้วย `findDonationByQuery` เหมือน route อื่นใต้ `[query]/` · `POST` เพราะทุกครั้งที่เรียกเขียน audit (FR-10b) — แบบเดียวกับปุ่มดู PIN เครื่อง kiosk (`kiosk/devices/[id]/staff-pin/reveal`) · response มี `Cache-Control: no-store` · สิทธิ์ตาม FR-9/FR-9a (ใบต้องอยู่ในศูนย์ที่ผู้เรียกมีสิทธิ์) · เรียกเมื่อกด "แสดงข้อมูลติดต่อ" เท่านั้น
- **FR-10b** — ทุกครั้งที่เรียก FR-10a บันทึก `audit` (§2.12) `action: other`, `target_type: donation`, `target_id`, `reason: "donor_contact_view"`, `created_by` = ผู้เรียก, `occurred_at` · ไม่เก็บค่าข้อมูลติดต่อใน audit

**walk-in หน้าคลัง**
- **FR-11** — `receive-stock-form.svelte` เพิ่มช่อง "อีเมล (ไม่บังคับ)" เก็บใน `donor.email` · ตรวจรูปแบบด้วย Zod ตัวเดียวกับ walk-in ในหน้ารับบริจาค (`z.string().trim().email().optional()`, `back-office.ts`) ใน `walkInDonationInputSchema` ทั้งที่ฟอร์มและตอนสร้างใบ (`createWalkInDonation`) · ว่าง = ไม่เก็บ

**ตามหาของ**
- **FR-12** — แสดงเลขล็อต (`lot.lot_no` ของแถว `stock_ledger`) ของแต่ละใบ จาก ledger `reason = donation`, `ref_id = donation:{ulid}` (แถวที่ `keyDonationReceipt` เขียนตอนรับเข้า; ใช้ index เดิม `['type','ref_id','item_id','reason']`) · แถวที่ไม่มี `lot.lot_no` (ก่อน CR-088) แสดง "—" · หน้ารายละเอียดแสดงสินค้า / จำนวน / ล็อต / หมดอายุ / จุดจัดเก็บ / คงเหลือ
- **FR-13** — ค้นด้วยเลขล็อต (`L-YYMMDD-XXX`) ตรงทั้งค่า → แถว ledger `reason = donation` ที่ `lot.lot_no` ตรง ผ่าน Mango index `(type, lot.lot_no)` → ใบบริจาคจาก `ref_id` · `lot_no` ไม่ unique (CR-088 ยอมให้ป้ายซ้ำ) ⇒ ผลอาจมี**หลายใบ** แสดงเป็นรายการเหมือนผลค้นหาอื่น ไม่เลือกใบเดียวให้ · ลิงก์ไปประวัติคลัง (#811)

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ใบที่รับแล้ว | ไม่มีหน้าให้ดู | ตัวกรอง "รับแล้ว" + หน้ารายละเอียดอ่านอย่างเดียว |
| ข้อมูลติดต่อผู้บริจาค walk-in | ไม่เห็นหลังรับเข้าคลัง | รายการ: ปิดบางส่วน · รายละเอียด: กดดูเต็ม |
| ค้นหา | — | ฝั่ง server ทั้งศูนย์ เลือกเงื่อนไขเดียว: เลขใบ / ชื่อหรือนามสกุลเต็มคำ / เบอร์เต็ม / รหัสสินค้า / เลขล็อต |
| API รายการ / ผลค้นหา | — | ส่งเฉพาะค่าที่ปิดแล้ว |
| ข้อมูลติดต่อเต็ม | — | endpoint `/contact` ต่อใบ · ทุกครั้งที่เรียกเขียน `audit` |
| เลขล็อตของใบ | ไม่แสดง | หน้ารายละเอียดแสดงล็อต / หมดอายุ / จุดจัดเก็บ / คงเหลือ · ค้นด้วยเลขล็อตได้ |
| walk-in หน้าคลัง | เก็บแค่เบอร์ | เบอร์ + อีเมล |
| shelter DB | — | Mango index `donation-received-by-received-at` + index `stock_ledger` `(type, lot.lot_no)` (+ index รองรับทุกวิธีค้นตาม FR-8c) |

## Acceptance

- **AC-1** — ใบ `status = received` ของศูนย์ขึ้นในตัวกรอง "รับแล้ว" ใหม่สุดก่อน · หน้าละ 20 · "โหลดเพิ่ม" ได้หน้าถัดไปจนหมด
- **AC-2** — รายการไม่แสดงนามสกุล / เบอร์ / อีเมลเต็ม (ตรวจได้จากหน้าจอ)
- **AC-3** — หน้ารายละเอียดเห็นค่าเต็มหลังกด "แสดงข้อมูลติดต่อ" เท่านั้น · คิวรอประเมินยังเห็นเต็มเหมือนเดิม
- **AC-4** — ค้นแยกทีละเงื่อนไขด้วยเลขใบเต็ม, ชื่อหรือนามสกุลเต็มคำ, เบอร์เต็ม, สินค้าที่เลือก, เลขล็อตเต็ม เจอใบที่ตรง **แม้ใบนั้นยังไม่ได้โหลดขึ้นจอ** · ไม่เจอ = ข้อความ "ไม่พบรายการที่ตรงกับ …"
- **AC-5** — ผู้ไม่ผ่าน `authorizeWarehouse` เรียก `?status=received` หรือ `/contact` → 403 · `shelter_manager` และ `system_admin` เข้าได้ · ขอศูนย์นอกสิทธิ์ → 403
- **AC-5a** — response ของรายการและผลค้นหาไม่มีชื่อเต็ม / เบอร์เต็ม / อีเมลเต็ม (ตรวจจาก network)
- **AC-5b** — `POST /contact` หนึ่งครั้ง = audit หนึ่งแถวที่มีผู้เรียก ใบ และเวลา · `GET /contact` → 405 ไม่เขียน audit
- **AC-5c** — `system_admin` เรียก `?status=received` โดยไม่ส่งรหัสศูนย์ → 400 · รายการไม่มีใบของศูนย์อื่นปน · `system_admin` เรียก status อื่น (เช่น `pending_review`) โดยไม่ส่งรหัสศูนย์ → 200 ได้ทุกศูนย์เหมือนเดิม
- **AC-5d** — response ของ `/contact` มี header `Cache-Control: no-store`
- **AC-6** — DB ที่ไม่มี index → 503 พร้อมข้อความ ไม่สแกนทั้ง DB · ทุกประเภทค้นตรวจ `_explain` และ execution stats ว่าใช้ index จำกัดตามเงื่อนไขค้น ไม่อ่านรายการทั้งศูนย์มากรอง
- **AC-6a** — ชื่อ/นามสกุลบางส่วนและเบอร์บางส่วนไม่ใช้เป็นการค้นแบบ substring · เบอร์เต็มรูปแบบ `0…`, มีขีด/ช่องว่าง และ `+66…` ที่เทียบเท่ากันให้ผลเดียวกัน · ผลค้นยังไม่มีข้อมูลเต็มตาม AC-5a
- **AC-6b** — ค้นเกิน rate limit ต่อผู้ใช้ → 429 · มี log เหตุการณ์ค้นตาม FR-8d โดยไม่มีข้อความค้น ชื่อ หรือเบอร์ดิบ · เปิดข้อมูลเต็มยังต้องผ่าน AC-5b
- **AC-7** — walk-in จากหน้าคลังที่ใส่อีเมล → `donor.email` ถูกเก็บ · อีเมลผิดรูปแบบ → บันทึกไม่ได้ · เว้นว่าง → บันทึกได้ ไม่มี `donor.email`
- **AC-8** — หน้ารายละเอียดแสดงเลขล็อตของแต่ละรายการที่รับเข้า (จาก ledger `reason = donation`) · ค้นด้วยเลขล็อตเจอทุกใบที่มีล็อตป้ายนั้น · ป้ายเดียวกันอยู่ 2 ใบ → ผลแสดงทั้ง 2 ใบ

## Impact

- **Gate:** implement ได้เมื่อ CR approve · deploy ต้อง provision index ลงทุก shelter DB (`redeploy-access`) ก่อนเปิดใช้ ไม่งั้นตัวกรองตอบ 503
- **งานที่แตะไฟล์ร่วมกัน:** FR-11 และ #981 แก้ `receive-stock-form.svelte` ร่วมกัน · merge ได้ตามความพร้อม · งานที่ merge ทีหลังต้อง resolve conflict และตรวจว่าการรับเข้าคลังกับการบันทึกอีเมลยังทำงานครบ
- **schema.md:** แก้ข้อความ ไม่เปลี่ยนรูปร่าง doc — §2.1 `lot.lot_no` ใช้เป็นคีย์ค้นใบบริจาคได้ (ยังไม่ unique และไม่ผูก business rule) · §Index `shelter_*` เพิ่ม donation `(type, status, received_at)` และ stock_ledger `(type, lot.lot_no)` · §2.12 เพิ่ม `reason = donor_contact_view` ของ `action: other`
- **ไม่ต้องแก้:** `donation` schema / `schema_v` · `audit` schema (ใช้ `action: other`) · FastAPI / Mongo / projection · worker · role-permission matrix
- **PII:** ข้อมูลติดต่ออยู่ใต้ retention ของ PII ผู้บริจาคเดิม · หลังพ้น retention ระบบเหลือแค่ชื่อ ปุ่ม "แสดงข้อมูลติดต่อ" ไม่มีอะไรให้แสดง
- **สถานะงาน:** FR-1 – FR-7, FR-9, FR-9a ทำแล้วใน branch `feat/821-received-filter` (FR-9a ต้องตรวจว่าจำกัดเฉพาะ `status=received`; comment / เทสต์ที่อ้าง "decision A1" เปลี่ยนเป็น FR-9a) · FR-8 ทำแล้วแบบค้นในหน้าที่โหลด ต้องเปลี่ยนเป็นฝั่ง server · FR-10 – FR-13 ยังไม่ทำ

## Migration

- ไม่มี migration ของข้อมูล · ไม่ bump `schema_v`
- index ใหม่: `{ fields: [type desc, status desc, received_at desc, _id desc] }`, ddoc `donation-received-list` · `stock_ledger` `{ fields: [type, lot.lot_no] }` (FR-13) · index รองรับการค้นแต่ละประเภท (FR-8c) รวม key ที่ normalize แล้วตามวิธี index ที่เลือก; หากต้องเพิ่มฟิลด์ persist ให้แก้ผลกระทบ schema / migration ก่อน implement
- ทุก index: provisioner สร้างให้ศูนย์ใหม่ · ศูนย์เดิมใช้ `scripts/redeploy-access.ts`

## Why

- ข้อมูลถูกเก็บแล้วแต่ไม่มีที่ให้ใช้ — เจ้าหน้าที่ต้องติดต่อผู้บริจาคกลับ (ขอบคุณ, แจ้งของเสีย, ใบเสร็จ)
- ปิดบางส่วนเป็นค่าเริ่มต้นเพราะหน้ารายการเปิดดูบ่อยและเห็นได้จากข้างหลัง · รูปแบบเดียวกับที่ระบบใช้อยู่ (`maskLastName`, `maskLookupPhone`)
- อยู่ในแท็บ "รายการของบริจาค" ไม่สร้างหน้าใหม่ — เป็นที่ที่เจ้าหน้าที่ดูใบบริจาคอยู่แล้ว
- โหลดเพิ่มแทนเลขหน้า — CouchDB bookmark ต่อจากหน้าก่อนเสมอ กระโดดไปหน้า N ไม่ได้ และ `skip` ช้าลงตามจำนวนข้อมูล
- ค้นฝั่ง server — ค้นในหน้าที่โหลดแล้วหาใบในหน้าถัดไปไม่เจอ (FR-8)
- ส่งเฉพาะค่าที่ปิดแล้ว — ปิดแค่บนจอ ค่าเต็มยังอยู่ใน response เปิด DevTools ก็เห็นทุกใบ · ดูค่าเต็มทีละใบผ่าน endpoint + audit เป็นแบบเดียวกับปุ่มดู PIN เครื่อง kiosk (FR-10)
- คิวรอประเมินยังเห็นเต็ม — ผู้ตรวจต้องติดต่อผู้บริจาคระหว่างตัดสิน (FR-7)
- เลขล็อต — ตามของจากใบบริจาคไปถึงล็อตในคลังได้ เช่น ของหมดอายุหรือมีปัญหา (FR-12, FR-13)
- ตัดทิ้ง: แสดงข้อมูลเต็มในรายการ · แสดงในประวัติคลังอย่างเดียว (#811 ยังแสดงแค่รหัส `donation:…`)

## Decision log

- 2026-10-28 — proposed (Team D): ร่างจากการรีวิวงานใน `feat/821-received-filter`
- 2026-10-28 — คำตอบ ([คอมเมนต์](https://github.com/r202-coe-psu/tent/pull/974#issuecomment-6468911552)) ข้อ 1–5:
  1. ค้นหาฝั่ง server ทั้งศูนย์ในเฟสนี้ (FR-8)
  2. `shelter_manager` และ `system_admin` เห็นรายการและข้อมูลติดต่อด้วย นอกจากฝ่ายคลัง (FR-9)
  3. ปิดข้อมูลตั้งแต่ฝั่ง server · ค่าเต็มเห็นเมื่อกด "แสดงข้อมูลติดต่อ" และบันทึกว่าใครดูใบไหน (FR-10)
  4. เลขล็อตและค้นด้วยเลขล็อตอยู่ใน CR นี้ (FR-12, FR-13)
  5. เห็นเฉพาะศูนย์ที่เลือก / ศูนย์ของผู้ใช้ ไม่รวมหลายศูนย์ (FR-9a) — โค้ดใน `feat/821-received-filter` อ้างข้อนี้ว่า "decision A1"
- 2026-10-29 — แก้ตามรีวิว PR #974: ledger `reason = donation` (FR-12) · `lot.lot_no` ไม่ unique ผลค้นได้หลายใบ (FR-13, AC-8) · FR-9a เฉพาะ `status=received` · `/contact` เป็น `POST` ใต้ `[query]/` · เพิ่ม `docs/data/schema.md` ใน `affects`

- 2026-10-29 — owner ยอมรับวิธีค้น: ใช้เงื่อนไขอย่างใดอย่างหนึ่งได้ · ชื่อหรือนามสกุลตรงเต็มคำ เบอร์เต็ม เลขใบ/ล็อตตรงเต็มค่า และเลือกสินค้าด้วยรหัส · ยอมรับว่าผลค้นยืนยันข้อมูลที่กรอกมาได้ แต่ไม่เปิดค่าเต็ม; ค่าเต็มต้องผ่าน `/contact` พร้อม audit · จำกัดอัตราค้นต่อผู้ใช้และบันทึกเหตุการณ์โดยไม่เก็บค่าค้นดิบ · ทุกวิธีค้นต้องมี index รองรับ (FR-8–FR-8d, AC-4, AC-6–AC-6b)
