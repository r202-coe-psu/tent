---
id: draft
title: Shelter toggles `public_visible` + `accepts_referrals` — ซ่อนศูนย์จาก public plane และปิดรับการส่งต่อ
status: proposed
date: 2026-11-12
requested_by: ทีม — GitHub #1343 (priority:high, Before It Floods)
decided_by:
layer: volatile
affects:
  - docs/data/schema.md §3.1 shelter `feature_flags` (+`public_visible`, +`accepts_referrals`)
  - no schema_v bump (additive key; precedent `accepts_pre_registration`)
  - worker PROJECTION_VERSION 17 → 18 (worker/src/worker/projection_version.py)
  - worker/src/worker/projectors/shelter.py · couch/processor.py · couch/bootstrap.py (`is_shelter_open`)
  - frontend/src/lib/features/shelters/domain/schema.ts (`shelterFeatureFlagsSchema`, `DEFAULT_SHELTER_FEATURE_FLAGS`, `isShelterBookable`, + `isShelterPublicVisible`, `isShelterAcceptingReferrals`)
  - frontend/src/lib/features/shelters/ui/basic-info-section.svelte · shelter-form-page.svelte
  - frontend BFF /api/v1/shelters · /api/v1/shelters/{code}/risk (+ /public/v1 alias) · /api/public/v1/transparency/shelters · /api/public/v1/config/shelter-policy
  - frontend/src/lib/features/referrals/ui/shelter-combobox.svelte · referrals/server/referral.server-repository.ts (`transition`)
  - frontend/src/routes/api/back-office/referral/+server.ts (POST) · referral/[id]/transition · referral/bulk-transition
---

# draft-shelter-visibility-referral-intake — toggle「แสดงบนหน้าสาธารณะ」และ「รับการส่งต่อ」

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** หน้าตั้งค่าศูนย์เพิ่ม 2 toggle เก็บใน `shelter.feature_flags`: `public_visible` (default `true`) และ `accepts_referrals` (default `true`)
> - **ผล:** `public_visible = false` → ศูนย์หายจาก public plane และ external API ทั้งหมด (ใช้ทางเดียวกับ `cancelled`); `accepts_referrals = false` → เลือกศูนย์เป็นปลายทาง referral ไม่ได้, สร้างใหม่และรับใบที่รออยู่ตอบ 422
> - **build:** domain flags + helper · worker คืน `delete` เมื่อซ่อน + rescan เมื่อเปิดกลับ · BFF กรอง registry · referral picker/POST/accept ตรวจ flag · UI 2 switch
> - **กระทบ:** schema.md `feature_flags` (ไม่ bump `schema_v`) · worker `PROJECTION_VERSION` 17→18 · ไม่แก้ FastAPI

---

## Requirements

**Domain / data**

- FR-1 — `shelterFeatureFlagsSchema` เพิ่ม `public_visible: boolean` default `true` และ `accepts_referrals: boolean` default `true`; `DEFAULT_SHELTER_FEATURE_FLAGS` ตั้งทั้งคู่เป็น `true`.
- FR-2 — doc เดิมที่ไม่มี key หรือไม่มี `feature_flags` อ่านเป็น `true` (ต่างจาก flag อื่นที่อ่านเป็น `false`). ค่า `false` ต้องเป็น boolean `false` เท่านั้นจึงมีผล.
- FR-3 — เพิ่ม `isShelterPublicVisible(doc)` คืน `false` เฉพาะเมื่อ `feature_flags.public_visible === false`.
- FR-4 — เพิ่ม `isShelterAcceptingReferrals(doc)` คืน `false` เฉพาะเมื่อ `feature_flags.accepts_referrals === false`.
- FR-5 — `isShelterBookable()` คืน `false` เมื่อ `isShelterPublicVisible()` เป็น `false` (เพิ่มจาก hard block เดิม `closed` / `cancelled` / `accepts_pre_registration`).
- FR-6 — สอง flag อิสระจาก `operation_status`: เปลี่ยน toggle ไม่เปลี่ยนสถานะ และเปลี่ยนสถานะไม่รีเซ็ต toggle.

