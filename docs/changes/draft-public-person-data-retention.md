---
id: draft # draft-public-person-data-retention — ยังไม่รันเลข CR-NNN (change-management §3)
title: แยกนาฬิกา retention สองตัว — public search 3 เดือนหลังปิดศูนย์ (CR-183) · ข้อมูลส่วนบุคคลใน CouchDB 2 ปี
status: draft
date: 2026-10-25
requested_by: Dev Team B  2026-10-25 「ทั้งเก็บ 3 เดือนและ retention 2 year」
decided_by:
layer: volatile # rule retention/PDPA; ไม่แตะ envelope/auth/sync priority/layer boundary
affects:
  - docs/data/data-model.md §7 Retention (แถว `medical`, `evacuee`/`household`, donor PII, edge server)
  - docs/data/schema.md §3.2 `config:app.retention_months_after_close` (คำอธิบาย "PDPA purge") · อาจเพิ่ม field ใหม่ใน §3.2 (ขึ้นกับ D-2)
  - docs/features/pdpa-consent-block-spec.md — ต้นทางของ「[๒ ปี]」 อ้างอิง **ไม่แก้** (owner 2026-10-25)
  - docs/features/public-tier-flow-spec.html (bullet Retention เคาะ 2026-06-11)
  - docs/task-breakdown/01-core.md T-43 (RoPA / consent / retention) — DoD + cross-ref
  - frontend/src/lib/constants/i18n/public-policy.ts · public-term.ts (หัวข้อ retention "จนถึง 31 ธ.ค. 2569" — ต้องแก้ให้ตรงกับ FR-4 เมื่อ approve)
  - docs/changes/11-famsearch/CR-183-closed-shelter-search-retention.md — อ้างอิง ไม่แก้
  - docs/changes/01-core/CR-017-dashboard-api-architecture.md — **ไม่แก้ตัวไฟล์**; การ supersede บางส่วนจาก CR-183 บันทึกที่ FR-16 ของ CR นี้แทน (owner 2026-10-25)
  - no schema_v bump (ขึ้นกับ D-2: config field ใหม่ = additive ใน `config:app`)
  - no PROJECTION_VERSION bump (public plane ไม่เปลี่ยน)
  - code: ไม่มีใน CR นี้ — CouchDB purge/anonymize job เป็นงาน T-43
---

# draft-public-person-data-retention — ระยะเก็บข้อมูลส่วนบุคคล 2 ปี แยกจาก public search 3 เดือน

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** แยก retention เป็นสองนาฬิกา — (1) **public plane:** คนของศูนย์ปิดค้นเจอได้ `closed_at` + `retention_months_after_close` (default 3 เดือน) ตาม [CR-183](11-famsearch/CR-183-closed-shelter-search-retention.md) **ไม่เปลี่ยน** · (2) **system of record (CouchDB):** ข้อมูลส่วนบุคคล (`evacuee`, `household`, `medical`) เก็บ **2 ปีหลังปิดศูนย์ (นับจาก `shelter.closed_at`)** แล้วจึง purge/anonymize (tombstone) — `medical` 2 ปีเท่ากันแต่ purge ก่อนตามลำดับ; donor PII ใน `donation` คง 3 เดือนหลังปิดศูนย์
> - **ทำไม:** data-model §7 บอก tombstone/purge CouchDB "ภายใน 3 เดือนหลังปิดศูนย์" ขัดกับข้อความ notice PDPA「[๒ ปี]」 — pdpa-consent-block-spec §10 บังคับให้ตรงกันก่อนเปิดแท็บ notice
> - **build:** ไม่มี code ใน CR นี้ — แก้ spec ให้ตรงกัน; job purge CouchDB ยังเป็น T-43 แต่ T-43 ต้องใช้นาฬิกา `closed_at` + 2 ปีแทน 3 เดือน
> - **กระทบ:** data-model §7 · schema.md §3.2 (คำอธิบาย + อาจมี field ใหม่ ดู D-2) · public-tier-flow-spec · T-43 · ไม่ bump `schema_v` · pdpa spec เป็นต้นทาง ไม่แก้
> - **สถานะ:** ยัง `draft` — แต่เอกสาร P-1..P-4, P-6, P-7 แก้ตามกฎนี้แล้ว 2026-10-25 ตามคำสั่ง owner「ยึด pdpa-consent-block-spec เป็นหลัก」; P-8 (code i18n) ยังไม่แก้ · D-2, D-6 ยังเปิด

