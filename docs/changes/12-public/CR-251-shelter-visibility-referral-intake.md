---
id: CR-251
title: Shelter toggles `public_visible` + `accepts_referrals` — ซ่อนศูนย์จาก public plane และปิดรับการส่งต่อ
status: approved
date: 2026-11-12
requested_by: ทีม — GitHub #1343 (priority:high, Before It Floods)
decided_by: kong
decision_date: 2026-11-12
layer: volatile
affects:
  - docs/data/schema.md §3.1 shelter `feature_flags` (+`public_visible`, +`accepts_referrals`)
  - no schema_v bump (additive key; precedent `accepts_pre_registration`)
  - worker PROJECTION_VERSION 18 → 19 (worker/src/worker/projection_version.py)
  - worker/src/worker/projectors/shelter.py (`project_shelter`, `classify_registry_shelter` → `RetentionPhase.HIDDEN`) · couch/bootstrap.py · couch/processor.py (ใช้ผ่าน `HIDDEN` / `delete` เดิม ไม่ต้องแก้ logic)
  - frontend/src/lib/features/shelters/domain/schema.ts (`shelterFeatureFlagsSchema`, `DEFAULT_SHELTER_FEATURE_FLAGS`, `isShelterBookable`, + `isShelterPublicVisible`, `isShelterAcceptingReferrals`)
  - frontend/src/lib/features/shelters/ui/basic-info-section.svelte · shelter-form-page.svelte
  - frontend BFF /api/v1/shelters · /api/v1/shelters/{code}/risk (+ /public/v1 alias) · /api/public/v1/transparency/shelters · /api/public/v1/config/shelter-policy
  - frontend/src/lib/features/referrals/ui/shelter-combobox.svelte · referrals/server/referral.server-repository.ts (`transition`)
  - frontend/src/routes/api/back-office/referral/+server.ts (POST) · referral/[id]/transition · referral/bulk-transition
---

# CR-251 — toggle「แสดงบนหน้าสาธารณะ」และ「รับการส่งต่อ」

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** หน้าตั้งค่าศูนย์เพิ่ม 2 toggle เก็บใน `shelter.feature_flags`: `public_visible` (default `true`) และ `accepts_referrals` (default `true`)
> - **ผล:** `public_visible = false` → ศูนย์หายจาก public plane และ external API ทั้งหมด (ใช้ทางเดียวกับ `cancelled`); `accepts_referrals = false` → เลือกศูนย์เป็นปลายทาง referral ไม่ได้, สร้างใหม่ ส่ง (`draft → sent`) และรับใบที่รออยู่ตอบ 422
> - **build:** domain flags + helper · worker คืน `delete` เมื่อซ่อน + rescan เมื่อเปิดกลับ · BFF กรอง registry · referral picker/POST/accept ตรวจ flag · UI 2 switch
> - **กระทบ:** schema.md `feature_flags` (ไม่ bump `schema_v`) · worker `PROJECTION_VERSION` 18→19 · ไม่แก้ FastAPI

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
- FR-8 — `classify_registry_shelter()` คืน `RetentionPhase.HIDDEN` เมื่อ `feature_flags.public_visible is False` (กลุ่มเดียวกับ `cancelled`) → `list_listened_shelters` ไม่รวมศูนย์นี้ bootstrap ไม่ scan DB `shelter_{code}` และ listener ของ DB นั้นหยุดในรอบ reconcile ถัดไป.
- FR-9 — change จาก DB `shelter_{code}` ของศูนย์ที่ซ่อนอยู่ต้องไม่ project อะไร แต่ยัง save checkpoint (กลไกเดียวกับ cancelled FR-6).
- FR-10 — เปิด `public_visible` กลับเป็น `true` → registry upsert สร้างแถว `public_shelters` ใหม่ และ rescan DB `shelter_{code}` ด้วย `bootstrap_database` (กลไกเดียวกับ cancelled FR-7 — ไม่มีแถวเดิมก่อน upsert).
- FR-11 — bump `PROJECTION_VERSION` 18 → 19 (ค่าบน develop ตอนร่าง = 18) พร้อม comment อ้าง CR-251.
- ไม่ลบ: `public_job_applications`, `public_shift_assignments`, `public_volunteers`, `public_donations` (เหมือน cancelled).

**FastAPI (public / external)**

- FR-12 — ไม่ต้องแก้: ทุก endpoint อ่านจาก collection ที่ถูกลบแล้ว → ศูนย์ที่ซ่อน = not found (`/public/v1/*`, `/external/v1/*`, booking `404 location_not_found`).

