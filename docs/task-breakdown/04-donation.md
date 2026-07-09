---
title: "Task Breakdown — Donation"
status: active
created: 2026-06-05
updated: 2026-06-22
module: donation
note: decision-synced 2026-06-15 — task details and DoD maintained directly in Markdown; CR-005 (§F, 2026-06-22) เพิ่ม public `/donate` wizard (T-60) + donation schema_v 1→2 — ดู T-60
---

# Donation

> donor pre-declaration, intake audit, reservation, cut-off, smart redirect, transparency

- **Team owner:** Team A — ชิโน, นัท, กาน (Donation; ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** R2, R3
- **Design input (บริษัท):** P-01 (ส่งมอบแล้ว), P-02 (กำหนดส่งก่อนกรกฎาคม 2026)
- **Target ส่งมอบ:** ภายในสิงหาคม 2026

## Features / Tasks

| ID | Feature / Task | FR | Phase | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-15 | Donor pre-declaration (QR/form, no-auth: tracking_token + phone OTP + rate-limit/CAPTCHA) | FR-32 | R2 | prod | ส.ค. | 5 | ÷1.6 | 3 | T-11 |
| T-16 | Donation intake audit trail | FR-33 | R2 | prod | ส.ค. | 4 | ÷1.25 | 3 | T-15 |
| T-21 | Donation reservation (quota vs stock, no-auth via tracking_token + TTL) | FR-35 | R3 | prod | ส.ค. | 5 | ÷1.4 | 3.5 | T-14,T-16 |
| T-22 | Donation cut-off (auto close at target) | FR-36 | R3 | prod | ส.ค. | 4 | ÷1.4 | 3 | T-21 |
| T-23 | Smart redirect to under-threshold shelters | FR-37 | R3 | prod | ส.ค. | 5 | ÷1.4 | 3.5 | T-22,T-14 |
| T-24 | Donation transparency report (24h, public, QR) | FR-38 | R3 | prod | ส.ค. | 6 | ÷1.6 | 4 | T-16 |
| T-60 | Public donation & queue booking (`/donate`) — needs board + logistics + slot booking + ticket (**CR-005 §F**) | FR-32,35,36 | R3 | prod | ส.ค. | 8 | ÷1.4 | 5.5 | T-15,T-21,T-22,T-02 |
| | **รวมทั้งโมดูล** | | | | | **37** | | **25.5** | |

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง
> ฝั่งผู้บริจาคทั้งหมดเป็น **public no-auth**: track ผ่าน `tracking_token`; OTP ต้องรองรับผ่าน config (`public_otp_required=false` ได้ใน MVP/dev), rate-limit บังคับทุก public environment, CAPTCHA เป็น production public gate

### T-15 — Donor pre-declaration (FR-32)

**Description:** ผู้บริจาคสแกน QR ของศูนย์/แคมเปญแล้วกรอกฟอร์มแจ้งล่วงหน้าว่าจะบริจาคอะไร จำนวนเท่าไร โดย**ไม่ต้องสมัครสมาชิก** — ระบบออก tracking_token ให้ติดตามสถานะ ยืนยันเบอร์ด้วย OTP แก้ปัญหา "ของบริจาคกองล้นโดยไม่มีข้อมูล" ตาม source proposal

**Definition of Done:**
- Public form (mobile-first) เลือก item จาก catalog (T-10) + จำนวน → ได้ tracking_token (random เดาไม่ได้ — **ห้าม** lookup ด้วยรหัส sequential กัน enumeration/IDOR ตาม FR-32)
- OTP support มีอยู่หลัง config (`public_otp_required`); dev/MVP ปิดได้ แต่ production public ต้องเปิดตาม policy. Rate-limit ทำงานจริงทุก environment ที่เปิด public endpoint, CAPTCHA ทำงานใน production public (test ยิงถี่แล้วโดน block); เบอร์เก็บแบบ masked/hash + ลง RoPA
- รายการ pre-declare เป็น pending ไม่เข้า on-hand จนกว่ารับจริง (T-16/FR-28)
- ผู้บริจาคเปิดสถานะรายการตัวเองด้วย tracking_token ได้ ไม่เห็นข้อมูลคนอื่น; เจ้าหน้าที่แจ้งแทนได้ (walk_in/phone)
- เจ้าหน้าที่เห็นรายการ pre-declare ค้างรับในระบบ และ demo flow สแกน QR → แจ้ง → เห็นฝั่งเจ้าหน้าที่

> **CR-005 §F:** public donor wizard `/donate` เต็มรูป (donor PII เพิ่ม line_id/email, items.category/condition/note, logistics, slot, ticket QR+booking_ref, `PATCH` courier tracking) แยกไปทำใน **T-60**; T-15 คงเป็น pre-declaration core. donation doc ที่เขียนจาก `/donate` เป็น **schema_v 2** (ดู T-02 / `schema.md §2.3`).

### T-16 — Donation intake audit trail (FR-33)

**Description:** บันทึกการรับบริจาคจริงที่หน้าศูนย์ ผูกกับ pre-declaration (ถ้ามี) และเขียนเข้า stock ledger (T-11) พร้อม audit trail ครบ — ใคร รับอะไร จากใคร เมื่อไร — เป็นฐานข้อมูลของ transparency report (T-24)

**Definition of Done:**
- รับของ walk-in (ไม่มี pre-declare) และรับตาม pre-declare ได้ทั้งสองทาง
- รับแล้ว → ledger entry ใน T-11 + สถานะ pre-declaration อัปเดตเป็น received
- Audit trail ทุกรายการ (ผู้รับ, ผู้บริจาค/token, เวลา, จำนวนจริง vs ที่แจ้ง) query ได้
- Test + demo รับบริจาคครบทั้งสอง path

### T-21 — Donation reservation (FR-35)

**Description:** ยกระดับ pre-declaration เป็น "จองบริจาค": ระบบเช็คความต้องการคงค้าง (เป้าหมาย − stock − ยอดจองค้าง จาก T-14) แล้วยืนยัน/ปฏิเสธการจอง พร้อม TTL — จองแล้วไม่มาส่งภายในกำหนด สิทธิ์คืนเข้าระบบ ลดของซ้ำซ้อนและความโกลาหลที่ศูนย์

**Definition of Done:**
- แสดงความต้องการคงค้าง (target − on-hand) ต่อ item ต่อศูนย์ก่อนยืนยันจอง
- จองผ่าน `tracking_token` (no-auth) — จองที่ยืนยันแล้ว reserve โควตา กันบริจาคซ้อนเกินเป้าจากหลายคนพร้อมกัน
- Donor แก้/ยกเลิกการจองของตนผ่าน token ได้โดยไม่ login (FR-35)
- Item ที่ยอดครบแล้วจองไม่ได้ แสดงเหตุผล + ชี้ทางไป redirect (T-23)
- TTL หมดอายุ → โควตาคืนอัตโนมัติ + rate-limit ต่อเบอร์/IP กัน abuse จองทิ้ง; OTP support อยู่หลัง `public_otp_required`, CAPTCHA เป็น production public gate (test การหมดอายุ + race ระหว่างจองพร้อมกัน)
- Demo จองจนเต็มเป้าแล้วเห็นระบบปิดรับ item นั้น

### T-22 — Donation cut-off (FR-36)

**Description:** ปิดรับบริจาค item อัตโนมัติเมื่อยอด (stock + จองค้าง) ถึงเป้าหมาย แสดงสถานะ "รับแล้ว/ครบแล้ว" ต่อสาธารณะ (ตาราง use case ใน source proposal) — กันภาระจัดเก็บ/กำจัดของส่วนเกิน

**Definition of Done:**
- เมื่อ on-hand + reserved ≥ target → ปิดรับอัตโนมัติทั้งฝั่งจองและ pre-declare ไม่ต้องมีคนกด (FR-36)
- Cut-off ทำงานต่อ item ต่อศูนย์ — ไม่กระทบ item อื่น
- สถานะ "รับแล้ว/ปิดรับ" เห็นบน public view ทันที, เจ้าหน้าที่ override เปิด/ปิด manual ได้พร้อม audit
- Stock ลด (แจกออก) จนต่ำกว่าเป้า → **เปิดรับใหม่อัตโนมัติ** (FR-36)
- Test threshold crossing ทั้งสองทิศ + demo

> **PR #39 partial (2026-07-08):** back-office needs board + domain slice (`isNeedCutOff`, `openNeeds`, `needs[].status`, `visible_on_home`, manual override + audit on `updateCampaign`) — **done in PR #39**. ยังไม่ครบ T-22 ทั้งหมด: public API wiring (`/donate`, `POST /public/v1/donations` quota check, `openNeeds` ที่ public API) เป็น follow-up แยกจาก PR นี้

### T-23 — Smart redirect to under-threshold shelters (FR-37)

**Description:** เมื่อ item ที่ผู้บริจาคต้องการให้ถูกปิดรับที่ศูนย์หนึ่ง ระบบแนะนำศูนย์อื่นที่ยังขาด item นั้น (ดูจาก threshold ข้ามศูนย์ T-14) — เกลี่ยของบริจาคทั้งเครือข่ายศูนย์ แก้ปัญหา "ล้นศูนย์หนึ่ง ขาดอีกศูนย์" ตรงตาม source proposal

**Definition of Done:**
- ศูนย์เป้าหมายปิดรับ → ผู้บริจาคเห็นรายชื่อศูนย์ที่ยังขาด item เดียวกัน เรียงตามความขาดแคลน (gap จาก reorder threshold — FR-37)
- ไม่แนะนำศูนย์ที่ปิดรับ item นั้นเช่นกัน
- กดเลือกศูนย์ใหม่แล้วรายการเข้า pipeline ศูนย์ปลายทาง (pattern เดียวกับ T-15) ใน flow เดียว ไม่ต้องเริ่มกรอกใหม่
- ข้อมูลข้ามศูนย์เป็น aggregate เท่านั้น (ไม่มี PII) และ test + demo redirect จริง

### T-24 — Donation transparency report (FR-38)

**Description:** รายงานสาธารณะสรุปยอดบริจาค-รับ-แจกจ่าย ภายใน 24 ชม. เข้าถึงผ่าน QR/ลิงก์ public ไม่ต้อง login — สร้างความโปร่งใสและความเชื่อมั่นผู้บริจาค (KPI ความโปร่งใสของโครงการ)

**Definition of Done:**
- Public page สรุปรับเข้า/แจกออกต่อ item ต่อศูนย์ รอบ 24 ชม. จาก Stock Ledger (ระบุเวลา as-of ชัดเจน)
- เป็น aggregate เท่านั้น — ไม่มี PII ของผู้บริจาคหรือผู้พักพิงบนหน้า public (มี test ยืนยัน, ต่อ NFR-5)
- ผ่าน data-governance review ก่อนเปิด public (note ใน FR-38 / NFR-15)
- QR ชี้มายังรายงานของศูนย์นั้นๆ ถูกต้อง, mobile-first, โหลดเร็วตาม NFR
- ตัวเลขตรงกับ ledger/audit trail (reconciliation test) + demo

### T-60 — Public donation & queue booking (`/donate`) (CR-005 §F, FR-32/35/36)

**Description:** หน้า public/no-login `/donate` ("บริจาคและจองคิว", DN tier) เป็น **stepper 4 ขั้น**: (1) กระดานความต้องการด่วน (`GET /public/v1/needs` aggregate), (2) ฟอร์มบริจาค pre-fill จากการ์ดที่เลือก, (3) เวลา/สถานที่ — วิธีส่ง/ยานพาหนะ/ศูนย์ปลายทาง (lock จากการ์ด)/slot/ETA, (4) ตั๋ว QR + booking ref (`DN-xxxxxx`) พิมพ์แปะลงของ. ขยาย DN surface เกินร่างเดิม — reflect ใน `public-tier-flow-spec §DN`; spec = `docs/features/public-tier-donation-spec.html`. ต่อยอด token-based flow ของ T-15/T-21 (no-auth, `tracking_token`)

**Definition of Done:**
- **ขั้น 1 needs board:** อ่าน aggregate ความต้องการทุกศูนย์จาก view `needs_open` (`schema.md §2.4`, cap = campaign `qty_target`; DN-4) — "ขาด N" = `max(0, needs_open)`, "งดรับ" = `needs_open ≤ 0`; ไม่มี PII
- **ขั้น 2 form:** pre-fill หมวด/ประเภทจาก need card; เก็บ donor PII — ชื่อ+เบอร์ (เดิม) + **line_id/email optional** (DN-2); items มี `category`/`condition`/`note` (schema_v 2). **ไม่มี**ใบอนุโมทนา/ลดหย่อนภาษี (DN-3 ระบบไม่รองรับ — ไม่มี checkbox/field)
- **ขั้น 3 logistics + slot:** วิธีส่ง/ยานพาหนะ/ปลายทาง lock จากการ์ด + ETA; จอง slot จาก `donation_slot` (`schema.md §2.13`, ศูนย์ตั้งค่าใน back-office — DN-5) อ่านความจุที่เหลือผ่าน view `slot_availability`; donor กรอกเลข courier tracking เองได้ (DN-6)
- **ขั้น 4 ticket:** ออก `booking_ref` + QR, พิมพ์ label แปะของได้; donor เปิด/แก้ผ่าน `GET`/`PATCH /public/v1/donations/{token}` (auth = token) — แก้ courier tracking ภายหลังได้ (DN-6)
- **กัน race ตอน submit:** service re-check atomic — `needs_open ≤ 0` → `NEED_FULL`, slot เต็ม → `SLOT_FULL`
- **DN-1 OTP = OFF (on hold):** develop แบบไม่มี OTP ไปก่อน (flag `public_otp_required=false` มีอยู่แล้ว — ไม่แตะ); rate-limit บังคับ, CAPTCHA เป็น production public gate
- Public no-PII-leak test (board/ticket ไม่หลุด donor คนอื่น), reservation/cut-off สอดคล้อง T-21/T-22 + demo flow 4 ขั้นครบจน print ticket

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| R2 | 9 | 6 |
| R3 | 28 | 19.5 |
| **รวม** | **37** | **25.5** |

> **CR-005 §F (2026-06-22):** +T-60 (public `/donate` wizard) Raw 8 / Adj 5.5; ต้องมี `donation` schema_v 1→2 + `donation_slot` §2.13 + view `needs_open`/`slot_availability` (ดู T-02). estimate provisional, recalibrate ตาม K-16.

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- `T-11` (Stock receive (inbound) + ledger write) — module **Module C — Supply & Inventory**
- `T-14` (Stock dashboard + reorder threshold) — module **Module C — Supply & Inventory**
- `T-02` (Data-model expansion — donation schema_v 1→2 + `donation_slot` §2.13 + `validate_doc_update` whitelist + view `needs_open`/`slot_availability`) — module **Platform/Core** (T-60, CR-005 §F)
