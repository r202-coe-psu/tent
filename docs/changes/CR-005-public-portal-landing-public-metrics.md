---
id: CR-005
title: "Public Portal landing v0.3 — public exposure ของ occupancy_total (metric) + deferral ของ Transparency/Volunteer + decisions OP-1..OP-7 + Public Shelter Dashboard /shelters (OP-8 vulnerable_count, OP-9) + Family Search /search (§E) + Donation & Queue Booking /donate (§F)"
status: approved        # proposed | approved | done | rejected | superseded
date: 2026-06-22
requested_by: project owner (session 2026-06-22)
decided_by: project owner (session 2026-06-22)
layer: volatile
affects:
  - docs/features/public-portal-landing-spec.html (v0.2 → v0.3)
  - docs/features/public-tier-flow-spec.html (PUB tier — data exposure surface)
  - docs/features/public-portal-shelter-spec.html (NEW — Public Shelter Dashboard "ตรวจสอบศูนย์พักพิง", route /shelters, PUB tier)
  - docs/features/public-tier-find-spec.html (NEW — Family Search "สืบค้นญาติ" / Restoring Family Links, route /search, FAM tier — §E)
  - docs/features/public-tier-flow-spec.html (§FAM — expanded exposure surface: national-id/passport search + field set)
  - public API: GET /public/v1/transparency/summary (field exposure)
  - public API: GET /public/v1/transparency/shelters (per-shelter field set — vulnerable_count, capacity, geo)
  - public API: POST /public/v1/family-search (search methods + returned field set — §E)
  - docs/features/public-tier-donation-spec.html (NEW — Donation & Queue Booking "บริจาคและจองคิว", route /donate, DN tier — §F)
  - docs/data/schema.md §2.3 donation (schema_v 1 → 2: +logistics, booking_ref, donor.line_id/email, items.category/condition/note, tax_receipt_requested) + §2.13 donation_slot (NEW — DN-5) — §F
  - docs/features/public-tier-flow-spec.html (§DN — expanded surface: donor Line/email + tax receipt + logistics + slot booking)
  - public API: GET /public/v1/needs + POST /public/v1/donations + GET /public/v1/donations/{token} (donor PII + logistics + slot fields — §F)
  - public API: GET /public/v1/faq (dynamic, EOC-managed)
  - EOC back-office: FAQ setup screen (new dependency), LINE OA / FB URL config
---

# CR-005 — Public Portal landing v0.3: public metrics exposure + feature deferrals

## Why

Mockup รอบใหม่ของ Public Portal landing page (session 2026-06-21) เพิ่ม **Real-Time Metrics
panel** ที่แสดงตัวเลขรวมต่อสาธารณะ และมีหลายจุดที่ต้องเคาะก่อน build. การ review (2026-06-22)
ได้ข้อสรุปของ OP-1..OP-7 — แต่ในนั้นมี **1 จุดที่เป็น business rule ระดับ data-exposure** (OP-6)
ซึ่งตาม `docs/change-management.md` §2 ต้องเปิด Change Record ก่อนยืนยันลง spec.

จุดสำคัญ: metric **"ผู้ประสบภัยปลอดภัย" = occupancy รวมทุกศูนย์** จะถูก expose สู่ **public /
no-login tier** (PUB). นี่คือการเพิ่ม data-exposure surface ของ PUB tier — เดิม PUB tier มีเฉพาะ
occupancy aggregate ต่อศูนย์ใน `/transparency/*` ที่ตั้งใจเปิดอยู่แล้ว แต่การโชว์ count บน
landing page หน้าแรกแบบ default ต้องยืนยันอีกครั้งเรื่องความเสี่ยง re-identification เมื่อ count ต่ำ.

## Change

### A. APPROVED — public exposure ของ occupancy_total (OP-6) — **อนุมัติ 2026-06-22**

| Item | สถานะ |
| --- | --- |
| Metric "ผู้ประสบภัยปลอดภัย" map เป็น field ไหน | **เคาะแล้ว** = `occupancy_total` (occupancy รวมทุกศูนย์) |
| Expose `occupancy_total` สู่ public landing ได้หรือไม่ | **APPROVED — แสดงได้** (เจ้าของอนุมัติ 2026-06-22) |
| ต้องมี k-anonymity threshold / แสดงเฉพาะระดับระบบรวมหรือไม่ | ไม่บังคับสำหรับ aggregate ระดับระบบ; ส่วน per-shelter ดู OP-9 |