---

## ปัญหาปัจจุบัน (as-is, working tree @ `feat/public-search-worker` — รวม edit ที่ยังไม่ commit จาก CR-183)

> **2026-10-25 — แก้แล้ว:** เอกสารใน P-1..P-4, P-6, P-7 แก้ตามกฎของ CR นี้แล้ว (owner สั่ง「ยึด pdpa-consent-block-spec เป็นหลัก」 แม้ CR ยังเป็น `draft`). ตารางด้านล่างคือข้อความ **ก่อนแก้** (เลขบรรทัด ณ ก่อนแก้). **P-5 ไม่แก้** — pdpa spec เป็นต้นทางของกฎ (owner 2026-10-25: ไม่ควรแก้ spec นี้); open issue §10 ของ spec คงไว้ตามเดิม. **P-8 ยังไม่แก้** — เป็น code (`frontend/src/lib/constants/i18n/`) อยู่นอกรอบแก้เอกสาร; เป็น follow-up ที่เหลือ (ดู Migration).

| # | สิ่งที่เขียนไว้ | ที่ |
| --- | --- | --- |
| P-1 | `medical` "purge ทันทีที่ครบ 3 เดือนหลัง `shelter.closed_at`" | `docs/data/data-model.md:230` |
| P-2 | `evacuee`, `household` "แทนที่ด้วย tombstone ไร้ PII … ภายใน 3 เดือนหลังปิดศูนย์" | `docs/data/data-model.md:231` |
| P-3 | donor PII ใน `donation` "ลบ name/phone ภายใน 3 เดือนหลังปิดศูนย์" · edge server wipe "ก่อนนาฬิกา 3 เดือนเริ่มนับที่ central" | `docs/data/data-model.md:233,235` |
| P-4 | `retention_months_after_close` อธิบายว่า "PDPA purge" — แต่ consumer จริงตัวเดียวคือ sync worker ลบ `public_persons` (CR-183); อ่านแล้วเข้าใจว่าเป็นนาฬิกา purge CouchDB ด้วย | `docs/data/schema.md:1560` |
| P-5 | notice PDPA ใน prototype ระบุ「[๒ ปี]」 ขัดกับ data-model §7 — "ต้องทำให้ตรงกันก่อนเปิดใช้แท็บ notice" | `docs/features/pdpa-consent-block-spec.md:158` |
| P-6 | "ข้อมูลส่วนบุคคลถูกลบ/anonymize ภายใน **3 เดือนหลังปิดศูนย์**" (เคาะ 2026-06-11) | `docs/features/public-tier-flow-spec.html:84` |
| P-8 | นโยบายความเป็นส่วนตัวและข้อตกลงการใช้งานหน้า public (ใช้งานจริงแล้ว) ระบุ "เก็บข้อมูลไว้จนถึงวันที่ 31 ธันวาคม พ.ศ. 2569" — เป็นค่าที่สาม ไม่ตรงทั้ง 3 เดือน (§7) และ 2 ปี (notice) | `frontend/src/lib/constants/i18n/public-policy.ts:41-43,99-101` · `public-term.ts:15-17,67-69` |
| P-7 | T-43 DoD "Retention policy ต่อประเภทข้อมูลกำหนดชัด + กลไกลบ/anonymize อัตโนมัติ" อ้าง data-model §7 (3 เดือน) โดยปริยาย; cross-ref บอก purge CouchDB เป็นขอบเขต T-43 | `docs/task-breakdown/01-core.md:115-126` |
| P-9 | CR-017 Decision D แถว "ปิดศูนย์" ยังเขียน "ลบ `public_needs`, `public_shelters` ของศูนย์นั้น" และตาราง listener ยังเขียน "`registry` ตรวจจับเปิด/ปิดศูนย์ → เริ่ม/หยุด listener" · "`shelter_{shelter_code}` (ทุกศูนย์ที่เปิด)" — ขัดกับ CR-183 FR-1, FR-4, FR-7 (D-4) ที่ implement แล้ว. **ไม่แก้ตัวไฟล์** — บันทึกที่ FR-16 | `docs/changes/01-core/CR-017-dashboard-api-architecture.md:98,250-251` |

