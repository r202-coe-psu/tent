---
id: CR-127
title: Volunteer — permanent per-volunteer tracking token (`tracking_token_hash`)
status: approved
date: 2026-09-16
updated: 2026-10-19
requested_by: Dev Team B
decided_by: Project Owner (Jakee / net-lynx) — approved permanent volunteer tracking_token_hash design 2026-09-18
layer: volatile
affects:
  - docs/data/schema.md §2.8 volunteer (new field `tracking_token_hash`, schema_v 3 → 4)
  - frontend/src/lib/features/volunteers/server/public-application.ts (mint-on-first-apply)
  - frontend/src/lib/features/volunteers/domain/volunteer.schema.ts
  - packages/tent-model/src/tent_model/public_volunteer.py (Mongo `PublicVolunteer` — new field)
  - worker/src/worker/projectors/volunteer.py (sync `tracking_token_hash` → Mongo)
  - backend/apiapp/modules/volunteers/use_case.py (credential resolution, ticket lookup)
  - frontend/src/lib/features/volunteers/ui/volunteer-check-in.svelte + data/domain layer
  - frontend/src/lib/features/volunteer-portal/ui/volunteer-access-portal.svelte + domain/volunteer.ts (note 2026-10-18, #625 — remembered device)
  - frontend/src/routes/api/public/v1/volunteer/{access/resolve,profile,schedule,schedule/action,ticket/find} (note 2026-10-18, #625 — token rate budget)
  - frontend/svelte.config.js `kit.csp` + frontend/src/app.html (note 2026-10-19 — Content-Security-Policy)
why: >
  `job_application.tracking_token` (schema.md §2.18, CR-104) is minted fresh per
  application, so a volunteer with more than one application has more than one token and
  no single stable identity to sign into the portal or scan at check-in with. Project
  owner asked for one permanent token per volunteer instead, stored hash-only (unlike
  `job_application.tracking_token`, which is stored plaintext).
migration: >
  schema_v 3 → 4 on `volunteer` (docs/data/schema.md §2.8), additive
  (`tracking_token_hash: str | null`, default absent). No backfill — lazy mint on first
  apply; dual-resolve with `job_application.tracking_token`. Schema.md bump is follow-up #275.
---

# Volunteer — permanent per-volunteer tracking token

## Checked first — no existing CR covers this

`volunteer` schema_v 3 (docs/data/schema.md §2.8) is owned by **CR-104** (which folded in
CR-092/096/101/102/103). Other volunteer CRs since then — **CR-107** (shift/identity
reconciliation; explicitly out of scope: "Changing the approved role taxonomy or check-in
UX"), **CR-116** (`shift_assignment` check-out actor/reason), **CR-117** (volunteer skills
master data) — none of them touch a volunteer-level token or `tracking_token_hash`. This is
a new field, not an amendment to any of those, so it gets its own CR.

## Why this change exists

`job_application.tracking_token` (§2.18) is a plaintext CSPRNG token minted once per
application (CR-104). A volunteer who applies to more than one job ends up
with as many tokens as applications — none of them a stable identity for the volunteer
themself, which the portal sign-in and on-site check-in both need one of.

## Decision

1. `volunteer` gains `tracking_token_hash: str | null` (schema_v 3 → 4, additive):
   SHA-256 of a `TKT-VOL-{32 hex}` token, generated the same way `job_application.tracking_token`
   is, but stored as a hash rather than plaintext. Minted **once**, the first time a volunteer ever
   applies (`frontend/src/lib/features/volunteers/server/public-application.ts`, the
   direct-CouchDB apply writer) — plaintext is returned to the caller exactly once, in that
   apply response, and never persisted. Every later application by the same volunteer
   reuses the existing hash; it is never re-minted or rotated.
2. This token is what portal sign-in and on-site check-in resolve against, alongside the
   existing per-application lookup on `job_application.tracking_token` (unmigrated
   tokens from before this change keep working — see Migration).
3. Synced Mongo-side onto `PublicVolunteer.tracking_token_hash`
   (`packages/tent-model/src/tent_model/public_volunteer.py`) by the CouchDB→Mongo projector
   (`worker/src/worker/projectors/volunteer.py`), so FastAPI-side portal resolution
   (`backend/apiapp/modules/volunteers/use_case.py`) can use it too.

## Migration

- `schema_v` on `volunteer` (docs/data/schema.md §2.8): **3 → 4**, purely additive.
  Schema.md edit is **not** in this ratification; it ships with follow-up #275.
- **Lazy mint:** no backfill. `tracking_token_hash` is absent until the volunteer first
  applies after this change; mint-on-first-apply in `public-application.ts`.
- **Dual-resolve:** portal sign-in and on-site QR check-in resolve
  `volunteer.tracking_token_hash` **and** existing `job_application.tracking_token`
  (plaintext, per application). Unmigrated pre-change tokens keep working.
- **Index later with schema:** Couch/Mongo lookup index on `tracking_token_hash` ships
  with the schema_v bump (#275), not this CR file.
- After schema bump: update `docs/data/couchdb-mongodb-sync.md` to add
  `tracking_token_hash` to the synced field list for `PublicVolunteer`.

## Note 2026-10-18 — portal "จดจำเครื่องนี้" + token rate budget (#625)

> **สรุป:** portal อาสาจดจำการเข้าสู่ระบบด้วย token ได้แบบ opt-in 7 วันใน `localStorage` และ lookup
> ที่ใช้ token `TKT-VOL-` ที่ mint แล้วย้ายไปใช้โควตา token (30/นาที/IP) แทนโควตาค้นหา (5/นาที/IP)
> ซึ่งทำให้อาสาคนที่ 2 ที่ศูนย์เดียวกัน (NAT IP เดียว) สแกนเข้าไม่ได้ · ไม่เปลี่ยน token ฝั่ง backend · ไม่ bump `schema_v`

### Requirements — จดจำเครื่องนี้

- **R-1** — แท็บ "สแกน QR ตั๋ว / รหัส Token" มี checkbox "จดจำเครื่องนี้ 7 วัน" ค่าเริ่มต้น**ไม่ติ๊ก**
- **R-2** — ติ๊กแล้วเข้าสู่ระบบสำเร็จ → เก็บ `{ token, portal_id, remembered_until }` ใน `localStorage`
  key `volunteer-portal-remembered`; `remembered_until` = เวลาที่ติ๊ก + 7 วัน (ไม่ต่ออายุเอง)
- **R-3** — จดจำ**เฉพาะการเข้าด้วย token**; การเข้าด้วยเบอร์โทรไม่ถูกจดจำ
- **R-4** — เปิด portal โดยไม่มี session 30 นาทีที่ใช้ได้ แต่มีการจดจำที่ยังไม่หมดอายุ → resolve token กับ server
  ใหม่แล้วเข้า dashboard; record ที่หมดอายุ / ผิดรูป / อายุเกิน 7 วันจากปัจจุบัน → ลบทิ้ง
- **R-5** — server ไม่รู้จัก token แล้ว (ยกเลิก / ออกใหม่) → ลบการจดจำ และกลับหน้า login พร้อมข้อความ;
  error ชั่วคราว (network / 429) ไม่ลบ
- **R-6** — "ออกจากระบบ / ลืมเครื่องนี้" ลบการจดจำทุกครั้ง
- **R-7** — เครื่องที่ไม่ติ๊กทำงานเหมือนเดิม (`sessionStorage`, token session 30 นาที — `PORTAL_TOKEN_SESSION_TTL_MS`)

### Requirements — token rate budget

- **R-8** — `access/resolve`, `profile`, `schedule`, `schedule/action`, `ticket/find`: credential ที่เป็น token
  รูปแบบ `TKT-VOL-` + hex 32 ตัว (128-bit, `isMintedTicketToken`) ใช้ `volunteerTicketLimiter` (60 s / 30)
  — ตัดสินจาก credential **หลัง parse** (ตัวที่ใช้ค้นจริง) ไม่ใช่ body ดิบ: body ที่มีทั้ง `phone` และ `token`
  parse เป็นเบอร์โทร จึงต้องใช้โควตาเข้ม
- **R-9** — เบอร์โทร, token สั้นหรือรูปแบบอื่น และ body ที่อ่านไม่ได้ ใช้ `volunteerTicketFindLimiter` (60 s / 5) เหมือนเดิม;
  `access/role-card` (รับเฉพาะเบอร์) ไม่เปลี่ยน; ทั้งสอง limiter ยัง**ห้ามปิด** ตาม CR-160

### Why

- token เป็น bearer credential ถาวร: เก็บใน `localStorage` บนเครื่องที่ใช้ร่วมกัน (เครื่องศูนย์ / kiosk) ทำให้คนถัดไป
  เข้าบัญชีอาสาคนก่อนได้ — จึงเป็น opt-in, มีวันหมดอายุ, ลบเมื่อออกจากระบบหรือ token ใช้ไม่ได้ (owner เลือก 7 วัน)
- การเข้าระบบด้วย token 1 ครั้งเรียก 4 endpoint ที่ใช้โควตาค้นหาก้อนเดียวกัน (5/นาที/IP) — ที่ศูนย์ซึ่งทุกคนออกเน็ต
  ผ่าน NAT IP เดียว การสแกนคนที่ 2 ภายใน 1 นาทีได้ 429 ตรงกับ feedback "สแกนแล้วต้องกดเข้าสู่ระบบเอง"
  (reproduce ด้วยกล้องปลอม: เส้นทาง auto-submit ทำงานถูกต้อง) token 128-bit เดาไม่ได้ จึงไม่ต้องใช้โควตาที่กัน enumeration
- ข้อจำกัดที่รู้: โควตา token ยังนับต่อ IP — ศูนย์เดียวเข้าระบบด้วย token ได้ ~7 ครั้ง/นาที (4 request ต่อครั้ง)

## Note 2026-10-19 — Content-Security-Policy ปกป้อง token ที่จดจำไว้

> **สรุป:** token ที่ "จดจำเครื่องนี้" (R-2) อยู่ใน `localStorage` ซึ่งสคริปต์ใดก็ตามบนหน้าอ่านได้ — ช่อง XSS
> เพียงจุดเดียวในเว็บจะขโมย token ถาวรได้ จึงเพิ่ม Content-Security-Policy ทั้งแอป · ไม่เปลี่ยน data · ไม่ bump `schema_v`

### Requirements

- **R-10** — ทุก response ของ SvelteKit ส่ง header `Content-Security-Policy` (`kit.csp`, `mode: 'auto'`):
  `script-src 'self'` + reCAPTCHA (`https://www.google.com/recaptcha/`, `https://www.gstatic.com/recaptcha/`)
  + nonce ต่อ response — **ห้าม** `unsafe-inline` / `unsafe-eval`
- **R-11** — `worker-src 'self' blob:` (worker ของ maplibre), `object-src 'none'`, `base-uri 'self'`,
  `frame-ancestors 'none'` (ห้ามเว็บอื่นฝังหน้าเราใน iframe)
- **R-12** — `connect-src` / `img-src` / `style-src` / `font-src` **ไม่จำกัด**: CouchDB edge, tile แผนที่ และรูปมาจาก
  origin ที่ต่างกันตาม deployment; เมื่อสคริปต์แปลกปลอมรันไม่ได้ (R-10) ก็ใช้ช่องทางเหล่านี้ขโมยข้อมูลไม่ได้
- **R-13** — zod v4 ตั้ง `jitless` ผ่าน `globalThis.__zod_globalConfig` ใน `app.html` (script ที่มี nonce) ก่อนโมดูลใด ๆ
  ของแอปโหลด เพื่อไม่ให้ probe `Function('')` ชน policy ทุกหน้า — ตั้งใน client hooks ไม่พอ เพราะ route matcher
  (`params/kioskScreen.ts`) สร้าง schema ก่อน hooks

### Why

- R-2 เก็บ bearer credential ถาวรใน `localStorage`; CSP ทำให้สคริปต์ที่ถูกแทรกเข้ามารันไม่ได้ตั้งแต่ต้น
- ตรวจแล้ว: `e2e/csp.test.ts` (header, สคริปต์ที่แทรกถูกบล็อก, หน้าแรก / job board / แผนที่ / สแกน QR ด้วยกล้อง
  ไม่มี violation) และรัน e2e ทั้งชุดเทียบเปิด/ปิด policy — ไม่มีเทสต์ที่พังเพราะ CSP
- ข้อจำกัดที่รู้: ถ้าเพิ่ม script / iframe จาก origin ภายนอกใหม่ ต้องเพิ่มใน `kit.csp` ด้วย

## Decision log

- 2026-09-16 — proposed as `draft-volunteer-permanent-tracking-token` (hash-only permanent
  volunteer token; mint-once on first apply).
- 2026-09-18 — Project Owner (Jakee / net-lynx) approved the permanent
  `tracking_token_hash` design. Ratified as **CR-127**. Schema.md bump remains follow-up
  with #275; this record is the design decision only.
- 2026-10-18 — Note (#625): portal "จดจำเครื่องนี้" (opt-in, token only, `localStorage`, 7 วัน) และย้าย
  lookup ด้วย minted token ไป `volunteerTicketLimiter`; owner เลือก track เป็น note ต่อท้าย CR-127, อายุ 7 วัน,
  และแยกโควตาตาม credential
- 2026-10-18 — แก้ R-8: เลือกโควตาจาก credential หลัง parse (body ที่มีทั้ง phone และ token เคยได้โควตา token
  ทั้งที่ค้นด้วยเบอร์โทร — พบตอนตรวจ security)
- 2026-10-19 — Note (CSP): เพิ่ม Content-Security-Policy ทั้งแอปเพื่อปกป้อง token ที่จดจำไว้ (R-10–R-13);
  owner เลือก track เป็น note ต่อท้าย CR-127 และให้ใส่ `frame-ancestors 'none'`