**เหตุผลที่อนุมัติ:** ตัวเลขนี้ต้อง **แสดงต่อสาธารณะเพื่อให้ประชาชน/ญาติรู้ว่าศูนย์เต็มหรือยัง**
ประกอบการตัดสินใจเคลื่อนย้าย — เป็น core value ของ public dashboard. เป็น aggregate ระดับระบบ
(รวมทุกศูนย์) ห้าม drill-down เป็นรายชื่อ.

> **Go (2026-06-22):** metric `occupancy_total` **แสดงต่อ public ได้**. feature flag
> `public_metrics_occupancy` (db `config`) เปลี่ยนบทบาทจาก "approval gate" เป็น
> **operational kill-switch, default = on** (เปิดแสดงโดย default; เหลือไว้เผื่อปิดฉุกเฉิน).
> ความเสี่ยง re-identification เหลือเฉพาะ **per-shelter count ต่ำ** — จัดการที่ OP-9 ไม่ใช่ตรงนี้.

### B. APPROVED — feature deferrals (disable ไว้ก่อน)

| ส่วน | Before (v0.2) | After (v0.3) |
| --- | --- | --- |
| Nav "รายงานความโปร่งใส" (`/transparency`) | แสดง | **disabled/ซ่อน** — เปิดภายหลัง |
| Nav "อาสาสมัคร / พี่เลี้ยง" (`/volunteer`) | แสดง (dropdown) | **disabled/ซ่อน** — เปิดภายหลัง (OP-3 ปิด) |
| Quick-service card "ทีมอาสาสมัคร" | แสดง → `/volunteer/register` | **ซ่อนทั้ง card** — grid เหลือ 3 card |
| Metric "อาสาสมัครลงปฏิบัติงาน" (`volunteers_active`) | แสดง | **ซ่อน** — panel เหลือ 2 metric |

### C. APPROVED — config/UX decisions

| OP | Decision |
| --- | --- |
| OP-1 | FAQ เป็น **dynamic** — อ่าน `GET /public/v1/faq`, content จัดการผ่าน **setup screen ใน EOC** (back-office). ⇒ เกิด dependency ใหม่: EOC FAQ setup screen (scope แยก) |
| OP-2 | LINE OA / FB Page URL เก็บเป็น **setup ใน EOC**, **ไม่แสดงผลตอนนี้** (ซ่อนปุ่ม LINE/FB; เหลือปุ่มโทร 1669/1784) |
| OP-4 | Alert level 4 บน mobile = **sticky top** |
| OP-5 | ลิงก์ "ตรวจสอบพิกัดแผนที่..." = **internal** `/shelters` (ไม่ใช่ external map) สำหรับหน้านี้ |
| OP-7 | Metrics refresh = **polling ทุก 10 นาที**; **stale-data threshold = 30 นาที** (เกิน 30 นาที โชว์ค่าเก่า + ป้ายเตือน "ข้อมูลอาจไม่เป็นปัจจุบัน") |

### D. Public Shelter Dashboard "ตรวจสอบศูนย์พักพิง" (route `/shelters`) — PUB-tier data-exposure surface

หน้า **"ตรวจสอบสถานะศูนย์พักพิง"** (PUBLIC SHELTER DASHBOARD) คือ nav link 1 ของ landing
(`/shelters`) — เป็น **Public / No-Login tier (PUB)** เหมือน landing. mockup รอบนี้แสดง: metric
cards 4 ใบบนสุด, panel ค้นหา/filter (จังหวัด / อำเภอ / ตำบล / ระยะทาง 5–50 กม. / สถานะเปิด-ปิด /
ประเภทศูนย์), map พร้อมหมุดศูนย์ + เส้นทาง, และ list ศูนย์พักพิง (ชื่อ, สถานะ, ที่ตั้ง, ระยะทางจากจุดศูนย์กลาง,
occupancy `current/capacity`, จำนวนที่ว่าง, ปุ่ม "ดูรายละเอียด" / "นำทาง").

