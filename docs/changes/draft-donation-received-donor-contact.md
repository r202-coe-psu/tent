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
  - frontend/src/routes/api/back-office/donations/received/search/+server.ts (ใหม่ — `POST` ค้นใบที่รับแล้ว)
  - frontend/src/lib/features/shelters/domain/view-manifest.ts (view ใหม่ 2 ตัว · `_design/app` version 6 → 7)
  - Mango index ค้นด้วยเบอร์ และค้นเลขล็อต (ต่อ shelter DB)
  - nginx/rate-limit.conf (zone ใหม่ของ route ค้นหา — ต่อ IP ตาม CR-188)
  - docs/data/schema.md — §2.1 ข้อความ `lot.lot_no` (ใช้เป็นคีย์ค้นได้ ไม่ unique) · §Index `shelter_*` (index ใหม่ของ `donation` และ `stock_ledger`) · §7 view ใหม่ 2 ตัว (view manifest v7) · §2.12 `audit.reason = donor_contact_view` · ไม่ bump `schema_v`
  - role/permission — ไม่เปลี่ยน: ใช้ `authorizeWarehouse` เดิม (warehouse_staff, shelter_manager, system_admin)
why: walk-in บันทึกเบอร์และอีเมลผู้บริจาคแล้ว แต่หลังรับเข้าคลังไม่มีหน้าไหนให้เห็นอีก เจ้าหน้าที่ติดต่อกลับไม่ได้ (#821)
migration: ไม่เปลี่ยนรูปร่าง doc — ไม่ bump `schema_v` · เพิ่ม Mango index + view ต่อ shelter DB (view manifest 6 → 7; provision / redeploy-access)
---

# draft-donation-received-donor-contact — รายการที่รับแล้ว + ข้อมูลติดต่อผู้บริจาค

## สรุป

- **เปลี่ยน:** เพิ่มตัวกรอง "รับแล้ว" ในแท็บ "รายการของบริจาค" (`/back-office/stock-donations?tab=list&filter=received`) เรียงใหม่สุดก่อน · ชื่อ / เบอร์ / อีเมลผู้บริจาคแสดงแบบ**ปิดบางส่วน** · ข้อมูลเต็มเห็นในหน้ารายละเอียดหลังกด "แสดงข้อมูลติดต่อ"
- **เพื่อ:** ให้เจ้าหน้าที่หาใบบริจาคที่รับแล้วและติดต่อผู้บริจาคกลับได้ โดยไม่เปิดข้อมูลส่วนบุคคลให้เห็นทั้งหน้า (PDPA: data minimization, least privilege)
- **dev ต้อง build:** API `?status=received` แบ่งหน้าด้วย bookmark + Mango index ใหม่ · **ค้นหาฝั่ง server ทั้งศูนย์** (`POST` + Mango index / CouchDB view ต่อประเภทค้น) · API รายการส่งเฉพาะค่าที่ปิดแล้ว + endpoint ข้อมูลติดต่อเต็มพร้อม audit · เลขล็อตของใบ + ค้นด้วยเลขล็อต · โหมดอ่านอย่างเดียวของหน้ารายละเอียด · อีเมลใน walk-in หน้าคลัง
- **กระทบ:** ไม่เปลี่ยน schema / `schema_v` · เพิ่ม Mango index + view ต่อ shelter DB (view manifest 6 → 7) · rate limit ต่อ IP ที่ nginx · ไม่เปลี่ยน role / permission

## Requirements

**รายการ "รับแล้ว"**
- **FR-1** — ตัวกรอง "รับแล้ว" แสดง `donation` ที่ `status = received` ของศูนย์ที่ทำงานอยู่ เรียง `received_at` ใหม่สุดก่อน
- **FR-2** — แบ่งหน้าจาก server หน้าละ 20 รายการ (`RECEIVED_PAGE_SIZE`) ด้วย CouchDB bookmark · ปุ่ม "โหลดเพิ่ม" ไม่ใช้เลขหน้า
- **FR-3** — query ใช้ Mango index ddoc `donation-received-list` ชื่อ `donation-received-by-received-at` (`allow_fallback: false`) · DB ที่ยังไม่มี index ตอบ 503 พร้อมข้อความ "ยังไม่พร้อมแสดงรายการที่รับแล้ว"
- **FR-4** — หน้าตาเหมือนตัวกรองอื่นของ queue: แถบค้นหา · การ์ด (< md) · ตาราง 4 คอลัมน์ (md+): ผู้ส่งและรหัสคำขอ / รายการที่รับ / ติดต่อผู้บริจาค / การจัดการ

**ปิดข้อมูลบางส่วน**
- **FR-5** — ในรายการ ปิดค่าด้วย helper ใน `features/donations/domain/donor-contact.ts`: ชื่อ = ชื่อแรก + นามสกุลแบบ `maskLastName` (`$lib/utils/mask`) → `สมชาย ใ****` (`maskDonorName`) · เบอร์ = `xxx-xxx-1234` (`maskDonorPhone` — รูปเดียวกับ `maskLookupPhone` ใน `domain/tracking.ts`; ใช้ตัวนั้นแทนเมื่อ branch อยู่บน develop) · อีเมล = `s***i@example.com` (`maskDonorEmail`) · ไม่มีค่า = "ไม่ระบุเบอร์โทร" / "ไม่ระบุอีเมล" · ปิดค่าฝั่ง server ก่อนส่ง (FR-10)
- **FR-6** — หน้ารายละเอียดของใบที่รับแล้ว (อ่านอย่างเดียว — ไม่มีปุ่มอนุมัติ / ปฏิเสธ / ส่งต่อ): แสดงแบบปิดก่อน · ปุ่ม "แสดงข้อมูลติดต่อ" → ชื่อเต็ม, เบอร์เต็ม (ลิงก์ `tel:`), อีเมลเต็ม
- **FR-7** — คิวรอประเมิน (ไม่ใช่โหมดอ่านอย่างเดียว) แสดงข้อมูลติดต่อเต็มเหมือนเดิม

**ค้นหา**
- **FR-8** — ช่องค้นหาในรายการ "รับแล้ว" ค้นฝั่ง server **ทั้งศูนย์** (ไม่ใช่เฉพาะหน้าที่โหลดแล้ว) · ค้นครั้งละ**หนึ่งประเภท** (UI เลือกประเภท; request ส่ง `by`) · ทุกประเภทตรงทั้งค่าหลัง normalize ไม่ค้นบางส่วน:

  | `by` | ค่าที่ค้น | ตรงกับ | ใช้ |
  | --- | --- | --- | --- |
  | `booking_ref` | เลขใบ เช่น `DN-306892` | `booking_ref` ตรงทั้งค่า | Mango index `(booking_ref)` เดิม |
  | `name` | ชื่อ หรือ นามสกุล หรือ ชื่อเต็ม | คำใดคำหนึ่งของ `donor.name` ตรงทั้งคำ **หรือ** ทั้งชื่อตรงทั้งค่า · `สมชาย ใจดี` = ทั้งสองคำต้องตรงตามลำดับ | view `donation_received_by_name` |
  | `phone` | เบอร์เต็ม | `donor.phone_hash` = hash ของเบอร์ที่ normalize แล้ว (แบบ CR-173) | Mango index `(type, status, donor.phone_hash, received_at)` |
  | `item` | สินค้าที่เลือกจากรายการ `item_master` | `items[].item_id` ตรง | view `donation_received_by_item` |
  | `lot` | เลขล็อต `L-YYMMDD-XXX` | ตาม FR-13 | Mango index `(type, lot.lot_no)` |

  normalize ชื่อ: NFKC → lowercase → trim → ยุบช่องว่างซ้ำ (ฟังก์ชันเดียวกันทั้งใน view และฝั่ง server) · normalize เบอร์: ตัดขีด / ช่องว่าง / วงเล็บ, `+66` → `0` แล้วต้องเป็นเบอร์ที่ใช้ได้ ไม่งั้น 400
- **FR-8a** — ผลค้นหน้าละ 20 (`RECEIVED_PAGE_SIZE`) เรียง `received_at` ใหม่สุดก่อน · เวลาเท่ากันเรียง `_id` มากไปน้อย · ใบหนึ่งขึ้นในผลได้ครั้งเดียว · ปุ่ม "โหลดเพิ่ม" ส่ง `cursor` ที่ server ออกให้ · ไม่เจอ = "ไม่พบรายการที่ตรงกับ …" · วิธีแบ่งหน้าตามประเภท:

  | `by` | แบ่งหน้าด้วย |
  | --- | --- |
  | `booking_ref` | ได้ไม่เกิน 1 ใบ ไม่มี `cursor` |
  | `phone` | Mango bookmark ของ index `(type, status, donor.phone_hash, received_at)` |
  | `name`, `item` | view + lookahead (FR-8h) |
  | `lot` | tuple `(received_at, _id)` (FR-8d) |

  `cursor` เป็นค่าทึบ (base64url ของ JSON) ที่ผูกกับ `by` และ `q` ของ request แรก · ส่ง `cursor` มากับ `by` หรือ `q` อื่น → 400
- **FR-8b** — ผลค้นใช้ยืนยันได้ว่าชื่อหรือเบอร์ที่เจ้าหน้าที่พิมพ์มีใบอยู่ แต่ response ยังเป็นค่าที่ปิดแล้ว (FR-10) · การค้นไม่ถือเป็นการเปิดข้อมูลเต็ม · ค่าเต็มเปิดผ่าน FR-10a พร้อม audit เท่านั้น
- **FR-8c** — route `POST /api/back-office/donations/received/search` · body `{ shelter_code?, by, q, cursor? }` (คำค้นอยู่ใน body ไม่อยู่ใน URL — ไม่ติด access log) · สิทธิ์และศูนย์ตาม FR-9 / FR-9a · response แบบเดียวกับรายการ (FR-10) + `cursor`
- **FR-8d** — ทุกประเภทค้นอ่านผ่าน index หรือ view ที่จำกัดด้วยค่าค้น · ไม่ใช้ `$regex` · ไม่โหลดใบทั้งศูนย์มากรองในแอป · index / view ยังไม่ deploy หรือ `_design/app` version ต่ำกว่า 7 → 503 ตาม FR-3 · `by = lot` ทำตามลำดับนี้:
  1. `_find` `stock_ledger` ที่ `lot.lot_no = q` และ `reason = donation` ผ่าน index `(type, lot.lot_no)` · `limit` 200 ต่อรอบ อ่านต่อด้วย bookmark จนหมด (ไม่พึ่ง `limit` ค่าเริ่มต้น 25)
  2. ตัด `ref_id` ซ้ำ — ใบเดียวมีหลายแถว ledger ป้ายเดียวกันนับเป็นใบเดียว
  3. ดึงใบด้วย `_all_docs` `keys` + `include_docs` · เก็บเฉพาะ `type = donation`, `status = received`
  4. เรียงตาม FR-8a (`received_at` ใหม่สุดก่อน, `_id` มากไปน้อย) — เรียงในแอปได้เพราะเป็นเฉพาะใบที่ตรงป้ายแล้ว ไม่ใช่ใบทั้งศูนย์
  5. ตัดหน้าละ 20 · `cursor` = `(received_at, _id)` ของใบสุดท้ายในหน้า · หน้าถัดไปเอาเฉพาะใบที่อยู่**ถัดจาก** tuple นี้ในลำดับเดียวกัน
- **FR-8e** — rate limit ต่อ **IP** ที่ nginx (`limit_req` zone ใหม่ของ route ค้นหา ใน `nginx/rate-limit.conf`) ตาม CR-188 · ไม่มี limiter ในแอป · เกิน = 429
- **FR-8f** — ทุกการค้นเขียน log ของแอป (ไม่ใช่ doc ใน CouchDB) event `donation_received_search`: ผู้ค้น, `shelter_code`, `by`, จำนวนผล, เวลา · **ไม่เก็บ `q`** หรือชื่อ / เบอร์ใน log
- **FR-8g** — รายการในใบที่ไม่ได้ผูก `item_master` (`free_text` อย่างเดียว) ค้นด้วย `by = item` ไม่เจอ · ใบนั้นยังค้นด้วยประเภทอื่นได้
- **FR-8h** — แบ่งหน้า view ด้วย lookahead: query `limit = 21` · แสดง 20 แถวแรก · มีแถวที่ 21 = มีหน้าถัดไป และ `cursor` = key + `_id` **ของแถวที่ 21** · หน้าถัดไปใช้ `startkey` / `startkey_docid` จาก `cursor` ซึ่งเริ่มที่แถวที่ 21 (CouchDB รวมแถวเริ่มต้น) จึงไม่ซ้ำและไม่ข้าม · ไม่ใช้ `skip` · map emit ใบหนึ่งไม่เกินหนึ่งแถวต่อ key (Migration) ผลจึงไม่มีใบซ้ำ

**สิทธิ์**
- **FR-9** — เข้าถึงได้เฉพาะบทบาทที่ผ่าน `authorizeWarehouse`: `warehouse_staff`, `shelter_manager`, `system_admin` (เหมือน API บริจาค back-office อื่น)
- **FR-9a** — `?status=received` เห็นเฉพาะศูนย์ที่เลือก / ศูนย์ของผู้ใช้ · ไม่รวมหลายศูนย์ในรายการเดียว · `system_admin` ต้องส่งรหัสศูนย์ (ไม่ส่ง = 400) · ผู้ใช้อื่นขอศูนย์นอกสิทธิ์ = 403 · **กฎนี้ใช้กับ `status=received` เท่านั้น** — status อื่น (คิวรอประเมิน ฯลฯ) ทำงานเหมือนเดิม: `system_admin` เห็นทุกศูนย์รวมกัน
- **FR-10** — API รายการ (และผลค้นหา) ส่ง**เฉพาะค่าที่ปิดแล้ว** · ห้ามมีชื่อเต็ม / เบอร์เต็ม / อีเมลเต็มใน response
- **FR-10a** — ข้อมูลติดต่อเต็มมาจาก endpoint ของใบ `POST /api/back-office/donations/{query}/contact` · `{query}` = `booking_ref` หรือ `_id` หาใบด้วย `findDonationByQuery` เหมือน route อื่นใต้ `[query]/` · `POST` เพราะทุกครั้งที่เรียกเขียน audit (FR-10b) — แบบเดียวกับปุ่มดู PIN เครื่อง kiosk (`kiosk/devices/[id]/staff-pin/reveal`) · response มี `Cache-Control: no-store` · สิทธิ์ตาม FR-9/FR-9a (ใบต้องอยู่ในศูนย์ที่ผู้เรียกมีสิทธิ์) · เรียกเมื่อกด "แสดงข้อมูลติดต่อ" เท่านั้น
- **FR-10b** — ทุกครั้งที่เรียก FR-10a บันทึก `audit` (§2.12) `action: other`, `target_type: donation`, `target_id`, `reason: "donor_contact_view"`, `created_by` = ผู้เรียก, `occurred_at` · ไม่เก็บค่าข้อมูลติดต่อใน audit
- **FR-10c** — ใบที่ข้อมูลติดต่อถูกลบตาม retention (ไม่มี `donor.name` / `phone` / `email`): รายการแสดง "ไม่ระบุชื่อ" / "ไม่ระบุเบอร์โทร" / "ไม่ระบุอีเมล" · `POST /contact` ตอบ 200 ค่าเป็น `null` ทุกช่อง และยังเขียน audit ตาม FR-10b · UI แสดง "ข้อมูลติดต่อถูกลบตามนโยบายการเก็บข้อมูล" · ค้น `by = name` ไม่เจอ · ค้น `by = phone` **ยังเจอ** เพราะเก็บ `phone_hash` ไว้ตามนโยบาย

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
| ค้นหา | — | `POST` ฝั่ง server ทั้งศูนย์ ครั้งละหนึ่งประเภท: เลขใบ / ชื่อหรือนามสกุลเต็มคำ / เบอร์เต็ม / สินค้าที่เลือก / เลขล็อต · rate limit ต่อ IP ที่ nginx |
| API รายการ / ผลค้นหา | — | ส่งเฉพาะค่าที่ปิดแล้ว |
| ข้อมูลติดต่อเต็ม | — | endpoint `/contact` ต่อใบ · ทุกครั้งที่เรียกเขียน `audit` |
| เลขล็อตของใบ | ไม่แสดง | หน้ารายละเอียดแสดงล็อต / หมดอายุ / จุดจัดเก็บ / คงเหลือ · ค้นด้วยเลขล็อตได้ |
| walk-in หน้าคลัง | เก็บแค่เบอร์ | เบอร์ + อีเมล |
| shelter DB | — | Mango index `donation-received-by-received-at` · donation `(type, status, donor.phone_hash, received_at)` · `stock_ledger` `(type, lot.lot_no)` · view `donation_received_by_name`, `donation_received_by_item` (`_design/app` v7) |

## Acceptance

- **AC-1** — ใบ `status = received` ของศูนย์ขึ้นในตัวกรอง "รับแล้ว" ใหม่สุดก่อน · หน้าละ 20 · "โหลดเพิ่ม" ได้หน้าถัดไปจนหมด
- **AC-2** — รายการไม่แสดงนามสกุล / เบอร์ / อีเมลเต็ม (ตรวจได้จากหน้าจอ)
- **AC-3** — หน้ารายละเอียดเห็นค่าเต็มหลังกด "แสดงข้อมูลติดต่อ" เท่านั้น · คิวรอประเมินยังเห็นเต็มเหมือนเดิม
- **AC-4** — ค้นแยกทีละประเภทด้วยเลขใบเต็ม, ชื่อหรือนามสกุลเต็มคำ, ชื่อเต็ม, เบอร์เต็ม, สินค้าที่เลือก, เลขล็อตเต็ม เจอใบที่ตรง **แม้ใบนั้นยังไม่ได้โหลดขึ้นจอ** · ไม่เจอ = ข้อความ "ไม่พบรายการที่ตรงกับ …"
- **AC-5** — ผู้ไม่ผ่าน `authorizeWarehouse` เรียก `?status=received`, `/received/search` หรือ `/contact` → 403 · `shelter_manager` และ `system_admin` เข้าได้ · ขอศูนย์นอกสิทธิ์ → 403
- **AC-5a** — response ของรายการและผลค้นหาไม่มีชื่อเต็ม / เบอร์เต็ม / อีเมลเต็ม (ตรวจจาก network)
- **AC-5b** — `POST /contact` หนึ่งครั้ง = audit หนึ่งแถวที่มีผู้เรียก ใบ และเวลา · `GET /contact` → 405 ไม่เขียน audit
- **AC-5c** — `system_admin` เรียก `?status=received` โดยไม่ส่งรหัสศูนย์ → 400 · รายการไม่มีใบของศูนย์อื่นปน · `system_admin` เรียก status อื่น (เช่น `pending_review`) โดยไม่ส่งรหัสศูนย์ → 200 ได้ทุกศูนย์เหมือนเดิม
- **AC-5d** — response ของ `/contact` มี header `Cache-Control: no-store`
- **AC-6** — DB ที่ยังไม่มี index / view หรือ `_design/app` version < 7 → 503 พร้อมข้อความ · `_explain` ของ query ประเภท `booking_ref`, `phone`, `lot` ใช้ index ที่ระบุใน FR-8 (ไม่ใช่ `all_docs`) · ประเภท `name`, `item` อ่านจาก view ด้วย key ของค่าค้น · ไม่มี `$regex` ใน selector
- **AC-6a** — ใบของ `สมชาย ใจดี` เบอร์ `081-234-5678`:
  - `name` = `ใจดี`, `สมชาย`, `สมชาย ใจดี`, ` สมชาย  ใจดี ` → เจอ
  - `name` = `ใจ`, `สม`, `ใจดี สมชาย` → ไม่เจอ
  - `phone` = `0812345678`, `081-234-5678`, `+66812345678` → เจอ · `5678`, `081234` → 400
  - ผลทุกกรณีไม่มีชื่อเต็ม / เบอร์เต็ม / อีเมลเต็ม (AC-5a)
- **AC-6b** — ค้นเกินอัตราที่ตั้งใน `nginx/rate-limit.conf` จาก IP เดียว → 429 · log `donation_received_search` มีผู้ค้น ศูนย์ `by` จำนวนผล เวลา และไม่มี `q` / ชื่อ / เบอร์ · access log ของ route ค้นหาไม่มีคำค้น (อยู่ใน body)
- **AC-6c** — ใบที่รายการเป็น `free_text` อย่างเดียว ค้นด้วย `item` ไม่เจอ แต่ค้นด้วย `booking_ref` / `name` / `phone` เจอ
- **AC-6d** — ล็อต: ป้ายเดียวกันอยู่ใน 25 ใบ → หน้าแรก 20 ใบ หน้าสอง 5 ใบ ไม่ซ้ำ ไม่ขาด เรียงใหม่ไปเก่า · ใบเดียวมี 3 แถว ledger ป้ายเดียวกัน → ขึ้นครั้งเดียว · 2 ใบ `received_at` เท่ากันคร่อมรอยต่อหน้า → ไม่ซ้ำ ไม่หาย · แถว ledger ที่ชี้ใบสถานะอื่นไม่ขึ้นในผล
- **AC-6e** — view: 25 ใบชื่อ `สมชาย` ที่ `received_at` เท่ากันหมด → หน้า 20 + 5 ไม่ซ้ำ ไม่หาย · ใบชื่อคำเดียว (`สมชาย`) ขึ้นครั้งเดียว · `cursor` ของคำค้นหนึ่งส่งมากับคำค้นอื่น → 400
- **AC-6f** — ใบที่ไม่มี `donor.name` / `phone` / `email`: รายการขึ้น "ไม่ระบุ…" · `POST /contact` ได้ `null` และมี audit 1 แถว · ค้นด้วยเบอร์เดิมยังเจอใบ · ค้นด้วยชื่อเดิมไม่เจอ
- **AC-7** — walk-in จากหน้าคลังที่ใส่อีเมล → `donor.email` ถูกเก็บ · อีเมลผิดรูปแบบ → บันทึกไม่ได้ · เว้นว่าง → บันทึกได้ ไม่มี `donor.email`
- **AC-8** — หน้ารายละเอียดแสดงเลขล็อตของแต่ละรายการที่รับเข้า (จาก ledger `reason = donation`) · ค้นด้วยเลขล็อตเจอทุกใบที่มีล็อตป้ายนั้น · ป้ายเดียวกันอยู่ 2 ใบ → ผลแสดงทั้ง 2 ใบ

## Impact

- **Gate:** implement ได้เมื่อ CR approve · deploy ต้อง provision index และ `_design/app` v7 ลงทุก shelter DB (`redeploy-access`) ก่อนเปิดใช้ ไม่งั้นตัวกรองและการค้นตอบ 503 · view manifest เป็นเลขลำดับร่วมทั้งระบบ — ถ้ามีงานอื่น bump ก่อน ให้ใช้เลขถัดไปตอน merge
- **nginx:** เพิ่ม zone ใน `nginx/rate-limit.conf` ทุก environment (CR-188)
- **งานที่แตะไฟล์ร่วมกัน:** FR-11 และ #981 แก้ `receive-stock-form.svelte` ร่วมกัน · merge ได้ตามความพร้อม · งานที่ merge ทีหลังต้อง resolve conflict และตรวจว่าการรับเข้าคลังกับการบันทึกอีเมลยังทำงานครบ
- **schema.md:** แก้ข้อความ ไม่เปลี่ยนรูปร่าง doc — §2.1 `lot.lot_no` ใช้เป็นคีย์ค้นใบบริจาคได้ (ยังไม่ unique และไม่ผูก business rule) · §Index `shelter_*` เพิ่ม donation `(type, status, received_at)`, `(type, status, donor.phone_hash, received_at)` และ stock_ledger `(type, lot.lot_no)` · §7 เพิ่ม view `donation_received_by_name`, `donation_received_by_item` (manifest v7) · §2.12 เพิ่ม `reason = donor_contact_view` ของ `action: other`
- **ไม่ต้องแก้:** `donation` schema / `schema_v` · `audit` schema (ใช้ `action: other`) · FastAPI / Mongo / projection · worker · role-permission matrix
- **PII:** ข้อมูลติดต่ออยู่ใต้ retention ของ PII ผู้บริจาคตาม `docs/data/data-model.md` §7 — ลบ `donor.name` / `phone` / `line_id` / `email` ภายใน 3 เดือนหลังปิดศูนย์ เหลือ `phone_hash` + ยอด · **สถานะจริง:** ยังไม่มีงานลบอัตโนมัติฝั่ง CouchDB ข้อมูลติดต่อจึงยังอยู่จนกว่าจะมีงานลบ · CR นี้ไม่สร้างงานลบ · เมื่อข้อมูลถูกลบแล้วทำงานตาม FR-10c
- **สถานะงาน:** FR-1 – FR-7, FR-9, FR-9a ทำแล้วใน branch `feat/821-received-filter` (FR-9a ต้องตรวจว่าจำกัดเฉพาะ `status=received`; comment / เทสต์ที่อ้าง "decision A1" เปลี่ยนเป็น FR-9a) · FR-8 ทำแล้วแบบค้นในหน้าที่โหลด ต้องเปลี่ยนเป็นฝั่ง server · FR-10 – FR-13 ยังไม่ทำ

## Migration

- ไม่มี migration ของข้อมูล · ไม่ bump `schema_v`
- Mango index ใหม่ (ddoc / ชื่อ):
  - `donation-received-list` / `donation-received-by-received-at` — `[type desc, status desc, received_at desc, _id desc]` (FR-1 – FR-3)
  - `donation-received-phone` — `[type, status, donor.phone_hash, received_at]` (FR-8 `phone`)
  - `stock-ledger-lot-no` — `[type, lot.lot_no]` (FR-8 `lot`, FR-13)
- view ใหม่ใน `_design/app` (version 6 → 7):
  - `donation_received_by_name` — emit เฉพาะ `type = donation`, `status = received`, มี `donor.name`: key `[ชื่อ normalize แล้วทั้งก้อน, received_at]` และ `[แต่ละคำ, received_at]` · emit แต่ละ key ไม่เกินครั้งเดียวต่อใบ — คำซ้ำในชื่อเดียว และชื่อคำเดียว (ชื่อทั้งก้อน = คำนั้น) emit ครั้งเดียว · value `null`
  - `donation_received_by_item` — emit เฉพาะใบเดียวกัน: key `[item_id, received_at]` ต่อ `item_id` ที่ไม่ซ้ำในใบ · value `null`
  - query หน้าแรก: `descending=true`, `startkey=[q, {}]`, `endkey=[q]`, `include_docs=true`, `limit=21` · หน้าถัดไป: `startkey` = key ของแถวที่ 21, `startkey_docid` = `_id` ของแถวที่ 21, `endkey=[q]`, `limit=21` (FR-8h) · แถวที่ key เท่ากัน CouchDB เรียงด้วย docid จากมากไปน้อยเมื่อ `descending=true`
- ทุก index และ view: provisioner สร้างให้ศูนย์ใหม่ · ศูนย์เดิมใช้ `scripts/redeploy-access.ts`

## Why

- ข้อมูลถูกเก็บแล้วแต่ไม่มีที่ให้ใช้ — เจ้าหน้าที่ต้องติดต่อผู้บริจาคกลับ (ขอบคุณ, แจ้งของเสีย, ใบเสร็จ)
- ปิดบางส่วนเป็นค่าเริ่มต้นเพราะหน้ารายการเปิดดูบ่อยและเห็นได้จากข้างหลัง · รูปแบบเดียวกับที่ระบบใช้อยู่ (`maskLastName`, `maskLookupPhone`)
- อยู่ในแท็บ "รายการของบริจาค" ไม่สร้างหน้าใหม่ — เป็นที่ที่เจ้าหน้าที่ดูใบบริจาคอยู่แล้ว
- โหลดเพิ่มแทนเลขหน้า — CouchDB bookmark ต่อจากหน้าก่อนเสมอ กระโดดไปหน้า N ไม่ได้ และ `skip` ช้าลงตามจำนวนข้อมูล
- ค้นฝั่ง server — ค้นในหน้าที่โหลดแล้วหาใบในหน้าถัดไปไม่เจอ (FR-8)
- ตรงทั้งคำ / เบอร์เต็ม — รายการปิดนามสกุลและเบอร์ไว้ ถ้าค้นบางส่วนได้จะไล่เดาค่าเต็มทีละตัวโดยไม่ผ่าน audit · กติกาเดียวกับค้นญาติ (CR-166) และติดตามใบด้วยเบอร์ (CR-173)
- view แทนฟิลด์ใหม่ — `donor.name` เป็นสตริงเดียวและ `items[]` เป็น array ซึ่ง Mango index ค้นรายคำ / รายช่องไม่ได้ · view emit รายคำได้โดยไม่เปลี่ยน doc และไม่ bump `schema_v`
- rate limit ต่อ IP — CR-188 เอา limiter ออกจากแอปแล้ว limit ต่อผู้ใช้ไม่มีกลไกรองรับ
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
- 2026-10-29 — วิธีค้น: ครั้งละหนึ่งประเภท · ชื่อหรือนามสกุลตรงเต็มคำ, เบอร์เต็ม, เลขใบ / ล็อตตรงทั้งค่า, สินค้าเลือกด้วยรหัส · ผลค้นยืนยันข้อมูลที่พิมพ์ได้แต่ไม่เปิดค่าเต็ม (FR-8 – FR-8b, AC-4, AC-6a)
- 2026-10-29 — ทำจริง: ชื่อ / สินค้าใช้ CouchDB view (`_design/app` v7) ไม่เพิ่มฟิลด์ · ค้นผ่าน `POST` · rate limit ต่อ IP ที่ nginx ตาม CR-188 · log การค้นอยู่ใน log ของแอปไม่เก็บคำค้น (FR-8c – FR-8g, AC-6 – AC-6c)
- 2026-10-29 — ระบุรายละเอียดที่ยังขาด ไม่เปลี่ยนมติ: retention ตาม data-model §7 + สถานะการลบจริง + พฤติกรรมหลังลบ (FR-10c, AC-6f) · แบ่งหน้าค้นล็อต (ตัดซ้ำ, เรียง, tuple cursor — FR-8d, AC-6d) · แบ่งหน้า view แบบ lookahead และ emit ไม่ซ้ำ (FR-8h, AC-6e) · `cursor` ผูกกับ `by` + `q` (FR-8a)