**Worker (CouchDB → Mongo)**

- FR-7 — `project_shelter()` คืน `("delete", {"_id": code})` เมื่อ `feature_flags.public_visible is False` — branch เดียวกับ `cancelled`; caller ลบแถว `public_shelters` แล้วเรียก `delete_{persons,occupants,needs,stocks,jobs}_for_shelter(code)`.
- FR-8 — `is_shelter_open()` คืน `false` เมื่อ `public_visible is False` → bootstrap ไม่ scan DB `shelter_{code}` และ listener ของ DB นั้นหยุดในรอบ reconcile ถัดไป.
- FR-9 — change จาก DB `shelter_{code}` ของศูนย์ที่ซ่อนอยู่ต้องไม่ project อะไร แต่ยัง save checkpoint (กลไกเดียวกับ cancelled FR-6).
- FR-10 — เปิด `public_visible` กลับเป็น `true` → registry upsert สร้างแถว `public_shelters` ใหม่ และ rescan DB `shelter_{code}` ด้วย `bootstrap_database` (กลไกเดียวกับ cancelled FR-7 — ไม่มีแถวเดิมก่อน upsert).
- FR-11 — bump `PROJECTION_VERSION` 17 → 18 พร้อม comment อ้าง draft นี้.
- ไม่ลบ: `public_job_applications`, `public_shift_assignments`, `public_volunteers`, `public_donations` (เหมือน cancelled).

**FastAPI (public / external)**

- FR-12 — ไม่ต้องแก้: ทุก endpoint อ่านจาก collection ที่ถูกลบแล้ว → ศูนย์ที่ซ่อน = not found (`/public/v1/*`, `/external/v1/*`, booking `404 location_not_found`).

**BFF ที่อ่าน registry CouchDB ตรง**

- FR-13 — `GET /api/v1/shelters` และ `GET /api/public/v1/transparency/shelters` ตัดศูนย์ที่ `isShelterPublicVisible() === false` ออกจาก list.
- FR-14 — `GET /api/v1/shelters/{code}/risk` (+ alias `/public/v1/...`) และ `GET /api/public/v1/config/shelter-policy` ตอบ 404 เหมือนไม่พบศูนย์ เมื่อศูนย์ถูกซ่อน.

**Referral intake (เฉพาะ `referral_type = capacity` ที่มี `to_shelter_code`)**

- FR-15 — `useSearchShelters` ต้องคืน `feature_flags` (อย่างน้อย `accepts_referrals`) ให้ picker ใช้.
- FR-16 — `shelter-combobox` ไม่เสนอศูนย์ที่ `isShelterAcceptingReferrals() === false` (กรองเหมือน `closed` / `cancelled`).
- FR-17 — `POST /api/back-office/referral` อ่าน shelter ปลายทางจาก registry; ปลายทางไม่รับการส่งต่อ → 422 `{ error: 'ศูนย์ปลายทางปิดรับการส่งต่อ' }` และไม่เขียน doc.
- FR-18 — `transition(→ accepted)` ตรวจ registry ของปลายทางใหม่ทุกครั้ง **ก่อน** cross-DB transfer; ปลายทางไม่รับการส่งต่อ → `CouchDbReferralError` 422 ข้อความเดียวกับ FR-17; ไม่ย้ายผู้อพยพ ไม่เปลี่ยนสถานะ referral. ครอบคลุม `/referral/[id]/transition` และ `/referral/bulk-transition` (bulk = ล้มเป็นรายใบ).
- FR-19 — `→ rejected` และ `→ closed` ยังทำได้ตามเดิมเมื่อปลายทางปิดรับ.
- FR-20 — referral ประเภท `resource` / `medical-emergency` ไม่ถูกกระทบ.

**Roles / permissions**

