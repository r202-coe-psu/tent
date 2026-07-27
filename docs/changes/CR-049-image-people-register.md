---
id: CR-049
title: Evacuee photo — เพิ่ม `photo` ใน evacuee + doc type `image` (CouchDB attachment) เพื่อบันทึกรูปถ่ายจริง; schema_v evacuee → 4, schema_v image 1 (ใหม่)
status: approved
date: 2026-07-25
requested_by: development team (branch feat/people-register-image)
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §1.1 (evacuee)
  - docs/data/schema.md §1 (new §1.6 `image`)
  - schema_v evacuee → 4
  - schema_v image 1 (new)
  - frontend/src/lib/features/people/domain/people.ts
  - frontend/src/lib/features/images/ (rebuilt as remote-first feature)
  - frontend/src/lib/db/couch-db.ts (attachment helpers)
  - frontend/src/lib/features/people/ui/evacuee-registration.svelte
---

# CR-049 — Evacuee photo

> **สรุป (TL;DR):** หน้าลงทะเบียน (Stage 3) มีช่องถ่ายภาพใบหน้าอยู่แล้วแต่ทำแค่ preview ชั่วคราว
> ด้วย `URL.createObjectURL` — รูปไม่เคยถูกบันทึก และ `Evacuee` ไม่มี field อ้างอิงรูปเลย. CR นี้เพิ่ม
> field `photo` ใน `evacuee` + doc type ใหม่ `image` (เก็บรูปเป็น **CouchDB attachment** จริง ผ่าน
> HTTP PUT ตรง) และเดินสายหน้าลงทะเบียนให้ compress + upload จริงตอนเลือกไฟล์ พร้อม reconcile schema_v
> ของ `evacuee` ที่ code เขียนผิดเป็น `2` ทั้งที่ `schema.md` บันทึกไว้แล้วว่าเป็น `3` (CR-035, done)
> ให้ตรงกันเป็น `4`

## Why

`evacuee-registration.svelte` มี UI ช่อง "ภาพถ่ายใบหน้า (Face Recognition)" อยู่แล้ว แต่ตัว `onchange`
handler เรียกแค่ `URL.createObjectURL(file)` เพื่อ preview ในเบราว์เซอร์ของผู้ใช้เท่านั้น — ไฟล์ไม่เคย
ถูกส่งขึ้น CouchDB และไม่มีที่เก็บถาวร ผลคือ `evacuee-profile-header-card.svelte` ต้อง hardcode
"No Photo" เสมอเพราะ `Evacuee` ไม่มี field ใดๆ อ้างอิงรูปถ่ายเลย

โค้ดเดิมมี placeholder feature (`frontend/src/lib/features/images/`, untracked ระหว่างทำ) ที่ตั้งใจ
สาธิตแนวคิด compress-then-store-as-attachment แต่ import path พังอยู่ (โฟลเดอร์สะกดผิด, `index.ts`
อ้างอิงไฟล์ที่ไม่มีอยู่จริง) — ต้องเขียนใหม่ทั้งชุดบน `couch-db.ts` (HTTP PUT/GET attachment ตรง ผ่าน
`/couch` proxy คุกกี้ `_session`) ไม่ใช่แค่แก้ import path

## Change

### 1. Database Schema (`docs/data/schema.md` §1.1 `evacuee`)

**Before (schema_v เขียนไว้ใน code = 2; `schema.md` บันทึกไว้ว่า current = 3 จาก CR-035 แต่ code ไม่เคย
bump ตาม — ช่องว่างนี้มีอยู่ก่อน CR นี้):**
- ไม่มี field อ้างอิงรูปถ่าย

**After (schema_v: 4):**

| Field | ชนิด | req | สถานะ | คำอธิบาย / หมายเหตุ |
| --- | --- | --- | --- | --- |
| `photo` | str\|null | opt | **[NEW]** | → `image:{ulid}` (§1.6) รูปถ่ายใบหน้าที่บันทึกตอนลงทะเบียน; `null`/ไม่มี field = ไม่มีรูป — ไม่ต้อง migrate เอกสารเก่า |

### 2. Database Schema (`docs/data/schema.md` §1 — new §1.6 `image`)

Doc type ใหม่ทั่วไป (ไม่ผูกเฉพาะ evacuee) สำหรับเก็บรูปเป็น **CouchDB attachment**:

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `filename` | str | req | ชื่อไฟล์ต้นฉบับ |
| `content_type` | str | req | mime type ของไฟล์ที่ compress แล้ว (`image/webp`) |
| `width` / `height` | int | req | ขนาดหลัง resize (max 1024px ด้านยาว) |
| `original_size` / `compressed_size` / `thumbnail_size` | int | req | bytes — ก่อน/หลัง compress และ thumbnail |
| `caption` | str | opt | default `''` |