**สถานะ code (ตรวจด้วย grep 2026-10-25):** ไม่มี code ใดอ่านค่า retention 2 ปี (ไม่พบ `retention_years`, `days=730`, `24 months` ฯลฯ ใน `frontend/src`, `backend/apiapp`, `worker/src`). ค่า retention ที่ code อ่านมีตัวเดียวคือ `retention_months_after_close` — `worker/src/worker/projectors/shelter.py:38,94-99`, `worker/src/worker/couch/bootstrap.py:212-220`, `worker/src/worker/retention/job.py:216-222`, `frontend/src/lib/features/shared/domain/app-config.ts:45` — ใช้กับ `public_persons` เท่านั้น. ยังไม่มี job purge/anonymize ฝั่ง CouchDB (`evacuee.anonymized` มีแค่ type ที่ `frontend/src/lib/features/people/domain/people.ts:332` รอ job ใน T-43).

---

## Requirements

### นาฬิกา 1 — public plane (คงเดิม)

- **FR-1** — retention ของ `public_persons` และ projection อื่นของศูนย์ปิดเป็นไปตาม [CR-183](11-famsearch/CR-183-closed-shelter-search-retention.md) FR-1..FR-6 ทุกข้อ — CR นี้ไม่เปลี่ยนค่า default, จุดเริ่มนาฬิกา, หรือพฤติกรรม worker. CR-183 (Why, D-1) อ้าง data-model §7 "3 เดือน" เป็นเหตุผลของระยะ public plane — เมื่อ CR นี้ approve ระยะ 3 เดือนของ public plane คงอยู่ในฐานะการตัดสินใจของ CR-183 เอง ไม่ผูกกับระยะเก็บใน CouchDB.
- **FR-2** — `config:app.retention_months_after_close` ต้องมีความหมายเดียว: ระยะที่คนของศูนย์ปิดยังค้นเจอบน public plane (public search + partner `/external/v1/occupants`). ห้ามใช้ค่านี้เป็นนาฬิกา purge CouchDB.
- **FR-3** — คำอธิบาย `retention_months_after_close` ใน schema.md §3.2 ต้องเปลี่ยนจาก "PDPA purge" เป็น "public plane retention (`public_persons`) ของศูนย์ปิด — ไม่ใช่ระยะเก็บข้อมูลใน CouchDB" (ความหมายเท่าโค้ดปัจจุบัน; ไม่เปลี่ยนชนิด/default).

### นาฬิกา 2 — system of record (CouchDB)