**BFF ที่อ่าน registry CouchDB ตรง**

- FR-13 — `GET /api/v1/shelters` และ `GET /api/public/v1/transparency/shelters` ตัดศูนย์ที่ `isShelterPublicVisible() === false` ออกจาก list.
- FR-14 — `GET /api/v1/shelters/{code}/risk` (+ alias `/public/v1/...`) และ `GET /api/public/v1/config/shelter-policy` ตอบ 404 เหมือนไม่พบศูนย์ เมื่อศูนย์ถูกซ่อน.

**Referral intake (เฉพาะ `referral_type = capacity` ที่มี `to_shelter_code`)**

- FR-15 — `useSearchShelters` ต้องคืน `feature_flags` (อย่างน้อย `accepts_referrals`) ให้ picker ใช้.
- FR-16 — `shelter-combobox` ไม่เสนอศูนย์ที่ `isShelterAcceptingReferrals() === false` (กรองเหมือน `closed` / `cancelled`).
- FR-17 — `POST /api/back-office/referral` อ่าน shelter ปลายทางจาก registry; ปลายทางไม่รับการส่งต่อ → 422 `{ error: 'ศูนย์ปลายทางปิดรับการส่งต่อ' }` และไม่เขียน doc. SPA สร้างใบผ่าน route นี้อยู่แล้ว (`referralRepository()` คืน `ReferralRemoteRepository` → `POST /api/back-office/referral`) จึงถูกบล็อกที่ server; ดู Q-6.
- FR-18 — `transition(→ accepted)` ตรวจ registry ของปลายทางใหม่ทุกครั้ง **ก่อน** cross-DB transfer; ปลายทางไม่รับการส่งต่อ → `CouchDbReferralError` 422 ข้อความเดียวกับ FR-17; ไม่ย้ายผู้อพยพ ไม่เปลี่ยนสถานะ referral. ครอบคลุม `/referral/[id]/transition` และ `/referral/bulk-transition` (bulk = ล้มเป็นรายใบ).
- FR-18a — `transition(→ sent)` ของ referral `capacity` ที่มี `to_shelter_code` ตรวจ registry ของปลายทางก่อนเปลี่ยนสถานะ; ปลายทางไม่รับการส่งต่อ → `CouchDbReferralError` 422 ข้อความเดียวกับ FR-17 ใบคงเป็น `draft` และผู้ใช้เห็นข้อความทันทีตอนกดส่ง. ครอบคลุม `/referral/[id]/transition` และ `/referral/bulk-transition` (bulk = ล้มเป็นรายใบ). `draft → closed` ยังทำได้.
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
  | `public_visible` | แสดงศูนย์นี้บนหน้าสาธารณะ | เปิด: ประชาชนเห็นศูนย์นี้ในหน้าค้นหาศูนย์ · ปิด: ประชาชนและหน่วยงานภายนอกจะไม่เห็นศูนย์นี้และจำนวนผู้พักอาศัย (ค่าเริ่มต้นเปิด) |
  | `accepts_referrals` | รับผู้ประสบภัยที่ส่งต่อมาจากศูนย์อื่น (Referral) | เปิด: ศูนย์อื่นส่งผู้ประสบภัยมาที่นี่ได้ · ปิด: ศูนย์อื่นส่งมาไม่ได้ และใบส่งต่อที่รออยู่จะกดรับไม่ได้ (ยังกดปฏิเสธได้) (ค่าเริ่มต้นเปิด) |

- FR-25 — ปิด `public_visible` ต้องผ่าน AlertDialog ยืนยัน (pattern เดียวกับยืนยัน `cancelled`): หัวข้อ「ซ่อนศูนย์จากหน้าสาธารณะ?」 · เนื้อหา「ประชาชนและหน่วยงานภายนอกจะไม่เห็นศูนย์นี้และข้อมูลผู้พักพิงทั้งหมด จนกว่าจะเปิดกลับ」 · ปุ่ม「ซ่อนศูนย์」/「ยกเลิก」. ยกเลิก dialog = switch คงค่าเดิม. เปิดกลับไม่ต้องยืนยัน. ปิด `accepts_referrals` ไม่ต้องยืนยัน.
- FR-26 — switch ใช้ `disabled` เดียวกับฟิลด์อื่นในฟอร์ม (ผู้ไม่มีสิทธิ์แก้เห็นแต่แก้ไม่ได้).