หน้านี้ **อ่าน aggregate-only** จาก `GET /public/v1/transparency/shelters` (per-shelter occupancy รวม —
ไม่มีรายบุคคล) ซึ่ง PUB tier ตั้งใจเปิดอยู่แล้ว (ดู public-tier-flow-spec §PUB). mockup เพิ่ม field
ที่ต้องเคาะ exposure 2 จุด:

| Item (mockup) | Field / map เป็น | สถานะ exposure |
| --- | --- | --- |
| Card "ศูนย์พักพิงทั้งหมด" (5 แห่ง) | `shelters_total` | **OK — เปิดได้ปกติ** (aggregate ระบบ ไม่อ่อนไหว) |
| Card "ศูนย์พักพิงที่เปิดใช้งาน" (5 แห่ง) | `shelters_open` | **OK — เปิดได้ปกติ** |
| Card "ผู้พักพิงปัจจุบัน" (7 คน) | `occupancy_total` | **APPROVED (§A/OP-6)** — แสดงได้; flag `public_metrics_occupancy` = kill-switch, default on |
| Card "กลุ่มเปราะบาง" (3 คน) | `vulnerable_count` (รวมทุกศูนย์) | **APPROVED (OP-8)** — แสดงได้; flag `public_metrics_vulnerable` = kill-switch, default on |
| Per-shelter occupancy `current/capacity` (เช่น 3/250) + "จำนวนที่ว่าง" (247) | `occupancy` ต่อศูนย์ + `capacity` (CR-004) | **APPROVED** — แสดงเป๊ะเสมอ (OP-9; ไม่ปัด/ไม่ mask) |
| หมุดศูนย์บน map + พิกัด/ระยะทาง | shelter `geo` / coordinates | **OK** — ที่ตั้งศูนย์เป็นข้อมูลสาธารณะเชิงปฏิบัติการ |
| Filter จังหวัด/อำเภอ/ตำบล/ระยะทาง/สถานะ/ประเภท | query param เท่านั้น | **OK** — ไม่ใช่ data exposure |

**OP-8 — public exposure ของ `vulnerable_count` ("กลุ่มเปราะบาง") — APPROVED 2026-06-22.**
เจ้าของอนุมัติให้ **แสดงต่อ public ได้** — count กลุ่มเปราะบางต้องเห็นเพื่อประกอบการช่วยเหลือ/จัดสรร.
เป็น aggregate ระดับระบบ (รวมทุกศูนย์) — **ห้าม drill-down เป็นรายชื่อ / ราย attribute ความเปราะบาง**.
feature flag `public_metrics_vulnerable` (db `config`) = operational kill-switch, **default = on**.
ความเสี่ยง re-identification ที่ระดับ per-shelter count ต่ำ จัดการรวมที่ OP-9.

**OP-9 — per-shelter exact occupancy เมื่อ count ต่ำ — APPROVED 2026-06-22: แสดงตัวเลขเป๊ะเสมอ.**
เจ้าของเลือก **แสดง occupancy/capacity รายศูนย์แบบเป๊ะตลอด** (เช่น `3/250`) — ไม่ปัด/ไม่ bucket/ไม่ mask
แม้ count ต่ำ. ยอมรับความเสี่ยง re-identification ปลาย low-count เพื่อความโปร่งใส/ใช้งานได้จริง
(per-shelter ยังเป็น aggregate ต่อศูนย์ ไม่ลงรายชื่อ). ⇒ ไม่ต้องทำ k-anonymity / low-count logic ฝั่ง service.

> **Go (2026-06-22):** หน้า `/shelters` แสดง metric card ทั้ง 4 ได้ — `shelters_open/total`,
> `occupancy_total` (OP-6 approved), `vulnerable_count` (OP-8 approved) — รวมทั้ง map, filter,
> per-shelter occupancy/capacity (แสดงเป๊ะเสมอ — OP-9). flag `public_metrics_occupancy` /
> `public_metrics_vulnerable` เหลือไว้เป็น kill-switch (default on). open points ครบทุกข้อแล้ว.