- **FR-4** — ข้อมูลส่วนบุคคลใน CouchDB ที่เก็บผ่านการลงทะเบียน (`evacuee`, `household`, `medical`) ต้องถูกเก็บได้ไม่เกิน **2 ปีนับจาก `shelter.closed_at`** (D-1) แล้วจึง purge/anonymize — ตรงกับข้อความ notice「[๒ ปี]」. ศูนย์ที่ `closed_at = null` ไม่มีนาฬิกา (เหมือน CR-183 D-5).
- **FR-5** — เมื่อครบ `closed_at` + 2 ปี: `evacuee`, `household` → แทนที่ด้วย tombstone ไร้ PII (`{type, anonymized: true}`) ตามรูปแบบเดิมใน data-model §7 (เปลี่ยนเฉพาะระยะเวลา; รูป tombstone ขึ้นกับ D-6 ที่ยังเปิด).
- **FR-6** — `medical` → purge เมื่อครบ `closed_at` + 2 ปี (D-3 — ระยะเท่าข้อความ notice) และ purge **ก่อน** `evacuee`/`household` ในลำดับของ job ตาม §7 เดิม.
- **FR-7** — donor PII ใน `donation` (name/phone) → ลบภายใน 3 เดือนหลังปิดศูนย์ตาม §7 เดิม (D-4 — อยู่นอกบล็อก consent ของการลงทะเบียน).
- **FR-8** — `movement`, `screening`, ledger, audit คงนโยบายเดิม (เก็บต่อจนจบโครงการ, อ้าง ULID เท่านั้น).
- **FR-9** — edge server wipe ยังเป็นขั้นตอนปิดศูนย์ (ไม่รอ 2 ปี) — edge ไม่ใช่ SoR; ข้อความ "ก่อนนาฬิกา 3 เดือนเริ่มนับที่ central" ต้องเปลี่ยนให้อ้างนาฬิกา FR-4.
- **FR-10** — ระยะ 2 ปีต้องอ่านจากแหล่งเดียวตาม D-2 (config field หรือ constant) — ห้าม hard-code ซ้ำหลายจุด.

### ความสอดคล้องของเอกสาร

- **FR-11** — data-model §7 ตารางแรกต้องมีหัวข้อ "CouchDB (SoR) — 2 ปี". ส่วน "Public plane (MongoDB) ของศูนย์ปิด" ที่เพิ่มตาม CR-183 คงไว้ไม่แก้ ยกเว้นวลี "เกินนโยบาย §7" ใน bullet `closed_at = null` ให้เปลี่ยนเป็น "เกินระยะ public plane ของ CR-183".
- **FR-12** — ข้อความ notice PDPA (pdpa-consent-block-spec) ระบุ「[๒ ปี]」อยู่แล้ว — CR นี้ทำให้ data-model §7 ตรงกับ notice โดย**ไม่แก้** pdpa spec. ถ้า notice กล่าวถึงการค้นหาญาติ ต้องระบุว่าค้นเจอได้ถึง `retention_months_after_close` เดือนหลังปิดศูนย์. ถ้าข้อความ consent ที่แสดงตอนยินยอมเปลี่ยน ต้องเปลี่ยน `consent.notice_version` ด้วย (pdpa spec §4, D11) เพื่อแยกคนที่ยินยอมภายใต้ข้อความเดิม.
- **FR-15** — 2 ปีเป็นระยะ**สูงสุด**. การถอนความยินยอมหรือคำขอลบตามสิทธิเจ้าของข้อมูลทำให้ลบได้ก่อนครบ — กลไกเป็นของงานถอนความยินยอม (อยู่นอกขอบเขต pdpa spec §1) ไม่ใช่ของ CR นี้.
- **FR-13** — public-tier-flow-spec bullet Retention ต้องแก้เป็นสองนาฬิกา (public 3 เดือน / ข้อมูลส่วนบุคคล 2 ปี) และอ้าง CR นี้.
- **FR-14** — T-43 DoD ต้องระบุว่า job purge/anonymize CouchDB ใช้นาฬิกา FR-4 (2 ปี) และ RoPA ต้องระบุทั้งสองระยะ.
- **FR-16** — CR-017 ถูก supersede บางส่วนโดย [CR-183](11-famsearch/CR-183-closed-shelter-search-retention.md) (CR-183 `affects:` + Impact + D-4 ระบุให้อัปเดต CR-017 ตอน implement). บันทึกไว้ที่นี่แทนการแก้ไฟล์ CR-017:
  - Decision D แถว "ปิดศูนย์" — แทน "ลบ `public_needs`, `public_shelters` ของศูนย์นั้น" ด้วย: ปิดศูนย์ → ลบ `public_needs`, `shelter_stocks`, `shelter_occupants` (พร้อม `_retention_audit`); **คง** `public_shelters` (`status = closed`) และ `public_persons` ไว้จนครบ `closed_at` + `retention_months_after_close` (CR-183 FR-1..FR-4).
  - ตาราง listener แถว `registry` — ยังตรวจจับเปิด/ปิดศูนย์ แต่ศูนย์ปิด**ไม่หยุด** listener ทันที: ฟังต่อจนครบ `closed_at` + `retention_months_after_close` (CR-183 D-4).
  - ตาราง listener แถว `shelter_{shelter_code}` — ขอบเขตเปลี่ยนจาก "ทุกศูนย์ที่เปิด" เป็น "ทุกศูนย์ที่เปิด + ศูนย์ปิดที่ยังอยู่ในระยะ retention หรือ `closed_at = null`" โดยศูนย์ปิด project เฉพาะ `public_persons` (CR-183 FR-7, FR-10).

