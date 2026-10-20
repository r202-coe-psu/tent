---
id: draft
title: Public footer — โลโก้หน่วยงาน (PSU · วช · อื่น ๆ) จัดการได้จากหลังบ้าน (`config:public_portal.footer_logos` + attachment)
status: proposed
date: 2026-10-21
requested_by:  Dev Team B feedback หน้างาน — GitHub #631
decided_by:
layer: volatile
affects:
  - docs/data/schema.md §3 DB `registry` — **เพิ่ม §3.13 `config` — `config:public_portal` (singleton)** (ปัจจุบัน doc นี้ไม่มีใน schema.md เลย) + field ใหม่ `footer_logos[]` + `_attachments.footer_logo_{id}`
  - no schema_v bump (`config:public_portal` คง 1 — field ใหม่ optional, doc เดิมยัง valid)
  - no VDU change (`REGISTRY_DESIGN_VERSION` คง 7 — registry เขียนได้เฉพาะ SA/`_admin` อยู่แล้ว; ตรวจ field ที่ server)
  - no worker change / no `PROJECTION_VERSION` bump (public footer อ่านผ่าน BFF จาก CouchDB — ไม่ผ่าน Mongo/FastAPI)
  - frontend/src/lib/features/public-portal/domain/footer-logo.ts (+ test) · config.ts (`publicConfigSchema.footer_logos`)
  - frontend/src/lib/features/public-portal/ui/footer-logos-section.svelte · footer-logo-dialog.svelte · footer-logo-action.ts · index.ts
  - frontend/src/lib/server/public-portal/footer-logos.server.ts (+ test) — read/mutate doc, decode รูป, public list, image bytes
  - frontend/src/lib/server/couch-admin.ts (+ `adminAttachment`, `serviceErrorStatus`)
  - frontend/src/routes/(protected)/system-management/public-portal-config/+page.server.ts (+ page.server.test.ts) — default action → `?/save` (คง `footer_logos` + `_attachments`); actions ใหม่ `createLogo` · `updateLogo` · `toggleLogo` · `moveLogo` · `deleteLogo`
  - frontend/src/routes/api/public/v1/config/faqs/+server.ts (+ `footer_logos` ใน response)
  - frontend/src/routes/api/public/v1/config/footer-logos/[id]/image/+server.ts (ใหม่ — public image delivery)
  - frontend/src/routes/(public)/+layout.ts (`PublicLayoutConfig.footer_logos`)
  - frontend/src/lib/components/public-footer.svelte
  - reuse: frontend/src/lib/features/kiosk-banners/domain/kiosk-banner-image.ts (`decodeBannerImage`, magic bytes, ≤2 MB — CR-162)
---

# draft-public-footer-logos — โลโก้หน่วยงานใน footer ของ public portal

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** public portal แสดงแถบโลโก้หน่วยงาน (แยกเหนือ footer) (PSU, วช, หน่วยงานอื่น) ที่ SA เพิ่ม/แก้/ลบ/เรียง/ซ่อนได้จากหน้า `public-portal-config` โดยไม่ต้อง deploy
> - **เก็บที่:** metadata ใน `config:public_portal.footer_logos[]` + รูปเป็น CouchDB attachment `footer_logo_{id}` บน doc เดียวกัน
> - **build:** Zod schema + section CRUD ในหน้า admin (SA-only) · BFF ส่ง `footer_logos` ไปกับ config เดิม · route ใหม่ส่งรูปสาธารณะ · footer render
> - **กระทบ:** schema.md เพิ่มหัวข้อ `config:public_portal` (ไม่ bump `schema_v`) · ไม่แตะ worker/FastAPI/Mongo

---

## Requirements

**Domain / data (`config:public_portal`)**

