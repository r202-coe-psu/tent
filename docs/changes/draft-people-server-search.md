---
id: draft
title: ค้นหา evacuee ฝั่ง server — ขึ้นต้นด้วย (ชื่อ/สกุล/ชื่อเล่น/เบอร์) + เลขบัตรตรงทั้งเลข + สแกน QR
status: proposed
date: 2026-11-01
requested_by: referrals UX audit 2026-10-14 (F-04, F-05) / issue #554
decided_by: เจ้าของโครงการ (ข้อสรุปใน #554 วันที่ 2026-10-28)
layer: volatile
affects:
  - docs/data/schema.md (evacuee — Kiosk Lookup Indexes)
  - frontend/src/lib/server/shelter-access-design.ts (KIOSK_LOOKUP_MANGO_INDEXES + warm-up)
  - frontend/src/lib/features/people/{domain,data,application,index.ts}
  - frontend/src/lib/db/repository.ts (findPage)
  - ไม่ bump schema_v (ไม่มี field ใหม่บน doc)
---

# draft-people-server-search — ค้นหา evacuee ฝั่ง server

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่มการค้น evacuee ด้วย Mango index ใน DB ของศูนย์ แทนการโหลดทั้งศูนย์มากรองใน
>   browser ผลแบ่งหน้าด้วย `bookmark`
> - **พฤติกรรมเปลี่ยน:** จาก "มีคำนี้ตรงไหนก็ได้" (`includes`) เป็น **"ขึ้นต้นด้วย"** และเลขบัตร/passport
>   ต้อง **ตรงทั้งเลข**
> - **ขอบเขต:** มีผลเฉพาะ hook ใหม่ `useEvacueeServerSearch` หน้าที่ใช้ search เดิม
>   (`useSearchEvacuees`, `matchesEvacueeSearch`) ยังทำงานแบบเดิมจนกว่าจะย้ายตาม
> - **ไม่ bump `schema_v`**

---

## Why

`searchEvacuees` และ `listEvacueesPaginated` (เมื่อมีคำค้น) เรียก `allByType('evacuee')` แล้วกรองใน
browser ศูนย์ที่มีหลายพันคนจึงโหลดทั้งศูนย์ทุกครั้งที่ค้น (audit F-04) การค้นแบบ `includes` ทำด้วย
index ไม่ได้ จึงต้องเปลี่ยนกติกาเป็น "ขึ้นต้นด้วย" ซึ่ง Mango range บน index ทำได้

## Change

| # | คำค้น | ก่อน | หลัง |
| --- | --- | --- | --- |
| 1 | คำเดียว (ตัวอักษร) | มีคำนี้ใน ชื่อ/สกุล/ชื่อเต็ม/ชื่อเล่น | `first_name` หรือ `last_name` หรือ `nickname` **ขึ้นต้นด้วย** คำนั้น |
| 2 | หลายคำ เช่น `สมชาย ใจ` | ชื่อเต็มมีข้อความนี้ | คำแรก prefix ของ `first_name` **และ** คำที่เหลือ prefix ของ `last_name` |
| 3 | ตัวเลขขึ้นต้น `0` ไม่เกิน 10 หลัก (รับ `+66`/`66`, ขีด, ช่องว่าง) | เบอร์มีเลขนี้ตรงไหนก็ได้ | `phone` หรือ `emergency_contact.phone` **ขึ้นต้นด้วย** เลขนั้น |
| 4 | เลขบัตร 13 หลัก, passport, `ANON-…`, ตัวเลขอื่น | เลขบัตรมีเลขนี้ตรงไหนก็ได้ (รวมแบบ mask) | `person_id.number` **ตรงทั้งเลข** เท่านั้น |
| 5 | สแกน QR (`/onsite/zoning/…`, `evacuee:…`, ULID) | GET ตาม id แล้ว fallback ค้นทั้งศูนย์ | GET ตาม id ครั้งเดียว ไม่ fallback |

กติกาเสริม

- ตัวพิมพ์เล็ก/ใหญ่ไม่มีผล ช่องว่างหัวท้ายและช่องว่างซ้อนถูกตัด
- ไม่รองรับค้นกลางชื่อ ชื่อกลาง และเลขท้ายเบอร์ (out of scope ตาม issue)
- เลขบัตรไม่ครบต้องไม่เจอ เพื่อกันการไล่เดาเลขบัตร
- ขอบล่างของช่วงค้นใช้คำค้นตัวพิมพ์เล็ก เพราะ ICU เรียง `Kittipong` ก่อน `KITTIPONG` ถ้าใช้ตามที่พิมพ์ การพิมพ์ชื่อเต็มเป็นตัวใหญ่จะไม่เจอ (พบตอนทดสอบกับ CouchDB 3.5 จริง)
- เบอร์ที่เก็บเป็น `+66…` (ข้อมูลเก่าก่อน `phoneSchema` บังคับ `0XXXXXXXXX`) index จะไม่คืนให้ ค้นไม่เจอ
- ค้นหลายคำ CouchDB เลือก index นามสกุล ถ้านามสกุลซ้ำเยอะ server จะอ่าน doc หลายตัวแล้วตัดทิ้ง (มี warning) แต่ไม่ส่งข้อมูลทั้งศูนย์มาที่ browser
- พิมพ์สระหน้า (`เ แ โ ใ ไ`) ตัวเดียวยังไม่ได้ผล ต้องพิมพ์พยัญชนะตามอีกตัว (ข้อจำกัดของ ICU collation
  ที่ CouchDB ใช้กับ index)

### Index ที่เพิ่ม (นิยามใน `KIOSK_LOOKUP_MANGO_INDEXES`)

| ชื่อ | fields |
| --- | --- |
| `evacuee-type-first-name-idx` | `['type', 'first_name']` |
| `evacuee-type-last-name-idx` | `['type', 'last_name']` |
| `evacuee-type-nickname-idx` | `['type', 'nickname']` |
| `evacuee-type-emergency-phone-idx` | `['type', 'emergency_contact.phone']` |

ใช้ index เดิมซ้ำ: `evacuee-type-phone-idx` (`phone`) และ `evacuee-type-person-id-idx`
(`person_id.number`) ทั้งหมดอยู่ใน DB ของศูนย์เท่านั้น ไม่ส่งไป public plane

### การแบ่งหน้า (ตอบหมายเหตุ owner ข้อ "ค้นหลาย field")

เลือกแบบ **cursor รวม**: กรณี 1 และ 3 ยิง query แยกทีละ index พร้อมกัน แต่ละ query จำกัด `pageSize`
(ค่าเริ่ม 20 สูงสุด 50) cursor ของหน้าถัดไปเก็บ `bookmark` ของ query ที่ยังมีผลเหลือ ตัดตัวซ้ำในหน้าเดียวกัน
คนที่ตรงหลาย field อาจโผล่ซ้ำข้ามหน้า hook ฝั่ง UI ต้องตัดซ้ำด้วย `_id` ตอนรวมหน้า

## Impact

- Code: ดู `affects` ใน frontmatter
- Infra: index ใหม่ deploy ผ่านทุกทางที่ deploy `KIOSK_LOOKUP_MANGO_INDEXES` อยู่แล้ว (สร้างศูนย์ใหม่,
  seed, `scripts/redeploy-access.ts`) ศูนย์ที่มีอยู่ต้องรัน redeploy หนึ่งครั้ง
- Test: domain classifier, repository ครบ 5 กรณี, รายการ index

## Migration

N/A (ไม่มี field ใหม่บน doc ไม่ bump `schema_v`) ศูนย์เดิมรัน redeploy index อย่างเดียว

## Decision log

- 2026-10-28 — owner สรุปขอบเขต 5 กรณีใน #554 และให้ผู้ implement ร่าง CR
- 2026-11-01 — proposed (draft) พร้อม implementation บน branch `feat/554-people-server-search`