---

## Acceptance (สำหรับการแก้ spec ตอน approve)

- data-model §7, schema.md §3.2, public-tier-flow-spec, หน้า privacy policy / terms และ T-43 ไม่มีข้อความใดบอกว่า CouchDB purge/tombstone "ภายใน 3 เดือนหลังปิดศูนย์".
- `retention_months_after_close` ทุกที่ที่กล่าวถึง อธิบายว่าเป็น public plane retention เท่านั้น.
- ทุกเอกสารที่กล่าวถึง 2 ปี ระบุจุดเริ่มนาฬิกาเดียวกัน (D-1) และแหล่งค่าเดียวกัน (D-2).
- worker/FastAPI/frontend ไม่มี diff จาก CR นี้ (นอกจาก T-43 ภายหลัง).

---

## Open decisions

- **D-1 — จุดเริ่มนาฬิกา 2 ปี** — ⬜ เสนอ (รอ owner ตัดสิน).
  - **เสนอ:** `shelter.closed_at` — นาฬิกาเดียวกับ CR-183 (field มี stamp rule + backfill แล้ว), job คำนวณต่อศูนย์ได้ทั้ง DB, สอดคล้อง §7 เดิมที่นับหลังปิดศูนย์. ข้อเสีย: ศูนย์ที่เปิดนานทำให้ข้อมูลคนที่ออกไปแล้วถูกเก็บนานกว่า 2 ปีนับจากวันที่ออก; ศูนย์ `closed_at = null` ไม่มีนาฬิกา (เหมือน CR-183 D-5).
  - ทางเลือก A: check-out ของผู้อพยพ (`current_stay.since` เมื่อ status เป็น `checked_out`/`transferred`/`deceased`) — ตรงหลัก minimisation ต่อคนมากที่สุด แต่ต้องจัดการคนที่ย้ายศูนย์ (`transfer_out` → `transfer_in`) และคนที่ไม่เคย check-out ก่อนศูนย์ปิด; job ต้องสแกนราย evacuee.
  - ทางเลือก B: วันลงทะเบียน (`consent.given_at` / created) — ง่ายและตรงกับวันที่เจ้าของข้อมูลเห็น notice แต่ผู้อพยพที่ยังอยู่ศูนย์เกิน 2 ปีจะถูก anonymize ระหว่างยังพักอยู่. ข้อควรระวัง: evacuee เดิมที่ได้ `consent` จาก backfill มี `given_at` = เวลารัน script (pdpa spec FR-50) ไม่ใช่วันลงทะเบียนจริง จึงต้องใช้ `created_at` แทนสำหรับ `given_by = backfill`.
  - ทางเลือก C: `max(closed_at, check-out)` — ปลอดภัยต่อการใช้งาน แต่ซับซ้อนที่สุด.
