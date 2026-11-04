---
id: CR-194 # renumbered from draft-public-person-data-retention
title: แยกนาฬิกา retention สองตัว — public search 3 เดือนหลังปิดศูนย์ (CR-183) · ข้อมูลส่วนบุคคลใน CouchDB 2 ปี
status: approved
date: 2026-10-25
requested_by: Dev Team B (2026-10-25) 「ทั้งเก็บ 3 เดือนและ retention 2 year」
decided_by: kong
decision_date: 2026-10-26
updated: 2026-10-26 # approved (kong)
layer: volatile # rule retention/PDPA; ไม่แตะ envelope/auth/sync priority/layer boundary
affects:
  - docs/data/data-model.md ตารางสรุปต้นไฟล์ (แถว Retention) · §7 Retention (แถว `medical`, `evacuee`/`household`, donor PII, edge server)
  - docs/data/schema.md §3.2 `config:app.retention_months_after_close` (คำอธิบาย "PDPA purge") · field ใหม่ `config:app.personal_data_retention_months` (D-2) · evacuee `anonymized` (สิ่งที่ purge job ล้าง/คงไว้, D-6)
  - docs/data/couchdb-mongodb-sync.md ตาราง "ตอนปิดศูนย์ / ครบ 3 เดือน" (หัวตาราง + แถว evacuee → tombstone)
  - docs/data/api-contract.md `POST /api/v1/shelters/{id}/close` · docs/sitemap.md `/admin/shelters/[code]` · docs/master-data/README.md แถว `retention_months_after_close` (คำว่า "retention 3 เดือน" / "retention หลังปิดเคส")
  - docs/features/pdpa-consent-block-spec.md — ต้นทางของ「[๒ ปี]」 อ้างอิง **ไม่แก้** (owner 2026-10-25)
  - docs/features/public-tier-flow-spec.html (bullet Retention เคาะ 2026-06-11)
  - docs/task-breakdown/01-core.md T-43 (RoPA / consent / retention) — DoD + cross-ref
  - frontend/src/lib/constants/i18n/public-policy.ts · public-term.ts (หัวข้อ retention "จนถึง 31 ธ.ค. 2569" → "2 ปีหลังปิดศูนย์พักพิง" ตาม FR-4 + FR-12a — **แก้ก่อน 31 ธ.ค. 2569 ไม่รอ approve**, FR-17)
  - docs/changes/11-famsearch/CR-183-closed-shelter-search-retention.md — อ้างอิง **ไม่แก้**; ผลต่อ CR-183 บันทึกที่ FR-18 ของ CR นี้
  - docs/changes/01-core/CR-017-dashboard-api-architecture.md — **ไม่แก้ตัวไฟล์**; การ supersede บางส่วนจาก CR-183 บันทึกที่ FR-16 ของ CR นี้แทน (owner 2026-10-25)
  - no schema_v bump — D-2 = field additive ใน `config:app`; D-6 = tombstone คง field เดิมของ `consent` (ไม่มี field ใหม่, ยังไม่มี tombstone จริง)
  - no PROJECTION_VERSION bump (public plane ไม่เปลี่ยน)
  - code: i18n หน้า policy/terms (P-8) ก่อน 31 ธ.ค. 2569 (FR-17) · CouchDB purge/anonymize job เป็นงาน T-43 · worker/src/worker/projectors/evacuee.py ข้าม `anonymized` (FR-5a, พร้อม T-43)
---

# CR-194 — ระยะเก็บข้อมูลส่วนบุคคล 2 ปี แยกจาก public search 3 เดือน

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** แยก retention เป็นสองนาฬิกา — (1) **public plane:** คนของศูนย์ปิดค้นเจอได้ `closed_at` + `retention_months_after_close` (default 3 เดือน) ตาม [CR-183](../11-famsearch/CR-183-closed-shelter-search-retention.md) **ไม่เปลี่ยน** · (2) **system of record (CouchDB):** ข้อมูลส่วนบุคคล (`evacuee`, `household`, `medical`) เก็บ **2 ปีหลัง `shelter.closed_at`** (D-1) แล้วจึง purge/anonymize (tombstone ที่คงหลักฐาน consent ไร้ PII, D-6) — ค่าอ่านจาก `config:app.personal_data_retention_months` (default `24`, D-2); `medical` 2 ปีเท่ากันแต่ purge ก่อน (D-3); donor PII ใน `donation` คง 3 เดือนหลังปิดศูนย์ (D-4)
> - **ทำไม:** data-model §7 บอก tombstone/purge CouchDB "ภายใน 3 เดือนหลังปิดศูนย์" ขัดกับข้อความ notice PDPA「[๒ ปี]」 — pdpa-consent-block-spec §10 บังคับให้ตรงกันก่อนเปิดแท็บ notice. หน้า privacy policy / terms ที่ใช้งานจริงระบุค่าที่สาม "จนถึง 31 ธ.ค. 2569" (P-8)
> - **ข้อควรระวัง:** 2 ปีเกินอายุโครงการ 12 เดือน → job purge CouchDB อาจไม่ถูกเรียกใช้จริงภายในโครงการ — PSU คงเป็น data controller จนครบนาฬิกาของศูนย์สุดท้าย, job + runbook อยู่ใน handover (T-44) (D-7; ต้องให้ DPO รับรอง)
> - **build:** ไม่มี code ใน CR นี้นอกจากข้อความ i18n หน้า policy/terms (P-8) → "2 ปีหลังปิดศูนย์พักพิง" ซึ่งต้องลง**ก่อน 31 ธ.ค. 2569** ไม่รอ approve (FR-17); job purge CouchDB ยังเป็น T-43 แต่ T-43 ต้องใช้นาฬิกา 2 ปีแทน 3 เดือน
> - **กระทบ:** data-model (ตารางสรุป + §7) · schema.md §3.2 (คำอธิบาย + field ใหม่ D-2) + evacuee `anonymized` (D-6) · couchdb-mongodb-sync · api-contract / sitemap / master-data README (คำอธิบาย) · public-tier-flow-spec · T-43 · pdpa spec และ CR-017 ไม่แก้
> - **สถานะ:** `approved` (kong, 2026-10-26) — **ยังไม่แก้เอกสารใด**; P-1..P-4, P-6, P-7, P-10..P-12 แก้ใน PR ตามหลัง approve; P-8 แก้ก่อน 31 ธ.ค. 2569 ไม่รอ approve แต่ต้องผ่าน owner (FR-17) · D-1..D-7 ตัดสินแล้ว (ตามที่เสนอ, Dev Team B 2026-10-25) — ค้าง: DPO รับรอง D-6 (`ref`) และ D-7 · owner/DPO ยืนยันจุดเริ่มนับในข้อความ notice (FR-12a) · DPO ตัดสินระยะของข้อมูลที่เก็บก่อน deploy FR-17 · T-43 รอ CR-183 merge (FR-4)