**Attachments:** `full` (WEBP compressed ≤1024px, quality 0.82), `thumb` (WEBP square-crop 200px) —
เขียนผ่าน `PUT /{db}/{docid}/{attname}?rev=...` หลังสร้างเอกสารเมตาดาต้าก่อน (2-step: put doc → put
attachment `full` → put attachment `thumb`, rev ไหลต่อกันตาม CouchDB MVCC)

### 3. Domain Layer (`frontend/src/lib/features/people/domain/people.ts`)

- เพิ่ม `photo?: string | null` ใน `Evacuee` interface และ `evacueeInputSchema`
  (`z.string().nullable().optional().default(null)`)
- `createEvacuee` factory: ส่งผ่าน `photo`, bump `schema_v` จาก `2` (ค่าเดิมใน code) เป็น `4`

### 4. New feature `frontend/src/lib/features/images/`

Layered ตามมาตรฐานโปรเจกต์ (`domain/data/application/ui` + barrel):

- `domain/image.ts` — `ImageDoc extends BaseDoc`, `ImageSummary`, `isImageDoc`
- `data/image.repository.ts` — interface `ImageRepository`
- `data/image.remote.ts` — `ImageRemoteRepository` ผ่าน `couch-db.ts` + factory `imageRepository()`
  scoped ต่อ shelter db เหมือน `peopleRepository()`
- `application/queries.ts` — `useSaveImage()` (TanStack mutation)
- `index.ts` — barrel

`frontend/src/lib/db/couch-db.ts` เพิ่ม `putAttachment` / `getAttachment` (fetch ตรง, ไม่ผ่าน
`couchDbFetchRaw` เพราะ body/response เป็น binary ไม่ใช่ JSON)

### 5. UI Wiring (`evacuee-registration.svelte`)

เมื่อเลือกไฟล์: compress ผ่าน `compressImage` (มีอยู่แล้ว) → `useSaveImage().mutateAsync` → เก็บ
`image._id` ลง `$formData.photo` → preview ยังคงใช้ `URL.createObjectURL(file)` เดิม (ไฟล์ต้นฉบับ
ไม่ใช่ blob หลัง compress) พร้อม spinner ระหว่างอัปโหลดและ toast เมื่อ error (การอัปโหลดรูปล้มเหลว
ไม่บล็อกการลงทะเบียน — เป็น opt field)

## Requirements

- **R-49-1** — `evacueeInputSchema`/`Evacuee` ต้องมี `photo` (opt, nullable, default `null`)
- **R-49-2** — `createEvacuee` ต้องตั้ง `schema_v: 4` และส่งผ่าน `photo` เมื่อมีค่า
- **R-49-3** — `images` feature ต้อง compress ก่อนอัปโหลดเสมอ (max 1024px / quality 0.82 / thumbnail
  200px, ค่าเดิมจาก `image-compress.ts`) และเก็บเป็น CouchDB attachment ของ doc `image:{ulid}` ใน
  shelter db ปัจจุบัน (`getShelterDb()`)
- **R-49-4** — หน้าลงทะเบียนต้องอัปโหลดรูปจริงตอนเลือกไฟล์ (ไม่ใช่แค่ preview) และไม่บล็อกการกรอกฟอร์ม
  ต่อถ้าอัปโหลดล้มเหลว (toast error แล้วปล่อยให้ลงทะเบียนต่อได้โดยไม่มีรูป)
- **R-49-5** — เอกสาร `evacuee` เก่า (ไม่มี `photo`) ต้องอ่านได้ปกติ — ไม่ต้องมี migration function
  เพราะเป็น field เสริมล้วนๆ

## Impact

**Docs:**
- `docs/data/schema.md` §1.1 (evacuee, +`photo`, schema_v → 4), new §1.6 (`image`)

**Code & Tests:**
- `frontend/src/lib/features/images/` (rebuilt: `domain/image.ts`, `data/image.repository.ts`,
  `data/image.remote.ts`, `application/queries.ts`, `index.ts`)
- `frontend/src/lib/db/couch-db.ts` (+`putAttachment`, `+getAttachment`)
- `frontend/src/lib/features/people/ui/evacuee-registration.svelte`
## Migration

Purely additive optional field — no lazy-migration function needed. Old `evacuee` docs simply lack
`photo` (`undefined`), which the UI treats identically to `null` ("No Photo").