### E. Family Search "สืบค้นญาติ" (Restoring Family Links, route `/search`) — FAM-tier data-exposure surface

หน้า **"ระบบสืบค้นญาติและครอบครัว"** (RESTORING FAMILY LINKS) คือ nav link "สืบค้นญาติ" ของ
landing (`/search`) — เป็น **FAM tier** ของ public/no-login service (ดู
`public-tier-flow-spec §FAM`). mockup (session 2026-06-22) ให้ค้นบุคคลแล้วยืนยันว่า **ปลอดภัยและ
อยู่ที่ศูนย์ใด** เพื่อบรรเทาความเครียดของญาติ. mockup นี้ **ขยาย exposure surface ของ FAM tier
เกินร่างเดิม** ใน `public-tier-flow-spec §FAM` (เดิมจำกัด: ค้นด้วยชื่อ ≥3 ตัว / เบอร์เต็มเท่านั้น,
คืนเฉพาะ ชื่อจริงเต็ม+สกุล mask / ชื่อเล่น / ชื่อศูนย์ / สถานะ — **ห้ามเลขบัตรและ field อื่น**).

| Item (mockup) | Field / map เป็น | สถานะ exposure |
| --- | --- | --- |
| ค้นด้วยเลขบัตรประชาชน 13 หลัก + passport (FS-1) | query (exact match) | **APPROVED 2026-06-22** — เพิ่มช่องทางค้น; identifier ต้อง exact-only กัน enumeration |
| ค้นด้วยเบอร์โทร / ชื่อ-สกุล | query | **OK** — ตาม FAM เดิม (เบอร์ exact, ชื่อ ≥3 ตัว) |
| คืน field: เลขบัตร mask (3+3), เพศ, ชื่อศูนย์, ภูมิลำเนาเดิม mask, เวลาลงทะเบียน, โซนความดูแล (FS-2) | `national_id`(masked)/`gender`/`shelter_name`/`origin_address`(masked)/`checked_in_at`/`care_zone` | **APPROVED 2026-06-22** — อนุมัติชุดเต็มตาม mockup (ทุก field masked ตามกติกา) |
| ชื่อ-นามสกุล (FS-3) | `name` | **APPROVED — ชื่อจริงเต็ม + นามสกุล mask** (ใช้ FAM เดิม; override mockup ที่ mask ทั้งคู่) |
| สถานะความปลอดภัย | `status` (in_shelter/moved/checked_out) | **OK** — core ของหน้านี้ |
| เบอร์โทร / เลขบัตรเต็ม / medical detail | — | **ห้ามคืนเด็ดขาด** (แม้ query ด้วยเบอร์) |

**FS-1 — ค้นด้วยเลขบัตร 13 หลัก + passport (นอกเหนือ ชื่อ/เบอร์) — APPROVED 2026-06-22.**
เจ้าของยืนยัน "ค้นได้จากทั้งหมด — เลขบัตร 13 หลักเป๊ะ / ชื่อ / นามสกุล / เบอร์โทร; เป้าหมายหลักคือ
หาผู้ประสบภัยให้เจอและรู้ว่าปลอดภัยอยู่ที่ไหน". identifier (เลขบัตร/passport/เบอร์) ต้อง **exact-only**
(ไม่รับ partial) เพื่อกัน enumeration; ชื่อ/สกุล = token ≥3 ตัว, max 10 ผล. คง anti-enumeration ของ
FAM ทุกข้อ (rate-limit, audit ทุก query, opt-out `search_excluded` hide ทั้ง record, PoW).

**FS-2 — public exposure ของชุด field เต็ม (เลขบัตร mask, เพศ, ศูนย์, ภูมิลำเนา mask, เวลา, โซน) — APPROVED 2026-06-22.**
เจ้าของอนุมัติ "ชุดเต็มตาม mockup". ทุก field ต้อง masked ตามกติกา (เลขบัตร 3 หน้า+3 ท้าย, ภูมิลำเนา
mask เลขที่บ้าน). **ห้าม**คืน เบอร์โทร / เลขบัตรเต็ม / medical detail / internal id.