- FR-21 — แก้สอง flag ได้ผ่าน `PATCH /api/back-office/shelter/[code]` เท่านั้น ซึ่งใช้ `requireShelterManagerOrSA` อยู่แล้ว: `system_admin` หรือ `shelter_manager` ที่มี scope ศูนย์นั้น; role อื่น 403. ไม่เพิ่ม role/permission ใหม่.
- FR-22 — การตรวจ FR-17/FR-18 ทำฝั่ง server; การกรองใน picker (FR-16) เป็น UX เท่านั้น.

**Staff UI (หน้าตั้งค่าศูนย์ — `basic-info-section.svelte`)**

- FR-23 — เพิ่ม switch ตาม pattern ของ `accepts_pre_registration`; ค่าเริ่มต้นในฟอร์ม (`shelter-form-page.svelte`) = `true` ทั้งคู่ เมื่อ doc ไม่มี key.
- FR-24 — copy:

  | flag | label | คำอธิบาย |
  | --- | --- | --- |
  | `public_visible` | แสดงศูนย์นี้บนหน้าสาธารณะ | ปิดแล้ว ศูนย์นี้และข้อมูลผู้พักพิง ความต้องการ สต็อก และงานอาสา จะไม่แสดงบนหน้าสาธารณะและ API ภายนอก |
  | `accepts_referrals` | รับผู้อพยพจากการส่งต่อ (Referral) | ปิดแล้ว ศูนย์อื่นเลือกศูนย์นี้เป็นปลายทางไม่ได้ และรับใบส่งต่อที่รออยู่ไม่ได้ (ยังปฏิเสธได้) |

- FR-25 — ปิด `public_visible` ต้องผ่าน AlertDialog ยืนยัน (pattern เดียวกับยืนยัน `cancelled`): หัวข้อ「ซ่อนศูนย์จากหน้าสาธารณะ?」 · เนื้อหา「ประชาชนและหน่วยงานภายนอกจะไม่เห็นศูนย์นี้และข้อมูลผู้พักพิงทั้งหมด จนกว่าจะเปิดกลับ」 · ปุ่ม「ซ่อนศูนย์」/「ยกเลิก」. ยกเลิก dialog = switch คงค่าเดิม. เปิดกลับไม่ต้องยืนยัน. ปิด `accepts_referrals` ไม่ต้องยืนยัน.
- FR-26 — switch ใช้ `disabled` เดียวกับฟิลด์อื่นในฟอร์ม (ผู้ไม่มีสิทธิ์แก้เห็นแต่แก้ไม่ได้).

## Edge cases

- E-1 — ศูนย์ `cancelled` หรือ `closed` ที่ `public_visible = false`: `cancelled` ถูกลบอยู่แล้ว (ไม่เปลี่ยนผล); `closed` + ซ่อน → แถว `public_shelters` ถูกลบ (ยกเว้นต่อ CR-183 soft-delete) — ดู Q-2.
- E-2 — PATCH แทน `feature_flags` ทั้ง object: client ที่ส่ง `feature_flags` แบบไม่มีสอง key ใหม่ → Zod default เติม `true` (ไม่ซ่อน/ไม่ปิดรับโดยไม่ตั้งใจ).
- E-3 — referral ที่สถานะ `draft`/`sent` อยู่แล้วตอนปิดรับ: ไม่ถูกเปลี่ยนสถานะอัตโนมัติ; accept ได้ 422 จนกว่าจะเปิดรับ; reject/close ได้.
- E-4 — สลับ `public_visible` ถี่ ๆ: แต่ละครั้ง worker ลบหรือ rescan ทั้งศูนย์; ผลสุดท้ายตาม revision ล่าสุดของ registry doc.
- E-5 — ซ่อนศูนย์ไม่กระทบ staff plane: เจ้าหน้าที่ยังเห็น/ใช้งานศูนย์ตามปกติ และยังเป็นปลายทาง referral ได้ถ้า `accepts_referrals = true`.

## Acceptance

