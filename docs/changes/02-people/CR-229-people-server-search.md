---
id: CR-229
title: ค้นหา evacuee ฝั่ง server — ขึ้นต้นด้วย (ชื่อ/สกุล/ชื่อเล่น/เบอร์) + เลขบัตรตรงทั้งเลข + สแกน QR
status: approved
date: 2026-11-01
updated: 2026-11-06
requested_by: referrals UX audit 2026-10-14 (F-04, F-05) / issue #554
decided_by: เจ้าของโครงการ (ข้อสรุปใน #554 วันที่ 2026-10-28) · approved โดย net-lynx (2026-11-06)
layer: volatile
affects:
  - docs/data/schema.md §1.1 (index ของ evacuee — แก้ใน PR โค้ด `feat/554-people-server-search`)
  - frontend/src/lib/server/shelter-access-design.ts (KIOSK_LOOKUP_MANGO_INDEXES + KIOSK_LOOKUP_WARMUP_SELECTORS)
  - frontend/src/lib/features/people/{domain,data,application,index.ts}
  - frontend/src/lib/features/people/application/queries.ts (lookupEvacueeByScanCode — fallback)
  - frontend/src/lib/features/people/application/federated-scan-lookup.ts (lookupFederatedByScanCode — fallback)
  - frontend/src/lib/db/repository.ts (findPage)
  - frontend/scripts/normalize-evacuee-search-fields.ts (ใหม่ — normalize ข้อมูลเก่า)
  - ไม่ bump schema_v (ไม่มี field ใหม่ รูป doc เดิม)
---

# CR-229 — ค้นหา evacuee ฝั่ง server

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ค้น evacuee ด้วย Mango index ใน DB ของศูนย์ แทนการโหลดทั้งศูนย์มากรองใน browser
>   ผลเป็นแบบ "โหลดเพิ่ม" ด้วย `bookmark`
> - **พฤติกรรมเปลี่ยน:** จาก "มีคำนี้ตรงไหนก็ได้" (`includes`) เป็น **"ขึ้นต้นด้วย"** และเลขบัตร/passport
>   ต้อง **ตรงทั้งเลข**
> - **ขอบเขต:** hook ใหม่ `useEvacueeServerSearch` และ fallback ของตัวสแกน QR สองตัว หน้าที่ใช้ search เดิม
>   (`useSearchEvacuees`, `matchesEvacueeSearch`) ยังทำงานแบบเดิมจนกว่าจะย้ายตาม
> - **ข้อมูลเก่า:** normalize เบอร์และเลขบัตรครั้งเดียวต่อศูนย์ด้วยสคริปต์ รันคู่กับ redeploy index
> - **ไม่ bump `schema_v`**

---

## Why

`searchEvacuees` และ `listEvacueesPaginated` (เมื่อมีคำค้น) เรียก `allByType('evacuee')` แล้วกรองใน
browser ศูนย์ที่มีหลายพันคนจึงโหลดทั้งศูนย์ทุกครั้งที่ค้น (audit F-04) ตัวสแกน QR ก็เรียก
`searchEvacuees(token)` ทุกครั้งที่หา id ไม่เจอ ซึ่งเกิดกับทุกการสแกนบัตรคิว unassigned เพราะ QR ของบัตรนั้น
เป็นเลข registration ไม่ใช่ id ของ evacuee การค้นแบบ `includes` ทำด้วย index ไม่ได้ จึงต้องเปลี่ยนกติกาเป็น
"ขึ้นต้นด้วย" ซึ่ง Mango range บน index ทำได้

## Change

| #   | คำค้น                                                             | ก่อน                                       | หลัง                                                                             |
| --- | ----------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| 1   | คำเดียว (ตัวอักษร)                                                | มีคำนี้ใน ชื่อ/สกุล/ชื่อเต็ม/ชื่อเล่น      | `first_name` หรือ `last_name` หรือ `nickname` **ขึ้นต้นด้วย** คำนั้น             |
| 2   | หลายคำ เช่น `สมชาย ใจ`                                            | ชื่อเต็มมีข้อความนี้                       | คำแรก prefix ของ `first_name` **และ** คำที่เหลือ prefix ของ `last_name`          |
| 3   | ตัวเลขขึ้นต้น `0` ไม่เกิน 10 หลัก (รับ `+66`/`66`, ขีด, ช่องว่าง) | เบอร์มีเลขนี้ตรงไหนก็ได้                   | `phone` หรือ `emergency_contact.phone` **ขึ้นต้นด้วย** เลขนั้น                   |
| 4   | เลขบัตร 13 หลัก, passport, `ANON-…`, ตัวเลขอื่น                   | เลขบัตรมีเลขนี้ตรงไหนก็ได้ (รวมแบบ mask)   | `person_id.number` **ตรงทั้งเลข** เท่านั้น ดูกติกาตัวพิมพ์ด้านล่าง               |
| 5   | สแกน QR (`/onsite/zoning/…`, `evacuee:…`, ULID)                   | GET ตาม id ถ้าไม่เจอ fallback ค้นทั้งศูนย์ | GET ตาม id ถ้าไม่เจอ fallback ด้วย server search นี้ (กรณี 3/4) ไม่โหลดทั้งศูนย์ |

### กติกาเลขบัตร (กรณี 4)

`$eq` ของ CouchDB แยกตัวพิมพ์ จึง normalize ทั้งคำค้นและข้อมูลให้เป็นรูปเดียวกัน

| ประเภท                                     | รูปที่เก็บ            | คำค้นถูกแปลงเป็น                                                     |
| ------------------------------------------ | --------------------- | -------------------------------------------------------------------- |
| เลขล้วน (บัตรประชาชน 13 หลัก ฯลฯ)          | ตัวเลขล้วน ไม่มีขีด   | ตัดช่องว่างและขีดออก                                                 |
| มีตัวอักษร (passport, pink card, `ANON-…`) | ตัวใหญ่ ไม่มีช่องว่าง | ตัวใหญ่ ตัดช่องว่าง ลองทั้งแบบคงขีดและตัดขีด (`ANON-…` เก็บพร้อมขีด) |

ผลคือพิมพ์ `aa1234567` หรือ `AA1234567` ได้ผลเดียวกัน ข้อมูลเก่าที่ไม่ตรงรูปนี้ต้องผ่านสคริปต์ใน Migration

### กติกาเสริม

- ชื่อ: ตัวพิมพ์เล็ก/ใหญ่ไม่มีผล ช่องว่างหัวท้ายและช่องว่างซ้อนถูกตัด
- ไม่รองรับค้นกลางชื่อ ชื่อกลาง และเลขท้ายเบอร์ (out of scope ตาม issue)
- เลขบัตรไม่ครบต้องไม่เจอ เพื่อกันการไล่เดาเลขบัตร
- ขอบล่างของช่วงค้นชื่อใช้คำค้นตัวพิมพ์เล็ก เพราะ ICU เรียง `Kittipong` ก่อน `KITTIPONG` (พบตอนทดสอบกับ
  CouchDB 3.5 จริง)
- ค้นหลายคำ CouchDB เลือก index นามสกุล ถ้านามสกุลซ้ำเยอะ server จะอ่าน doc หลายตัวแล้วตัดทิ้ง (มี warning)
  แต่ไม่ส่งข้อมูลทั้งศูนย์มาที่ browser
- พิมพ์สระหน้า (`เ แ โ ใ ไ`) ตัวเดียวยังไม่ได้ผล ต้องพิมพ์พยัญชนะตามอีกตัว (ข้อจำกัดของ ICU collation)

### Index ที่เพิ่ม (นิยามใน `KIOSK_LOOKUP_MANGO_INDEXES`)

| ชื่อ                               | fields                                |
| ---------------------------------- | ------------------------------------- |
| `evacuee-type-first-name-idx`      | `['type', 'first_name']`              |
| `evacuee-type-last-name-idx`       | `['type', 'last_name']`               |
| `evacuee-type-nickname-idx`        | `['type', 'nickname']`                |
| `evacuee-type-emergency-phone-idx` | `['type', 'emergency_contact.phone']` |

ใช้ index เดิมซ้ำ: `evacuee-type-phone-idx` (`phone`) และ `evacuee-type-person-id-idx`
(`person_id.number`) ชุดนี้จึงมี **8 ตัว** และ `KIOSK_LOOKUP_WARMUP_SELECTORS` มี warm-up ครบ 8 ตัว
(unit test บังคับให้ตรงกัน) ทั้งหมดอยู่ใน DB ของศูนย์เท่านั้น ไม่ส่งไป public plane

### การแบ่งหน้า (ตอบหมายเหตุ owner ข้อ "ค้นหลาย field")

เลือกแบบ **cursor รวม** แบบ "โหลดเพิ่ม"

- กรณี 1 และ 3 ยิง query แยกทีละ index พร้อมกัน แต่ละ query จำกัด `pageSize` (ค่าเริ่ม 20 สูงสุด 50)
- cursor ของหน้าถัดไปเก็บ `bookmark` ของ query ที่ยังมีผลเหลือ หมดเมื่อทุก query คืนไม่เต็มหน้า
- **ไม่บอกจำนวนรวม** (`total` / `totalPages`) และใช้กับ `PaginatedResult` แบบเลขหน้าเดิมไม่ได้ UI ต้องเป็น
  ปุ่ม "โหลดเพิ่ม" หรือ infinite scroll
- **ลำดับผล** เรียงตามลำดับ query (ชื่อ → สกุล → ชื่อเล่น หรือ เบอร์ → เบอร์ฉุกเฉิน) และภายในแต่ละ query
  ตามลำดับของ index ไม่ได้เรียงข้าม index
- ตัดตัวซ้ำในหน้าเดียวกัน คนที่ตรงหลาย field อาจโผล่ซ้ำข้ามหน้า UI ต้องตัดซ้ำด้วย `_id` ตอนรวมหน้า

## Impact

- Code: ดู `affects` ใน frontmatter
- ตัวสแกน QR (`lookupFederatedByScanCode` ที่ zoning, people, medical-screening ใช้ และ
  `lookupEvacueeByScanCode`) ยังมี fallback ตามเดิม แต่ fallback ใช้ server search แทนการโหลดทั้งศูนย์
  token ที่ไม่ใช่เลขบัตรหรือเบอร์จะไม่เจอใน fallback แล้ว (เดิมเจอได้ถ้ามีในชื่อ)
- Infra: index ใหม่ deploy ผ่านทุกทางที่ deploy `KIOSK_LOOKUP_MANGO_INDEXES` อยู่แล้ว ได้แก่ สร้างศูนย์ใหม่,
  seed และ `frontend/scripts/redeploy-access.ts` (`pnpm redeploy:access --write --confirm`)
- **ลำดับการ deploy:** redeploy ที่ central ก่อน edge (#348) ได้ design doc ของ index จาก central ผ่าน
  replication และไม่มี warm-up การค้นครั้งแรกบน edge จึงช้ากว่าปกติระหว่าง CouchDB สร้าง index
- Test: domain classifier, repository ครบ 5 กรณี, fallback ของตัวสแกน, สคริปต์ normalize, รายการ index

## Migration

ไม่ bump `schema_v` เพราะรูป doc เดิม แต่ค่าเก่าบางตัวไม่อยู่ในรูปที่ index ค้นได้

| field                                              | ค่าเก่าที่ค้นไม่เจอ          | normalize เป็น                                                       |
| -------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `phone`, `emergency_contact.phone`                 | `+66…`, มีขีด/ช่องว่าง       | `0XXXXXXXXX` ด้วย `normalizeThaiPhone` เฉพาะเมื่อผลเป็นเบอร์ 10 หลัก |
| `person_id.number` (`national_id`)                 | มีขีด/ช่องว่าง (ก่อน CR-148) | ตัวเลขล้วน เฉพาะเมื่อได้ 13 หลัก                                     |
| `person_id.number` (ประเภทอื่น ยกเว้น `anonymous`) | ตัวเล็ก, มีช่องว่าง          | ตัวใหญ่ ไม่มีช่องว่าง                                                |

สคริปต์ `frontend/scripts/normalize-evacuee-search-fields.ts`

- `pnpm normalize:evacuee-search` = dry-run นับอย่างเดียว `--write --confirm` = เขียนจริง
- รันซ้ำได้ ครั้งที่สองต้องแก้ 0 doc ค่าที่ normalize ไม่ได้จะไม่ถูกแตะ และนับรายงานไว้
- ลำดับต่อศูนย์: `pnpm redeploy:access --write --confirm` แล้ว `pnpm normalize:evacuee-search --write --confirm`
  ที่ central ก่อน edge

## Decision log

- 2026-10-28 — owner สรุปขอบเขต 5 กรณีใน #554 และให้ผู้ implement ร่าง CR
- 2026-11-01 — proposed (draft) พร้อม implementation บน branch `feat/554-people-server-search`
- 2026-11-02 — แก้ตาม review: ย้าย hunk ของ `schema.md` ไป PR โค้ด, กรณี 5 คง fallback แต่ใช้ server search,
  เพิ่มสคริปต์ normalize ข้อมูลเก่า, เลขบัตรไม่แยกตัวพิมพ์, ลำดับ redeploy central ก่อน edge, ระบุว่า cursor
  เป็นแบบโหลดเพิ่มไม่มีจำนวนรวม
- 2026-11-06 — approved โดย net-lynx รันเลขเป็น CR-229 (หมวด 02-people)