---

## ปัญหาปัจจุบัน (as-is, `develop` @ `826f787b3`)

> ทุกแถวคือข้อความบน `develop` @ `826f787b3` (เลขบรรทัด ณ commit นั้น) — **ยังไม่แก้**; แก้ตอน approve ตาม Acceptance ยกเว้น **P-8 แก้ก่อน 31 ธ.ค. 2569 ไม่รอ approve** (FR-17). **P-5 ไม่แก้** — pdpa spec เป็นต้นทางของกฎ (owner 2026-10-25: ไม่ควรแก้ spec นี้); open issue §10 ของ spec คงไว้ตามเดิม. **P-9 ไม่แก้ตัวไฟล์** — บันทึกที่ FR-16.

| # | สิ่งที่เขียนไว้ | ที่ |
| --- | --- | --- |
| P-1 | `medical` "purge ทันทีที่ครบ 3 เดือนหลัง `shelter.closed_at`" | `docs/data/data-model.md:230` |
| P-2 | `evacuee`, `household` "แทนที่ด้วย tombstone ไร้ PII … ภายใน 3 เดือนหลังปิดศูนย์" | `docs/data/data-model.md:231` |
| P-3 | donor PII ใน `donation` "ลบ name/phone ภายใน 3 เดือนหลังปิดศูนย์" · edge server wipe "ก่อนนาฬิกา 3 เดือนเริ่มนับที่ central" | `docs/data/data-model.md:233,235` |
| P-4 | `retention_months_after_close` อธิบายว่า "PDPA purge" — แต่ consumer ที่ CR-183 กำหนดคือ sync worker ลบ `public_persons`; อ่านแล้วเข้าใจว่าเป็นนาฬิกา purge CouchDB ด้วย | `docs/data/schema.md:1569` |
| P-5 | notice PDPA ใน prototype ระบุ「[๒ ปี]」 ขัดกับ data-model §7 — "ต้องทำให้ตรงกันก่อนเปิดใช้แท็บ notice" | `docs/features/pdpa-consent-block-spec.md:158` |
| P-6 | "ข้อมูลส่วนบุคคลถูกลบ/anonymize ภายใน **3 เดือนหลังปิดศูนย์**" (เคาะ 2026-06-11) | `docs/features/public-tier-flow-spec.html:84` |
| P-7 | T-43 DoD "Retention policy ต่อประเภทข้อมูลกำหนดชัด + กลไกลบ/anonymize อัตโนมัติ" อ้าง data-model §7 (3 เดือน) โดยปริยาย; ไม่มีการอ้าง 2 ปี | `docs/task-breakdown/01-core.md:115-126` |
| P-8 | นโยบายความเป็นส่วนตัวและข้อตกลงการใช้งานหน้า public (ใช้งานจริงแล้ว) ระบุ "เก็บข้อมูลไว้จนถึงวันที่ 31 ธันวาคม พ.ศ. 2569" ทั้งในย่อหน้าสรุปและหัวข้อ retention (TH/EN) — เป็นค่าที่สาม ไม่ตรงทั้ง 3 เดือน (§7) และ 2 ปี (notice); วันที่นี้ห่างจากวันที่ CR ≈ 2 เดือน | `frontend/src/lib/constants/i18n/public-policy.ts:7,43,65,101` · `public-term.ts:17,69` |
| P-9 | CR-017 Decision D แถว "ปิดศูนย์" ยังเขียน "ลบ `public_needs`, `public_shelters` ของศูนย์นั้น" และตาราง listener ยังเขียน "`registry` ตรวจจับเปิด/ปิดศูนย์ → เริ่ม/หยุด listener" · "`shelter_{shelter_code}` (ทุกศูนย์ที่เปิด)" — ขัดกับ CR-183 FR-1, FR-4, FR-7 (D-4). **ไม่แก้ตัวไฟล์** — บันทึกที่ FR-16 | `docs/changes/01-core/CR-017-dashboard-api-architecture.md:98,250-251` |
| P-10 | ตารางสรุปต้นไฟล์ แถว Retention "purge PII ≤3 เดือนหลังปิดศูนย์" | `docs/data/data-model.md:22` |
| P-11 | ตาราง retention ของ sync: หัว "ตอนปิดศูนย์ / ครบ 3 เดือน" และแถว `evacuee → tombstone` ผูก CouchDB `_purge` + tombstone กับการลบ `public_persons` เป็นจังหวะเดียว — สองนาฬิกาแยกกันแล้ว | `docs/data/couchdb-mongodb-sync.md:306-307` |
| P-12 | คำอธิบายนาฬิกาปิดศูนย์ว่า "เริ่มนาฬิกา retention 3 เดือน" / "retention หลังปิดเคส เดือน" — ไม่บอกว่าเป็นระยะ public plane เท่านั้น | `docs/data/api-contract.md:520` · `docs/sitemap.md:136` · `docs/master-data/README.md:462` |

