---
id: CR-151
title: Kiosk — เปลี่ยนจาก "เสียบบัตรเพื่อสร้างผู้ลงทะเบียน" เป็น "รายงานตัวผู้ลงทะเบียนล่วงหน้า" (QR / บัตรประชาชน / เบอร์โทร)
status: approved
date: 2026-09-24
created: 2026-09-24
updated: 2026-10-23 # 2026-10-23 rate limit superseded by CR-188 · ข้อเสนอแก้ไข §17 approved โดย Team Lead Soravit Sukkarn (2026-10-20) — พิมพ์ QR จิตอาสา (#609) · 2026-10-18 ทีม kiosk เสนอ §16 (#654): แถว Zone + checklist บน QR label, `zones[].short_name`, reprint คืน `label.zone`/`stations_passed` — รอ PO เคาะ · 2026-10-17 decision sync (#604): ฐาน local ขาด kiosk index → redeploy แล้ว + redeploy/seed deploy index ครบชุด · 2026-10-15 ทีม kiosk ขอเลิกกรอง registered_via ใน §15 (FR-KPC-101/104) · 2026-10-13 ข้อเสนอแก้ไข §15 approved โดย Dev/Team Lead Soravit Sukkarn (รับ requirement จากหัวหน้าโครงการเมื่อวาน 2026-10-12) · 2026-10-04 approved และ merge โดย Soravit Sukkar (Team Lead) + รันเลข CR-151 และลงทะเบียนใน _index.md
requested_by: ทีม kiosk (branch feat/pre-register_kiosk)
decided_by: Soravit Sukkar (Team Lead)
decision_date: 2026-10-04
layer: volatile
supersedes:
  - docs/changes/14-kiosk/CR-097-smart-card-evacuee-draft-flow.md หัวข้อ Change ข้อ 2–3 และ As-Built ข้อ 1 (การสร้าง evacuee จาก kiosk)
  - docs/features/smart-card-registration-spec.md FR-CARD-01..04