**FS-3 — กติกา mask ชื่อ — APPROVED 2026-06-22: ใช้ FAM เดิม (ชื่อจริงเต็ม + นามสกุล mask).**
เจ้าของเลือก "ตาม FAM spec เดิม" — แสดงชื่อจริงเต็มให้ญาติยืนยันตัวบุคคลได้, mask เฉพาะนามสกุล
(grapheme rule เดิม). **override** mockup ที่ mask ทั้งชื่อและสกุล.

> **Go (2026-06-22):** หน้า `/search` build ได้เต็มที่ — ค้นด้วย เลขบัตร13/passport/ชื่อ/สกุล/เบอร์
> (FS-1), คืนชุด field เต็ม masked (FS-2), ชื่อจริงเต็ม + สกุล mask (FS-3). การขยาย FAM surface นี้
> ต้อง **reflect กลับใน `public-tier-flow-spec §FAM`**. FS-4 (ปุ่ม "จำลอง"/demo) = **REJECTED**
> (ไม่มี demo เลย — เจ้าของ 2026-06-22); ทุกการค้นยิง API จริง + เขียน audit.

### F. Donation & Queue Booking "บริจาคและจองคิว" (route `/donate`) — DN-tier surface

หน้า **"บริจาคและจองคิว"** คือ nav link ของ landing (`/donate`) — เป็น **DN tier (Donor, FD-16)**
ของ public/no-login service (ดู `public-tier-flow-spec §DN`). mockup (session 2026-06-22) เป็น
**stepper 4 ขั้น**: (1) กระดานความต้องการด่วน — เห็นของที่ทุกศูนย์ขาด, (2) ฟอร์มบริจาค — ข้อมูล
ผู้บริจาค + รายการสิ่งของ (pre-fill จากการ์ดที่เลือก), (3) เวลา/สถานที่ — วิธีส่ง/ยานพาหนะ/ศูนย์ปลายทาง
(lock จากการ์ด)/slot เวลา/ETA, (4) ตั๋ว — QR + booking ref (`DN-xxxxxx`) ที่ **บันทึก/พิมพ์แปะลงของ**.

4 ความต้องการของเจ้าของ (session 2026-06-22) = **scope ที่ยืนยันแล้ว**:

| # | ความต้องการ | map ในหน้า |
| --- | --- | --- |
| 1 | เห็นรายการที่ศูนย์ต้องการรับบริจาคทั้งหมด | ขั้น 1 board (`GET /public/v1/needs` aggregate) |
| 2 | กรอกสิ่งที่จะบริจาคจากการ์ดที่เลือก | ขั้น 2 form pre-fill หมวดหมู่/ประเภทจาก need |
| 3 | ระบุเวลาส่ง + คนส่ง + ปลายทาง (lock จากการ์ด) + ETA ให้ทีมศูนย์ติดตาม | ขั้น 3 logistics + slot booking |
| 4 | บันทึก + พิมพ์ตั๋วแปะลงของ — ติดตามทั้งสองฝั่ง | ขั้น 4 ticket (QR + booking ref + print label) |

mockup **ขยาย field ของ DN tier** เกินร่างเดิมใน `public-tier-flow-spec §DN` (เดิมเก็บ donor PII
ขั้นต่ำ = ชื่อ + เบอร์). open points (DN-2/5/6/7 เคาะ 2026-06-22; DN-1/3/4 เจ้าของจะหาคำตอบมาเติม):

| # | คำถาม | สถานะ |
| --- | --- | --- |
| DN-1 | OTP ยืนยันเบอร์ตอน submit (flag `public_otp_required`) เปิด default ไหม | **OPEN** — เจ้าของจะเติม |
| DN-2 | เก็บ Line ID / email (donor PII เกินร่างเดิม) | **RESOLVED** — เก็บได้ ทั้งคู่ optional |
| DN-3 | ใบอนุโมทนาบัตร/ลดหย่อนภาษี — PII เพิ่ม (ที่อยู่/เลขผู้เสียภาษี) + ใครออกใบ | **OPEN** — เจ้าของจะเติม |
| DN-4 | สูตร "ขาด N"/"ล้นสต็อก %"/"ของยังรับได้ %" + เกณฑ์ "งดรับ" | **OPEN** — เจ้าของจะเติม (รอ Data Model) |
| DN-5 | กติกา slot/คิว: จำนวน/ความจุต่อ slot, ใครตั้งค่า | **RESOLVED** — ศูนย์ตั้งค่า slot เองใน Donation module (back-office) |
| DN-6 | กรณีขนส่งพัสดุ — เก็บเลข tracking ผู้ให้บริการ | **RESOLVED** — donor กรอกเอง + แก้ภายหลังผ่านหน้า ticket (`PATCH /donations/{token}`) |
| DN-7 | donation doc shape (donor/items/logistics/slot) + schema_v | **RESOLVED** — extend `donation` schema.md §2.3 → **schema_v 2** + `donation_slot` §2.13 (DN-5) + migration 1→2 |

