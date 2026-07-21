---
title: "Task Breakdown — Family Search"
status: active
created: 2026-06-05
updated: 2026-07-16
module: famsearch
note: decision-synced 2026-06-15 — task details and DoD maintained directly in Markdown; CR-005 (§E, 2026-06-22) ขยาย exposure surface ของ /search — ดู T-41
---

# Family Search

> consent/opt-out (FD-12), privacy-preserving public search + anti-enumeration

- **Team owner:** Team B — พีค, โฮป, ปิ๊ก (Family Search; ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** R4
- **Design input (บริษัท):** P-03 (Family Search ส่งล่วงหน้า; EOC/Open API ตาม deferred)
- **Target ส่งมอบ:** ภายในสิงหาคม 2026

## Features / Tasks

| ID | Status | Feature / Task | FR | Phase | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-40 | ⬜ | Search consent / opt-out | FR-52 | R4 | prod | ส.ค. | 4 | ÷1.6 | 2.5 | T-04 |
| T-41 | ⬜ | Privacy-preserving public family search (`/search`) + anti-enumeration — **scope ขยายตาม CR-005 §E** | FR-53 | R4 | prod | ส.ค. | 9 | ÷1.4 | 6.5 | T-40,P-03 |
|  |  | **รวมทั้งโมดูล** |  |  |  |  | **13** |  | **9** |  |

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง
> Feature นี้เป็น **core public feature ใน scope ส.ค.** (ตอบ pain point หลักใน source proposal: "ญาติพี่น้องไม่สามารถค้นหาได้ว่าสมาชิกครอบครัวอยู่ที่ศูนย์ใด") — เปิด public = PII exposure จริง จึงผูกกับ T-43 RoPA/retention (minimal) ก่อน go-live

### T-40 — Search consent / opt-out (FR-52, FD-12)

**Description:** เก็บ consent ของผู้พักพิงว่ายินยอมให้ปรากฏในผลค้นหาสาธารณะหรือไม่ ตั้งแต่ขั้นลงทะเบียน โดยใช้ **opt-out policy** ที่ปิด K-15 แล้ว: default `privacy.search_excluded=false` และเปลี่ยนใจ opt-out ได้ทุกเมื่อ — กลุ่มเสี่ยง (เช่น ผู้หนีภัยความรุนแรงในครอบครัว) ต้องถูกซ่อนจากการค้นหาได้จริง

**Definition of Done:**
- บันทึก consent ต่อบุคคลตอนลงทะเบียนด้วย default `privacy.search_excluded=false` + แก้ภายหลังได้ (โดยเจ้าตัวผ่านเจ้าหน้าที่) พร้อมประวัติการเปลี่ยน
- Opt-out มีผลทันทีกับ T-41 — record หายจากผลค้นหา (test ยืนยัน ไม่มี cache ค้าง)
- ถ้อยคำขอ consent ตรงตาม FD-12 / ที่ DPIA (P-03) กำหนด และสื่อสารชัดว่าเป็น opt-out
- Audit การเปลี่ยน consent ครบ + demo opt-out แล้วค้นไม่เจอ

### T-41 — Privacy-preserving public family search (`/search`) + anti-enumeration (FR-53)

**Description:** หน้าเว็บสาธารณะ `/search` ("สืบค้นญาติ" / Restoring Family Links, FAM tier) ให้ญาติค้นหาผู้ประสบภัย (ไม่ต้อง login) เพื่อยืนยันว่า "ปลอดภัยและอยู่ศูนย์ใด". **CR-005 §E (2026-06-22) ขยาย exposure surface เกินร่างเดิม** — เพิ่มช่องทางค้นด้วย identifier และคืน field set masked ชุดเต็ม ตาม spec `docs/features/public-tier-find-spec.html`; ต้อง reflect กลับใน `public-tier-flow-spec §FAM`. คงกลไก anti-enumeration ทุกข้อ

**Definition of Done:**
- **ช่องทางค้น (FS-1, CR-005):** เลขบัตรประชาชน 13 หลัก (**exact-only**) / passport (exact) / เบอร์โทร (exact) / ชื่อ-สกุล (token ≥3 ตัว, max 10 ผล) — identifier ห้ามรับ partial เพื่อกัน enumeration
- **Field ที่คืน (FS-2, CR-005 — masked ทุกตัว):** เลขบัตร mask 3หน้า+3ท้าย, เพศ, ชื่อศูนย์, ภูมิลำเนาเดิม mask (เลขที่บ้าน), เวลาลงทะเบียน, โซนความดูแล, สถานะความปลอดภัย (in_shelter/moved/checked_out) — **ห้ามคืนเด็ดขาด:** เบอร์โทรเต็ม, เลขบัตรเต็ม, medical detail, internal id (ดู T-01 redaction)
- **กติกา mask ชื่อ (FS-3, CR-005):** ชื่อจริงเต็ม + นามสกุล mask (FAM grapheme rule เดิม) — ให้ญาติยืนยันตัวบุคคลได้
- เฉพาะคนที่ consent (T-40) เท่านั้นที่ปรากฏ; opt-out `search_excluded` ซ่อนทั้ง record ครอบทุกช่องทางค้น (รวม identifier); ไม่พบ กับ ไม่ยินยอม ต้องแยกไม่ออกจากภายนอก
- Anti-enumeration: rate-limit ต่อ IP/session, CAPTCHA/PoW ใน production public, identifier exact-only, ไม่มี endpoint ไล่ดึงรายชื่อ (test เชิง adversarial ครบ)
- **ไม่มี demo/จำลอง (FS-4 REJECTED, CR-005):** ทุกการค้นยิง `POST /public/v1/family-search` จริง + เขียน audit ทุก query (ไม่เก็บ PII ผู้ค้น แต่ trace พอสำหรับ abuse detection — FR-53); mobile-first, ภาษาไทยเป็นหลัก
- ผ่าน data-governance review + DPIA ก่อนเปิด public (feature-specific NFR ใน R4 PRD)
- Demo ค้นเจอ (ทุกช่องทาง) ↔ opt-out แล้วค้นไม่เจอ end-to-end

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| R4 | 13 | 9 |
| **รวม** | **13** | **9** |

> **CR-005 §E (2026-06-22):** T-41 bump 7→9 Raw / 5→6.5 Adj — เพิ่ม identifier search (เลขบัตร13/passport/เบอร์ exact-only) + field set masked ชุดเต็ม (FS-1/2/3). estimate provisional, recalibrate ตาม K-16.

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- `T-04` (Household create + attach members + head) — module **Household & Zoning**

**Design input:** P-03 (pre-production โดยบริษัท)