- **D-2 — แหล่งค่า 2 ปี** — ⬜ เสนอ (รอ owner ตัดสิน; เอกสารที่แก้แล้วระบุ 2 ปีโดยยังไม่มี config field).
  - **เสนอ:** config field ใหม่ใน `config:app` เช่น `personal_data_retention_months` (int, default `24`) — เปลี่ยนได้โดยไม่ deploy และสมมาตรกับ `retention_months_after_close`. เป็นการเพิ่ม field ใน schema.md §3.2 (เข้าข่าย change-management §2 — ครอบโดย CR นี้เมื่อ approve; additive, ไม่ bump `schema_v`). ต้องตัดสินด้วยว่าอยู่ใน public allow-list `PUBLIC_APP_CONFIG_FIELDS` หรือไม่ (แนะนำ: ไม่).
  - ทางเลือก: constant ใน code ของ job T-43 — ไม่แตะ schema แต่ค่าใน notice กับ code ผูกกันด้วยมือ และเปลี่ยนต้อง deploy + CR ใหม่.
- **D-3 — `medical` ใช้นาฬิกาสั้นกว่าหรือไม่** — ⬜ เสนอ (รอ owner ตัดสิน).
  - **เสนอ:** 2 ปีเท่าข้อมูลอื่น (ระยะเดียวกับข้อความ notice「[๒ ปี]」 ซึ่งไม่แยกระยะของข้อมูลสุขภาพ) — ยังคง purge ก่อนในลำดับของ job (FR-6).
  - ทางเลือก: ระยะสั้นกว่า — `closed_at` + 3 เดือน (ค่าเดิมของ §7) เพราะเป็น sensitive data (PDPA ม.26).
- **D-4 — donor PII ใน `donation` อยู่ในขอบเขต 2 ปีหรือไม่** — ⬜ เสนอ (รอ owner ตัดสิน).
  - **เสนอ:** ไม่ — คง 3 เดือนหลังปิดศูนย์ตาม §7. notice「[๒ ปี]」อยู่ในบล็อก consent ของการลงทะเบียนผู้อพยพ ไม่ใช่ผู้บริจาค; การเปลี่ยนต้องดูข้อความ consent ของ donor (T-43).
  - ทางเลือก: ใช้ 2 ปีเท่ากันทุก PII.
- **D-5 — ขอบเขต T-43** — ⬜ เสนอ (รอ owner ตัดสิน).
  - **เสนอ:** CR นี้ **เปลี่ยนเฉพาะพารามิเตอร์** ของ T-43 (ระยะ 2 ปี + จุดเริ่มตาม D-1 + แหล่งค่าตาม D-2) — ไม่เพิ่ม/ลด deliverable, ไม่เปลี่ยน effort/deadline. job purge CouchDB ยังเป็นงาน T-43 ตามเดิม.
  - ทางเลือก: แยก job purge CouchDB ออกเป็น task ใหม่ (เปลี่ยน scope task-breakdown — ต้องตัดสินแยก).
- **D-6 — หลักฐานความยินยอมหลัง tombstone** — ⬜ เสนอ (รอ owner ตัดสิน). tombstone ตาม FR-5 (`{type, anonymized: true}`) ลบ `evacuee.consent` ทั้ง object ไปด้วย ทำให้พิสูจน์ไม่ได้ว่าเคยยินยอมอะไรภายใต้ข้อความเวอร์ชันไหน.
  - **เสนอ:** tombstone คง field ที่ไม่ระบุตัวบุคคลของ `consent` ไว้ — `mode`, `health`, `ref`, `given_at`, `given_by`, `channel`, `notice_version` — และลบ `giver_evacuee_id`, `recorded_verbally_by` (ชี้ไปยังบุคคล). ต้องตรวจกับ DPO ว่า `ref` ยังจำเป็นหลังลบ PII หรือไม่.
  - ทางเลือก: tombstone ตามรูปแบบเดิมทั้งหมด (ไม่เหลือหลักฐาน consent ใน CouchDB).

---

## Impact