- FR-1 — เพิ่ม field optional `footer_logos: FooterLogo[]` (ไม่มี field = `[]`) ใน `config:public_portal`.
- FR-2 — `FooterLogo` = `{ id, alt_th, alt_en?, link_url?, order, is_published }`:
  - `id` — ULID, server สร้าง, แก้ไม่ได้; ใช้เป็นชื่อ attachment `footer_logo_{id}`
  - `alt_th` — trim · 1–120 ตัวอักษร · req (ใช้เป็น `alt` และ `title` ของรูป)
  - `alt_en` — trim · ≤120 · opt (ว่าง = fallback `alt_th` เมื่อภาษา EN)
  - `link_url` — `https://` URL เท่านั้น · opt (ว่าง = รูปไม่เป็นลิงก์)
  - `order` — int ≥1 · server กำหนด (ต่อท้าย) · เปลี่ยนผ่าน action จัดลำดับเท่านั้น
  - `is_published` — bool · default `true`
- FR-3 — สูงสุด **12** โลโก้ต่อ doc; เพิ่มเกิน → reject `422`. `> [NEEDS DECISION: Q3 — เพดานจำนวน]`
- FR-4 — ทุก entry ใน `footer_logos` ต้องมี attachment `footer_logo_{id}` คู่กัน และ attachment `footer_logo_*` ทุกตัวต้องมี entry คู่กัน (ไม่มีรูปกำพร้า/entry ไร้รูป).
- FR-5 — รูป: `image/png` · `image/jpeg` · `image/webp` · ≤2 MB หลัง decode · `content_type` มาจาก magic bytes ที่ server ตรวจ (reuse `decodeBannerImage` ของ CR-162) · ไม่รับ SVG.

**Admin (SA-only) — `/system-management/public-portal-config`**

- FR-6 — เพิ่ม section/tab「โลโก้หน่วยงาน (Footer)」ในหน้าเดิม: รายการโลโก้พร้อม thumbnail, alt, link, สถานะ, ปุ่ม เพิ่ม · แก้ไข · ลบ · เปิด/ปิดแสดง · ↑↓ จัดลำดับ.
- FR-7 — ทุก action ของโลโก้ตรวจ `caller.isSA` ฝั่ง server; role อื่น (รวม manager ที่เปิดหน้าได้) → `403` และ UI ซ่อนปุ่มแก้ไข.
- FR-8 — แต่ละ operation (create · update · delete · toggle · reorder) เป็น **form action แยก** (multipart) — default action เดิมของหน้าเปลี่ยนชื่อเป็น `?/save` (SvelteKit ห้ามมี default action คู่กับ named action — `> [NEEDS DECISION: Q5]`) และเขียน doc ด้วย PUT ครั้งเดียวแบบ atomic (metadata + attachment ใน request เดียว); `_rev` ไม่ตรง → `409` → toast「มีผู้อื่นแก้ไขการตั้งค่านี้ โปรดโหลดใหม่」.
- FR-9 — create ต้องมีรูป; update โดยไม่เลือกรูปใหม่ = คงรูปเดิม (ส่ง stub กลับ); delete = ลบ entry + attachment ใน PUT เดียวกัน.
- FR-10 — **default action (บันทึก FAQ/social เดิม) ต้องคง `footer_logos` และ `_attachments` จาก doc ปัจจุบันเสมอ** — ไม่อ่านค่าเหล่านี้จาก form. ทุก action ของโลโก้ต้องคง field อื่นของ doc (`faqs`, `phone_number`, `line_oa_url`, `facebook_url`) เช่นกัน.
- FR-11 — ฟอร์ม: preview รูปทันทีที่เลือกไฟล์ · ข้อความ「รองรับ png / jpeg / webp ขนาดไม่เกิน 2 MB」· ตรวจชนิด/ขนาดฝั่ง client ก่อนส่ง (UX เท่านั้น — server ตรวจซ้ำตาม FR-5).

**Public delivery (BFF — CR-063)**