**สถานะ code (`develop` @ `826f787b3`):** ไม่มี code ใดอ่านค่า retention 2 ปี (ไม่พบ `retention_years`, `days=730`, `24 months` ฯลฯ ใน `frontend/src`, `backend/apiapp`, `worker/src`). `retention_months_after_close` ถูกอ่านที่ `frontend/src/lib/features/shared/domain/app-config.ts:45` เท่านั้น; ตัวลบ `public_persons` ของศูนย์ปิดตาม CR-183 (sync worker) อยู่บน branch `feat/public-search-worker` ยังไม่ merge. ยังไม่มี job purge/anonymize ฝั่ง CouchDB (`evacuee.anonymized` มีแค่ type ที่ `frontend/src/lib/features/people/domain/people.ts:332` รอ job ใน T-43).

---

## Requirements

### นาฬิกา 1 — public plane (คงเดิม)

- **FR-1** — retention ของ `public_persons` และ projection อื่นของศูนย์ปิดเป็นไปตาม [CR-183](11-famsearch/CR-183-closed-shelter-search-retention.md) FR-1..FR-6 ทุกข้อ — CR นี้ไม่เปลี่ยนค่า default, จุดเริ่มนาฬิกา, หรือพฤติกรรม worker. CR-183 (Why, D-1) อ้าง data-model §7 "3 เดือน" เป็นเหตุผลของระยะ public plane — เมื่อ CR นี้ approve ระยะ 3 เดือนของ public plane คงอยู่ในฐานะการตัดสินใจของ CR-183 เอง ไม่ผูกกับระยะเก็บใน CouchDB.
- **FR-2** — `config:app.retention_months_after_close` ต้องมีความหมายเดียว: ระยะที่คนของศูนย์ปิดยังค้นเจอบน public plane (public search + partner `/external/v1/occupants`). ห้ามใช้ค่านี้เป็นนาฬิกา purge CouchDB.
- **FR-3** — คำอธิบาย `retention_months_after_close` ใน schema.md §3.2 ต้องเปลี่ยนจาก "PDPA purge" เป็น "public plane retention (`public_persons`) ของศูนย์ปิด — ไม่ใช่ระยะเก็บข้อมูลใน CouchDB" (ไม่เปลี่ยนชนิด/default). คำอธิบายเดียวกันใช้ที่ P-12.

### นาฬิกา 2 — system of record (CouchDB)