## Edge cases

- E-1 — ศูนย์ `cancelled` หรือ `closed` ที่ `public_visible = false`: `cancelled` ถูกลบอยู่แล้ว (ไม่เปลี่ยนผล); `closed` + ซ่อน → แถว `public_shelters` ถูกลบ (ยกเว้นต่อ CR-183 soft-delete) — ดู Q-2.
- E-2 — PATCH แทน `feature_flags` ทั้ง object: client ที่ส่ง `feature_flags` แบบไม่มีสอง key ใหม่ → Zod default เติม `true` (ไม่ซ่อน/ไม่ปิดรับโดยไม่ตั้งใจ).
- E-3 — referral ที่สถานะ `draft`/`sent` อยู่แล้วตอนปิดรับ: ไม่ถูกเปลี่ยนสถานะอัตโนมัติ; `draft` กดส่งได้ 422 (FR-18a), `sent` กดรับได้ 422 จนกว่าจะเปิดรับ; reject/close ได้.
- E-4 — สลับ `public_visible` ถี่ ๆ: แต่ละครั้ง worker ลบหรือ rescan ทั้งศูนย์; ผลสุดท้ายตาม revision ล่าสุดของ registry doc.
- E-5 — ซ่อนศูนย์ไม่กระทบ staff plane: เจ้าหน้าที่ยังเห็น/ใช้งานศูนย์ตามปกติ และยังเป็นปลายทาง referral ได้ถ้า `accepts_referrals = true`.

## Acceptance

- [ ] doc ศูนย์เดิม (ไม่มี key) แสดงบน public และรับ referral ได้เหมือนเดิม.
- [ ] ปิด `public_visible` (ผ่าน dialog ยืนยัน) → หลัง worker ประมวลผล ศูนย์ไม่ปรากฏใน public ทุกหน้า (ค้นหาศูนย์, needs, transparency, ค้นหาผู้พักพิง, งานอาสา) และ external API; `/api/public/v1/shelters/{code}` 404; จอง/ลงทะเบียนล่วงหน้าไม่ได้.
- [ ] เปิด `public_visible` กลับ → ศูนย์และข้อมูลราย shelter กลับมาใน public หลัง worker rescan.
- [ ] ปิด `accepts_referrals` → ศูนย์ไม่อยู่ใน referral picker; `POST /api/back-office/referral` ไป shelter นั้นตอบ 422; ส่งใบ `draft` ไปศูนย์นั้นตอบ 422 และใบคงเป็น `draft`; accept ใบ `sent` ที่ค้างอยู่ตอบ 422 และผู้อพยพไม่ถูกย้าย; reject/close ใบเดิมสำเร็จ.
- [ ] ผู้ที่ไม่ใช่ `system_admin` / `shelter_manager` ของศูนย์ PATCH flag ได้ 403.
- [ ] Tests: domain (defaults, doc เดิมอ่านเป็น `true`, `isShelterBookable`, helper ใหม่) · form DOM (2 switch + dialog) · worker (projector delete, processor gate, rescan เมื่อเปิดกลับ) · BFF (list filter, risk/shelter-policy 404, referral POST 422, accept 422, reject/close ผ่าน, bulk ล้มรายใบ) · combobox filter · e2e shelters / referrals / public shelters.

## Open questions

- Q-1 — picker: ตัดศูนย์ที่ปิดรับออก (FR-16, ตาม precedent `cancelled`) หรือแสดงแบบ disabled พร้อมเหตุผล「ปิดรับการส่งต่อ」?
  - **ตัดสินแล้ว 2026-11-12 (kong):** ตัดออกจาก picker ตาม FR-16
- Q-2 — ศูนย์ `closed` ที่ถูกซ่อน: ยอมให้ลบแถว `public_shelters` (ขัด CR-183 soft-delete สำหรับ partner) หรือ worker ควรคงแถว closed ไว้?
  - **ตัดสินแล้ว 2026-11-12 (kong):** ศูนย์ `closed` ยังแสดงตามกฎ CR-183 ตามปกติ; จะหายจาก public เฉพาะเมื่อกด `public_visible = false` (ตามร่าง E-1)
- Q-3 — การส่ง (`draft → sent`) ไปศูนย์ที่ปิดรับ: block 422 ด้วยหรือไม่ (ร่างนี้ block เฉพาะ create และ accept)?
  - **ตัดสินแล้ว 2026-11-12 (kong):** ห้ามตอนส่งด้วย — ส่งไม่ได้จะได้รู้ทันที (เพิ่ม FR-18a)