- [ ] doc ศูนย์เดิม (ไม่มี key) แสดงบน public และรับ referral ได้เหมือนเดิม.
- [ ] ปิด `public_visible` (ผ่าน dialog ยืนยัน) → หลัง worker ประมวลผล ศูนย์ไม่ปรากฏใน public ทุกหน้า (ค้นหาศูนย์, needs, transparency, ค้นหาผู้พักพิง, งานอาสา) และ external API; `/api/public/v1/shelters/{code}` 404; จอง/ลงทะเบียนล่วงหน้าไม่ได้.
- [ ] เปิด `public_visible` กลับ → ศูนย์และข้อมูลราย shelter กลับมาใน public หลัง worker rescan.
- [ ] ปิด `accepts_referrals` → ศูนย์ไม่อยู่ใน referral picker; POST create ไป shelter นั้นตอบ 422; accept ใบ `sent` ที่ค้างอยู่ตอบ 422 และผู้อพยพไม่ถูกย้าย; reject/close ใบเดิมสำเร็จ.
- [ ] ผู้ที่ไม่ใช่ `system_admin` / `shelter_manager` ของศูนย์ PATCH flag ได้ 403.
- [ ] Tests: domain (defaults, doc เดิมอ่านเป็น `true`, `isShelterBookable`, helper ใหม่) · form DOM (2 switch + dialog) · worker (projector delete, processor gate, rescan เมื่อเปิดกลับ) · BFF (list filter, risk/shelter-policy 404, referral POST 422, accept 422, reject/close ผ่าน, bulk ล้มรายใบ) · combobox filter · e2e shelters / referrals / public shelters.

## Open questions

- Q-1 — picker: ตัดศูนย์ที่ปิดรับออก (FR-16, ตาม precedent `cancelled`) หรือแสดงแบบ disabled พร้อมเหตุผล「ปิดรับการส่งต่อ」?
- Q-2 — ศูนย์ `closed` ที่ถูกซ่อน: ยอมให้ลบแถว `public_shelters` (ขัด CR-183 soft-delete สำหรับ partner) หรือ worker ควรคงแถว closed ไว้?
- Q-3 — การส่ง (`draft → sent`) ไปศูนย์ที่ปิดรับ: block 422 ด้วยหรือไม่ (ร่างนี้ block เฉพาะ create และ accept)?
- Q-4 — ปิด `accepts_referrals` ควรเตือนเมื่อมีใบ `sent` ค้างเข้าศูนย์หรือไม่?
- Q-5 — ซ่อนศูนย์ควรตัด `public_donations` / `public_volunteers` / ใบสมัครงานที่ผูกศูนย์ด้วยหรือไม่ (ร่างนี้คงไว้ตาม cancelled)?

## Why

ศูนย์ต้องการซ่อนตัวจากประชาชนชั่วคราว (เช่นยังไม่พร้อมเปิดหรือไม่ต้องการให้คนเดินทางมาเอง) โดยไม่เปลี่ยน `operation_status`, และต้องหยุดรับผู้อพยพที่ส่งต่อจากศูนย์อื่นเมื่อรับไม่ไหว. ใช้ทางลบ projection ของ `cancelled` เพื่อไม่ต้อง filter ราย endpoint ใน FastAPI. ปิดรับต้อง block การ accept ใบที่ค้างด้วย เพราะ accept คือจุดที่ย้ายผู้อพยพเข้าศูนย์จริง. เก็บเป็น `feature_flags` (ไม่ใช่ enum สถานะใหม่) เพราะเป็นสวิตช์อิสระจากวงจรสถานะ.

## Migration

- CouchDB: ไม่มี — key ใหม่ optional, doc เดิมอ่านเป็น `true`, ไม่ bump `schema_v` (precedent `accepts_pre_registration`).
- Mongo: `PROJECTION_VERSION` 18 → worker full bootstrap ครั้งเดียวหลัง deploy (ยังไม่มีศูนย์ที่ `public_visible = false` จึงไม่มีข้อมูลต้องลบ).