- FR-12 — `GET /api/public/v1/config/faqs` เพิ่ม `footer_logos` ใน response: เฉพาะ `is_published = true`, เรียง `order` → `id`, แต่ละรายการ = `{ id, alt_th, alt_en, link_url, image_url }`.
- FR-13 — `image_url` = `/api/public/v1/config/footer-logos/{id}/image?v={attachment digest}` (digest เปลี่ยนเมื่อเปลี่ยนรูป → cache bust).
- FR-14 — route ใหม่ `GET /api/public/v1/config/footer-logos/{id}/image`: อ่าน attachment ด้วย admin credential ฝั่ง server, ตอบ bytes + `content-type` จาก attachment + `cache-control: public, max-age=86400`; โลโก้ไม่มี / ไม่ published → `404`; CouchDB ใช้ไม่ได้ → `503`. ไม่ต้อง signed URL (โลโก้เป็นข้อมูลสาธารณะ).
- FR-14a — ข้อยกเว้นเพื่อ preview ในหน้า admin: ผู้ที่เปิดหน้า config ได้ (SA / shelter_manager — ตรวจจาก session cookie) ได้รูปของโลโก้ที่ซ่อนอยู่ด้วย `cache-control: no-store`; ผู้อื่นได้ `404` เหมือนเดิม. `> [NEEDS DECISION: Q6]`
- FR-15 — fallback เดิมไป FastAPI (CouchDB ใช้ไม่ได้) ไม่ต้องมี `footer_logos` → footer ไม่แสดงแถวโลโก้ (degrade เงียบ, ไม่ error).

**Footer UI**

- FR-16 — `(public)/+layout.ts` ส่ง `footer_logos` ใน `configData`; `public-footer.svelte` render **แถบแยก (`<section>`) วางเหนือ `<footer>`** — ไม่อยู่บนพื้นสีเข้มของ footer — เมื่อมี ≥1 รายการ; ไม่มี = ไม่ render แถบ. `> [NEEDS DECISION: Q7]`
- FR-17 — แถบ: พื้น canvas `#F8FAFC` + เส้นขอบบน `border-slate-200/80` · หัวข้อ「หน่วยงานร่วมดำเนินงาน」/「Partner organizations」(`h2` ผูก `aria-labelledby`) · โลโก้เรียงกลาง ตัดบรรทัดได้.
- FR-17a — โลโก้แต่ละอันอยู่ใน **การ์ดกรอบ**: พื้นขาว · `border border-slate-200/80` · `rounded-xl` · `shadow-2xs` · สูงคงที่ 80 px · กว้าง ≥128 px · รูปสูง 48 px (กว้างตามสัดส่วน ≤176 px, `object-contain`) · ไม่ใส่ filter/เปลี่ยนสี. `> [NEEDS DECISION: Q8]`
- FR-17b — มี `link_url` → การ์ดเป็น `<a target="_blank" rel="noopener noreferrer">` (hover: ขอบ `slate-300` + `shadow-xs` · focus ring `slate-900`); `alt` ตามภาษาปัจจุบัน; `loading="lazy"`.
- FR-18 — โลโก้ Smart Shelter (`/logo.png`), email, เบอร์ฉุกเฉิน, policy links คงเป็น hardcode (out of scope).

## Acceptance

- [ ] SA เพิ่ม/แก้/ลบ/เรียง/ซ่อนโลโก้ได้ และ footer สะท้อนผลหลัง reload โดยไม่ deploy.
- [ ] user ที่ไม่ใช่ SA เรียก action ของโลโก้ตรง ๆ → `403`.
- [ ] ไฟล์ `.png` ที่เนื้อในไม่ใช่ PNG, SVG, หรือ >2 MB → reject ทั้ง client และ server.
- [ ] footer แสดงเฉพาะ published ตาม `order` พร้อม alt (th/en) และลิงก์ (ถ้ามี).
- [ ] บันทึก FAQ/social หลังมีโลโก้แล้ว → `footer_logos` และรูปยังอยู่ครบ; จัดการโลโก้ → FAQ/social ยังอยู่ครบ.
- [ ] รูปโหลดผ่าน `/api/public/v1/config/footer-logos/{id}/image` เท่านั้น — ไม่มี URL CouchDB/credential ใน browser; โลโก้ที่ซ่อน → `404`.
- [ ] Tests: domain (`footerLogoSchema`, เรียง/กรอง published, เพดานจำนวน) · server (action preserve fields/attachments, SA guard, 409, image route 404/200/content-type) · `.svelte` ที่แตะผ่าน `svelte-autofixer`.