- Q-4 — ปิด `accepts_referrals` ควรเตือนเมื่อมีใบ `sent` ค้างเข้าศูนย์หรือไม่?
  - **ตัดสินแล้ว 2026-11-12 (kong):** ไม่เตือน ตามร่าง
- Q-5 — ซ่อนศูนย์ควรตัด `public_donations` / `public_volunteers` / ใบสมัครงานที่ผูกศูนย์ด้วยหรือไม่ (ร่างนี้คงไว้ตาม cancelled)?
  - **ตัดสินแล้ว 2026-11-12 (kong):** คงข้อมูลไว้ ไม่ตัด ตามร่าง (เหมือน `cancelled`)
- Q-6 — การสร้าง referral จาก SPA ถูกบล็อกที่ server หรือไม่ (ตอนร่างเข้าใจว่า SPA เขียน CouchDB ตรงไม่ผ่าน BFF)?
  - **แก้ข้อเท็จจริง 2026-11-12:** ตรวจโค้ดแล้ว SPA สร้างและส่งผ่าน BFF (`ReferralRemoteRepository`) ทั้งหมด จึงไม่มีช่องที่ต้องยอมรับ; ช่องที่เหลือมีเฉพาะผู้ที่เรียก CouchDB ตรงนอก SPA (สร้างใบได้ แต่ส่งและรับไม่ได้ตาม FR-18a / FR-18) — ยอมรับไว้ก่อน (kong)

## Why

ศูนย์ต้องการซ่อนตัวจากประชาชนชั่วคราว (เช่นยังไม่พร้อมเปิดหรือไม่ต้องการให้คนเดินทางมาเอง) โดยไม่เปลี่ยน `operation_status`, และต้องหยุดรับผู้อพยพที่ส่งต่อจากศูนย์อื่นเมื่อรับไม่ไหว. ใช้ทางลบ projection ของ `cancelled` เพื่อไม่ต้อง filter ราย endpoint ใน FastAPI. ปิดรับต้อง block การ accept ใบที่ค้างด้วย เพราะ accept คือจุดที่ย้ายผู้อพยพเข้าศูนย์จริง. เก็บเป็น `feature_flags` (ไม่ใช่ enum สถานะใหม่) เพราะเป็นสวิตช์อิสระจากวงจรสถานะ.

## Migration

- CouchDB: ไม่มี — key ใหม่ optional, doc เดิมอ่านเป็น `true`, ไม่ bump `schema_v` (precedent `accepts_pre_registration`).
- Mongo: `PROJECTION_VERSION` 19 → worker full bootstrap ครั้งเดียวหลัง deploy (ยังไม่มีศูนย์ที่ `public_visible = false` จึงไม่มีข้อมูลต้องลบ).

## Decision log

- 2026-11-12 — proposed สำหรับ [Issue #1343](https://github.com/r202-coe-psu/tent/issues/1343) ([PR #1372](https://github.com/r202-coe-psu/tent/pull/1372))
- 2026-11-12 — แก้ตาม review: FR-8 อ้าง `classify_registry_shelter` → `RetentionPhase.HIDDEN` แทน `is_shelter_open` ที่ไม่มีแล้ว; `PROJECTION_VERSION` 18 → 19
- 2026-11-12 — approved โดย kong กำหนดหมายเลข CR-251 (ต่อจาก CR-250 ที่ PR #1351 จองไว้)
- 2026-11-12 — ตอบ Q-1: ตัดศูนย์ที่ปิดรับออกจาก picker ตามร่าง (FR-16)
- 2026-11-12 — ตอบ Q-2 (ซ่อนเฉพาะเมื่อกด `public_visible = false`), Q-4, Q-5 ตามร่าง, Q-6 ยอมรับช่องนี้ไว้ก่อน
- 2026-11-12 — ตอบ Q-3: ห้าม `draft → sent` ไปศูนย์ที่ปิดรับด้วย เพิ่ม FR-18a (ครบ Q-1..Q-6)
- 2026-11-12 — แก้ข้อเท็จจริง Q-6/FR-17: SPA สร้าง/ส่งผ่าน BFF อยู่แล้ว ไม่ใช่ CouchDB ตรง (คอมเมนต์ใน `referral/+server.ts` ล้าสมัย — แก้ตอนลงมือทำ)