ส่วน scope หลัก (4 ข้อ) + endpoint `GET /needs` / `POST /donations` / `GET /donations/{token}` +
`PATCH /donations/{token}` (DN-6) — **build โครงหน้าได้**. การขยาย DN surface ที่เคาะแล้ว
(DN-2/5/6/7) reflect ใน `public-tier-flow-spec §DN`; DN-1/3/4 รอเจ้าของเติมก่อน finalize.

> **Status (2026-06-22):** spec page `docs/features/public-tier-donation-spec.html` เขียนแล้ว
> (4 ข้อ confirmed; DN-2/5/6/7 resolved); DN-1/3/4 ยัง OPEN — เจ้าของจะหาคำตอบมาเติม.

## Impact

- `docs/features/public-portal-landing-spec.html` — bump v0.2 → v0.3 (apply B + C; A แสดงเป็น PENDING)
- `docs/features/index.html` — card description update (real-time metrics)
- `docs/features/public-tier-flow-spec.html` — PUB tier data-exposure surface เพิ่ม `occupancy_total` + `vulnerable_count` (A/OP-8 approved — reflect ได้แล้ว)
- **`docs/features/public-portal-shelter-spec.html`** — spec ใหม่ (แยกจาก landing) สำหรับ Public Shelter Dashboard `/shelters` ("ตรวจสอบศูนย์พักพิง") ตาม §D; metric card "ผู้พักพิงปัจจุบัน" / "กลุ่มเปราะบาง" gate หลัง flag; ส่วน shelters_open/total + map + filter + per-shelter occupancy เปิดได้. `docs/features/index.html` เพิ่ม card #10
- API `GET /public/v1/transparency/summary` — field set: `shelters_open`/`shelters_total` + `occupancy_total` (OP-6 approved) + `vulnerable_count` (OP-8 approved); `volunteers_active` ซ่อนตาม B
- API `GET /public/v1/transparency/shelters` — per-shelter field set: `occupancy`/`capacity`/`geo` (เปิด, แสดงเป๊ะเสมอ — OP-9)
- **`docs/features/public-tier-find-spec.html`** — spec ใหม่ (§E) สำหรับ Family Search `/search` ("สืบค้นญาติ" / Restoring Family Links, FAM tier); search methods FS-1, field set FS-2, masking FS-3. `docs/features/index.html` เพิ่ม card #11
- **`docs/features/public-tier-flow-spec.html` §FAM** — reflect การขยาย FAM exposure: เพิ่ม search ด้วยเลขบัตร13/passport (FS-1) + ชุด field ที่คืนใน `/search` (FS-2); ชี้ไป find-spec
- API `POST /public/v1/family-search` — search methods (เลขบัตร13 exact / passport / เบอร์ / ชื่อ-สกุล) + returned field set (masked) ตาม §E
- **`docs/features/public-tier-donation-spec.html`** — spec ใหม่ (§F) สำหรับ Donation & Queue Booking `/donate` ("บริจาคและจองคิว", DN tier); 4-step wizard (needs board → form → logistics/slot → ticket). `docs/features/index.html` เพิ่ม card #12
- **`docs/features/public-tier-flow-spec.html` §DN** — reflect การขยาย DN surface: donor Line/email + ใบอนุโมทนา (DN-2/DN-3), logistics + slot booking; ชี้ไป donation-spec
- API `GET /public/v1/needs` + `POST /public/v1/donations` + `GET`/`PATCH /public/v1/donations/{token}` — field set (donor PII, items, logistics, slot, ETA, courier tracking) ตาม §F; DN-1/3/4 รอเคาะ
- **`docs/data/schema.md`** — `donation` §2.3 bump **schema_v 1 → 2** (+`logistics`, `booking_ref`, `donor.line_id/email`, `items[].category/condition/note`, `tax_receipt_requested`) + migration note; **`donation_slot` §2.13 NEW** (DN-5, ศูนย์ตั้งค่า slot/คิว); §7 index + `slot_availability` view. `config.public_otp_required` (DN-1) มีอยู่แล้ว — ไม่แตะ
- API `GET /public/v1/faq` + EOC FAQ setup screen — dependency ใหม่ (task แยก)
- `docs/changes/_index.md` — เพิ่ม CR-005 row