## Change (before → after)

| จุด | Before | After |
| --- | --- | --- |
| `docs/data/schema.md` | ไม่มีหัวข้อ `config:public_portal` | §3.13 `config:public_portal` (fields เดิม: `faqs`, `phone_number`, `line_oa_url`, `facebook_url` + `footer_logos[]`, `_attachments.footer_logo_{id}`) · schema_v 1 |
| `publicConfigSchema` | ไม่มี `footer_logos` | + `footer_logos` optional (FR-1/2) |
| admin default action | สร้าง doc ใหม่จาก `form.data` (attachment ใด ๆ จะหายเมื่อ PUT) | คง `footer_logos` + `_attachments` จาก doc เดิม (FR-10) |
| `GET /api/public/v1/config/faqs` | `faqs`, `line_oa_url`, `facebook_url`, `phone_number` | + `footer_logos` (FR-12) |
| public image route | ไม่มี | `GET /api/public/v1/config/footer-logos/{id}/image` (FR-14) |
| footer | โลโก้ Smart Shelter อันเดียว | + แถบโลโก้หน่วยงานจาก config แยกเหนือ footer (การ์ดกรอบรายโลโก้ — FR-16/17) |

## Impact

- **Worker:** ไม่แก้ — `project_config` upsert `config:public_portal` ทั้งก้อนอยู่แล้ว จึงจะมี `footer_logos` และ `_attachments` (stub metadata ไม่มี bytes) ติดไปใน Mongo `public_config` โดยไม่มีผู้อ่าน. `> [NEEDS DECISION: Q2]`
- **FastAPI / OpenAPI:** ไม่แก้ — `ConfigUseCase` map เฉพาะ field ที่ระบุ; ไม่ต้องรัน `pnpm openapi:update`.
- **External API (`/external/v1/*`):** ไม่กระทบ.
- **Seed:** ไม่ seed โลโก้ — SA อัปโหลดไฟล์ทางการหลัง deploy. `> [NEEDS DECISION: Q4]`

## Migration

N/A — field ใหม่ optional; `config:public_portal` ที่ persist แล้วยัง valid; ไม่ bump `schema_v`, ไม่ bump `PROJECTION_VERSION`.

## Open decisions

> Q1–Q8: implement ตามข้อเสนอแล้วบน `fix/footer-web` (2026-10-21) — ยังรอ owner ยืนยันก่อน approve.