affects:
  - docs/features/smart-card-registration-spec.md (FR-CARD-01..04 → ถูกแทนที่)
  - docs/changes/14-kiosk/CR-097-smart-card-evacuee-draft-flow.md (Decision log → ชี้มาที่ CR นี้)
  - docs/data/api-contract.md (เพิ่มหัวข้อ Scanner / Kiosk)
  - docs/data/schema.md §1.1 index ของ evacuee (คงเดิม (ไม่อัปเกรด schema_v; อิงตามเวอร์ชันปัจจุบันของ develop))
  - CONTEXT.md (Report-in — ช่องทาง kiosk)
  - frontend/src/lib/features/kiosk/{domain,data,server,ui}
  - frontend/src/routes/kiosk/** (/, /qr, /phone, /scanner/*)
  - frontend/src/routes/api/v1/scanner/{bootstrap,kiosk/lookup,kiosk/check-in,draft}
  - frontend/src/lib/features/scanners/** · frontend/src/lib/server/scanners/device-credentials.ts
  - frontend/src/lib/server/security/rate-limiter.ts
  - frontend/src/lib/server/shelter-access-design.ts · shelters.admin.ts · features/shelters/server/provisioner.ts · scripts/redeploy-access.ts · scripts/seed/registry-shelters.ts
  - scanner_client/app/{manager,config,scard}.py · scanner_client/tests · scanner_client/README.md
  - (§15 proposed) frontend/src/lib/features/kiosk/server/{kiosk-check-in.server.ts,kiosk-reprint.server.ts} · domain/{check-in-status.ts,identity-method.ts} · application/{reprint-session.svelte.ts,kiosk-label-print.ts} · ui/{identity-method-selector,kiosk-reprint,reprint-member-list,phone-household-picker}.svelte
  - (§16 proposed) docs/data/schema.md shelter master `zones[].short_name` · frontend/src/lib/features/shelters/{domain/schema.ts,ui/zones-facilities-section.svelte}
  - (§16 proposed) frontend/src/lib/features/kiosk/{domain/print-label.ts,application/kiosk-label-image.ts,application/kiosk-label-print.ts,ui/kiosk-label-sheet.svelte,server/kiosk-reprint.server.ts,data/kiosk-check-in.api.ts} · frontend/src/lib/components/qr-id-card.svelte
  - (§16 proposed) frontend/src/lib/features/people/domain/{people.ts,intake-pipeline.ts} · people/ui/evacuee-profile/evacuee-qr-modal.svelte · frontend/src/routes/kiosk/register/done/+page.svelte
  - (§15 proposed) frontend/src/routes/api/v1/kiosk/reprint/+server.ts · frontend/src/routes/kiosk/{reprint,phone}/** · frontend/src/lib/server/security/rate-limiter.ts · kiosk/app/manager.py (allowlist)
  - (§17 approved 2026-10-20) docs/data/api-contract.md §2.1.2 · frontend/src/routes/api/v1/kiosk/volunteer-card/+server.ts · frontend/src/lib/features/kiosk/server/kiosk-volunteer-card.server.ts · frontend/src/lib/server/security/rate-limiter.ts
  - (§17 approved 2026-10-20) frontend/src/lib/features/kiosk/** (label จิตอาสา, session, UI) · frontend/src/routes/kiosk/{print-qr,volunteer}/** · kiosk/app/manager.py (allowlist)
why: >
  Kiosk แบบเดิม (CR-097) สร้าง evacuee จากบัตรโดยไม่มีครัวเรือนและไม่มีเบอร์ เจ้าหน้าที่ต้องกรอกซ้ำที่ Station 1
  และเกิด record ซ้อนกับผู้จองออนไลน์ kiosk รอบนี้จึงทำหน้าที่เดียว คือรับรายงานตัว (Report-in) ผู้ที่ลงทะเบียนล่วงหน้าทางเว็บแล้ว
  ผ่านช่องทางที่ผู้ประสบภัยมีติดตัว (QR ใบจอง บัตรประชาชน เบอร์โทร)
migration: ไม่มี — ไม่มี field ใหม่ ไม่ bump schema_v (คงเดิม (ไม่อัปเกรด schema_v; อิงตามเวอร์ชันปัจจุบันของ develop)); evacuee ที่ `registered_via:'kiosk'` เดิมยังอยู่ และให้เจ้าหน้าที่จัดการที่ Station 1 (ดู §9)
---
# CR-151: Kiosk รับรายงานตัวผู้ลงทะเบียนล่วงหน้า

> **ข้อเสนอแก้ไข 2026-10-13 (proposed, ยังไม่ approve):** §15 ท้ายเอกสาร — หัวข้อหน้าแรก「ลงทะเบียน」· รับ walk-in `registered_via:'kiosk'` · ช่องทางเบอร์ → เมนู「พิมพ์ QR」ยืนยันเลขบัตร 4 ตัวท้าย · ระหว่างรอ PO ข้อความ §1–§14 ยังมีผล

> **ข้อเสนอแก้ไข 2026-10-18 (#654, proposed, รอ PO เคาะ):** §16 ท้ายเอกสาร — QR label มีแถว Zone + checklist ติ๊กตาม station ที่ผ่าน · ตัดเบอร์โทร · shelter `zones[].short_name` · reprint คืน `label.zone` / `label.stations_passed`

> **ข้อเสนอแก้ไข 2026-10-18 (#609, approved 2026-10-20):** §17 ท้ายเอกสาร — เมนู「พิมพ์ QR」เพิ่มทางเลือก「จิตอาสา」พิมพ์ role-card QR ที่มีอยู่แล้วด้วยเบอร์โทร (`POST /api/v1/kiosk/volunteer-card`, อ่านอย่างเดียว) — approved โดย Soravit Sukkarn (Team Lead)

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** kiosk **เลิกสร้าง** evacuee จากบัตร (`POST /api/v1/scanner/draft` → 410) และเปลี่ยนเป็น **รับรายงานตัว (Report-in)** ผู้จองทางเว็บ (`pre_registered → arriving`) ผ่าน 3 ช่องทาง ได้แก่ QR ใบจอง · บัตรประชาชน (ใช้เลข 13 หลักอย่างเดียว) · เบอร์โทร (กำลังพัฒนา) — ThaiD พักไว้ก่อน
> - **เพื่อใคร / ทำไม:** ผู้จองล่วงหน้ารายงานตัวเองได้โดยไม่ต้องต่อคิว เลือกสมาชิกครัวเรือนที่มาถึง และรับ QR สายรัดข้อมือ → ลดคิวที่ Station 1 และไม่เกิด record ซ้ำ
> - **Dev ต้องทำอะไร:** implementation หลัก commit แล้ว; ก่อน release ต้องผ่านการอนุมัติ CR, Svelte autofixer, deploy/`_explain` บน staging และ production และทดสอบ kiosk ตาม M1–M8 รวม AC-KPC-26
> - **กระทบ schema / scope:** ไม่ bump `schema_v` (คงเดิม (ไม่อัปเกรด schema_v; อิงตามเวอร์ชันปัจจุบันของ develop)) · เพิ่มชุด Mango index `KIOSK_LOOKUP_MANGO_INDEXES` 3 ตัว (เบอร์ · เลขบัตร · ครัวเรือน) (ภายหลังเป็น 4 ตัว — CR-149 / #525; ดู FR-KPC-63) แยกจาก index ของ referral · แทนที่ส่วนสร้าง evacuee ของ CR-097 และ FR-CARD-01..04 ของ smart-card spec

---

## 1. เหตุผล

1. **Record ซ้อนกัน:** CR-097 ให้บัตรสร้าง `evacuee` ใหม่ (`registered_via:'kiosk'`, `household_id:null`) แยกจาก booking ทางเว็บของคนคนเดียวกัน เจ้าหน้าที่ต้องรวมเองด้วย `PullPreRegisteredDialog`
2. **ข้อมูลไม่พอใช้งาน:** record ที่ได้จากบัตรไม่มีเบอร์ ไม่มีครัวเรือน ไม่มีความต้องการพิเศษ ยังต้องกรอกที่ Station 1 อยู่ดี kiosk จึงไม่ได้ลดงานจริง
3. **PDPA:** การอ่านชื่อ ที่อยู่ และรูปจากชิป แล้วส่งเข้า server (`card_snapshot.photo_base64`) เป็นการเก็บข้อมูลเกินจำเป็น flow ใหม่ใช้เลข 13 หลักเพื่อค้นหาเท่านั้น และไม่บันทึกลงระบบ
4. **Booking ทางเว็บมีข้อมูลครบอยู่แล้ว** (ครัวเรือน สมาชิก เบอร์ผู้ติดต่อ) สิ่งที่ขาดคือการยืนยันว่า "มาถึงแล้ว" ซึ่งผู้ประสบภัยทำเองที่ kiosk ได้
5. **ผู้ที่ไม่มี QR หรือบัตร** (QR หาย เด็ก ชาวต่างชาติ) ต้องการช่องทางที่ 3 → ใช้เบอร์โทรที่ใช้ตอนจอง

---

## 2. ก่อน → หลัง

| หัวข้อ                             | ก่อน (CR-097 ตามที่ทำจริง 2026-09-11)                                   | หลัง (CR นี้)                                                                                                                      |
| :--------------------------------------- | :-------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| หน้าที่ของ kiosk               | ลงทะเบียน (สร้าง evacuee) จากบัตร                                  | **รับรายงานตัว** ผู้ลงทะเบียนล่วงหน้าทางเว็บ                                                 |
| Endpoint หลัก                        | `POST /api/v1/scanner/draft`                                                          | `POST /api/v1/scanner/kiosk/lookup` + `/kiosk/check-in` · `/draft` → **410**                                                |
| ข้อมูลที่อ่านจากบัตร | ชื่อ เลขบัตร เพศ วันเกิด ที่อยู่ รูป →`card_snapshot` | **เลข 13 หลักเท่านั้น** ไม่บันทึกลงระบบ                                                               |
| ช่องทางยืนยันตัวตน     | บัตรอย่างเดียว                                                            | QR ใบจอง · บัตร · เบอร์โทร (ThaiD พัก)                                                                              |
| Doc ที่เขียน                     | สร้าง`evacuee` ใหม่ `pre_registered` + `registered_via:'kiosk'`          | **ไม่สร้าง doc ใหม่** · แก้ `evacuee.current_stay` → `arriving` และคำนวณ `household.status` ใหม่ |
| ผู้จองซ้ำ / สแกนซ้ำ      | 409`already_pre_registered` ฯลฯ (หน้าจอสีเหลือง)                     | แสดงผลรายงานตัวเดิม ไม่บันทึกซ้ำ · พิมพ์ QR ซ้ำได้ถ้ายังเป็น`arriving`             |
| ครัวเรือน                       | `household_id:null` ให้เจ้าหน้าที่รวมเอง                          | เลือกสมาชิกครัวเรือนที่มาถึงได้บน kiosk                                                                  |
| สิ่งที่ผู้ใช้ได้รับ   | ข้อความ "กรุณาไปพบเจ้าหน้าที่"                               | QR สายรัดข้อมือ (`evacuee:<ULID>` ไม่มีข้อมูลส่วนบุคคล)                                                 |
| ขั้นต่อไปของผู้ใช้     | เจ้าหน้าที่เริ่มฟอร์มลงทะเบียนตั้งแต่ Step 1       | ไปคัดกรองและจัดโซนตาม ADR-0001 โดยใช้ QR                                                                       |

**สิ่งที่ไม่เปลี่ยน:** การยืนยันเครื่อง (`X-Device-Id` + `X-Device-Secret`, `scanner_device` อยู่ใน DB `registry`) · flow ของเจ้าหน้าที่ที่ Station 1 · `schema_v` ของ evacuee (คงเดิม (ไม่อัปเกรด schema_v; อิงตามเวอร์ชันปัจจุบันของ develop))

---

## 3. ขอบเขต

| อยู่ในขอบเขต                                                                                              | อยู่นอกขอบเขต                                                                                                                                                                                                                    |
| :-------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| รับรายงานตัวผู้จองทางเว็บ (`registered_via:'web'`) ในศูนย์ของเครื่อง      | ลงทะเบียน walk-in ที่ kiosk*(หมายเหตุ: ส่วน Walk-in ผ่านบัตรประชาชนได้รับการขยายผลและอนุมัติเพิ่มเติมใน [CR-149](CR-149-kiosk-walk-in-registration.md) แล้ว)* |
| QR ใบจอง · บัตรประชาชน · เบอร์โทร                                                           | **ThaiD** — พักไว้ (ปุ่มยังปิดอยู่ แสดง "ยังไม่เปิดใช้งาน")                                                                                                                                    |
| เลือกสมาชิกครัวเรือน และพิมพ์ QR สายรัดข้อมือ                                 | Unassigned registration (Mongo) — เจ้าหน้าที่ต้อง claim ก่อน                                                                                                                                                              |
| ลงทะเบียนเครื่อง / bootstrap /`scanner_client`                                                      | OTP / SMS                                                                                                                                                                                                                                     |
| ปิด endpoint เดิม`/scanner/draft` (410)                                                                      | ย้าย`scanner_device` ไปไว้ที่ `shelter_{code}` (คำถามค้างใน CR-097 ยังคงเดิม)                                                                                                                             |
| ติดตามงานและข้อกำหนดทั้งหมดใน CR ฉบับนี้โดยตรง (ไม่เปิด task แยก) | บันทึก Device Provenance / Audit Log (เลื่อนไป backlog — ⚠️ ความเสี่ยง Audit Trail Gap หากเกิดข้อพิพาทสวมสิทธิ์รับสายรัดข้อมือ)                                             |
|                                                                                                                       | Kiosk แบบ edge / offline                                                                                                                                                                                                                   |

---

## 4. ลำดับการเปลี่ยนแปลง (ใช้ตรวจย้อนกลับ)

| วันที่ | Commit                                                 | สาระ                                                                                                                                                                         |
| :----------- | :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26   | `394e508f`, `a4fa8be6`                             | เพิ่ม scanner module และ server repository                                                                                                                               |
| 2026-08-29   | `2db7fe0b`, `88c81459`, `648e0066`               | CR-097: บัตร → evacuee draft, คำนวณอายุจากปีเกิด, หารหัสไปรษณีย์                                                                            |
| 2026-08-30   | `ca89a471`, `8d399ac6`, `b9433fe5`, `57a7ef44` | เลิกใช้สถานะ draft เปลี่ยนเป็น`pre_registered` + `kiosk` · ยืนยันเครื่องด้วย header เท่านั้น                                |
| 2026-09-11   | `891b0ca5`                                           | กรอกที่อยู่อัตโนมัติจาก`card_snapshot` (CR-097 as-built)                                                                                                |
| 2026-09-22   | `31c7cb63`, `e22aa87b`                             | kiosk แสดงชื่อศูนย์และชื่อเครื่องจาก bootstrap                                                                                                     |
| 2026-09-23   | `e79dda69`, `fb036054`                             | หน้าเลือกวิธียืนยันตัวตน + สแกน QR                                                                                                                   |
| 2026-09-24   | `52c08e7d`                                           | **API lookup / check-in ของ kiosk** (เริ่มรับรายงานตัว)                                                                                                |
| 2026-09-24   | `59d799cd`, `6079b9af`, `df48dbec`, `90693285` | บัตรใช้ flow ค้นหาเดียวกับ QR · check-in ทั้งครัวเรือนร่วมกันทุกช่องทาง ·`/draft` → 410                                   |
| 2026-09-24   | `acace076`                                           | สแกนซ้ำ → แสดงผลรายงานตัวเดิม                                                                                                                         |
| 2026-09-24   | `094a6fb2`, `22befb27`, `5013e626`, `1a7d2889` | ปรับ layout จอเล็ก · navigation ระหว่างอ่านบัตร                                                                                                        |
| 2026-09-24   | `9bbc592d`                                           | `scanner_client` ยอมรับ HTTP สำหรับ URL ตอนพัฒนา                                                                                                           |
| 2026-09-24   | `bbb244f3`                                           | เพิ่มชุด Mango index ของ kiosk lookup และจุด deploy                                                                                                             |
| 2026-09-24   | `35c471a3`                                           | ใช้ตัวช่วยปิดนามสกุลร่วมกัน                                                                                                                           |
| 2026-09-24   | `18595fd6`                                           | เพิ่มการแปลงรูปแบบเบอร์และจัดกลุ่มผลค้นหา                                                                                               |
| 2026-09-24   | `02679262`                                           | ค้นครัวเรือนจากเบอร์โทร                                                                                                                                   |
| 2026-09-24   | `b8281c79`                                           | ช่องทางเบอร์โทร                                                                                                                                                   |
| 2026-09-24   | `998a6274`, `11f4b4b3`, `bcd87dc2`ห             | allowlist credential · เสียบบัตรซ้ำจากหน้าผล · idle timeout ทุกช่องทาง                                                                          |
| 2026-09-25   | `f7da61f9`                                           | ปิดนามสกุลทุกช่องทาง · แสดงสมาชิกทั้งครัวเรือนและสมาชิกจาก Station 1 แบบเลือกไม่ได้ (FR-KPC-28, FR-KPC-29) |

**ตรวจฐาน local (2026-09-25):** `shelter_sh001`–`shelter_sh004` มี kiosk index ครบ 3 ตัว (`_index` ตอบ `exists`) และ `_explain` ของ selector เบอร์, เลขบัตร, ครัวเรือนแบบมี/ไม่มี `registered_via` เลือก `evacuee-type-phone-idx`, `evacuee-type-person-id-idx`, `evacuee-type-household-idx` ตามลำดับทุกฐาน; ไม่มี `_all_docs` · warm-up `_find` ผ่านทุก selector · ยังไม่ได้ตรวจ staging/production

> **2026-10-17 (decision sync, #604):** ผลตรวจข้างบนทำบน branch `feat/pre-register_kiosk` ก่อน merge เข้า develop (#457, 2026-10-11) — ตรวจซ้ำ 2026-10-17 พบ `shelter_sh001`–`sh004` บน local **ไม่มี** kiosk index (`_explain` เลือก `_all_docs`) เพราะไม่มีการรัน redeploy/seed หลัง #457 · รัน `redeploy-access --write --confirm` แล้ว ทุกฐานเลือก `evacuee-type-person-id-idx` · staging/production ได้ redeploy อัตโนมัติผ่าน `pnpm db:sync` ของ Jenkins ตอน deploy แต่ยังไม่ได้ตรวจ — ดูบันทึกการตัดสินใจ §14

---

## 5. รายการ feature ที่มีอยู่ (ณ 2026-09-25)

สัญลักษณ์: ✅ ทำเสร็จและ commit แล้ว · 🔄 code พร้อมแต่รอ deploy/ตรวจจริง หรือมีงานค้าง · ⬜ ยังไม่ทำ · ⏸ พักไว้

| #    | Feature                                                                                                                                                                       | สถานะ                                                                                                                                            | ไฟล์หลัก                                                                                     |
| :--- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| F-01 | ลงทะเบียนเครื่อง kiosk (เฉพาะ system_admin) · แสดง secret ครั้งเดียว · เก็บเป็น SHA-256                                          | ✅                                                                                                                                                    | `routes/(protected)/system-management/scanners`, `features/scanners`, `api/v1/scanner/devices` |
| F-02 | Bootstrap เครื่อง · retry พร้อม backoff · ล้มเหลวแล้วหยุดทำงาน                                                                              | ✅                                                                                                                                                    | `api/v1/scanner/bootstrap`, `scanner_client/app/manager.py`                                      |
| F-03 | หน้าจอหลักของ kiosk: ชื่อศูนย์ จุดบริการ ชื่อเครื่อง นาฬิกา · ส่งต่อค่าแสดงผล 4 ค่าระหว่างหน้า  | ✅                                                                                                                                                    | `features/kiosk/ui/kiosk-shell.svelte`, `domain/display-context.ts`                              |
| F-04 | หน้าเลือกวิธียืนยันตัวตน (การ์ดเต็มปุ่ม 2×2)                                                                                            | ✅                                                                                                                                                    | `ui/identity-method-selector.svelte`, `domain/identity-method.ts`                                |
| F-05 | ช่องทาง QR (กล้อง · token`evacuee:<ULID>` · กันสแกนรัว 1.5 วินาที)                                                                            | ✅                                                                                                                                                    | `ui/qr-identity-scan.svelte`, `routes/kiosk/qr`                                                  |
| F-06 | ช่องทางบัตรประชาชน (อ่านเลข 13 หลัก · ต้องถอดบัตรก่อนยืนยัน)                                                               | ✅                                                                                                                                                    | `scanner_client/app/{manager,scard}.py`, `routes/kiosk/scanner/*`                                |
| F-07 | ช่องทางเบอร์โทร (numpad · เลือกครัวเรือนเมื่อเจอหลายราย · ปิดนามสกุลบางส่วน · จำกัดจำนวนครั้ง) | 🔄                                                                                                                                                    | `ui/phone-*.svelte`, `ui/kiosk-numpad.svelte`, `routes/kiosk/phone`                            |
| F-08 | ช่องทาง ThaiD                                                                                                                                                          | ⏸                                                                                                                                                    | `domain/identity-method.ts` (ปิดไว้)                                                         |
| F-09 | ค้นหาผู้จองในศูนย์ของเครื่อง                                                                                                                      | ✅ (QR/บัตร) · 🔄 (เบอร์)                                                                                                                   | `server/kiosk-check-in.server.ts`, `api/v1/scanner/kiosk/lookup`                                 |
| F-10 | เลือกสมาชิกครัวเรือน + ยืนยันรายงานตัว                                                                                                     | ✅                                                                                                                                                    | `ui/kiosk-pre-registered-check-in.svelte`, `api/v1/scanner/kiosk/check-in`                       |
| F-11 | สแกนซ้ำ → แสดงผลเดิม ไม่บันทึกซ้ำ                                                                                                               | ✅                                                                                                                                                    | `domain/check-in-status.ts`                                                                        |
| F-12 | พิมพ์ QR สายรัดข้อมือ (กว้าง 80mm, ใน QR ไม่มีข้อมูลส่วนบุคคล)                                                                    | ✅                                                                                                                                                    | `ui/kiosk-pre-registered-check-in.svelte`                                                          |
| F-13 | แถบขั้นตอน (wizard) 5 ขั้น                                                                                                                                      | ✅                                                                                                                                                    | `ui/kiosk-check-in-wizard.svelte`                                                                  |
| F-14 | ปิด endpoint เดิม`/scanner/draft` (410)                                                                                                                              | ✅                                                                                                                                                    | `api/v1/scanner/draft`                                                                             |
| F-15 | Playwright เติม credential ให้เฉพาะ path ที่อนุญาต                                                                                                       | ✅                                                                                                                                                    | `scanner_client/app/manager.py`                                                                    |
| F-16 | ชุด Mango index kiosk lookup (เบอร์ · เลขบัตร · ครัวเรือน)                                                                                          | 🔄 deploy/`_explain` ผ่านบน local; รอ staging/production                                                                                    | `server/shelter-access-design.ts`                                                                  |
| F-17 | Test ของ server และ route lookup / report-in                                                                                                                            | ✅                                                                                                                                                    | `server/*.test.ts`, `api/v1/scanner/kiosk/*/server.test.ts`                                      |
| F-18 | บันทึกว่าเครื่องไหนรับรายงานตัวใคร (Audit Trail / Provenance)                                                                               | ⏸ เลื่อนไป backlog — มีความเสี่ยงด้าน operation/security หากเกิดข้อพิพาทสวมสิทธิ์ (Audit Trail Gap) | —                                                                                                   |
| F-19 | QR / บัตร / เบอร์ แสดงรายชื่อทั้งครัวเรือนเหมือนกันทุกกรณี รวมถึงสแกนซ้ำหลังรายงานตัวแล้ว      | 🔄 โค้ดและ automated tests ผ่าน; รอทดสอบ M1–M5 บน kiosk                                                                          | `ui/kiosk-pre-registered-check-in.svelte`, `server/kiosk-check-in.server.ts`                     |
| F-20 | ปิดนามสกุลบางส่วนทุกช่องทาง (หน้าจอ + สายรัดข้อมือ)                                                                              | 🔄 โค้ดและ automated tests ผ่าน; รอทดสอบ M4 บน kiosk                                                                              | `server/kiosk-check-in.server.ts`                                                                  |
| F-21 | เสียบบัตรใหม่ระหว่างหน้าผลของ flow บัตร + หมดเวลาไม่มีการแตะจอทุกช่องทาง                                       | 🔄 โค้ดและ automated tests ผ่าน; รอทดสอบ M6–M8 บน kiosk                                                                          | `scanner_client/app/manager.py`, `ui/kiosk-pre-registered-check-in.svelte`                       |

---

## 6. Requirements

รหัส `FR-KPC-*` (Kiosk Pre-registration Check-in) · คอลัมน์ "สถานะ" ใช้สัญลักษณ์เดียวกับ §5

### 6.1 เครื่องและ bootstrap

| ID        | Requirement                                                                                                                                                                                                                                                                           | สถานะ |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------- |
| FR-KPC-01 | เฉพาะ`system_admin` สร้างเครื่องได้ โดยระบุ `device_id` (`[A-Za-z0-9_-]` อย่างน้อย 2 ตัว), `name`, `shelter_code`, `station_name` (ค่าเริ่มต้น「จุดคัดกรองทั่วไป」), `status active\|inactive`         | ✅         |
| FR-KPC-02 | แสดง secret (`sk_scan_…`) แบบ plaintext ครั้งเดียวตอนสร้าง ระบบเก็บเฉพาะ `secret_hash` (SHA-256) + `secret_prefix` ใน `scanner_device:{device_id}` DB `registry`                                                                   | ✅         |
| FR-KPC-03 | ทุก request ของ kiosk ต้องยืนยันด้วย header`X-Device-Id` + `X-Device-Secret` (เทียบแบบ timing-safe) · เครื่องที่ไม่รู้จัก, secret ผิด หรือ `inactive` → 401 `DEVICE_AUTH_FAILED` แบบเดียวกันทุกกรณี | ✅         |
| FR-KPC-04 | ศูนย์ของทุก request มาจากข้อมูลเครื่องเท่านั้น ค่าที่ browser ส่งมาใช้แสดงผลอย่างเดียว                                                                                                                             | ✅         |
| FR-KPC-05 | `scanner_client` ต้องเรียก bootstrap ก่อนเปิด browser · ได้ 401 → หยุดทำงาน (exit 79) · ได้ 503 หรือ network ล่ม → retry แบบจำกัดจำนวนครั้งพร้อม backoff                                                          | ✅         |
| FR-KPC-06 | Browser ไม่ถือ secret: Playwright เติม header ให้เฉพาะ`POST` แบบ same-origin ไปที่ `/api/v1/scanner/kiosk/lookup` และ `/check-in` · request อื่นที่แนบ header ปลอมมาจะถูกลบ header ออก                                  | ✅         |
| FR-KPC-07 | ทุก response ของ`/api/v1/scanner/*` ต้องมี `cache-control: no-store`                                                                                                                                                                                                  | ✅         |
| FR-KPC-08 | อัปเดต`last_seen_at` ของเครื่องเมื่อค้นหาสำเร็จ (ล้มเหลวได้โดยไม่กระทบผลค้นหา)                                                                                                                                          | ✅         |

### 6.2 หน้าจอหลักและการนำทาง

| ID        | Requirement                                                                                                                                                                                                                                                             | สถานะ          |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------ |
| FR-KPC-10 | แสดงชื่อศูนย์ จุดบริการ และชื่อเครื่องจาก query`shelter_name`, `shelter_code`, `station_name`, `device_name` · ส่งต่อระหว่างหน้าเฉพาะ 4 ค่านี้                                              | ✅                  |
| FR-KPC-11 | หน้า`/kiosk` แสดงวิธียืนยันตัวตน 4 การ์ด: QR (✅) · บัตร (✅) · เบอร์ (🔄) · ThaiD (⏸ ปิดไว้)                                                                                                                          | ✅/🔄               |
| FR-KPC-12 | ทุกหน้าหลังเลือกวิธีต้องมีปุ่ม「กลับ」และแถบขั้นตอน 5 ขั้น: วิธีค้นหา → สแกน/กรอก → ค้นหา → สมาชิก → เสร็จสิ้น                                                              | ✅                  |
| FR-KPC-13 | ใช้งานได้ครบโดยไม่ต้อง scroll ที่ขนาดจอ 1024×600 และ 540×960                                                                                                                                                                        | ✅                  |
| FR-KPC-14 | ทุกช่องทาง: ไม่มีการแตะจอ 60 วินาทีในหน้าค้นหา / เลือกสมาชิก / ผล → ล้าง state และกลับ`/kiosk` · หยุดนับระหว่างพิมพ์สายรัดข้อมือ                                     | 🔄 รอ manual test |
| FR-KPC-15 | ช่องทางบัตร: หน้าถอดบัตรต้องแสดงคำเตือนค้างไว้ตลอดเวลาที่ยังเสียบบัตร · เริ่มนับเวลาไม่ใช้งาน 60 วินาทีหลังได้รับ`kiosk:smart-card-removed` เท่านั้น | 🔄 รอ manual test |

### 6.3 กฎการค้นหา (ทุกช่องทาง)

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | สถานะ                              |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| FR-KPC-20 | ค้นเฉพาะใน DB`shelter_{code}` ของเครื่อง                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅                                      |
| FR-KPC-21 | ผู้ที่ค้นเจอได้ =`type:'evacuee'` · `shelter_code` ตรงกับเครื่อง · `registered_via:'web'` · `current_stay.status` เป็นหนึ่งใน `pre_registered, arriving, active, room_confirmed, temporary_leave`                                                                                                                                                                                                                                                                                              | ✅                                      |
| FR-KPC-22 | สมาชิกที่แสดง = ผู้ที่ค้นเจอ + evacuee ที่`registered_via:'web'` ใน `household_id` เดียวกัน                                                                                                                                                                                                                                                                                                                                                                                                              | ✅ ถูกแทนที่ด้วย FR-KPC-29 |
| FR-KPC-23 | เลือกรายงานตัวได้ (`selectable`) เมื่อ `registered_via:'web'` และ `status:'pre_registered'`                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅                                      |
| FR-KPC-24 | ไม่พบ หรือพบแต่ไม่เข้าเงื่อนไข (ยกเลิก, ออกแล้ว, ย้ายศูนย์, เสียชีวิต, อยู่ศูนย์อื่น) → 404`PRE_REGISTRATION_NOT_FOUND` ด้วยข้อความเดียวกันทุกกรณี                                                                                                                                                                                                                                                                                           | ✅                                      |
| FR-KPC-25 | ข้อมูลสมาชิกใน response มีเฉพาะ`evacuee_id, first_name, last_name, gender, age, status, is_primary, selectable` · ห้ามมี `phone`, `person_id`, ที่อยู่ หรือข้อมูลสุขภาพ                                                                                                                                                                                                                                                                                                                   | ✅                                      |
| FR-KPC-26 | Response ต้องมี`kind:'household'` และ `name_masked:boolean` เพิ่มเข้ามา (ของเดิมไม่เปลี่ยน · client ที่ได้ response ไม่มี `kind` ให้ถือเป็น household)                                                                                                                                                                                                                                                                                                                            | ✅                                      |
| FR-KPC-27 | หน้าจอต้องเทียบ`shelter_code` ที่ได้จาก server กับที่แสดงบนจอ ถ้าไม่ตรง → แสดง「ข้อมูลศูนย์ของเครื่องสแกนไม่ตรงกัน」และห้ามยืนยัน                                                                                                                                                                                                                                                                                                             | ✅                                      |
| FR-KPC-28 | ทุกช่องทางปิดนามสกุลบางส่วนด้วย`maskLastName` และตอบ `name_masked:true` เสมอ · หน้าจอแสดง「ชื่อถูกปิดบางส่วนเพื่อความเป็นส่วนตัว」· สายรัดข้อมือพิมพ์นามสกุลแบบปิดบางส่วนทุกช่องทาง (QR / บัตร / เบอร์ ตาม FR-KPC-58)                                                                                                                                                                     | 🔄 รอ manual test                     |
| FR-KPC-29 | รายชื่อสมาชิก = ทุกคนใน`household_id` เดียวกันในศูนย์นี้ที่สถานะ `pre_registered` หรือรายงานตัวแล้ว (`arriving, active, room_confirmed, temporary_leave`) · ไม่แสดงคนที่ยกเลิก / ออกแล้ว / ย้ายศูนย์ / เสียชีวิต และคนที่ `privacy.search_excluded:true` · แสดงสมาชิกที่ `registered_via` ไม่ใช่ `web` แต่เลือกไม่ได้ · เลือกได้เฉพาะ FR-KPC-23 · แทน FR-KPC-22 | 🔄 รอ manual test                     |

### 6.4 ช่องทาง QR

| ID        | Requirement                                                                                                                                                                                        | สถานะ |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------- |
| FR-KPC-30 | อ่าน QR ผ่านกล้องหลังของเครื่อง · รับเฉพาะ`evacuee:<ULID>` (ไม่สนตัวพิมพ์เล็ก/ใหญ่ แล้วแปลงเป็นตัวใหญ่)              | ✅         |
| FR-KPC-31 | QR รูปแบบอื่น (รวมถึงใบจองแบบยังไม่ระบุศูนย์ที่เป็น Mongo id) → แสดง「QR นี้ใช้รายงานตัวไม่ได้」และไม่เรียก API | ✅         |
| FR-KPC-32 | ไม่อ่าน QR ซ้ำภายใน 1.5 วินาที · เปิดกล้องไม่ได้ → แสดงปุ่ม「ลองอีกครั้ง」                                                                | ✅         |
| FR-KPC-33 | ค้นหาด้วย`_id` ตรงตัว ได้ไม่เกิน 1 ราย                                                                                                                               | ✅         |

### 6.5 ช่องทางบัตรประชาชน

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                   | สถานะ          |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------ |
| FR-KPC-40 | `scanner_client` อ่าน **เฉพาะเลข 13 หลัก** จากชิป · ห้ามส่งชื่อ ที่อยู่ หรือรูปเข้า server                                                                                                                                                                                                        | ✅                  |
| FR-KPC-41 | เสียบบัตร → หน้า「กำลังอ่านบัตร」(แสดงอย่างน้อยช่วงสั้น ๆ เพื่อไม่ให้จอกระพริบ) → อ่านเสร็จ → หน้าถอดบัตรรับ event`kiosk:smart-card-read`                                                                                                                     | ✅                  |
| FR-KPC-42 | อ่านบัตรไม่สำเร็จ หรือเลขไม่ครบ 13 หลัก → ไปหน้า`/kiosk/scanner/error` พร้อมคำแนะนำ                                                                                                                                                                                                                    | ✅                  |
| FR-KPC-43 | ปุ่มยืนยันรายงานตัวกดได้หลังถอดบัตรแล้วเท่านั้น (`kiosk:smart-card-removed`)                                                                                                                                                                                                                                 | ✅                  |
| FR-KPC-44 | ค้นหาด้วย`_find` บน `person_id.number` · ถ้าพบผู้เข้าเงื่อนไขไม่ใช่ 1 รายพอดี → 404                                                                                                                                                                                                                         | ✅                  |
| FR-KPC-45 | เสียบบัตรขณะอยู่หน้าใดก็ตาม → flow บัตรมาก่อน (พาไปหน้าอ่านบัตรทันที)                                                                                                                                                                                                                              | ✅                  |
| FR-KPC-46 | หลังถอดบัตรแล้ว ระหว่างที่หน้าจอยังอยู่ที่หน้าเลือกสมาชิกหรือหน้าผล ถ้ามีบัตรเสียบเข้ามาใหม่`scanner_client` ต้องเริ่ม flow อ่านบัตรใหม่ทันที (ไม่ต้องรอกลับ `/kiosk`) และ state ของหน้าเดิมถูกล้าง | 🔄 รอ manual test |

### 6.6 ช่องทางเบอร์โทร

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | สถานะ                                            |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------- |
| FR-KPC-50 | หน้า`/kiosk/phone` ใช้ numpad บนจอ (0–9, ลบ, ล้าง) ปุ่มสูงอย่างน้อย 64px · ห้ามใช้คีย์บอร์ดของระบบหรือ autocomplete                                                                                                                                                                                                                                                                                                                        | 🔄                                                    |
| FR-KPC-51 | กดค้นหาได้เมื่อกรอก 9–10 หลักที่ขึ้นต้นด้วย`0` · แสดงผลแบบ `0xx-xxx-xxxx`                                                                                                                                                                                                                                                                                                                                                                              | 🔄                                                    |
| FR-KPC-52 | เก็บเบอร์ไว้ใน state ของหน้าจอเท่านั้น ห้ามอยู่ใน URL,`page.state`, storage หรือ log ของ server (log ตอนพัฒนาแสดงได้แค่ 4 หลักท้าย) · ต้องล้างเบอร์หลังค้นหา เมื่อกดกลับ หรือเมื่อไม่มีการแตะจอ 60 วินาที (แล้วกลับไป `/kiosk`)                                                                                                                      | 🔄                                                    |
| FR-KPC-53 | API รับ`{source:'phone', phone, primary_evacuee_id?}` · server แปลงรูปแบบเบอร์ (ตัดอักขระที่ไม่ใช่ตัวเลข, `66…` → `0…`) ผลต้องตรง `^0\d{8,9}$` ไม่อย่างนั้นตอบ 400                                                                                                                                                                                                                                                           | 🔄                                                    |
| FR-KPC-54 | จับคู่กับเบอร์ของ**สมาชิกคนใดก็ได้** · จัดกลุ่มตาม `household_id` (ถ้าเป็น null ให้เป็นกลุ่มเดี่ยว) · กลุ่มต้องผ่านเงื่อนไข FR-KPC-21                                                                                                                                                                                                                                                                   | 🔄                                                    |
| FR-KPC-55 | คนหลักของกลุ่ม = สมาชิกที่เบอร์ตรงและ`_id === household.head_evacuee_id` → ถ้าไม่มี ใช้คนที่เบอร์ตรงและ `created_at` เก่าที่สุด (เท่ากันให้ดู `_id`)                                                                                                                                                                                                                                                             | 🔄                                                    |
| FR-KPC-56 | พบ 0 กลุ่ม → 404 · 1 กลุ่ม →`kind:'household'` · 2–5 กลุ่ม → `kind:'candidates'` (`primary_evacuee_id, contact_display, member_count, pending_count`) · เกิน 5 → 409 `KIOSK_TOO_MANY_MATCHES`「พบหลายรายการ กรุณาติดต่อเจ้าหน้าที่」                                                                                                                                                                                                | 🔄                                                    |
| FR-KPC-57 | เมื่อผู้ใช้เลือกครัวเรือน → ส่ง`phone + primary_evacuee_id` กลับมา · server ต้องค้นซ้ำและยืนยันว่า id อยู่ในกลุ่มของเบอร์นั้น **และจำนวนกลุ่มไม่เกิน 5** · ไม่ผ่าน → 404 / 409                                                                                                                                                                                                       | ✅                                                    |
| FR-KPC-58 | ช่องทางเบอร์: ปิดนามสกุลบางส่วนของทุกคน (รวมใน`contact_display`) ด้วย `maskLastName` · ตั้ง `name_masked:true` · หน้าจอแสดง「ชื่อถูกปิดบางส่วนเพื่อความเป็นส่วนตัว」                                                                                                                                                                                                                              | 🔄                                                    |
| FR-KPC-59 | จำกัดจำนวนครั้งเฉพาะช่องทางเบอร์ (นับหลังยืนยันเครื่องผ่านแล้ว): 10 ครั้ง/นาที/เครื่อง และ 5 ครั้ง/นาที/เบอร์สำหรับค้นหาเบื้องต้น · request ที่มี`primary_evacuee_id` ข้าม limit ต่อเบอร์แต่ยังนับ limit ต่อเครื่อง · เกินตอบ 429 `KIOSK_RATE_LIMITED` + `retry-after: 60` · หน้าจอปิดปุ่มลองใหม่ 60 วินาที | 🔄                                                    |
| FR-KPC-60 | ช่องทางเบอร์: ถ้ามีสมาชิกที่เลือกได้อย่างน้อย 1 คน ให้ไปหน้าเลือกสมาชิก (เลือกให้ทุกคนที่เลือกได้ไว้ก่อน) · แสดงผลรายงานตัวเดิมทันทีเฉพาะเมื่อไม่มีใครเลือกได้เลย                                                                                                                                                                                    | 🔄                                                    |
| FR-KPC-61 | evacuee ที่ตั้ง`privacy.search_excluded:true` ค้นด้วยเบอร์ไม่พบ และได้ผลลัพธ์ 404 `PRE_REGISTRATION_NOT_FOUND` เสมือนไม่พบข้อมูล                                                                                                                                                                                                                                                                                                                 | 🔄                                                    |
| FR-KPC-62 | Mango index`['type','phone']` ในชุด `KIOSK_LOOKUP_MANGO_INDEXES` deploy ตอนสร้างศูนย์ใหม่, admin redeploy, `scripts/redeploy-access.ts` และ seed; query ใช้ exact match ต่อค่าที่จัดเก็บและ query ค่า `+66…` เพิ่มเพื่อรองรับข้อมูลเก่า                                                                                                                                                                               | 🔄 (local ผ่าน; รอ staging/production)          |
| FR-KPC-63 | ชุด`KIOSK_LOOKUP_MANGO_INDEXES` มี **4 ตัว** (decision sync 2026-10-17, #604): `['type','phone']` (`evacuee-type-phone-idx`) · `['type','person_id.number']` (`evacuee-type-person-id-idx`) · `['type','household_id']` (`evacuee-type-household-idx`) · `['type','card_snapshot.address_no']` (`evacuee-type-card-address-no-idx`, เพิ่มโดย CR-149 / #525 สำหรับ walk-in lookup ตามบัตร) · ไม่มี `shelter_code` ใน index                                                                                                                                                                                                                        | 🔄 (local ผ่าน; รอ staging/production)          |
| FR-KPC-64 | ชุด index ของ kiosk deploy ด้วย function / loop / step ของตัวเองทุกจุด (provisioner, admin redeploy,`scripts/redeploy-access.ts`, seed) · `REFERRAL_MANGO_INDEXES` และ `deployReferralMangoIndexes` แยกเดิม · redeploy script warm-up 1 query ต่อ index หลังสร้าง                                                                                                                                                                                   | ✅ (code commit แล้ว; deploy จริงยังรอ)  |
| FR-KPC-65 | ทุก`_find` ของ kiosk (ค้นบัตร, ขยายครัวเรือน, คำนวณสถานะครัวเรือน, นับสมาชิกตอนแสดงตัวเลือกครัวเรือน) ใช้ equality บน field ที่มี index · ไม่มี `$in`; ตัวเลือกครัวเรือนค้นทีละครัวเรือน ไม่เกิน 5 ครั้ง                                                                                                                                                    | ✅ (code commit แล้ว; local`_explain` ผ่าน) |

### 6.7 เลือกสมาชิกและยืนยันรายงานตัว

| ID        | Requirement                                                                                                                                                                                                                                                                                                         | สถานะ |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------- |
| FR-KPC-70 | QR / บัตร: เลือกคนที่ถูกสแกนไว้ก่อน (ถ้าเลือกได้) · ผู้ใช้ติ๊กสมาชิกอื่นเพิ่มหรือเอาออกได้ · สมาชิกที่เลือกไม่ได้ให้แสดงสถานะแต่ติ๊กไม่ได้                                              | ✅         |
| FR-KPC-71 | `POST /kiosk/check-in` รับ `primary_evacuee_id` + `evacuee_ids` จำนวน 1–20 · ตัด id ที่ซ้ำออก                                                                                                                                                                                           | ✅         |
| FR-KPC-72 | Server ต้องตรวจว่าคนหลักและสมาชิกแต่ละคนอยู่ศูนย์เดียวกัน ครัวเรือนเดียวกับคนหลัก เป็น`web` และไม่มี `privacy.search_excluded:true` ก่อนรับรายงานตัว · ไม่ผ่าน → `not_eligible` / `not_found` | ✅         |
| FR-KPC-73 | ถ้าเป็น`pre_registered` → PUT `current_stay: {status:'arriving', zone:null, since:<เวลาปัจจุบัน>}` + `updated_at` พร้อม `_rev` ล่าสุด → ตอบ `checked_in` + `qr_payload = evacuee_id`                                                                                 | ✅         |
| FR-KPC-74 | สถานะอื่น →`already_checked_in` (มี `qr_payload` เฉพาะ `arriving`) หรือ `not_eligible` · ถ้าเขียนแล้วชน (conflict) → อ่านใหม่แล้วรายงานตามสถานะจริง                                                                                      | ✅         |
| FR-KPC-75 | เมื่อมีคน`checked_in` อย่างน้อย 1 คน → คำนวณ `household.status` ใหม่ด้วย `deriveHouseholdStatus` (ถ้าล้มเหลวต้องไม่ทำให้การรายงานตัวล้มตาม)                                                                                         | ✅         |
| FR-KPC-76 | ครัวเรือนเกิน 20 คน: ทุกช่องทางแบ่งส่งครั้งละไม่เกิน 20 และยืนยันได้ครบ · ถ้าชุดถัดไปล้มเหลว ต้องแสดงผล/QR ของชุดที่สำเร็จและให้ลองรายการค้างซ้ำได้                               | ✅         |
| FR-KPC-77 | ทุก request จากหน้าจอมี timeout 10 วินาที → แสดง「เชื่อมต่อช้า กรุณาลองอีกครั้ง」                                                                                                                                                                              | 🔄         |

### 6.8 สแกนซ้ำและสิ่งที่ผู้ใช้ได้รับ

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | สถานะ                              |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| FR-KPC-80 | QR / บัตร: ถ้าคนที่ถูกสแกนรายงานตัวไปแล้ว → ข้ามหน้าเลือกสมาชิก แสดง「พบผลรายงานตัวเดิม ไม่มีการบันทึกซ้ำ」เฉพาะคนที่ถูกสแกน                                                                                                                                                                                                                                                                                                    | ✅ ถูกแทนที่ด้วย FR-KPC-83 |
| FR-KPC-81 | พิมพ์สายรัดข้อมือเฉพาะคนที่มี`qr_payload` · ใบละ 1 คน มีชื่อ ศูนย์ QR (`evacuee:<ULID>`) และข้อความ「สแกน QR นี้เพื่อค้นหาข้อมูลในศูนย์พักพิง」                                                                                                                                                                                                                                                                                             | ✅                                      |
| FR-KPC-82 | กด「เสร็จสิ้น」→ กลับหน้าเริ่มของช่องทางนั้น (บัตร →`/kiosk`) และล้าง state ทั้งหมด                                                                                                                                                                                                                                                                                                                                                                                              | ✅                                      |
| FR-KPC-83 | ทุกช่องทางใช้กฎเดียวกันหลังค้นเจอ: มีสมาชิกเลือกได้อย่างน้อย 1 คน → หน้าเลือกสมาชิก (QR / บัตร เลือกไว้ก่อนเฉพาะคนที่ถูกสแกนถ้าเลือกได้ · เบอร์เลือกทุกคนที่เลือกได้) · ไม่มีใครเลือกได้ → หน้าผลแสดงทุกคนที่รายงานตัวแล้ว และพิมพ์ QR ซ้ำได้ทุกคนที่ยัง`arriving` · แทน FR-KPC-80 และรวม FR-KPC-60 | 🔄 รอ manual test                     |

### 6.9 ของเดิมที่ปิดไป

| ID        | Requirement                                                                                                                                                 | สถานะ |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------- |
| FR-KPC-90 | `POST /api/v1/scanner/draft` ยืนยันเครื่องแล้วตอบ 410 `KIOSK_DRAFT_DISABLED` เสมอ · ไม่สร้างหรือแก้ doc ใด ๆ | ✅         |
| FR-KPC-91 | `scanner_client` ไม่เรียก `read_all_data()` ใน flow ปกติ (`test_card.py` ใช้ตรวจฮาร์ดแวร์เท่านั้น)              | ✅         |

---

## 7. API Contract

| Endpoint                                | Request                                                                                                               | 200                                                                                                                                     | Error                                                                                                                                                                        |
| :-------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/scanner/bootstrap`      | `{client_version}`                                                                                                  | `{device:{device_id,name,shelter_code,shelter_name,station_name,status,last_seen_at}, server_time}`                                   | 401`DEVICE_AUTH_FAILED` · 503 `DEPENDENCY_UNAVAILABLE`                                                                                                                  |
| `POST /api/v1/scanner/kiosk/lookup`   | `{source:'smart-card', citizen_id}` · `{source:'qr', token}` · `{source:'phone', phone, primary_evacuee_id?}` | `{kind:'household', name_masked, shelter_code, primary_evacuee_id, members[]}` · `{kind:'candidates', shelter_code, candidates[]}` | 400`INVALID_GATE_INPUT` · 401 · 404 `PRE_REGISTRATION_NOT_FOUND` · 409 `KIOSK_TOO_MANY_MATCHES` · 429 `KIOSK_RATE_LIMITED` · 503 · 500 `KIOSK_LOOKUP_FAILED` |
| `POST /api/v1/scanner/kiosk/check-in` | `{primary_evacuee_id, evacuee_ids[1..20]}`                                                                          | `{shelter_code, members:[{evacuee_id, status, stay_status?, qr_payload?}]}`                                                           | 400`INVALID_CHECK_IN_INPUT` · 401 · 503 · 500 `KIOSK_CHECK_IN_FAILED`                                                                                                 |
| `POST /api/v1/scanner/draft`          | —                                                                                                                    | —                                                                                                                                      | **410 `KIOSK_DRAFT_DISABLED`** · 401 · 503                                                                                                                         |
| `POST /api/v1/scanner/devices`        | `scannerDeviceInputSchema` (session ของ `system_admin`)                                                        | ข้อมูลเครื่อง +`plaintext_secret` (ครั้งเดียว)                                                                 | 403 · 404 ไม่พบศูนย์ · 409`CONFLICT` · 503                                                                                                                    |

ค่า `member.status` ที่ API report-in ส่งกลับ (คง enum เดิม): `checked_in` · `already_checked_in` · `not_found` · `not_eligible` · `failed`

---

## 8. ผลกระทบต่อข้อมูล

| Doc                           | การเปลี่ยน                                                                                                                                                          | schema_v                                                                                                 |
| :---------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| `evacuee`                   | แก้`current_stay` (`pre_registered → arriving`, `zone:null`, `since`) + `updated_at` — ไม่มี field ใหม่                                               | คงเดิม (ไม่อัปเกรด schema_v; อิงตามเวอร์ชันปัจจุบันของ develop) |
| `household`                 | คำนวณ`status` ใหม่ (ค่าที่ derive มา)                                                                                                                      | คงเดิมที่ schema_v 6 (อิงตาม develop ล่าสุด — CR-148)                                                             |
| `scanner_device` (registry) | `last_seen_at`                                                                                                                                                              | คงเดิม (schema_v 1)                                                                                         |
| Mango index                   | ชุด`KIOSK_LOOKUP_MANGO_INDEXES`: เบอร์ + เลขบัตร + ครัวเรือน (FR-KPC-63) · แยกจาก index ของ referral · ไม่มี field ใหม่ใน doc | —                                                                                                       |
| `card_snapshot`             | kiosk**เลิกเขียน** · field ยังอยู่ใน schema สำหรับ record เก่า                                                                             | คงเดิม                                                                                             |

---

## 9. การย้ายข้อมูล

- ไม่ bump `schema_v` (คงเดิม (ไม่อัปเกรด schema_v; อิงตามเวอร์ชันปัจจุบันของ develop)) · ไม่แก้ doc ที่บันทึกไว้แล้ว
- evacuee ที่ `registered_via:'kiosk'` ซึ่งสร้างก่อนปิด `/draft` ยังอยู่ใน `shelter_{code}` · kiosk ใหม่ **ไม่** รับรายงานตัวให้ (ค้นเฉพาะ `web`) → ให้เจ้าหน้าที่จัดการที่ Station 1 / `PullPreRegisteredDialog` ตามเดิม
- Index ใหม่: ศูนย์ใหม่ได้ตอนสร้างศูนย์ · ศูนย์เดิมรัน `pnpm redeploy:access` (dry-run) แล้ว `pnpm redeploy:access --write --confirm` หรือ admin redeploy · ระหว่างที่ยังไม่ deploy `_find` ยังทำงานได้ แต่ต้องไล่อ่านทั้ง DB
- CouchDB build index ตอนค้นครั้งแรก → redeploy script ยิง query อุ่นเครื่องหลังสร้าง (FR-KPC-64) เพื่อไม่ให้ผู้ใช้คนแรกที่ kiosk ต้องรอ
- Index ชื่อเดิมระหว่างพัฒนา (`evacuee-type-shelter-phone-idx`) ยังไม่เคย merge จึงไม่มีใน staging / prod · เครื่อง dev ที่เคย seed ไว้ลบเองได้
- ย้อนกลับ: ลบ index ของชุด kiosk ได้โดยไม่กระทบ referral · query ยังทำงานได้แบบไล่อ่านทั้ง DB
- `scanner_client` ที่ติดตั้งแล้วไม่ต้องอัปเดตเพื่อใช้ช่องทางเบอร์ (ใช้ `/lookup` เดิม)

---

## 10. เกณฑ์ตรวจรับ (Acceptance criteria)

| AC        | สิ่งที่ตรวจ                                                                                                                                                                               | อ้าง FR-KPC |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------- |
| AC-KPC-01 | เครื่องที่`inactive` หรือ secret ผิด → bootstrap ได้ 401 และ `scanner_client` หยุดทำงาน                                                                         | 03, 05          |
| AC-KPC-02 | Request จาก browser ที่ปลอม`X-Device-Secret` ไปยัง path อื่น → header ถูกลบออก                                                                                         | 06              |
| AC-KPC-03 | QR ใบจองของศูนย์นี้ → เห็นสมาชิกครัวเรือน · QR ของศูนย์อื่น → 404                                                                                  | 20, 24, 33      |
| AC-KPC-04 | QR ใบจองแบบยังไม่ระบุศูนย์ → 「QR นี้ใช้รายงานตัวไม่ได้」และไม่มี request ไป`/lookup`                                                       | 31              |
| AC-KPC-05 | เสียบบัตรค้างไว้ → กดปุ่มยืนยันไม่ได้จนกว่าจะถอดบัตร                                                                                               | 43              |
| AC-KPC-06 | ยืนยัน 2 คนจาก 3 คน → เฉพาะ 2 คนนั้นเป็น`arriving` และ household status อัปเดต                                                                               | 73, 75          |
| AC-KPC-07 | สแกนซ้ำคนที่`arriving` → เห็นผลเดิมและพิมพ์ QR ได้ · คนที่ `active` → เห็นผลเดิม ไม่มี QR                                                | 74, 80          |
| AC-KPC-08 | เจ้าหน้าที่เปลี่ยนสถานะระหว่างค้นหากับกดยืนยัน → ผลเป็น`already_checked_in` ไม่ใช่ error                                                | 74              |
| AC-KPC-09 | `POST /scanner/draft` → 410 และไม่มี doc ใหม่ใน DB                                                                                                                                  | 90              |
| AC-KPC-10 | เบอร์: เบอร์ของสมาชิกที่ไม่ใช่หัวหน้า → ได้ครัวเรือนเต็ม และนามสกุลถูกปิดบางส่วน                                          | 54, 58          |
| AC-KPC-11 | เบอร์: ใช้ร่วมกัน 2 ครัวเรือน → ให้เลือก 2 รายการ · 6 ครัวเรือน → 409                                                                              | 56              |
| AC-KPC-12 | เบอร์:`primary_evacuee_id` ไม่อยู่ในกลุ่มของเบอร์ → 404 · มีเกิน 5 กลุ่มแล้วส่ง id มา → 409                                                      | 57              |
| AC-KPC-13 | เบอร์: ค้นครั้งที่ 11 ภายใน 1 นาทีจากเครื่องเดียว → 429                                                                                                     | 59              |
| AC-KPC-14 | เบอร์: ตลอด flow ไม่มีเบอร์ใน URL, history หรือ storage · ไม่แตะจอ 60 วินาที → กลับ`/kiosk`                                                           | 52              |
| AC-KPC-15 | เบอร์: คนที่เบอร์ตรงรายงานตัวแล้ว แต่สมาชิกคนอื่นยัง → ยังเลือกสมาชิกที่เหลือได้                                          | 60              |
| AC-KPC-16 | เบอร์: ค้นได้จริงกับ CouchDB (ไม่ใช่แค่ผ่าน mock) — ทดสอบแบบ integration หรือ manual                                                                     | 53–56          |
| AC-KPC-17 | ครัวเรือน 25 คน → ยืนยันได้ครบทุกช่องทาง                                                                                                                           | 76              |
| AC-KPC-18 | หลัง redeploy:`_explain` ของ query ค้นเบอร์ใช้ `evacuee-type-phone-idx` (ไม่ใช่ `_all_docs`)                                                                           | 62              |
| AC-KPC-19 | หลัง redeploy`_explain` ของค้นบัตร / ขยายครัวเรือน / คำนวณสถานะครัวเรือนใช้ index ที่กำหนด ไม่ใช้ `_all_docs`                     | 63, 65          |
| AC-KPC-20 | `git diff develop` ไม่มีการเปลี่ยน `REFERRAL_MANGO_INDEXES` หรือ `deployReferralMangoIndexes`                                                                               | 64              |
| AC-KPC-21 | บัตรหัวหน้า`arriving` + สมาชิกอีก 2 คน `pre_registered` → เสียบบัตรหัวหน้าซ้ำ → เห็น 3 คน และรายงานตัว 2 คนที่เหลือได้ | 29, 83          |
| AC-KPC-22 | ทั้ง 3 คน`arriving` → เสียบบัตรซ้ำ → หน้าผลแสดง 3 คน และพิมพ์ QR ได้ 3 ใบ                                                                             | 83              |
| AC-KPC-23 | หน้าผลของ flow บัตรค้างอยู่ แล้วเสียบบัตรใหม่ → เริ่มอ่านบัตรใหม่ภายใน 1 รอบ polling                                                 | 46              |
| AC-KPC-24 | QR / บัตร: ไม่แตะจอ 60 วินาทีที่หน้าผล → กลับ`/kiosk` · ระหว่างพิมพ์ไม่ตัด                                                                      | 14              |
| AC-KPC-25 | QR / บัตร / เบอร์: นามสกุลบนหน้าจอและบนสายรัดข้อมือถูกปิดบางส่วน                                                                               | 28              |
| AC-KPC-26 | เสียบบัตรค้างเกิน 60 วินาที → ยังเห็นคำเตือนให้ดึงบัตร · หลังดึงบัตรแล้วไม่แตะจอ 60 วินาที → กลับ`/kiosk`       | 14, 15          |
| AC-KPC-27 | ส่ง`evacuee_id` ของสมาชิกที่ตั้ง `search_excluded:true` หรือใช้เป็นคนหลักโดยตรง → `not_eligible` และไม่มี PUT                               | 72              |

---

## 11. กรณีขอบ (Edge cases)

| ID   | กรณี                                                                                                                                  | ผลที่ต้องได้                                                                                            |
| :--- | :---------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| E-01 | Server ไม่ตอบเกิน 10 วินาที                                                                                               | แสดงข้อความเชื่อมต่อช้า + ปุ่มลองใหม่                                             |
| E-02 | เครื่องถูกตั้งเป็น`inactive` ระหว่างใช้งาน                                                               | request ถัดไปได้ 401 → 「ไม่สามารถยืนยันเครื่อง kiosk ได้」                       |
| E-03 | เปิด`/kiosk` จาก browser ทั่วไปโดยไม่มี `scanner_client`                                                         | lookup / check-in ได้ 401 เพราะไม่มี header                                                            |
| E-04 | มีคนแก้ query แสดงผลให้`shelter_code` ผิด                                                                            | FR-KPC-27 บล็อกการยืนยัน · server ยังใช้ศูนย์จากข้อมูลเครื่อง             |
| E-05 | QR ใบจองของครัวเรือนที่ถูกยกเลิก                                                                             | 404                                                                                                                 |
| E-06 | บัตรที่มี record web 2 รายในศูนย์เดียวกัน (จองซ้ำ)                                                       | 404 → ติดต่อเจ้าหน้าที่ (FR-KPC-44)                                                               |
| E-07 | บัตรของคนที่มี record`registered_via:'kiosk'` เดิม                                                                    | 404 → ติดต่อเจ้าหน้าที่ที่ Station 1                                                           |
| E-08 | อ่านบัตรไม่สำเร็จ หรือถอดบัตรเร็วเกินไป                                                             | หน้า error + คำแนะนำ                                                                                     |
| E-09 | ไม่มีกล้อง หรือไม่ได้รับสิทธิ์ใช้กล้อง                                                               | 「เปิดกล้องไม่ได้」+ ปุ่มลองอีกครั้ง                                                  |
| E-10 | เสียบบัตรขณะอยู่หน้า QR หรือหน้าเบอร์                                                                    | flow บัตรมาก่อน · state ของหน้าเดิมหายไป                                                 |
| E-11 | สมาชิกที่เจ้าหน้าที่เพิ่มเอง (`registered_via` ไม่ใช่ `web`) ในครัวเรือนเดียวกัน | แสดงสถานะและชื่อที่ปิดนามสกุล แต่เลือกไม่ได้ (FR-KPC-29)                 |
| E-12 | ครัวเรือนเกิน 20 คน                                                                                                        | แบ่งส่งครั้งละไม่เกิน 20 คนตาม FR-KPC-76                                                  |
| E-13 | พิมพ์ไม่สำเร็จ หรือสร้างรูป QR ไม่ได้                                                                     | 「สร้าง QR สำหรับพิมพ์ไม่สำเร็จ」+ พิมพ์ซ้ำได้ (ไม่รายงานตัวซ้ำ) |
| E-14 | เบอร์: กรอก`+66…` มีขีด หรือเบอร์บ้าน 9 หลัก                                                            | แปลงรูปแบบแล้วค้นได้                                                                            |
| E-15 | เบอร์: doc เก็บเบอร์ไว้ในรูปแบบอื่น (เช่นมีขีด)                                                     | ค้นไม่พบ (ข้อจำกัดที่รู้อยู่แล้ว)                                                     |
| E-16 | เบอร์: ตอนจองเลือก「ไม่มีเบอร์」                                                                                | 404 + แนะนำให้ใช้ QR / บัตร / ติดต่อเจ้าหน้าที่                                     |
| E-17 | เบอร์: มีคนไล่เดาเบอร์                                                                                                | 429 + ปิดนามสกุลบางส่วน + 404 แบบเดียวกันทุกกรณี                                 |
| E-18 | เบอร์: ครอบครัวที่ใช้เบอร์ร่วมกันกดกลับหรือลองใหม่หลายรอบ                          | อาจชนเพดาน 5 ครั้ง/นาที/เบอร์ (FR-KPC-59)                                                   |
| E-19 | Server รันหลาย instance                                                                                                            | ตัวจำกัดจำนวนครั้งนับแยกต่อ process (ข้อจำกัดที่รู้อยู่แล้ว)       |
| E-20 | หมดเวลาไม่มีการแตะจอระหว่างพิมพ์สายรัดข้อมือ                                                  | ต้องไม่ตัดการพิมพ์ (หยุดนับเวลาขณะพิมพ์)                                       |
| E-21 | เสียบบัตรใบเดิมซ้ำระหว่างหน้าผลยังค้าง                                                              | เริ่ม flow ใหม่ แสดงผลเดิม ไม่บันทึกซ้ำ (FR-KPC-46)                                  |
| E-22 | คนถัดไปเสียบบัตรตัวเองระหว่างหน้าผลของครอบครัวก่อนหน้ายังค้าง                | เริ่ม flow ของคนใหม่ · รายชื่อครอบครัวก่อนหน้าหายจากจอ (FR-KPC-46)    |
| E-23 | ครัวเรือนมีสมาชิกที่เจ้าหน้าที่เพิ่มที่ Station 1 (`registered_via` ไม่ใช่ `web`)        | แสดงสมาชิกแต่ละคนที่เข้าเกณฑ์สถานะ โดยไม่ให้เลือก                   |
| E-24 | คนที่ถือบัตรรายงานตัวแล้ว แต่สมาชิกคนอื่นยัง`pre_registered`                                 | แสดงทั้งครัวเรือน และเลือกรายงานตัวสมาชิกที่ยังรอได้             |
| E-25 | เสียบบัตรค้างไว้และไม่มีการแตะจอเกิน 60 วินาที                                                  | คงคำเตือนให้ดึงบัตรไว้บนจอ; เริ่มนับ 60 วินาทีหลังดึงบัตร        |

---

## 12. ช่องว่างที่พบจาก review และสถานะ

| #       | ปัญหา                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ไฟล์                                                                                             | อ้าง             |
| :------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------- | :------------------- |
| G-1 ✅  | เพิ่ม`type` ใน projection และให้ mock ตัด field ตาม `fields` เพื่อจำลอง Mango จริง                                                                                                                                                                                                                                                                                                                                                                                             | `kiosk/server/kiosk-check-in.server.ts` และ test                                                | FR-KPC-53, AC-KPC-16 |
| G-2 ✅  | เช็คเพดาน 5 กลุ่มก่อนแยกทางเลือก`primary_evacuee_id`                                                                                                                                                                                                                                                                                                                                                                                                                                 | `lookupByPhone`                                                                                    | FR-KPC-57            |
| G-3 ✅  | ทุก gate ส่งครั้งละไม่เกิน 20; ผลบางส่วนกับ QR ยังแสดง และปุ่ม retry ส่งเฉพาะรายการค้าง                                                                                                                                                                                                                                                                                                                                                             | `kiosk/data/kiosk-check-in.api.ts`, `kiosk/ui/kiosk-pre-registered-check-in.svelte`              | FR-KPC-76            |
| G-4 ✅  | เพิ่ม test ของ`checkInSelectedMembers` และ route `/kiosk/check-in`                                                                                                                                                                                                                                                                                                                                                                                                                                   | `kiosk-check-in.api.test.ts`, `check-in/server.test.ts`                                          | F-17                 |
| G-5 🔄  | Phone index และ exact-match query (FR-KPC-62) ผ่าน`_explain` บน local ทั้ง 4 ฐาน; รอ staging/production                                                                                                                                                                                                                                                                                                                                                                                         | `shelter-access-design.ts`                                                                         | FR-KPC-62            |
| G-9 🔄  | Index ค้นบัตรและครัวเรือนผ่าน`_explain` ทั้ง 4 selector บน local ทั้ง 4 ฐาน ไม่มี `_all_docs`; รอ staging/production                                                                                                                                                                                                                                                                                                                                                 | `kiosk-check-in.server.ts`, `shelter-access-design.ts`                                           | FR-KPC-63, FR-KPC-65 |
| G-10 ✅ | `scripts/redeploy-access.ts` และ `scripts/seed/registry-shelters.ts` แยก deploy index kiosk จาก loop/function ของ referral แล้ว (commit `bbb244f3`)                                                                                                                                                                                                                                                                                                                                           | `frontend/scripts/*`                                                                               | FR-KPC-64            |
| G-6 ⏸  | ไม่บันทึกว่าเครื่องใดทำรายงานตัวใน CR นี้; provenance และ audit log การค้นเบอร์เลื่อนไป backlog (⚠️ ข้อสังเกตความเสี่ยงด้าน Operation & Security: หากเกิดข้อพิพาทสวมสิทธิ์รับสายรัดข้อมือหรือสถานะเปลี่ยน จะตรวจย้อนหลังไม่ได้ว่าทำจาก kiosk หรือ station ใด ต้องดึงกลับมาทำเป็นลำดับความสำคัญสูง) | —                                                                                                   | F-18                 |
| G-7 ✅  | หยุดและเริ่ม idle timer ใหม่รอบการพิมพ์สายรัดข้อมือ                                                                                                                                                                                                                                                                                                                                                                                                                          | `ui/phone-identity-entry.svelte`                                                                   | E-20                 |
| G-8 ⏸  | `scanner_client/.env.example` ตั้งขนาดหน้าต่าง 1024×600 แต่ค่าเริ่มต้นในโค้ดเป็น 540×960 · ยังไม่มี `BOOTSTRAP_*` และ `CLIENT_VERSION` (บันทึกเป็น backlog ติดตามแก้ไขใน PR ถัดไปของ `scanner_client`)                                                                                                                                                                                                                 | `scanner_client/`                                                                                  | —                   |
| G-11 🔄 | แก้ polling เสียบบัตรซ้ำและ idle timeout ทุกช่องทางแล้ว; automated tests ผ่าน · รอ manual test M6–M8 บน kiosk                                                                                                                                                                                                                                                                                                                                                             | `scanner_client/app/manager.py`, `kiosk/ui/*`, `routes/kiosk/scanner/remove-card/+page.svelte` | FR-KPC-14, FR-KPC-46 |
| G-12 🔄 | แสดงสมาชิกทั้งครัวเรือนทุกช่องทาง, รวมสมาชิกที่เจ้าหน้าที่เพิ่มแบบเลือกไม่ได้, และแสดงผลรายงานตัวเดิมพร้อม QR ที่ยังพิมพ์ซ้ำได้; automated tests ผ่าน · รอ manual test M1–M5 บน kiosk                                                                                                                                                                                              | `kiosk/server/kiosk-check-in.server.ts`, `kiosk/ui/kiosk-pre-registered-check-in.svelte`         | FR-KPC-29, FR-KPC-83 |
| G-13    | Seed มี`registered_via` ปนกันในครัวเรือน · FR-KPC-29 รองรับการแสดงสมาชิกที่ไม่ใช่ `web` แบบเลือกไม่ได้แล้ว · ใช้ seed ทดสอบรายชื่อได้ แต่ AC-KPC-21/22 ต้องจัดสถานะสมาชิกให้ตรงกับกรณีทดสอบ                                                                                                                                                                                          | `frontend/scripts/seed/*`                                                                          | FR-KPC-29, FR-KPC-83 |

**ผลแก้ review รอบ 2026-09-25:** code commit `14a6a1f2` เริ่ม idle timer หลังถอดบัตร, ใช้กฎ opt-out เดียวกันใน lookup และ check-in, ปรับ `untrack` / `$derived` / generation guard · unit tests ที่เกี่ยวข้อง 40 รายการผ่าน, `svelte-check` ไม่มี error/warning, ESLint ผ่าน, `svelte-autofixer` ไม่พบ issue ใน 3 ไฟล์ที่แก้ · `docs/data/schema.md` และ CR ฉบับนี้ยังอยู่ใน working tree ตามคำสั่งเจ้าของโครงการ ไม่ commit เอกสารก่อน · คง `id: draft`, `status: proposed`; ยังไม่รันเลข CR

**ผลแก้ review รอบ 2026-10-04 (PR #309 Attempt 1/3):** ปรับปรุงเอกสารตามข้อสังเกตของ PR review:

1. อัปเดตจุดอ้างอิง `schema_v` ของ `evacuee` ใน frontmatter, §2, §8 และ §9 เป็น "คงเดิม (ไม่อัปเกรด schema_v; อิงตามเวอร์ชันปัจจุบันของ develop)" เนื่องจากไม่มี field ใหม่ (เพียงเปลี่ยน current_stay.status เป็น arriving)
2. เพิ่มหมายเหตุกำกับใน §3 ขอบเขต เชื่อมโยงว่า walk-in ผ่านบัตรประชาชนได้รับการขยายผลและอนุมัติใน [CR-149](CR-149-kiosk-walk-in-registration.md) แล้ว
3. บันทึกคำเตือนความเสี่ยงด้าน Operation และ Security เรื่อง Audit Trail Gap (FR-KPC-18, G-6) หากเกิดข้อพิพาทสวมสิทธิ์รับ QR สายรัดข้อมือ
4. ปรับสถานะ G-8 เป็น backlog (`⏸`) ติดตามแก้ไข config window size และ env variables ใน PR ถัดไปของ `scanner_client`
5. ปรับการอ้างอิงแผน implementation plans ใน affects และ §13 โดยผนวกรวมติดตามข้อกำหนดทั้งหมดภายใน CR นี้ตามมติเจ้าของโครงการ (ไม่เปิดไฟล์แยก)

**การอนุมัติและ Merge (2026-10-04):** อนุมัติ (approved) และ merge เข้าสู่ `develop` ผ่าน PR #309 โดย Soravit Sukkar (Team Lead) · รันเลข Change Record เป็น **CR-151** และบันทึกลงใน `docs/changes/_index.md`

**Gate ที่ยังรอ:** deploy และตรวจ `_explain` บน staging/production (local `shelter_sh001`–`sh004` ผ่านแล้ว) · ทดสอบ M1–M8 บน kiosk จริง โดยเพิ่มกรณี AC-KPC-26 · ติดตามแก้ไข G-8 ใน PR ถัดไปของ `scanner_client`

---

## 13. สิ่งที่ต้องแก้ตาม CR นี้

| ชั้น                 | ไฟล์                                                                                                                                                                                                       | สิ่งที่ต้องแก้                                                                                                                                   |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| เอกสาร             | `docs/features/smart-card-registration-spec.md`                                                                                                                                                              | ใส่ข้อความต้นไฟล์ว่า FR-CARD-01..04 ถูกแทนที่ → ชี้มาที่ CR นี้                                                       |
| เอกสาร             | `docs/changes/14-kiosk/CR-097-smart-card-evacuee-draft-flow.md`                                                                                                                                                       | เพิ่มใน Decision log ว่าปิดการสร้าง evacuee จาก kiosk แล้ว → ชี้มาที่ CR นี้                                           |
| เอกสาร             | `docs/data/api-contract.md`                                                                                                                                                                                  | เพิ่มหัวข้อ Scanner / Kiosk ตาม §7                                                                                                              |
| เอกสาร             | `docs/data/schema.md` §1.1                                                                                                                                                                                  | index เบอร์, เลขบัตร, ครัวเรือน (ตาม FR-KPC-63) + อัปเดต`updated:`                                                             |
| เอกสาร             | `CONTEXT.md`                                                                                                                                                                                                 | Report-in ทำได้ที่ Station 1 หรือ kiosk (QR / บัตร / เบอร์)                                                                               |
| เอกสาร (CR นี้) | ผนวกรวมแผน implement ช่องทางเบอร์ (§6.6), ชุด Mango index (§6.6), และรายชื่อครัวเรือน/เสียบบัตรซ้ำ (§6.2, §6.3, §6.5, §6.8) ไว้ใน CR นี้ | ติดตามรายละเอียดข้อกำหนด, เกณฑ์ตรวจรับ และ gates ทั้งหมดในเอกสารฉบับนี้โดยไม่แยกไฟล์ |
| Frontend                 | `features/kiosk/**`, `routes/kiosk/**`, `routes/api/v1/scanner/**`                                                                                                                                       | ตาม §5                                                                                                                                                     |
| Frontend                 | `features/scanners/**`, `lib/server/scanners/**`                                                                                                                                                           | ลงทะเบียนและยืนยันเครื่อง (รอบนี้ไม่เปลี่ยน)                                                                          |
| Infra                    | `shelter-access-design.ts`, `shelters.admin.ts`, `provisioner.ts`, `scripts/redeploy-access.ts`, `scripts/seed/registry-shelters.ts`                                                                 | นิยามและ deploy ชุด`KIOSK_LOOKUP_MANGO_INDEXES` แยกจาก referral (คืนส่วน referral ใน scripts เป็นเหมือนเดิม — G-10) |
| เครื่อง kiosk     | `scanner_client/**`                                                                                                                                                                                          | อ่านเฉพาะเลขบัตร · allowlist · เช็คบัตรใหม่ระหว่างรอกลับหน้าแรก (FR-KPC-46) · README · tests               |

---

## 14. บันทึกการตัดสินใจ

- 2026-08-29 — CR-097: kiosk สร้าง evacuee จากบัตร (เริ่มจาก `draft` ภายหลังเปลี่ยนเป็น `pre_registered` + `kiosk`)
- 2026-09-24 — ทีม kiosk เปลี่ยนทิศทางในโค้ด: kiosk = รับรายงานตัวผู้จองทางเว็บ · `/scanner/draft` → 410 (commit `52c08e7d`, `59d799cd`, `6079b9af`, `90693285`) — **ยังไม่มี CR รองรับ จนกระทั่งร่างฉบับนี้**
- 2026-09-24 — เจ้าของโครงการตัดสินใจเกี่ยวกับข้อกำหนดช่องทางเบอร์โทรศัพท์:
  - ขอบเขต = รับรายงานตัวเท่านั้น (ไม่ทำ walk-in ที่ kiosk ใน CR นี้; ภายหลังได้รับการขยายผลและอนุมัติเพิ่มเติมใน CR-149)
  - การยืนยันตัวตน = ใช้เบอร์อย่างเดียว + ปิดนามสกุลบางส่วน + จำกัดจำนวนครั้ง (ไม่เลือก: ถามปีเกิด — `birth_year` ไม่ครบทุก record · ใช้รหัสจอง + เบอร์ — คนที่ QR หายมักไม่มีรหัสด้วย)
  - เบอร์ร่วมหลายครัวเรือน = ให้เลือกได้ไม่เกิน 5 ครัวเรือน (ไม่เลือก: ปฏิเสธทุกกรณีที่เจอมากกว่า 1 — ครอบครัวใช้เบอร์ร่วมกันบ่อย)
  - วิธีติดตามการเปลี่ยนแปลง = จัดทำไฟล์ draft CR นี้
  - Privacy Search Excluded = สมาชิกที่ตั้ง `privacy.search_excluded:true` จะไม่ปรากฏในผลค้นหา และตอบ 404 แบบเดียวกับไม่พบข้อมูล
  - Name Masking = สายรัดข้อมือพิมพ์นามสกุลแบบปิดบางส่วน
  - Task Tracking = ไม่สร้างเอกสาร T-task แยก; ติดตามงานและข้อกำหนดทั้งหมดใน CR ฉบับนี้โดยตรง
  - Batching = แบ่งการรายงานตัวทุกช่องทางเป็นชุดละไม่เกิน 20 คนต่อ request และคง API contract ของ `/check-in` เดิม
- 2026-09-24 — เจ้าของโครงการตัดสินใจเกี่ยวกับระบบและการจัดเก็บข้อมูล:
  - Provenance = ไม่บันทึก device / `updated_by` / audit document ใน CR นี้; เลื่อนไป backlog (รับทราบความเสี่ยงด้าน audit trail และข้อพิพาทสวมสิทธิ์รับสายรัดข้อมือย้อนหลัง)
  - Phone Index = ใช้ Mango index `['type','phone']`; query เบอร์แบบ exact match และ query ค่า `+66…` เพิ่มเพื่อรองรับข้อมูลเก่า
  - Legacy Kiosk Records = record เดิมที่ `registered_via:'kiosk'` ให้เจ้าหน้าที่จัดการที่ Station 1 ตามเดิม; kiosk ค้นและรับรายงานตัวเฉพาะ record จากเว็บ
  - Phone Rate Limiting = request ที่มี `primary_evacuee_id` (ตอนเลือกครัวเรือน) ไม่นับ limit ต่อเบอร์ แต่ยังนับ limit ต่อเครื่อง
  - Terminology = ใช้คำว่า Report-in / รายงานตัวในเอกสาร และคงชื่อ API `check-in` เดิม
  - Mango Lookup Indexes = ใช้ชุด index `KIOSK_LOOKUP_MANGO_INDEXES` ครบ 3 ตัว (`phone`, `person_id.number`, `household_id`) (ภายหลังเป็น 4 ตัว — CR-149 / #525; ดู FR-KPC-63), deploy แยกจาก referral ทุกจุด และใช้ equality query · CR ยังคง `proposed`
  - Name Masking All Channels = ปิดนามสกุลบางส่วนทุกช่องทาง ทั้งบนหน้าจอและบนสายรัดข้อมือ (QR / บัตร / เบอร์) ตาม FR-KPC-28
  - Household List Consistency = ทุกช่องทางแสดงรายชื่อครัวเรือนเดียวกัน รวมถึงการสแกนซ้ำ; สมาชิกที่ `registered_via` ไม่ใช่ `web` แสดงแต่เลือกไม่ได้ ตาม FR-KPC-29 และ FR-KPC-83
- 2026-09-25 — ดำเนินการตามแผนจัดการรายชื่อครัวเรือนและเสียบบัตรซ้ำ: C1–C5 และ automated tests ผ่าน; code commits `11f4b4b3`, `bcd87dc2`, `f7da61f9` · manual M1–M8 บน kiosk ยัง pending · CR คง `proposed` จนกว่าเจ้าของโครงการจะอนุมัติ
- 2026-09-25 — เจ้าของโครงการให้บันทึกผลแก้ review เพิ่มใน draft CR และยังไม่ commit เอกสาร; คงสถานะ `proposed` และเลข `draft` ระหว่างรออนุมัติ CR
- 2026-09-24 — ช่องทาง ThaiD **พักไว้** (ปุ่มยังปิดอยู่)
- 2026-09-24 — รวม `draft-kiosk-phone-report-in.md` เข้ามาใน CR นี้ให้เป็นเอกสารเดียว
- 2026-10-04 — ปรับปรุงเอกสารตาม PR review (#309): ปรับการอ้างอิง `schema_v` ของ evacuee ให้ระบุคงเดิมตาม develop (ไม่ระบุเลข 10 ที่ล้าสมัย), ระบุหมายเหตุเชื่อมโยง walk-in กับ CR-149, บันทึกคำเตือนความเสี่ยงด้าน audit trail (Audit Trail Gap), ปรับ G-8 เป็น backlog ของ scanner_client, ปรับการอ้างอิง implementation plans ให้ระบุรวมติดตามใน CR นี้ (ตัด phantom paths), และยกเลิกโครงสร้างส่วนถาม-ตอบเดิม โดยผนวกข้อกำหนดและคำตอบของเจ้าของโครงการทั้งหมดเข้าสู่เนื้อหา spec โดยตรง
- 2026-10-04 — Soravit Sukkar (Team Lead) อนุมัติ (approved) CR-151 และ merge PR #309 เข้า branch develop; ยืนยัน schema_v ของ evacuee คงเดิม (ไม่อัปเกรด schema_v; อิงตามเวอร์ชันปัจจุบันของ develop) และรันเลข CR-151
- เหตุผลที่ใช้ `/lookup` เดิมสำหรับเบอร์แทนการสร้าง endpoint ใหม่: allowlist ของ `scanner_client` ครอบคลุมอยู่แล้ว จึงไม่ต้อง deploy ฝั่ง Python ใหม่
- 2026-10-13 — ทีม kiosk เสนอ §15 จาก feedback หน้างาน: หัวข้อหน้าแรก「ลงทะเบียน」· รับ `registered_via:'kiosk'` · ช่องทางเบอร์เปลี่ยนเป็น「พิมพ์ QR」ยืนยัน 4 ตัวท้าย พิมพ์ได้เฉพาะ `arriving`/`active`/`room_confirmed` (ไม่รวม `temporary_leave`, `checked_out`) · ช่องทางบัตร/QR/ThaiD พิมพ์ซ้ำได้เฉพาะ `arriving` คงเดิม · track ใน CR นี้แทน draft CR ใหม่
- 2026-10-13 — Soravit Sukkarn (Team Lead) approved ข้อเสนอแก้ไข §15 โดยรับ requirement จากหัวหน้าโครงการเมื่อวาน (2026-10-12)
- 2026-10-15 — ทีม kiosk ขอเลิกกรอง `registered_via` (เดิม {`web`, `kiosk`}): lookup บัตร/QR/ThaiD/เบอร์, `/kiosk/check-in` และ `/kiosk/reprint` ค้นทั้งศูนย์ของเครื่อง · กฎสถานะคงเดิม (check-in = `pre_registered` · พิมพ์ซ้ำทางเบอร์ = `arriving`/`active`/`room_confirmed`) · สมาชิกที่เจ้าหน้าที่เพิ่มที่ Station 1 เลือกได้ตามสถานะ (แก้ FR-KPC-29, E-11, E-23) · Mango selector เบอร์ไม่มี `registered_via` แล้ว ยังใช้ `evacuee-type-phone-idx`
- 2026-10-17 — **decision sync** (#604; ไม่เปิด CR ใหม่ ตามที่เจ้าของโครงการเลือก): (1) ผลตรวจ local 2026-09-25 (§4) ล้าสมัย — `shelter_sh001`–`sh004` ไม่มี index ใน `KIOSK_LOOKUP_MANGO_INDEXES` (รวม people / transfer-ledger / Daily SOP) เพราะไม่ได้รัน redeploy/seed หลัง merge #457 (2026-10-11); รัน `scripts/redeploy-access.ts --write --confirm` บน local แล้ว (ok 4/4) และ `_explain` ของ selector เลขบัตรเลือก `evacuee-type-person-id-idx` ทุกฐาน · (2) FR-KPC-64 เพิ่มเติม: provisioning ทุกจุดต้อง deploy ชุด index ของ shelter DB **เท่ากัน** — เดิม `redeploy-access.ts` ขาด people + transfer-ledger และ seed ขาด requisition + people + transfer-ledger; warm-up selector ใช้ map กลาง `KIOSK_LOOKUP_WARMUP_SELECTORS` (ครบทุก index รวม `evacuee-type-card-address-no-idx`) และมี test กันนิยาม index ชื่อซ้ำไม่ตรงกัน (branch `fix/604-shelter-mango-index`, commit `748ebe2d6`) · (3) staging/production: Jenkins รัน `pnpm db:sync` (รวม `redeploy:access --write --confirm`) ทุกครั้งที่ deploy branch `staging` / `main` อยู่แล้ว — ไม่ต้องรันเอง แต่ยังไม่ได้ตรวจ `_index` / `_explain` บน staging/production หลัง deploy · (4) FR-KPC-63 แก้เป็น 4 ตัวให้ตรงกับ CR-149 / #525 (เพิ่ม `evacuee-type-card-address-no-idx` บน `card_snapshot.address_no`; เดิมนับ 3 ตัว)
- 2026-10-18 — ทีม kiosk เสนอ §16 (#654): แถว Zone + checklist บน QR label, ตัดเบอร์โทร, `zones[].short_name`, reprint คืน `label.zone`/`stations_passed` · รวม draft `draft-zone-short-name` เข้า CR นี้แทนการเปิด draft ใหม่ · proposed โดยทีม รอ PO เคาะ
- 2026-10-18 — ทีม kiosk เสนอ §17 (#609): จิตอาสาพิมพ์ role-card QR ที่ตู้ด้วยเบอร์โทร · ตกลง D1–D8 ในทีม (§17.4) · track ใน CR นี้แทนการเปิด CR ใหม่ (ต่อยอดเมนู「พิมพ์ QR」ของ §15) · รอ PO อนุมัติ
- 2026-10-20 — รวมกับ §16 (#654) จาก develop: ข้อเสนอจิตอาสาเป็น §17 · FR-KPC-120–129 · AC-KPC-120–123 (เลข 110–119 เป็นของ §16)

## 15. ข้อเสนอแก้ไข 2026-10-13 (approved โดย Team Lead)

> **สถานะ:** approved โดย Soravit Sukkarn (Team Lead) — รับ requirement จากหัวหน้าโครงการเมื่อ 2026-10-12 · implement แล้วบน branch `refactor-kiosk-cleanup`

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** (1) หัวข้อหน้า `/kiosk`「รายงานตัว」→「ลงทะเบียน」(2) ช่องทางบัตร/QR/ThaiD และ `/kiosk/check-in` รับ `registered_via: 'kiosk'` ด้วย (walk-in ของ CR-149 §9) (3) ช่องทางเบอร์โทรเลิกรับรายงานตัว เปลี่ยนเป็นเมนู「พิมพ์ QR」ที่ยืนยันด้วยเลขบัตร 4 ตัวท้าย
> - **เพื่อใคร/ทำไม:** walk-in ที่เป็น `arriving` พิมพ์ QR ซ้ำได้เหมือนคนจองล่วงหน้า · คนที่ QR หายพิมพ์ใหม่ได้เองโดยไม่ต้องใช้เบอร์อย่างเดียว
> - **Dev ต้อง build:** `POST /api/v1/kiosk/reprint` (อ่านอย่างเดียว) · หน้า `/kiosk/reprint` · `/kiosk/phone` redirect · ปุ่ม「พิมพ์ QR」ใต้การ์ด
> - **กระทบ schema:** ไม่มี · flag `kiosk_phone_check_in_enabled` key เดิม (CR-152 §9)

**แก้ข้อเดิม:** FR-KPC-11 (การ์ดเบอร์) · FR-KPC-21/22/23/72 (`registered_via:'web'` → ไม่กรองช่องทาง ค้นทั้งศูนย์ · 2026-10-13 เดิมเป็น `web` หรือ `kiosk`) · FR-KPC-29, E-11, E-23 (สมาชิกช่องทางอื่นไม่ถูกล็อกแล้ว — เลือกได้ตามสถานะ) · §6.6 ช่องทางเบอร์ (FR-KPC-60 และส่วนเบอร์ของ FR-KPC-83 — ไม่รับรายงานตัวด้วยเบอร์อีก)

### 15.1 หน้าแรกและช่องทางเดิม

| ID         | Requirement                                                                                                                                                                                                                                             |
| :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-KPC-100 | หัวข้อ h1 หน้า `/kiosk`「รายงานตัว」→「ลงทะเบียน」(เปลี่ยนเฉพาะ h1 หน้าแรก)                                                                                                                                                                             |
| FR-KPC-101 | lookup บัตร/QR/ThaiD และ `/kiosk/check-in`: ค้นทั้งศูนย์ของเครื่อง ไม่กรอง `registered_via` (ทุกช่องทางเข้าเงื่อนไข · เลือกได้ตามสถานะเท่านั้น: check-in = `pre_registered`) · household ที่ไม่มีคนเลือก check-in ได้ → ทางพิมพ์ซ้ำเดิม (`already_checked_in` + `label`, ไม่เขียน doc) · ทางนี้พิมพ์ซ้ำได้เฉพาะ `arriving` (เหมือนเดิม) |
| FR-KPC-102 | หน้า `/kiosk`: การ์ดหลัก 3 ช่องทาง (QR · บัตรประชาชน · ThaiD) · ใต้ grid ปุ่มรองเต็มความกว้าง ไอคอนเครื่องพิมพ์「พิมพ์ QR」→ `/kiosk/reprint` · แสดงเมื่อ `kiosk_phone_check_in_enabled` เปิด                                                           |
| FR-KPC-103 | `/kiosk/phone` redirect 307 → `/kiosk/reprint` (คง context query) · flag ปิด → redirect `/kiosk`                                                                                                                                                        |

### 15.2 พิมพ์ QR ด้วยเบอร์โทร

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                        |
| :--------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KPC-104 | lookup `source:'phone'` และ `/kiosk/reprint`: ค้นทั้งศูนย์ของเครื่อง ไม่กรอง `registered_via` · สมาชิกที่พิมพ์ได้ = `arriving`/`active`/`room_confirmed` · `pre_registered` แสดงแต่เลือกไม่ได้ (ให้ใช้บัตรหรือ ThaiD) · `temporary_leave` แสดงแต่เลือกไม่ได้ · `checked_out` ไม่แสดง (FR-KPC-29) · candidates นับคนที่พิมพ์ได้                                                                      |
| FR-KPC-105 | เลือกครัวเรือนแล้ว → numpad「เลขบัตรประชาชน 4 ตัวท้ายของเจ้าของเบอร์」ก่อนพิมพ์                                                                                                                                                                                                                                                                                    |
| FR-KPC-106 | `POST /api/v1/kiosk/reprint { phone, primary_evacuee_id, id_last4, evacuee_ids }`: device auth · flag ปิด → 403 `KIOSK_METHOD_DISABLED` · primary ต้องมี `phone` ตรง (canonical/legacy) · `person_id.number` ลงท้ายด้วย `id_last4` → ไม่ตรง 403 `KIOSK_REPRINT_VERIFY_FAILED` · primary ไม่มีเลขที่เป็นตัวเลข → 403 `KIOSK_REPRINT_UNVERIFIABLE` (ไปพบเจ้าหน้าที่) |
| FR-KPC-107 | reprint คืน `[{ evacuee_id, qr_payload, label }]` เฉพาะสมาชิก household เดียวกันที่พิมพ์ได้และไม่ `search_excluded` · **ไม่เขียน doc ใด ๆ** · `cache-control: no-store`                                                                                                                                                                                            |
| FR-KPC-108 | rate limit ต่อเครื่อง และ verify ผิด 5 ครั้ง/10 นาทีต่อ primary → 429 `KIOSK_RATE_LIMITED` · `scanner_client` allowlist เพิ่ม `/api/v1/kiosk/reprint`                                                                                                                                                                                                              |
| FR-KPC-109 | ข้อความเมื่อเลือกไม่ได้: `pre_registered`「ยังไม่ได้ลงทะเบียน — ใช้บัตรประชาชนหรือ ThaiD」· `temporary_leave`「ออกนอกศูนย์ชั่วคราว — พิมพ์ QR ไม่ได้」· ไม่มีใครพิมพ์ได้「ไม่มีผู้ที่พิมพ์ QR ได้ กรุณาติดต่อเจ้าหน้าที่」                                                                                                                                         |

### 15.3 Acceptance

- **AC-KPC-100** walk-in `arriving` เสียบบัตรซ้ำ → พิมพ์ QR ซ้ำได้ ไม่มีการเขียน doc
- **AC-KPC-101** เบอร์ + 4 ตัวท้ายถูก → พิมพ์ label คนที่เลือก · 4 ตัวท้ายผิด → ไม่ได้ label · ผิดเกิน 5 ครั้ง → 429
- **AC-KPC-102** คน `pre_registered` / `temporary_leave` เห็นในรายชื่อแต่เลือกพิมพ์ไม่ได้ · คน `checked_out` ไม่แสดง
- **AC-KPC-103** เปิด `/kiosk/phone` → ไปที่ `/kiosk/reprint` · flag ปิด → `/kiosk`
- **AC-KPC-104** reprint ทุกกรณีไม่มี PUT / DELETE ไปที่ CouchDB

### 15.4 Impact / Risks

- `/kiosk/check-in` ไม่ใช้เป็นทางพิมพ์ซ้ำด้วยเบอร์อีก (เดิมไม่ตรวจ flag และไม่ต้องยืนยันตัวตนเพิ่ม)
- คนที่รู้ทั้งเบอร์และเลขบัตร 4 ตัวท้ายพิมพ์ QR ของผู้อื่นในครัวเรือนเดียวกันได้ · จำกัดด้วย rate limit
- ผู้จองล่วงหน้าที่ยังไม่รายงานตัวใช้เบอร์รายงานตัวไม่ได้แล้ว ต้องใช้ QR ใบจอง / บัตร / ThaiD

---

## 16. ข้อเสนอแก้ไข 2026-10-18 — โซนและ checklist บน QR label (#654, รอ PO เคาะ)

> **สถานะ:** proposed โดยทีม kiosk — Project Owner (รอเคาะ) · implement แล้วบน branch `feat/654-label-zone` · ที่มา: เอกสารหน้างาน หมวด 2 (issue #654) · รวม draft `draft-zone-short-name` เข้ามาในหัวข้อนี้แทนการเปิด draft CR ใหม่

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** (1) QR label 80×60 มีแถว `Zone:` ใต้ชื่อ (2) checklist「เช็คอิน · คัดกรอง · ที่พัก」ติ๊กตามจำนวน station ที่ผ่าน (3) ตัดเบอร์โทรออกจาก label (4) shelter `zones[].short_name` (optional) ใช้พิมพ์บน label แทนชื่อเต็ม (5) `POST /api/v1/kiosk/reprint` คืน `label.zone` + `label.stations_passed`
> - **เพื่อใคร/ทำไม:** เจ้าหน้าที่หน้างานเห็นโซนและ station ที่ผ่านแล้วจาก label · พิมพ์ครั้งแรกยังไม่มีโซน จึงเว้นช่องให้เขียนมือ · ชื่อโซนเต็มยาวเกินพื้นที่ label
> - **Dev ต้อง build:** implement แล้ว — ต้องทดสอบพิมพ์จริงบน XP-365B (AC-KPC-114)
> - **กระทบ schema:** `shelter.zones[].short_name` str\|null opt (`docs/data/schema.md` shelter master) — additive ไม่ backfill ไม่ bump `schema_v` (แนวเดียวกับ CR-163)

**แก้ข้อเดิม:** FR-KPC-107 (รูปร่าง `label` ใน response reprint) · ไม่ขัดกับ CR-106 FR-04b (พิมพ์ซ้ำใช้ zone จาก profile ไม่สร้าง zone ที่ S1)

### 16.1 เนื้อหา label

| ID         | Requirement |
| :--------- | :---------- |
| FR-KPC-110 | label ทุกทางพิมพ์ (kiosk check-in · walk-in `/kiosk/register/done` · `/kiosk/reprint` · staff หน้า profile「QR」) ใช้ layout 80×60 เดียวกัน: ซ้าย = ชื่อ (≤3 บรรทัด) → แถว Zone → checklist → `shelter.psu.ac.th` มุมซ้ายล่าง · ขวา = QR · **ไม่พิมพ์เบอร์โทร** · staff พิมพ์จาก PNG เดียวกับ kiosk (preview = สิ่งที่พิมพ์) |
| FR-KPC-111 | แถว Zone: มีโซน → `Zone: <ข้อความโซน>` (ยาวเกินแถว → ตัดด้วย `…`) · ไม่มีโซน → `Zone:` ตามด้วยเส้นจุดว่างให้เจ้าหน้าที่เขียนมือ |
| FR-KPC-112 | ข้อความโซน = `zones[].short_name` ของโซนที่ `code` ตรงกับ `current_stay.zone` (ไม่สนตัวพิมพ์) → ไม่มีใช้ `name` → ไม่มีใช้ code ดิบ · `current_stay.zone` ว่าง → ไม่มีโซน |
| FR-KPC-113 | checklist 3 ช่อง แถวละช่อง ติ๊กตาม `stations_passed`: **0** = ไม่มี stay หรือ `pre_registered`/`kiosk_registered`/`cancelled` · **3** = สถานะไม่ใช่ `arriving` และ (มีโซน หรือ `room_confirmed`/`temporary_leave`) — นับ 3 แม้ศูนย์ปิด medical screening · **2** = มี doc `type:'screening'` ของคนนั้น · **1** = อื่น ๆ (`arriving` ชนะโซนค้าง) |
| FR-KPC-114 | พิมพ์ครั้งแรกที่ kiosk (check-in / walk-in) → ติ๊ก 1 ช่อง (เช็คอิน) และแถว Zone ว่าง |

### 16.2 Reprint API

| ID         | Requirement |
| :--------- | :---------- |
| FR-KPC-115 | (แก้ FR-KPC-107) `label` = `{ name, phone, zone, stations_passed }` · `zone` ตาม FR-KPC-112 (`null` ก่อน Station 3) · `stations_passed` 0–3 ตาม FR-KPC-113 · ยังไม่เขียน doc ใด ๆ |
| FR-KPC-116 | อ่าน shelter registry เฉพาะเมื่อมีสมาชิกที่มีโซน · อ่านไม่ได้ → ใช้ code ดิบ (reprint ไม่ fail) · ค้น screening เฉพาะสมาชิกที่ยังไม่ถึง 3 ช่อง · ค้นไม่ได้ → ถือว่ายังไม่คัดกรอง (ติ๊กน้อยลง ไม่ fail) |

### 16.3 ชื่อย่อโซน (`zones[].short_name`)

| ID         | Requirement |
| :--------- | :---------- |
| FR-KPC-117 | shelter form แสดงช่อง「ชื่อย่อ」ต่อโซน ไม่บังคับ · สูงสุด 10 ตัวอักษร (input จำกัด + Zod `max(10)`) |
| FR-KPC-118 | พิมพ์เว้นวรรคได้ระหว่างกรอก · trim หัว-ท้ายตอนบันทึก · ค่าว่างเก็บเป็น `null` · doc เดิมที่ไม่มี field เปิดแก้/บันทึกได้ตามปกติ |
| FR-KPC-119 | staff-only — ยังไม่ส่งออก shelter import / worker projection / public / external API (worker ใช้แค่ `zones[].capacity`) |

### 16.4 Acceptance

- **AC-KPC-110** kiosk check-in / walk-in → label มี `Zone:` + เส้นจุด และติ๊กเช็คอิน 1 ช่อง
- **AC-KPC-111** พิมพ์ซ้ำหลัง Station 3 จัดโซน → `Zone: <short_name หรือชื่อโซน>` และติ๊กครบ 3 ช่อง
- **AC-KPC-112** คัดกรองแล้วยังไม่มีโซน → ติ๊ก 2 ช่อง, Zone ว่าง
- **AC-KPC-113** ไม่มี label ใดพิมพ์เบอร์โทร
- **AC-KPC-114** พิมพ์จริงบน XP-365B: ชื่อ 3 บรรทัด + แถว Zone + checklist ไม่ล้น/ไม่ถูกตัด (ยังต้องทดสอบ)
- **AC-KPC-115** shelter form: ชื่อย่อเกิน 10 ตัวอักษรบันทึกไม่ได้ · เว้นว่างบันทึกได้

### 16.5 Open questions (เสนอให้ PO เคาะ)

1. `short_name` ต้อง unique ภายในศูนย์หรือไม่ — ทีมเสนอ: ยังไม่บังคับ (`code` เป็น id อยู่แล้ว)
2. จำกัดอักขระ (เช่น A–Z/0–9) หรืออนุญาตภาษาไทย — ทีมเสนอ: อนุญาตทุกอักขระ
3. ความยาวสูงสุด 10 เหมาะกับ label 80×60 หรือไม่
4. ส่งออก `short_name` ใน shelter import / public projection หรือไม่ — ทีมเสนอ: ยังไม่ (staff-only)
5. label ไม่มีเบอร์โทรแล้ว — ยืนยันว่าหน้างานไม่ต้องใช้เบอร์บน label

### 16.6 Impact / Risks

- ติ๊ก checklist คำนวณจากข้อมูล ณ ตอนพิมพ์ — label ที่พิมพ์ไปแล้วไม่อัปเดตเอง ต้องพิมพ์ซ้ำ
- ช่อง「ชื่อย่อ」ที่กรอกแต่เว้นวรรคล้วน อาจถูกเก็บเป็น `""` แทน `null` (Zod trim หลัง form แปลงค่าว่างเป็น `null`) — label ถือว่าไม่มีชื่อย่อ จึงไม่กระทบการพิมพ์
- reprint อ่าน registry + `_find` screening เพิ่ม (ทั้งคู่ fail-soft)

---

## 17. ข้อเสนอแก้ไข 2026-10-18 — พิมพ์ QR จิตอาสา (approved)

> **สถานะ:** ข้อเสนอทีม kiosk (issue #609) — D1–D8 ตกลงในทีม 2026-10-18 · **approved โดย Soravit Sukkarn (Team Lead) 2026-10-20** · implement แล้วบน branch `feat-volunteer-qr-printer`

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** เพิ่ม `POST /api/v1/kiosk/volunteer-card` ให้ตู้หาจิตอาสาด้วยเบอร์โทรใน shelter ของเครื่องเท่านั้น แล้วคืน role-card QR (`TKT-VOL-HASH-…`) **ที่มีอยู่แล้ว** แบบอ่านอย่างเดียว · label จิตอาสาแยกจาก label ผู้พักพิง · ปุ่ม「พิมพ์ QR」(FR-KPC-102) ไปหน้าเลือก「ผู้พักพิง / จิตอาสา」
> - **เพื่อใคร/ทำไม:** จิตอาสาที่ไม่มีมือถือหรือแบตหมดได้บัตร QR กระดาษไว้ให้เจ้าหน้าที่สแกน โดยไม่ต้องให้เจ้าหน้าที่ช่วยออกบัตร
> - **Dev ต้อง build:** endpoint volunteer-card + rate limiter · label จิตอาสา · หน้า `/kiosk/print-qr` และ `/kiosk/volunteer` · allowlist scanner client
> - **กระทบ schema:** ไม่มี field ใหม่ · ไม่ bump `schema_v` · ไม่เปลี่ยนวิธีออก/หมุน token (CR-127 คงเดิม) · สัญญา API: [api-contract.md §2.1.2](../../data/api-contract.md)

**แก้ข้อเดิม:** FR-KPC-102 (ปุ่ม「พิมพ์ QR」→ `/kiosk/print-qr` แทน `/kiosk/reprint` ตรง ๆ)

### 17.1 ค้นหาแบบอ่านอย่างเดียว

| ID         | Requirement                                                                                                                                                                                                 |
| :--------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KPC-120 | Server หา `type: "volunteer"` ใน `shelter_{device.shelter_code}` เท่านั้น (D3) ด้วย `phone` (รวมรูปแบบ `+66`) หรือ `phone_hash = sha256(เบอร์ canonical)`                                                     |
| FR-KPC-121 | กรองซ้ำในโค้ด: เบอร์ใน `phone` ปัจจุบันต้องตรงกับเบอร์ที่กรอก — กัน `phone_hash` ค้างจาก #693                                                                                                                 |
| FR-KPC-122 | ต้อง `status: "active"` และเหลือ **1 คนพอดี** (D4) และมี `tracking_token_hash` เป็น hex 64 ตัว (D2)                                                                                                            |
| FR-KPC-123 | คืน `qr_payload = "TKT-VOL-HASH-" + tracking_token_hash.toUpperCase()` — **ห้าม mint/rotate/backfill** และห้ามเรียก `readOrMintRoleCardToken` · ไม่เขียน CouchDB (ยกเว้น device last-seen)                   |
| FR-KPC-124 | ทุกกรณีที่พิมพ์ไม่ได้ (ไม่พบ / ต่าง shelter / `inactive` / ไม่มี hash / เบอร์ซ้ำ) ตอบ `404 KIOSK_VOLUNTEER_CARD_NOT_FOUND` body เดียวกัน — ไม่ leak ว่าเบอร์มีในระบบ                                           |

### 17.2 Gate และ rate limit

| ID         | Requirement                                                                                                          |
| :--------- | :------------------------------------------------------------------------------------------------------------------- |
| FR-KPC-125 | ผูกกับ flag `kiosk_phone_check_in_enabled` (CR-152 §9) เหมือน reprint (D5) — ปิดตอบ `403 KIOSK_METHOD_DISABLED`      |
| FR-KPC-126 | ต่อเครื่อง 10 ครั้ง/นาที · ต่อเบอร์ 3 ครั้ง/10 นาที ข้ามเครื่อง · นับ**ทุก** request (D7) · key เบอร์เป็น sha256 → 429 `KIOSK_RATE_LIMITED` |

### 17.3 Label และ UI

| ID         | Requirement                                                                                                                                                                       |
| :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-KPC-127 | Label 80×60 mm: ชื่อ `first_name` + `maskLastName(last_name)` (+ ชื่อเล่น) · badge `จิตอาสา · V-NNN` · QR ชิดขวา · link ล่างซ้าย · **ไม่พิมพ์เบอร์** (D6; ตรงกับ label ผู้พักพิงตาม FR-KPC-110) |
| FR-KPC-128 | ปุ่ม「พิมพ์ QR」หน้าแรก → `/kiosk/print-qr` เลือก「ผู้พักพิง」(`/kiosk/reprint` เดิม) หรือ「จิตอาสา」(`/kiosk/volunteer`) (D8) · flag ปิด → ไม่มีปุ่ม (FR-KPT-30)                      |
| FR-KPC-129 | Scanner client แนบ device credential ให้ `/api/v1/kiosk/volunteer-card` (same-origin POST เท่านั้น)                                                                                |

### 17.4 Decisions (ข้อเสนอทีม 2026-10-18)

| #   | ประเด็น                    | ข้อเสนอ                                                                                                         |
| :-- | :------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| D1  | วิธี track                  | §17 ของ CR-151 (ไม่เปิด CR ใหม่)                                                       |
| D2  | ไม่มี `tracking_token_hash` | ปฏิเสธ (error เดียวกับไม่พบ) — เกิดเฉพาะข้อมูลเก่า/นำเข้าเอง; แก้หน้างานโดยเปิด role card ใน portal ครั้งหนึ่ง |
| D3  | "shelter เดียวกัน"          | doc อยู่ใน `shelter_{device.shelter_code}`                                                                       |
| D4  | เบอร์ซ้ำหลายคน              | ปฏิเสธ (error เดียวกับไม่พบ)                                                                                     |
| D5  | flag                       | ใช้ `kiosk_phone_check_in_enabled`                                                                              |
| D6  | mask ชื่อ                   | first + masked last (+ ชื่อเล่น) · ไม่พิมพ์เบอร์                                                                 |
| D7  | rate limit                 | เครื่อง 10/นาที · เบอร์ 3/10 นาที · นับทุก request                                                               |
| D8  | ทางเข้า UI                  | หน้าเลือก 2 กล่อง                                                                                               |

### 17.5 Acceptance

- **AC-KPC-120** จิตอาสา `active` เบอร์ไม่ซ้ำ มี `tracking_token_hash` → พิมพ์ label ได้ · QR = `TKT-VOL-HASH-…` ตรงกับ role card ใน portal
- **AC-KPC-121** ไม่พบ / ต่าง shelter / `inactive` / ไม่มี hash / เบอร์ซ้ำ → 404 body เดียวกันทุกกรณี
- **AC-KPC-122** flag ปิด → 403 และไม่มีปุ่ม「พิมพ์ QR」· เกิน limit → 429
- **AC-KPC-123** volunteer-card ทุกกรณีไม่มี PUT / DELETE ไปที่ volunteer doc · `tracking_token_hash` ไม่เปลี่ยน

### 17.6 Security trade-off (accepted risk — PO ยืนยันและอนุมัติแล้ว 2026-10-20)

- **รู้เบอร์ = พิมพ์ credential ถาวรของจิตอาสาคนนั้นได้** ที่ตู้ในศูนย์เดียวกัน
- ลดความเสี่ยงด้วย: shelter scope · rate limit ต่อเครื่อง/ต่อเบอร์ · error เดียว · mask ชื่อ · ไม่พิมพ์เบอร์
- ปิดจริงต้องมี factor ที่ 2 — hardening ภายหลัง (CR-158 staff PIN หรือเลขท้าย 4 หลัก)
- Rate limiter เป็น in-memory ต่อ process (reset เมื่อ restart) · เมื่อย้าย limit ไป Nginx (#627) ต้องย้าย limiter นี้ด้วย

### 17.7 Out of scope

- วิธีออก/หมุน token (CR-127) · parse QR จิตอาสาฝั่ง scan (#650) · แก้ `phone_hash` ไม่อัปเดต (#693) · กันเบอร์ซ้ำ (#694)

---

## Decision log

- 2026-10-23 — **Superseded (rate limit) by [CR-188](../01-core/CR-188-rate-limit-to-nginx.md):** FR-KPC-59 / FR-KPC-108 (verify ผิด 5 ครั้ง/10 นาที ต่อ primary) / FR-KPC-126 / D7 ถูกยกเลิก — kiosk ใช้ nginx zone `kiosk` ต่อ IP (body 429 `KIOSK_RATE_LIMITED` + `Retry-After: 60` คงเดิม)