| ด้าน | ผลกระทบ |
| --- | --- |
| Privacy / PDPA | PII ใน CouchDB อยู่นานขึ้น (≈3 เดือน → 2 ปี) — RoPA และ notice ต้องระบุ 2 ปีและวัตถุประสงค์ที่เก็บต่อ; DPO ของโครงการต้องรับรอง |
| Public plane | ไม่เปลี่ยน — ยังลบ `public_persons` ตาม CR-183; ระยะ public search (3 เดือน) < ระยะเก็บ SoR (2 ปี) |
| Sync worker | ไม่เปลี่ยน — หลัง CouchDB tombstone (2 ปี) evacuee ของศูนย์นั้นไม่ถูก project อีก เพราะ listener หยุดฟังตั้งแต่หลัง 3 เดือน (CR-183 FR-7/FR-8) |
| Edge server | ไม่เปลี่ยน — wipe ตอนปิดศูนย์ (FR-9) |
| Storage | CouchDB เก็บ `evacuee`/`household`/`medical` ของศูนย์ปิดนานขึ้น — ปริมาณไม่กระทบ capacity ระดับโครงการ |
| T-43 | พารามิเตอร์ retention เปลี่ยน (D-5); ระยะ 2 ปีเกินอายุโครงการ 12 เดือน → job อาจไม่ถูกเรียกใช้จริงภายในโครงการ แต่ยังต้อง test ได้ตาม DoD และส่งต่อใน handover (T-44) |
| pdpa-consent-block | ไม่แก้ spec — เป็นต้นทางของ「[๒ ปี]」. เมื่อ data-model §7 ตรงกับ notice แล้ว เงื่อนไขของ open issue §10 ("ต้องทำให้ตรงกันก่อนเปิดใช้แท็บ notice") ครบ; การปิด open issue ในตัว spec เป็นของ owner (track ด้วย decision sync note ตาม D13 ของ spec). ตัวบล็อก consent (C1–C5, `evacuee.consent`) ทำได้ก่อนโดยไม่รอ CR นี้ |

## Migration

- **CouchDB:** ไม่มี — ไม่เปลี่ยนรูปร่าง doc ที่ persist; ไม่ bump `schema_v`. ถ้า D-2 เลือก config field ใหม่ → additive ใน `config:app` (ไม่มีค่า = ใช้ default `24`), ไม่ต้อง backfill.
- **Mongo:** ไม่มี — ไม่ bump `PROJECTION_VERSION`.
- **Code:** ไม่มี — ไม่มี code ที่อ่านค่า 2 ปีอยู่ (ตรวจ grep ใน as-is); ไม่มี job purge CouchDB ที่ต้องเปลี่ยน (ยังไม่ถูกสร้าง).
- **ข้อมูลเดิม:** ยังไม่มี doc ใดถูก tombstone ตามกฎ 3 เดือนเดิม (ไม่มี job) — ไม่มีอะไรต้องฟื้น.
- **เอกสาร (2026-10-25):** P-1..P-4, P-6, P-7 แก้แล้วตามคำสั่ง owner แม้ CR ยัง `draft` — `docs/data/**` (data-model §7, schema.md §3.2 ฯลฯ), `docs/features/public-tier-flow-spec.html` (Retention), `docs/task-breakdown/01-core.md` T-43. `docs/features/pdpa-consent-block-spec.md` ไม่แก้ (P-5).
- **Follow-up ที่เหลือ:** P-8 — `frontend/src/lib/constants/i18n/public-policy.ts`, `public-term.ts` ยังระบุ "จนถึง 31 ธ.ค. 2569" — ไม่แก้ในรอบเอกสารเพราะเป็น code; ต้องแก้ให้ตรง FR-4 ในงานแยก (และพิจารณา `consent.notice_version` ตาม FR-12 ถ้าข้อความ consent เปลี่ยน).

## Decision log

- 2026-10-25 — **draft** (proposed) จากคำของ project owner ในแชต:「ทั้งเก็บ 3 เดือนและ retention 2 year」— ตีความ: 3 เดือน = public search ของศูนย์ปิด (CR-183, ไม่เปลี่ยน) · 2 ปี = ระยะเก็บข้อมูลส่วนบุคคลใน CouchDB. owner ระบุว่ายังไม่ต้อง approve. เอกสารที่ขัดกัน (P-1..P-8) **ยังไม่แก้** จนกว่าจะ approve. D-1..D-6 รอตัดสิน.