- **Q1 — ที่เก็บ:** attachment บน singleton `config:public_portal` (ตาม #631) **vs** doc type ใหม่ `public_footer_logo:{ulid}` ใน `registry` (mirror `kiosk_banner`).
  **เสนอ: singleton** — ตรง scope ของ #631, ไม่ต้องเพิ่ม VDU/index; ต้นทุนคือทุก write ต้องคง `_attachments` (FR-10) และ doc โตตามจำนวนรูป (≤12 × 2 MB).
- **Q2 — Mongo:** ปล่อย `footer_logos` / `_attachments` stub ไหลไป `public_config` ตามเดิม **vs** ให้ projector ตัด `_attachments` ออก (+ bump `PROJECTION_VERSION` 5→6).
  **เสนอ: ปล่อยตามเดิม** ใน CR นี้ — ไม่มีผู้อ่าน, stub ไม่มี bytes.
- **Q3 — เพดานจำนวน:** 12 โลโก้. **เสนอ: 12** (footer แถวเดียว–สองแถวบนจอกว้าง).
- **Q4 — ไฟล์โลโก้ทางการ:** PSU/วช มี brand guideline (สีพื้น, clear space, ขนาดขั้นต่ำ) — ใครเป็นผู้จัดหาไฟล์ และต้อง seed ไว้ใน `master-seed.ts` หรือไม่.
  **เสนอ:** SA อัปโหลดไฟล์ PNG ฉบับสีมาตรฐานเอง (แถบโลโก้เป็นพื้นสว่าง + การ์ดขาว — FR-16/17a — จึงไม่ต้องใช้ฉบับ reverse สำหรับพื้นเข้ม); ไม่ seed.
- **Q5 — action ของหน้า config:** เปลี่ยน default action (บันทึก FAQ/social) เป็น named `?/save` **vs** แยกจัดการโลโก้ไปเป็น route/BFF ของตัวเอง (`/api/back-office/...` แบบ kiosk banner) แล้วคง default action เดิม.
  **เสนอ: `?/save`** — โค้ดน้อยกว่า, อยู่หน้าเดียวกัน; ต้นทุนคือ client ที่ POST ไป default action ต้องเปลี่ยน (ฟอร์มในหน้านี้ + e2e `public-portal-faq-crud`).
- **Q6 — preview โลโก้ที่ซ่อน:** route รูปให้ staff (SA / shelter_manager) ดูรูปที่ `is_published = false` ได้ **vs** ทุกคนได้ `404` (หน้า admin ไม่แสดงรูปของโลโก้ที่ซ่อน).
  **เสนอ: ให้ staff ดูได้** — SA ต้องเห็นรูปก่อนเปิดเผยแพร่; ตอบ `no-store` ไม่ปน cache สาธารณะ.
- **Q7 — ตำแหน่งแถบโลโก้:** แถบแยกวางเหนือ `<footer>` **vs** แถวภายใน footer (พื้นกรมท่า `#0A2647`) เหนือแถบ copyright.
  **เสนอ: แถบแยกเหนือ footer** — โลโก้หน่วยงานส่วนใหญ่ออกแบบสำหรับพื้นสว่าง; บนพื้นกรมท่าจะกลืน/ผิด brand guideline.
- **Q8 — กรอบโลโก้:** การ์ดกรอบรายโลโก้ (พื้นขาว · ขอบ `slate-200/80` · `rounded-xl` · `shadow-2xs`) บนพื้นแถบ `#F8FAFC` **vs** วางรูปเปล่าบนพื้นขาว.
  **เสนอ: การ์ดกรอบ** — โลโก้ที่มีพื้นขาวในตัวกลืนกับพื้นแถบเมื่อไม่มีกรอบ; การ์ดสูงเท่ากันทำให้โลโก้ต่างสัดส่วนเรียงตรงกัน.

## Why

feedback หน้างาน (#631): footer ยังไม่มีโลโก้หน่วยงานผู้สนับสนุน/เจ้าของโครงการ (PSU, วช) และรายชื่อหน่วยงานจะเปลี่ยนตามผู้ร่วมโครงการ จึงต้องแก้ได้จากหลังบ้านโดยไม่ deploy.

- ใช้ BFF อ่าน CouchDB ตรง (แบบ `/api/public/v1/config/faqs` เดิม) แทนทาง Mongo/FastAPI — footer ใช้เฉพาะ public SPA, ไม่ต้องขยาย `ConfigUseCase`/OpenAPI/projector และไม่ต้องรอ worker.
- ไม่รับ SVG — SVG ฝัง script ได้ และ route ส่งรูปเป็น same-origin.
- ไม่ใช้ signed URL แบบ kiosk banner — โลโก้เป็นข้อมูลสาธารณะ, ต้องการ cache ข้ามผู้ใช้.

อ้างอิง: [CR-162](14-kiosk/CR-162-kiosk-banner.md) (กติการูป/attachment) · [CR-063](12-public/CR-063-public-bff-only.md) (public ผ่าน BFF เท่านั้น) · PSU brand <https://www.psu.ac.th/?page=psubrand> · วช brand <https://www.nrct.go.th/about/detail/227>

## Decision log

- 2026-10-21 — proposed (draft จาก #631)