- **FR-4** — ข้อมูลส่วนบุคคลใน CouchDB ที่เก็บผ่านการลงทะเบียน (`evacuee`, `household`, `medical`) ต้องถูกเก็บได้ไม่เกิน **`shelter.closed_at` + `personal_data_retention_months` เดือน** (default `24` = 2 ปี; D-1, D-2) แล้วจึง purge/anonymize — ตรงกับข้อความ notice「[๒ ปี]」. ศูนย์ที่ `closed_at = null` ไม่มีนาฬิกา (เหมือน CR-183 D-5). **Dependency:** stamp rule + backfill ของ `closed_at` มากับงาน implement CR-183 (ยังไม่ merge) — job purge ของ T-43 ห้ามเปิดใช้ก่อน CR-183 merge และรัน backfill แล้ว; ไม่เช่นนั้นศูนย์ legacy จะมี `closed_at = null` และไม่มีนาฬิกา.
- **FR-5** — เมื่อครบนาฬิกา FR-4: `household` → แทนที่ด้วย tombstone ไร้ PII `{type, anonymized: true}` ตามรูปแบบเดิมใน data-model §7. `evacuee` → tombstone `{type, anonymized: true, consent}` โดย `consent` คงเฉพาะ `mode`, `health`, `ref`, `given_at`, `given_by`, `channel`, `notice_version` และลบ `giver_evacuee_id`, `recorded_verbally_by` (D-6); evacuee ที่ไม่มี `consent` → `{type, anonymized: true}`.
- **FR-5a** — projector evacuee (`worker/src/worker/projectors/evacuee.py` `project_evacuee`) ต้องถือว่า `anonymized = true` เป็น "delete" เหมือน `privacy.search_excluded = true` — tombstone ตาม FR-5 ไม่มี `privacy` จึงจะถูก upsert เป็นคนไร้ชื่อใน `public_persons` เมื่อ DB ของศูนย์ถูก rescan: เปิดศูนย์ใหม่ (CR-183 FR-9, #645) หรือ bootstrap. ทำพร้อม job ของ T-43 และต้องลงก่อนเปิดใช้ job; ไม่ bump `PROJECTION_VERSION` (shape ไม่เปลี่ยน). ต้องมี test: rescan DB ที่มี tombstone → ไม่มีแถวใน `public_persons`.
- **FR-6** — `medical` → purge เมื่อครบนาฬิกา FR-4 (D-3 — ระยะเท่าข้อความ notice) และ purge **ก่อน** `evacuee`/`household` ในลำดับของ job ตาม §7 เดิม.
- **FR-7** — donor PII ใน `donation` (name/phone) → ลบภายใน 3 เดือนหลังปิดศูนย์ตาม §7 เดิม (D-4 — อยู่นอกบล็อก consent ของการลงทะเบียน).
- **FR-8** — `movement`, `screening`, ledger, audit คงนโยบายเดิม (เก็บต่อจนจบโครงการ, อ้าง ULID เท่านั้น).
- **FR-9** — edge server wipe ยังเป็นขั้นตอนปิดศูนย์ (ไม่รอ 2 ปี) — edge ไม่ใช่ SoR; ข้อความ "ก่อนนาฬิกา 3 เดือนเริ่มนับที่ central" ต้องเปลี่ยนให้อ้างนาฬิกา FR-4.
- **FR-10** — ระยะ 2 ปีอ่านจากแหล่งเดียว: `config:app.personal_data_retention_months` (int 1–24, default `24`; อ่านไม่ได้/ค่าผิด/เกิน 24 → `24`) ใน schema.md §3.2 (D-2) — ห้าม hard-code ซ้ำหลายจุด. ขอบบน 24 = ระยะที่แจ้งใน notice — ค่าใน config ต้องไม่ทำให้เก็บนานกว่าที่แจ้งเจ้าของข้อมูล. field นี้**ไม่อยู่**ใน public allow-list `PUBLIC_APP_CONFIG_FIELDS` และไม่อยู่ใน `PUT /api/v1/app-config` (`AppConfigPatchKey`) — แก้ได้เฉพาะ admin ที่ระดับ doc. เอกสาร/ข้อความที่แสดงผู้ใช้ระบุ "2 ปี" ตาม default; เปลี่ยนค่า = ต้องแก้ notice และ policy ด้วย (CR ใหม่).

### ความสอดคล้องของเอกสาร

- **FR-11** — data-model ตารางสรุปต้นไฟล์ (P-10) และ §7 ตารางแรกต้องระบุ "CouchDB (SoR) — 2 ปี" แยกจากระยะ public plane. ส่วน "Public plane (MongoDB) ของศูนย์ปิด" ที่ CR-183 เพิ่ม (ยังไม่อยู่บน `develop` @ `826f787b3` — มากับงาน implement CR-183) ไม่แก้ ยกเว้นวลี "เกินนโยบาย §7" ใน bullet `closed_at = null` ให้เปลี่ยนเป็น "เกินระยะ public plane ของ CR-183". couchdb-mongodb-sync (P-11) ต้องแยกแถว CouchDB purge (นาฬิกา FR-4) ออกจากการลบ `public_persons` (นาฬิกา CR-183).
- **FR-12** — ข้อความ notice PDPA (pdpa-consent-block-spec) ระบุ「[๒ ปี]」อยู่แล้ว — CR นี้ทำให้ data-model §7 ตรงกับ notice โดย**ไม่แก้** pdpa spec. ถ้า notice กล่าวถึงการค้นหาญาติ ต้องระบุว่าค้นเจอได้ถึง `retention_months_after_close` เดือนหลังปิดศูนย์. ถ้าข้อความ consent ที่แสดงตอนยินยอมเปลี่ยน ต้องเปลี่ยน `consent.notice_version` ด้วย (pdpa spec §4, D11) เพื่อแยกคนที่ยินยอมภายใต้ข้อความเดิม. การแก้หน้า privacy policy / terms (P-8) **ไม่เปลี่ยน** `consent.notice_version` — `notice_version` คือเวอร์ชันข้อความบล็อก consent (pdpa spec §4); การแก้ P-8 ทำให้หน้า policy ตรงกับข้อความที่ผู้ยินยอมเห็น ไม่ได้เปลี่ยนข้อความนั้น.
- **FR-12a** — ข้อความที่บอกระยะเก็บต้องระบุจุดเริ่มนับตาม D-1 ("2 ปีหลังปิดศูนย์พักพิง") ทั้งหน้า policy / terms (P-8) และ notice ของบล็อก consent — นับจากวันปิดศูนย์ทำให้คนที่ยินยอมตอนศูนย์เพิ่งเปิดถูกเก็บนานกว่า 2 ปีนับจากวันยินยอม. notice ใน prototype ระบุเพียง「[๒ ปี]」(วงเล็บอาจเป็น placeholder) ไม่บอกจุดเริ่ม → **ค้าง:** owner/DPO ยืนยันข้อความ notice. ถ้าต้องเติมจุดเริ่มนับ → แก้ข้อความ i18n ของบล็อก consent และเปลี่ยน `consent.notice_version` (FR-12) — ไม่แก้ตัว pdpa spec.
- **FR-13** — public-tier-flow-spec bullet Retention ต้องแก้เป็นสองนาฬิกา (public 3 เดือน / ข้อมูลส่วนบุคคล 2 ปี) และอ้าง CR นี้.
- **FR-14** — T-43 DoD ต้องระบุว่า job purge/anonymize CouchDB ใช้นาฬิกา FR-4 (2 ปี) และ RoPA ต้องระบุทั้งสองระยะ + PSU เป็น data controller และผู้รับผิดชอบ job จนครบนาฬิกา FR-4 ของศูนย์สุดท้าย (D-7); job + runbook การรันอยู่ใน handover package (T-44). ขอบเขต T-43 อื่นไม่เปลี่ยน (D-5).
- **FR-15** — 2 ปีเป็นระยะ**สูงสุด**. การถอนความยินยอมหรือคำขอลบตามสิทธิเจ้าของข้อมูลทำให้ลบได้ก่อนครบ — กลไกเป็นของงานถอนความยินยอม (อยู่นอกขอบเขต pdpa spec §1) ไม่ใช่ของ CR นี้.
- **FR-16** — CR-017 ถูก supersede บางส่วนโดย [CR-183](11-famsearch/CR-183-closed-shelter-search-retention.md) (CR-183 `affects:` + Impact + D-4 ระบุให้อัปเดต CR-017 ตอน implement). บันทึกไว้ที่นี่แทนการแก้ไฟล์ CR-017:
  - Decision D แถว "ปิดศูนย์" — แทน "ลบ `public_needs`, `public_shelters` ของศูนย์นั้น" ด้วย: ปิดศูนย์ → ลบ `public_needs`, `shelter_stocks`, `shelter_occupants` (พร้อม `_retention_audit`); **คง** `public_shelters` (`status = closed`) และ `public_persons` ไว้จนครบ `closed_at` + `retention_months_after_close` (CR-183 FR-1..FR-4).
  - ตาราง listener แถว `registry` — ยังตรวจจับเปิด/ปิดศูนย์ แต่ศูนย์ปิด**ไม่หยุด** listener ทันที: ฟังต่อจนครบ `closed_at` + `retention_months_after_close` (CR-183 D-4).
  - ตาราง listener แถว `shelter_{shelter_code}` — ขอบเขตเปลี่ยนจาก "ทุกศูนย์ที่เปิด" เป็น "ทุกศูนย์ที่เปิด + ศูนย์ปิดที่ยังอยู่ในระยะ retention หรือ `closed_at = null`" โดยศูนย์ปิด project เฉพาะ `public_persons` (CR-183 FR-7, FR-10).
- **FR-17** — หน้า privacy policy / terms (P-8) ต้องเปลี่ยนระยะเก็บจาก "จนถึงวันที่ 31 ธันวาคม พ.ศ. 2569" เป็น **"2 ปีหลังปิดศูนย์พักพิง"** (TH) / "2 years after the shelter closes" (EN) ทั้งย่อหน้าสรุปและหัวข้อ retention **ก่อน 31 ธ.ค. 2569** — ไม่รอ CR นี้ approve เพราะข้อความปัจจุบันประกาศว่าจะลบข้อมูลภายในวันนั้น ซึ่งระบบไม่ได้ทำ (ไม่มี job purge). แต่ข้อความต้องผ่าน owner ก่อน merge PR แยกนั้น — ระยะเก็บอยู่นอกขอบเขตที่ pdpa-consent-block-spec อนุมัติ (§1; D11 ครอบเฉพาะการ์ด「ความยินยอมของท่าน」 ไม่รวมแท็บ notice ที่มี「[๒ ปี]」). แก้ใน PR แยก (code i18n); ไม่เปลี่ยน `consent.notice_version` (FR-12); บันทึกวันที่ deploy ไว้ใน Decision log.
  - ข้อมูลที่เก็บก่อนวัน deploy (หน้า policy แจ้ง "จนถึง 31 ธ.ค. 2569") ใช้แนวเดียวกับ backfill ของ pdpa spec (§10, FR-50): **ไม่ตัดสินใน CR นี้** — แยกได้ด้วย `consent.given_by = backfill` หรือ `consent.given_at` < วัน deploy (`notice_version` แยกไม่ได้ เพราะผูกกับข้อความบล็อก consent ไม่ใช่หน้า policy) — ให้ DPO ตัดสินภายหลังว่าจะใช้ระยะใหม่ แจ้งเจ้าของข้อมูล หรือขอยินยอมใหม่.
- **FR-18** — ผลต่อ [CR-183](11-famsearch/CR-183-closed-shelter-search-retention.md) — บันทึกที่นี่ **ไม่แก้ไฟล์ CR-183** (แนวเดียวกับ FR-16/CR-017):
  - `retention_months_after_close` (3 เดือน) ของ CR-183 D-1 / FR-2 = ระยะ public plane เท่านั้น; CouchDB ใช้นาฬิกา FR-4. CR-183 Why ที่อ้าง data-model §7 "3 เดือน" อ่านตาม FR-1 ของ CR นี้.
  - CR-183 FR-9 (rescan ตอนเปิดใหม่, #645) — ต้องไม่ publish evacuee tombstone (FR-5a). Acceptance #645 "ปิด → เปิดใหม่ → ค้นคนเดิมเจอครบ" ใช้ได้ถึงก่อนครบนาฬิกา FR-4; หลังจากนั้นคนที่ถูก tombstone แล้วต้องไม่ปรากฏ.
  - CR-183 Impact แถว CouchDB ("ไม่มี purge job … T-43") — job ของ T-43 ใช้นาฬิกา FR-4 (2 ปี).
  - CR-183 Impact แถว D-5 และ D-5 "เกิน §7" อ่านเป็น "เกินระยะ public plane (FR-2)".

---

## Acceptance (สำหรับการแก้ spec ตอน approve)

- data-model (ตารางสรุป + §7), schema.md §3.2, couchdb-mongodb-sync, api-contract, sitemap, master-data README, public-tier-flow-spec, หน้า privacy policy / terms และ T-43 ไม่มีข้อความใดบอกว่า CouchDB purge/tombstone "ภายใน 3 เดือนหลังปิดศูนย์" หรือเรียกนาฬิกา public plane ว่า "retention" เฉย ๆ (P-1..P-4, P-6..P-8, P-10..P-12).
- `retention_months_after_close` ทุกที่ที่กล่าวถึง อธิบายว่าเป็น public plane retention เท่านั้น.
- ทุกเอกสารที่กล่าวถึง 2 ปี ระบุจุดเริ่ม `shelter.closed_at` (D-1) และแหล่งค่า `config:app.personal_data_retention_months` (D-2).
- หน้า policy / terms (P-8) ระบุ "2 ปีหลังปิดศูนย์พักพิง" (FR-12a) และลงก่อน 31 ธ.ค. 2569 หลัง owner อนุมัติข้อความ; Decision log มีวันที่ deploy (FR-17); notice ของบล็อก consent ผ่านการยืนยันของ owner/DPO ตาม FR-12a.
- schema.md §3.2 มีแถว `personal_data_retention_months` (int 1–24, default `24`, ไม่อยู่ใน public allow-list / `PUT /api/v1/app-config`) และคำอธิบาย evacuee `anonymized` ระบุ field ของ `consent` ที่ tombstone คงไว้ตาม FR-5.
- pdpa-consent-block-spec, CR-017 และ CR-183 ไม่มี diff (P-5, P-9, FR-18).
- FastAPI ไม่มี diff จาก CR นี้; worker มี diff เฉพาะ FR-5a (พร้อม T-43); frontend มี diff เฉพาะข้อความ i18n ของ P-8 (นอกจาก T-43 ภายหลัง).
- rescan DB ของศูนย์ที่มี evacuee tombstone (เปิดศูนย์ใหม่ / bootstrap) → ไม่มีแถวของ tombstone ใน `public_persons` (FR-5a).

---

## Decisions

> ทุกข้อ ✅ ตัดสินตามที่เสนอ (เสนอโดย Dev Team B 2026-10-25 · approve โดย kong 2026-10-26 — ดู Decision log). ทางเลือกที่ไม่เลือกคงไว้เป็นบันทึก.

- **D-1 — จุดเริ่มนาฬิกา 2 ปี** — ✅ `shelter.closed_at`.
  - **เลือก:** `shelter.closed_at` — นาฬิกาเดียวกับ CR-183 (stamp rule + backfill มากับงาน implement CR-183 — ยังไม่อยู่บน `develop` @ `826f787b3`: schema.md:1548 ยังเป็น `—`, ไม่มี script `migrate:shelter-closed-at`), job คำนวณต่อศูนย์ได้ทั้ง DB, สอดคล้อง §7 เดิมที่นับหลังปิดศูนย์. ข้อเสีย: ศูนย์ที่เปิดนานทำให้ข้อมูลคนที่ออกไปแล้วถูกเก็บนานกว่า 2 ปีนับจากวันที่ออก; ศูนย์ `closed_at = null` ไม่มีนาฬิกา (เหมือน CR-183 D-5).
  - ทางเลือก A: check-out ของผู้อพยพ (`current_stay.since` เมื่อ status เป็น `checked_out`/`transferred`/`deceased`) — ตรงหลัก minimisation ต่อคนมากที่สุด แต่ต้องจัดการคนที่ย้ายศูนย์ (`transfer_out` → `transfer_in`) และคนที่ไม่เคย check-out ก่อนศูนย์ปิด; job ต้องสแกนราย evacuee.
  - ทางเลือก B: วันลงทะเบียน (`consent.given_at` / created) — ง่ายและตรงกับวันที่เจ้าของข้อมูลเห็น notice แต่ผู้อพยพที่ยังอยู่ศูนย์เกิน 2 ปีจะถูก anonymize ระหว่างยังพักอยู่. ข้อควรระวัง: evacuee เดิมที่ได้ `consent` จาก backfill มี `given_at` = เวลารัน script (pdpa spec FR-50) ไม่ใช่วันลงทะเบียนจริง จึงต้องใช้ `created_at` แทนสำหรับ `given_by = backfill`.
  - ทางเลือก C: `max(closed_at, check-out)` — ปลอดภัยต่อการใช้งาน แต่ซับซ้อนที่สุด.
- **D-2 — แหล่งค่า 2 ปี** — ✅ config field `config:app.personal_data_retention_months` (int, default `24`), ไม่อยู่ใน public allow-list.
  - **เลือก:** config field ใหม่ใน `config:app` `personal_data_retention_months` (int, default `24`) — เปลี่ยนได้โดยไม่ deploy และสมมาตรกับ `retention_months_after_close`. เป็นการเพิ่ม field ใน schema.md §3.2 (เข้าข่าย change-management §2 — ครอบโดย CR นี้เมื่อ approve; additive, ไม่ bump `schema_v`). ไม่อยู่ใน public allow-list `PUBLIC_APP_CONFIG_FIELDS`.
  - ทางเลือก: constant ใน code ของ job T-43 — ไม่แตะ schema แต่ค่าใน notice กับ code ผูกกันด้วยมือ และเปลี่ยนต้อง deploy + CR ใหม่.
- **D-3 — `medical` ใช้นาฬิกาสั้นกว่าหรือไม่** — ✅ ไม่ — 2 ปีเท่าข้อมูลอื่น, purge ก่อน.
  - **เลือก:** 2 ปีเท่าข้อมูลอื่น (ระยะเดียวกับข้อความ notice「[๒ ปี]」 ซึ่งไม่แยกระยะของข้อมูลสุขภาพ) — ยังคง purge ก่อนในลำดับของ job (FR-6).
  - ทางเลือก: ระยะสั้นกว่า — `closed_at` + 3 เดือน (ค่าเดิมของ §7) เพราะเป็น sensitive data (PDPA ม.26).
- **D-4 — donor PII ใน `donation` อยู่ในขอบเขต 2 ปีหรือไม่** — ✅ ไม่ — คง 3 เดือนหลังปิดศูนย์.
  - **เลือก:** ไม่ — คง 3 เดือนหลังปิดศูนย์ตาม §7. notice「[๒ ปี]」อยู่ในบล็อก consent ของการลงทะเบียนผู้อพยพ ไม่ใช่ผู้บริจาค; การเปลี่ยนต้องดูข้อความ consent ของ donor (T-43).
  - ทางเลือก: ใช้ 2 ปีเท่ากันทุก PII.
- **D-5 — ขอบเขต T-43** — ✅ เปลี่ยนเฉพาะพารามิเตอร์.
  - **เลือก:** CR นี้ **เปลี่ยนเฉพาะพารามิเตอร์** ของ T-43 (ระยะ 2 ปี + จุดเริ่มตาม D-1 + แหล่งค่าตาม D-2) — ไม่เพิ่ม/ลด deliverable, ไม่เปลี่ยน effort/deadline. job purge CouchDB ยังเป็นงาน T-43 ตามเดิม.
  - ทางเลือก: แยก job purge CouchDB ออกเป็น task ใหม่ (เปลี่ยน scope task-breakdown — ต้องตัดสินแยก).
- **D-6 — หลักฐานความยินยอมหลัง tombstone** — ✅ tombstone ของ `evacuee` คง field ที่ไม่ระบุตัวบุคคลของ `consent` (FR-5). tombstone รูปเดิม (`{type, anonymized: true}`) ลบ `evacuee.consent` ทั้ง object ไปด้วย ทำให้พิสูจน์ไม่ได้ว่าเคยยินยอมอะไรภายใต้ข้อความเวอร์ชันไหน.
  - **เลือก:** tombstone คง field ที่ไม่ระบุตัวบุคคลของ `consent` ไว้ — `mode`, `health`, `ref`, `given_at`, `given_by`, `channel`, `notice_version` — และลบ `giver_evacuee_id`, `recorded_verbally_by` (ชี้ไปยังบุคคล). ไม่ bump `evacuee` `schema_v`: ไม่มี field ใหม่ (ทุก field มีอยู่แล้วใน `consent`, schema_v 15) — เปลี่ยนเฉพาะกฎว่า purge job ล้างอะไร และยังไม่มี tombstone จริงให้แปลง (ดู Migration). **ค้าง:** DPO ยืนยันว่า `ref` ยังจำเป็นหลังลบ PII — ถ้าไม่จำเป็น ตัด `ref` ออกจากรายการที่คงไว้ก่อน T-43 implement.
  - ทางเลือก: tombstone ตามรูปแบบเดิมทั้งหมด (ไม่เหลือหลักฐาน consent ใน CouchDB) — ไม่เปลี่ยนรูป doc.
- **D-7 — ผู้รับผิดชอบ job purge และ data controller หลังจบโครงการ** — ✅ PSU คงเป็น controller จนครบนาฬิกา. นาฬิกา 2 ปีเกินอายุโครงการ 12 เดือน — job purge CouchDB (T-43) อาจไม่ถูกเรียกจริงภายในโครงการ.
  - **เลือก:** PSU (data controller ตาม public-tier-flow-spec) คงเป็น controller จนครบนาฬิกา FR-4 ของศูนย์สุดท้าย; job + runbook การรันอยู่ใน handover package (T-44) และ RoPA ระบุผู้รับผิดชอบ. **ค้าง:** DPO รับรอง.
  - ทางเลือก: โอน controller ให้หน่วยงานรับมอบระบบตอน handover (ต้องมีข้อตกลงโอน/แบ่งปันข้อมูล และ notice ต้องระบุ).

---

## Impact

| ด้าน | ผลกระทบ |
| --- | --- |
| Privacy / PDPA | PII ใน CouchDB อยู่นานขึ้น (≈3 เดือน → 2 ปี) — RoPA และ notice ต้องระบุ 2 ปีและวัตถุประสงค์ที่เก็บต่อ; DPO ของโครงการต้องรับรอง |
| Public plane | ไม่เปลี่ยน — ยังลบ `public_persons` ตาม CR-183; ระยะ public search (3 เดือน) < ระยะเก็บ SoR (2 ปี) |
| Sync worker | projector evacuee ข้าม `anonymized = true` (FR-5a, งาน T-43). ปกติ tombstone (2 ปี) ไม่ถูก project เพราะ listener หยุดฟังศูนย์ปิดหลัง 3 เดือน (CR-183 FR-7/FR-8) — แต่เปิดศูนย์ใหม่ทำให้ rescan ทั้ง DB (CR-183 FR-9, #645) จึงต้องมี FR-5a |
| Edge server | ไม่เปลี่ยน — wipe ตอนปิดศูนย์ (FR-9) |
| Storage | CouchDB เก็บ `evacuee`/`household`/`medical` ของศูนย์ปิดนานขึ้น — ปริมาณไม่กระทบ capacity ระดับโครงการ |
| Public policy / terms | ข้อความ retention เปลี่ยนจาก "จนถึง 31 ธ.ค. 2569" เป็น "2 ปีหลังปิดศูนย์พักพิง" (P-8, FR-12a) — ไม่เปลี่ยน `consent.notice_version` (FR-12); notice ของบล็อก consent อาจต้องเติมจุดเริ่มนับ + เปลี่ยน `notice_version` ตามผลยืนยันใน FR-12a |
| T-43 | พารามิเตอร์ retention เปลี่ยน (D-5); job purge รอ CR-183 merge + backfill `closed_at` (FR-4); ระยะ 2 ปีเกินอายุโครงการ 12 เดือน → job อาจไม่ถูกเรียกใช้จริงภายในโครงการ แต่ยังต้อง test ได้ตาม DoD และส่งต่อใน handover (T-44) — ผู้รับผิดชอบตาม D-7 |
| pdpa-consent-block | ไม่แก้ spec — เป็นต้นทางของ「[๒ ปี]」. เมื่อ data-model §7 ตรงกับ notice แล้ว เงื่อนไขของ open issue §10 ("ต้องทำให้ตรงกันก่อนเปิดใช้แท็บ notice") ครบ; การปิด open issue ในตัว spec เป็นของ owner (track ด้วย decision sync note ตาม D13 ของ spec). ตัวบล็อก consent (C1–C5, `evacuee.consent`) ทำได้ก่อนโดยไม่รอ CR นี้ |

## Migration

- **CouchDB:** ไม่ bump `schema_v`. `config:app.personal_data_retention_months` (D-2) additive — ไม่มีค่า = ใช้ default `24`, ไม่ต้อง backfill. tombstone ของ `evacuee` ที่คง `consent` (D-6) ใช้ field ที่มีอยู่แล้ว — ยังไม่มี tombstone จริง จึงไม่มีข้อมูลเดิมต้องแปลง.
- **Mongo:** ไม่มี — ไม่ bump `PROJECTION_VERSION`.
- **Code:** ไม่มี code ที่อ่านค่า 2 ปีอยู่ (ดู as-is); ไม่มี job purge CouchDB ที่ต้องเปลี่ยน (ยังไม่ถูกสร้าง). projector evacuee ข้าม `anonymized` (FR-5a) ลงพร้อม job ของ T-43. แก้ข้อความ i18n หน้า policy/terms (P-8) เป็น "2 ปีหลังปิดศูนย์พักพิง" **ก่อน 31 ธ.ค. 2569** ใน PR แยก ไม่รอ approve แต่ต้องผ่าน owner (FR-17); ข้อความ i18n ของบล็อก consent + `notice_version` แก้เฉพาะถ้าผลยืนยันใน FR-12a บอกให้เติมจุดเริ่มนับ.
- **ข้อมูลเดิม:** ยังไม่มี doc ใดถูก tombstone ตามกฎ 3 เดือนเดิม (ไม่มี job) — ไม่มีอะไรต้องฟื้น.
- **เอกสาร:** ยังไม่แก้. ตอน approve: แก้ P-1..P-4, P-6, P-7, P-10..P-12 ตาม FR-3, FR-5, FR-9, FR-11, FR-13, FR-14 + เพิ่มแถว `personal_data_retention_months` ใน schema.md §3.2 (FR-10) และแก้คำอธิบาย evacuee `anonymized` (FR-5) + อัปเดต `updated:` ของแต่ละไฟล์; pdpa-consent-block-spec (P-5) และ CR-017 (P-9) ไม่แก้.

## Decision log

- 2026-10-25 — **proposed** จากคำขอของ Dev Team B:「ทั้งเก็บ 3 เดือนและ retention 2 year」— ตีความ: 3 เดือน = public search ของศูนย์ปิด (CR-183, ไม่เปลี่ยน) · 2 ปี = ระยะเก็บข้อมูลส่วนบุคคลใน CouchDB. owner ระบุว่ายังไม่ต้อง approve. เอกสารที่ขัดกัน **ยังไม่แก้** จนกว่าจะ approve. D-1..D-6 รอตัดสิน.
- 2026-10-25 — owner: 「ยึด pdpa-consent-block-spec เป็นหลัก」 (ระยะ 2 ปีตาม notice) · ไม่แก้ pdpa-consent-block-spec (P-5) · ไม่แก้ไฟล์ CR-017 — บันทึกการ supersede ที่ FR-16. ไม่เปลี่ยนสถานะ: เอกสาร P-* ยังแก้ตอน approve.
- 2026-10-25 — แก้ตาม review PR #866: สถานะเอกสารเป็น "ยังไม่แก้" ทุกจุด · `status: proposed` · as-is อ้าง `develop` @ `826f787b3` · เพิ่ม P-10..P-12 + บรรทัด P-8 · FR-4 ขึ้นกับ D-1 · Migration ขึ้นกับ D-6 · FR-12 ระบุผลของ P-8 ต่อ `notice_version` · เพิ่ม D-7 (ผู้รับผิดชอบหลังจบโครงการ). ยังไม่มี open decision ใดถูกตัดสิน.
- 2026-10-25 — Dev Team B (แชต):「Open Decision เอาตามที่เสนอ」(ตอบ comment PR #866) → D-1..D-7 ✅ ตามที่เสนอ; field ชื่อ `personal_data_retention_months`, ไม่อยู่ใน public allow-list. FR-4..FR-7, FR-10, FR-14, Acceptance, Migration อัปเดตตาม. D-6 ไม่ bump `schema_v` (ไม่มี field ใหม่). ค้าง DPO: `ref` ใน tombstone (D-6) และการรับรอง D-7. สถานะยัง `proposed` (ยังไม่ approve).
- 2026-10-25 — Dev Team B (แชต):「แก้ warning ปรับเป็น 2 ปี」(ตอบ review รอบ 3 PR #866) → เพิ่ม FR-17: หน้า policy / terms (P-8) เปลี่ยนเป็น "2 ปีหลังปิดศูนย์พักพิง" ก่อน 31 ธ.ค. 2569 ใน PR แยก ไม่รอ approve.
- 2026-10-26 — **approved** โดย kong → รันเลข CR-194 (หมวด 01-core เพราะผูกกับ T-43). D-1..D-7 มีผลตามที่เสนอ. ยังค้าง: DPO รับรอง D-6 (`ref`) และ D-7 · owner/DPO ยืนยันจุดเริ่มนับใน notice (FR-12a). เอกสาร P-1..P-4, P-6, P-7, P-10..P-12 แก้ใน PR ตามหลัง; P-8 ตาม FR-17.