## Migration

§A–§E — ไม่มี persisted doc shape เปลี่ยน (spec/feature-scope + API field-exposure decision ล้วน).
OP-6 / OP-8 / OP-9 approved ครบ; ไม่ต้องทำ k-anonymity / low-count logic ฝั่ง service.

**§F — มี schema เปลี่ยน (DN-7):**
- `donation` §2.3 bump **schema_v 1 → 2**. field ใหม่ทั้งหมด optional/sys → **backward compatible, ไม่ต้อง backfill**. doc เดิม (schema_v 1, ส่วนใหญ่ walk_in) อ่านได้ปกติ; reader ถือว่าไม่มี `logistics`/`booking_ref`/`line_id`/`email`. public donation ใหม่เขียนเป็น schema_v 2.
- `donation_slot` §2.13 = doc type **ใหม่** (schema_v 1) — ไม่กระทบ doc เดิม; ต้อง deploy index/`slot_availability` view + เพิ่ม type ใน whitelist ของ `validate_doc_update` (shelter db) ก่อนใช้.
- `validate_doc_update` ฝั่ง central + edge ต้องอัปเดตให้รับ field/type ใหม่ก่อน rollout.

## Decision log

- 2026-06-22 — proposed
- 2026-06-22 — CR tracking method: file ใน `docs/changes/` (เจ้าของสั่ง "เขียนเพิ่มเป็น CR5")
- 2026-06-22 — B (disable transparency/volunteer) — approved
- 2026-06-22 — C (OP-1, OP-2, OP-4, OP-5, OP-7) — approved
- 2026-06-22 — A (OP-6 public exposure ของ occupancy_total) — **OPEN, mark ไว้ก่อน, รอยืนยันรอบสอง**
- 2026-06-22 — A: conditional go-ahead — dev เดินหน้าได้ โดย `occupancy_total` ต้องอยู่หลัง feature flag `public_metrics_occupancy` (default off); ห้าม expose จริงจนกว่า §A approved (เจ้าของอนุมัติแนวทาง flag)
- 2026-06-22 — D (Public Shelter Dashboard `/shelters` "ตรวจสอบศูนย์พักพิง") — เพิ่มเข้า CR ตามคำสั่งเจ้าของ; ส่วน shelters_open/total + map + filter + per-shelter occupancy/capacity — เปิดได้ปกติ
- 2026-06-22 — D: แยกเป็น spec page ของตัวเอง `docs/features/public-portal-shelter-spec.html` (ตามคำสั่งเจ้าของ "แยกออกมาเป็น spec อีกหน้านึง"); index.html เพิ่ม card #10
- 2026-06-22 — OP-8 (public exposure ของ `vulnerable_count` "กลุ่มเปราะบาง") — **OPEN, ยังไม่อนุมัติ**; conditional go-ahead หลัง flag `public_metrics_vulnerable` (default off), ห้าม expose จริงจนกว่า OP-8 approved
- 2026-06-22 — OP-9 (low-count bucketing ของ per-shelter occupancy) — refinement, รอเคาะ; ไม่ block dev
- 2026-06-22 — **A/OP-6 — APPROVED**: `occupancy_total` แสดงต่อ public ได้ (เหตุผล: ต้องเห็นว่าศูนย์เต็มหรือยัง); flag `public_metrics_occupancy` กลายเป็น kill-switch default on
- 2026-06-22 — **OP-8 — APPROVED**: `vulnerable_count` แสดงต่อ public ได้ (aggregate ระดับระบบ, ห้าม drill-down); flag `public_metrics_vulnerable` = kill-switch default on
- 2026-06-22 — **OP-9 — APPROVED**: per-shelter occupancy แสดงตัวเลขเป๊ะเสมอ (ไม่ปัด/ไม่ mask แม้ count ต่ำ); ไม่ต้องทำ k-anonymity ฝั่ง service
- 2026-06-22 — **CR-005 → approved**: open points ครบทุกข้อ (B, C, OP-1..OP-9); dev เดินหน้าได้เต็มที่
- 2026-06-22 — E (Family Search `/search` "สืบค้นญาติ") — เพิ่มเข้า CR ตามคำสั่งเจ้าของ ("ต่อไป CR5 เพิ่ม spec หน้าค้นหาญาติ"); แยกเป็น spec page `docs/features/public-tier-find-spec.html`; index.html เพิ่ม card #11
- 2026-06-22 — **FS-1 — APPROVED**: ค้นด้วย เลขบัตร13(เป๊ะ)/passport/ชื่อ/สกุล/เบอร์ (identifier exact-only กัน enumeration); เป้าหมาย = หาผู้ประสบภัยให้เจอ
- 2026-06-22 — **FS-2 — APPROVED**: คืนชุด field เต็มตาม mockup (เลขบัตร mask, เพศ, ศูนย์, ภูมิลำเนา mask, เวลา, โซน) ทุก field masked; ห้ามเบอร์/เลขบัตรเต็ม/medical
- 2026-06-22 — **FS-3 — APPROVED**: mask ชื่อตาม FAM เดิม (ชื่อจริงเต็ม + นามสกุล mask); override mockup ที่ mask ทั้งคู่
- 2026-06-22 — **FS-4 — REJECTED**: ไม่มีปุ่ม "จำลอง"/demo เลย (เจ้าของสั่ง "ไม่ต้องมี demo เลย"); ทุกการค้นยิง API จริง + audit
- 2026-06-22 — F (Donation & Queue Booking `/donate` "บริจาคและจองคิว") — เพิ่มเข้า CR ตามคำสั่งเจ้าของ ("CR5 เพิ่มเติมส่วนของ spec หน้า donation"); แยกเป็น spec page `docs/features/public-tier-donation-spec.html`; index.html เพิ่ม card #12
- 2026-06-22 — F: 4 ความต้องการ (เห็น needs · กรอกจากการ์ด · ระบุเวลา/คนส่ง/ปลายทาง lock/ETA · บันทึก+พิมพ์ตั๋วแปะของ) = **scope confirmed**; DN-1..DN-7 (OTP, Line/email PII, ใบอนุโมทนา, needs/capacity formula, slot rules, ขนส่งพัสดุ, doc shape) — **OPEN, รอเคาะ/รอ Data Model**
- 2026-06-22 — **DN-2 — RESOLVED**: เก็บ Line ID + email ได้ ทั้งคู่เป็น optional
- 2026-06-22 — **DN-5 — RESOLVED**: ศูนย์ตั้งค่า slot/คิวเองใน Donation module (back-office); หน้า public อ่าน slot + ความจุที่เหลือ
- 2026-06-22 — **DN-6 — RESOLVED**: ผู้ส่งกรอกข้อมูลเองทั้งหมด; เลข tracking ขนส่งพัสดุได้มาทีหลัง → donor แก้ผ่านหน้า ticket (`PATCH /public/v1/donations/{tracking_token}`, auth = token)
- 2026-06-22 — **DN-7 — RESOLVED**: extend `donation` ใน schema.md §2.3 เป็น **schema_v 2** (เพิ่ม logistics/booking_ref/donor.line_id+email/items.category+condition+note/tax_receipt_requested) + migration note (1→2, field ใหม่ optional) + เพิ่ม `donation_slot` §2.13 (DN-5); schema.md `updated:` → 2026-06-22
- 2026-06-22 — DN-1 (OTP) / DN-3 (ใบอนุโมทนา) / DN-4 (needs/capacity formula) — ยัง **OPEN**, เจ้าของจะหาคำตอบมาเติมต่อ
