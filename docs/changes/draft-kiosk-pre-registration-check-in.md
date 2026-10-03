---
id: draft
title: Kiosk — เปลี่ยนจาก "เสียบบัตรเพื่อสร้างผู้ลงทะเบียน" เป็น "รายงานตัวผู้ลงทะเบียนล่วงหน้า" (QR / บัตรประชาชน / เบอร์โทร)
status: proposed
date: 2026-09-24
created: 2026-09-24
updated: 2026-09-25
requested_by: ทีม kiosk (branch feat/pre-register_kiosk)
decided_by: เจ้าของโครงการ
layer: volatile
supersedes:
  - docs/changes/CR-097-smart-card-evacuee-draft-flow.md หัวข้อ Change ข้อ 2–3 และ As-Built ข้อ 1 (การสร้าง evacuee จาก kiosk)
  - docs/features/smart-card-registration-spec.md FR-CARD-01..04
affects:
  - docs/features/smart-card-registration-spec.md (FR-CARD-01..04 → ถูกแทนที่)
  - docs/changes/CR-097-smart-card-evacuee-draft-flow.md (Decision log → ชี้มาที่ CR นี้)
  - docs/data/api-contract.md (เพิ่มหัวข้อ Scanner / Kiosk)
  - docs/data/schema.md §1.1 index ของ evacuee (ไม่ bump schema_v)
  - docs/features/kiosk-lookup-mango-index-implementation-plan.md (ชุด index kiosk lookup — Q10)
  - CONTEXT.md (Report-in — ช่องทาง kiosk)
  - frontend/src/lib/features/kiosk/{domain,data,server,ui}
  - frontend/src/routes/kiosk/** (/, /qr, /phone, /scanner/*)
  - frontend/src/routes/api/v1/scanner/{bootstrap,kiosk/lookup,kiosk/check-in,draft}
  - frontend/src/lib/features/scanners/** · frontend/src/lib/server/scanners/device-credentials.ts
  - frontend/src/lib/server/security/rate-limiter.ts
  - frontend/src/lib/server/shelter-access-design.ts · shelters.admin.ts · features/shelters/server/provisioner.ts · scripts/redeploy-access.ts · scripts/seed/registry-shelters.ts
  - scanner_client/app/{manager,config,scard}.py · scanner_client/tests · scanner_client/README.md
why: >
  Kiosk แบบเดิม (CR-097) สร้าง evacuee จากบัตรโดยไม่มีครัวเรือนและไม่มีเบอร์ เจ้าหน้าที่ต้องกรอกซ้ำที่ Station 1
  และเกิด record ซ้อนกับผู้จองออนไลน์ kiosk รอบนี้จึงทำหน้าที่เดียว คือรับรายงานตัว (Report-in) ผู้ที่ลงทะเบียนล่วงหน้าทางเว็บแล้ว
  ผ่านช่องทางที่ผู้ประสบภัยมีติดตัว (QR ใบจอง บัตรประชาชน เบอร์โทร)
migration: ไม่มี — ไม่มี field ใหม่ ไม่ bump schema_v; evacuee ที่ `registered_via:'kiosk'` เดิมยังอยู่ และให้เจ้าหน้าที่จัดการที่ Station 1 (ดู §9)
---

# ร่าง CR: Kiosk รับรายงานตัวผู้ลงทะเบียนล่วงหน้า

> **สรุป (TL;DR)**
>
> - **เปลี่ยนอะไร:** kiosk **เลิกสร้าง** evacuee จากบัตร (`POST /api/v1/scanner/draft` → 410) และเปลี่ยนเป็น **รับรายงานตัว (Report-in)** ผู้จองทางเว็บ (`pre_registered → arriving`) ผ่าน 3 ช่องทาง ได้แก่ QR ใบจอง · บัตรประชาชน (ใช้เลข 13 หลักอย่างเดียว) · เบอร์โทร (กำลังพัฒนา) — ThaiD พักไว้ก่อน
> - **เพื่อใคร / ทำไม:** ผู้จองล่วงหน้ารายงานตัวเองได้โดยไม่ต้องต่อคิว เลือกสมาชิกครัวเรือนที่มาถึง และรับ QR สายรัดข้อมือ → ลดคิวที่ Station 1 และไม่เกิด record ซ้ำ
> - **Dev ต้องทำอะไร:** implementation หลัก commit แล้ว; ก่อน release ต้องผ่านการอนุมัติ CR, Svelte autofixer, deploy/`_explain` บน staging และ production และทดสอบ kiosk ตาม M1–M8 รวม AC-KPC-26
> - **กระทบ schema / scope:** ไม่ bump `schema_v` · เพิ่มชุด Mango index `KIOSK_LOOKUP_MANGO_INDEXES` 3 ตัวตาม Q6/Q10 แยกจาก index ของ referral · แทนที่ส่วนสร้าง evacuee ของ CR-097 และ FR-CARD-01..04 ของ smart-card spec

---

## 1. เหตุผล

1. **Record ซ้อนกัน:** CR-097 ให้บัตรสร้าง `evacuee` ใหม่ (`registered_via:'kiosk'`, `household_id:null`) แยกจาก booking ทางเว็บของคนคนเดียวกัน เจ้าหน้าที่ต้องรวมเองด้วย `PullPreRegisteredDialog`
2. **ข้อมูลไม่พอใช้งาน:** record ที่ได้จากบัตรไม่มีเบอร์ ไม่มีครัวเรือน ไม่มีความต้องการพิเศษ ยังต้องกรอกที่ Station 1 อยู่ดี kiosk จึงไม่ได้ลดงานจริง
3. **PDPA:** การอ่านชื่อ ที่อยู่ และรูปจากชิป แล้วส่งเข้า server (`card_snapshot.photo_base64`) เป็นการเก็บข้อมูลเกินจำเป็น flow ใหม่ใช้เลข 13 หลักเพื่อค้นหาเท่านั้น และไม่บันทึกลงระบบ
4. **Booking ทางเว็บมีข้อมูลครบอยู่แล้ว** (ครัวเรือน สมาชิก เบอร์ผู้ติดต่อ) สิ่งที่ขาดคือการยืนยันว่า "มาถึงแล้ว" ซึ่งผู้ประสบภัยทำเองที่ kiosk ได้
5. **ผู้ที่ไม่มี QR หรือบัตร** (QR หาย เด็ก ชาวต่างชาติ) ต้องการช่องทางที่ 3 → ใช้เบอร์โทรที่ใช้ตอนจอง

---

## 2. ก่อน → หลัง

| หัวข้อ               | ก่อน (CR-097 ตามที่ทำจริง 2026-09-11)                            | หลัง (CR นี้)                                                                                    |
| :------------------- | :--------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| หน้าที่ของ kiosk     | ลงทะเบียน (สร้าง evacuee) จากบัตร                                | **รับรายงานตัว** ผู้ลงทะเบียนล่วงหน้าทางเว็บ                                                     |
| Endpoint หลัก        | `POST /api/v1/scanner/draft`                                     | `POST /api/v1/scanner/kiosk/lookup` + `/kiosk/check-in` · `/draft` → **410**                     |
| ข้อมูลที่อ่านจากบัตร | ชื่อ เลขบัตร เพศ วันเกิด ที่อยู่ รูป → `card_snapshot`           | **เลข 13 หลักเท่านั้น** ไม่บันทึกลงระบบ                                                          |
| ช่องทางยืนยันตัวตน   | บัตรอย่างเดียว                                                   | QR ใบจอง · บัตร · เบอร์โทร (ThaiD พัก)                                                           |
| Doc ที่เขียน         | สร้าง `evacuee` ใหม่ `pre_registered` + `registered_via:'kiosk'` | **ไม่สร้าง doc ใหม่** · แก้ `evacuee.current_stay` → `arriving` และคำนวณ `household.status` ใหม่ |
| ผู้จองซ้ำ / สแกนซ้ำ  | 409 `already_pre_registered` ฯลฯ (หน้าจอสีเหลือง)                | แสดงผลรายงานตัวเดิม ไม่บันทึกซ้ำ · พิมพ์ QR ซ้ำได้ถ้ายังเป็น `arriving`                          |
| ครัวเรือน            | `household_id:null` ให้เจ้าหน้าที่รวมเอง                         | เลือกสมาชิกครัวเรือนที่มาถึงได้บน kiosk                                                          |
| สิ่งที่ผู้ใช้ได้รับ  | ข้อความ "กรุณาไปพบเจ้าหน้าที่"                                   | QR สายรัดข้อมือ (`evacuee:<ULID>` ไม่มีข้อมูลส่วนบุคคล)                                          |
| ขั้นต่อไปของผู้ใช้   | เจ้าหน้าที่เริ่มฟอร์มลงทะเบียนตั้งแต่ Step 1                     | ไปคัดกรองและจัดโซนตาม ADR-0001 โดยใช้ QR                                                         |

**สิ่งที่ไม่เปลี่ยน:** การยืนยันเครื่อง (`X-Device-Id` + `X-Device-Secret`, `scanner_device` อยู่ใน DB `registry`) · flow ของเจ้าหน้าที่ที่ Station 1 · `schema_v` ของ evacuee

---

## 3. ขอบเขต

| อยู่ในขอบเขต                                                         | อยู่นอกขอบเขต                                                                  |
| :------------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| รับรายงานตัวผู้จองทางเว็บ (`registered_via:'web'`) ในศูนย์ของเครื่อง | ลงทะเบียน walk-in ที่ kiosk                                                    |
| QR ใบจอง · บัตรประชาชน · เบอร์โทร                                    | **ThaiD** — พักไว้ (ปุ่มยังปิดอยู่ แสดง "ยังไม่เปิดใช้งาน")                    |
| เลือกสมาชิกครัวเรือน และพิมพ์ QR สายรัดข้อมือ                        | Unassigned registration (Mongo) — เจ้าหน้าที่ต้อง claim ก่อน                   |
| ลงทะเบียนเครื่อง / bootstrap / `scanner_client`                      | OTP / SMS                                                                      |
| ปิด endpoint เดิม `/scanner/draft` (410)                             | ย้าย `scanner_device` ไปไว้ที่ `shelter_{code}` (คำถามค้างใน CR-097 ยังคงเดิม) |
|                                                                      | Kiosk แบบ edge / offline                                                       |

---

## 4. ลำดับการเปลี่ยนแปลง (ใช้ตรวจย้อนกลับ)

| วันที่     | Commit                                         | สาระ                                                                                          |
| :--------- | :--------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| 2026-08-26 | `394e508f`, `a4fa8be6`                         | เพิ่ม scanner module และ server repository                                                    |
| 2026-08-29 | `2db7fe0b`, `88c81459`, `648e0066`             | CR-097: บัตร → evacuee draft, คำนวณอายุจากปีเกิด, หารหัสไปรษณีย์                              |
| 2026-08-30 | `ca89a471`, `8d399ac6`, `b9433fe5`, `57a7ef44` | เลิกใช้สถานะ draft เปลี่ยนเป็น `pre_registered` + `kiosk` · ยืนยันเครื่องด้วย header เท่านั้น |
| 2026-09-11 | `891b0ca5`                                     | กรอกที่อยู่อัตโนมัติจาก `card_snapshot` (CR-097 as-built)                                     |
| 2026-09-22 | `31c7cb63`, `e22aa87b`                         | kiosk แสดงชื่อศูนย์และชื่อเครื่องจาก bootstrap                                                |
| 2026-09-23 | `e79dda69`, `fb036054`                         | หน้าเลือกวิธียืนยันตัวตน + สแกน QR                                                            |
| 2026-09-24 | `52c08e7d`                                     | **API lookup / check-in ของ kiosk** (เริ่มรับรายงานตัว)                                       |
| 2026-09-24 | `59d799cd`, `6079b9af`, `df48dbec`, `90693285` | บัตรใช้ flow ค้นหาเดียวกับ QR · check-in ทั้งครัวเรือนร่วมกันทุกช่องทาง · `/draft` → 410      |
| 2026-09-24 | `acace076`                                     | สแกนซ้ำ → แสดงผลรายงานตัวเดิม                                                                 |
| 2026-09-24 | `094a6fb2`, `22befb27`, `5013e626`, `1a7d2889` | ปรับ layout จอเล็ก · navigation ระหว่างอ่านบัตร                                               |
| 2026-09-24 | `9bbc592d`                                     | `scanner_client` ยอมรับ HTTP สำหรับ URL ตอนพัฒนา                                              |
| 2026-09-24 | `bbb244f3`                                     | เพิ่มชุด Mango index ของ kiosk lookup และจุด deploy                                           |
| 2026-09-24 | `35c471a3`                                     | ใช้ตัวช่วยปิดนามสกุลร่วมกัน                                                                   |
| 2026-09-24 | `18595fd6`                                     | เพิ่มการแปลงรูปแบบเบอร์และจัดกลุ่มผลค้นหา                                                     |
| 2026-09-24 | `02679262`                                     | ค้นครัวเรือนจากเบอร์โทร                                                                       |
| 2026-09-24 | `b8281c79`                                     | ช่องทางเบอร์โทร                                                                               |
| 2026-09-24 | `998a6274`, `11f4b4b3`, `bcd87dc2`             | allowlist credential · เสียบบัตรซ้ำจากหน้าผล · idle timeout ทุกช่องทาง                        |
| 2026-09-25 | `f7da61f9`                                     | ปิดนามสกุลทุกช่องทาง · แสดงสมาชิกทั้งครัวเรือนและสมาชิกจาก Station 1 แบบเลือกไม่ได้ (Q11/Q12) |

**ตรวจฐาน local (2026-09-25):** `shelter_sh001`–`shelter_sh004` มี kiosk index ครบ 3 ตัว (`_index` ตอบ `exists`) และ `_explain` ของ selector เบอร์, เลขบัตร, ครัวเรือนแบบมี/ไม่มี `registered_via` เลือก `evacuee-type-phone-idx`, `evacuee-type-person-id-idx`, `evacuee-type-household-idx` ตามลำดับทุกฐาน; ไม่มี `_all_docs` · warm-up `_find` ผ่านทุก selector · ยังไม่ได้ตรวจ staging/production

---

## 5. รายการ feature ที่มีอยู่ (ณ 2026-09-25)

สัญลักษณ์: ✅ ทำเสร็จและ commit แล้ว · 🔄 code พร้อมแต่รอ deploy/ตรวจจริง หรือมีงานค้าง · ⬜ ยังไม่ทำ · ⏸ พักไว้

| #    | Feature                                                                                        | สถานะ                                                    | ไฟล์หลัก                                                                                       |
| :--- | :--------------------------------------------------------------------------------------------- | :------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| F-01 | ลงทะเบียนเครื่อง kiosk (เฉพาะ system_admin) · แสดง secret ครั้งเดียว · เก็บเป็น SHA-256        | ✅                                                       | `routes/(protected)/system-management/scanners`, `features/scanners`, `api/v1/scanner/devices` |
| F-02 | Bootstrap เครื่อง · retry พร้อม backoff · ล้มเหลวแล้วหยุดทำงาน                                 | ✅                                                       | `api/v1/scanner/bootstrap`, `scanner_client/app/manager.py`                                    |
| F-03 | หน้าจอหลักของ kiosk: ชื่อศูนย์ จุดบริการ ชื่อเครื่อง นาฬิกา · ส่งต่อค่าแสดงผล 4 ค่าระหว่างหน้า | ✅                                                       | `features/kiosk/ui/kiosk-shell.svelte`, `domain/display-context.ts`                            |
| F-04 | หน้าเลือกวิธียืนยันตัวตน (การ์ดเต็มปุ่ม 2×2)                                                   | ✅                                                       | `ui/identity-method-selector.svelte`, `domain/identity-method.ts`                              |
| F-05 | ช่องทาง QR (กล้อง · token `evacuee:<ULID>` · กันสแกนรัว 1.5 วินาที)                            | ✅                                                       | `ui/qr-identity-scan.svelte`, `routes/kiosk/qr`                                                |
| F-06 | ช่องทางบัตรประชาชน (อ่านเลข 13 หลัก · ต้องถอดบัตรก่อนยืนยัน)                                   | ✅                                                       | `scanner_client/app/{manager,scard}.py`, `routes/kiosk/scanner/*`                              |
| F-07 | ช่องทางเบอร์โทร (numpad · เลือกครัวเรือนเมื่อเจอหลายราย · ปิดนามสกุลบางส่วน · จำกัดจำนวนครั้ง) | 🔄                                                       | `ui/phone-*.svelte`, `ui/kiosk-numpad.svelte`, `routes/kiosk/phone`                            |
| F-08 | ช่องทาง ThaiD                                                                                  | ⏸                                                        | `domain/identity-method.ts` (ปิดไว้)                                                           |
| F-09 | ค้นหาผู้จองในศูนย์ของเครื่อง                                                                   | ✅ (QR/บัตร) · 🔄 (เบอร์)                                | `server/kiosk-check-in.server.ts`, `api/v1/scanner/kiosk/lookup`                               |
| F-10 | เลือกสมาชิกครัวเรือน + ยืนยันรายงานตัว                                                         | ✅                                                       | `ui/kiosk-pre-registered-check-in.svelte`, `api/v1/scanner/kiosk/check-in`                     |
| F-11 | สแกนซ้ำ → แสดงผลเดิม ไม่บันทึกซ้ำ                                                              | ✅                                                       | `domain/check-in-status.ts`                                                                    |
| F-12 | พิมพ์ QR สายรัดข้อมือ (กว้าง 80mm, ใน QR ไม่มีข้อมูลส่วนบุคคล)                                 | ✅                                                       | `ui/kiosk-pre-registered-check-in.svelte`                                                      |
| F-13 | แถบขั้นตอน (wizard) 5 ขั้น                                                                     | ✅                                                       | `ui/kiosk-check-in-wizard.svelte`                                                              |
| F-14 | ปิด endpoint เดิม `/scanner/draft` (410)                                                       | ✅                                                       | `api/v1/scanner/draft`                                                                         |
| F-15 | Playwright เติม credential ให้เฉพาะ path ที่อนุญาต                                             | ✅                                                       | `scanner_client/app/manager.py`                                                                |
| F-16 | ชุด Mango index kiosk lookup (เบอร์ · เลขบัตร · ครัวเรือน)                                     | 🔄 deploy/`_explain` ผ่านบน local; รอ staging/production | `server/shelter-access-design.ts`                                                              |
| F-17 | Test ของ server และ route lookup / report-in                                                   | ✅                                                       | `server/*.test.ts`, `api/v1/scanner/kiosk/*/server.test.ts`                                    |
| F-18 | บันทึกว่าเครื่องไหนรับรายงานตัวใคร                                                             | ⏸ เลื่อนไป backlog (Q4)                                  | —                                                                                              |
| F-19 | QR / บัตร / เบอร์ แสดงรายชื่อทั้งครัวเรือนเหมือนกันทุกกรณี รวมถึงสแกนซ้ำหลังรายงานตัวแล้ว      | 🔄 โค้ดและ automated tests ผ่าน; รอทดสอบ M1–M5 บน kiosk  | `ui/kiosk-pre-registered-check-in.svelte`, `server/kiosk-check-in.server.ts`                   |
| F-20 | ปิดนามสกุลบางส่วนทุกช่องทาง (หน้าจอ + สายรัดข้อมือ)                                            | 🔄 โค้ดและ automated tests ผ่าน; รอทดสอบ M4 บน kiosk     | `server/kiosk-check-in.server.ts`                                                              |
| F-21 | เสียบบัตรใหม่ระหว่างหน้าผลของ flow บัตร + หมดเวลาไม่มีการแตะจอทุกช่องทาง                       | 🔄 โค้ดและ automated tests ผ่าน; รอทดสอบ M6–M8 บน kiosk  | `scanner_client/app/manager.py`, `ui/kiosk-pre-registered-check-in.svelte`                     |

---

## 6. Requirements

รหัส `FR-KPC-*` (Kiosk Pre-registration Check-in) · คอลัมน์ "สถานะ" ใช้สัญลักษณ์เดียวกับ §5

### 6.1 เครื่องและ bootstrap

| ID        | Requirement                                                                                                                                                                                          | สถานะ |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---- |
| FR-KPC-01 | เฉพาะ `system_admin` สร้างเครื่องได้ โดยระบุ `device_id` (`[A-Za-z0-9_-]` อย่างน้อย 2 ตัว), `name`, `shelter_code`, `station_name` (ค่าเริ่มต้น「จุดคัดกรองทั่วไป」), `status active\|inactive`      | ✅    |
| FR-KPC-02 | แสดง secret (`sk_scan_…`) แบบ plaintext ครั้งเดียวตอนสร้าง ระบบเก็บเฉพาะ `secret_hash` (SHA-256) + `secret_prefix` ใน `scanner_device:{device_id}` DB `registry`                                     | ✅    |
| FR-KPC-03 | ทุก request ของ kiosk ต้องยืนยันด้วย header `X-Device-Id` + `X-Device-Secret` (เทียบแบบ timing-safe) · เครื่องที่ไม่รู้จัก, secret ผิด หรือ `inactive` → 401 `DEVICE_AUTH_FAILED` แบบเดียวกันทุกกรณี | ✅    |
| FR-KPC-04 | ศูนย์ของทุก request มาจากข้อมูลเครื่องเท่านั้น ค่าที่ browser ส่งมาใช้แสดงผลอย่างเดียว                                                                                                               | ✅    |
| FR-KPC-05 | `scanner_client` ต้องเรียก bootstrap ก่อนเปิด browser · ได้ 401 → หยุดทำงาน (exit 79) · ได้ 503 หรือ network ล่ม → retry แบบจำกัดจำนวนครั้งพร้อม backoff                                             | ✅    |
| FR-KPC-06 | Browser ไม่ถือ secret: Playwright เติม header ให้เฉพาะ `POST` แบบ same-origin ไปที่ `/api/v1/scanner/kiosk/lookup` และ `/check-in` · request อื่นที่แนบ header ปลอมมาจะถูกลบ header ออก              | ✅    |
| FR-KPC-07 | ทุก response ของ `/api/v1/scanner/*` ต้องมี `cache-control: no-store`                                                                                                                                | ✅    |
| FR-KPC-08 | อัปเดต `last_seen_at` ของเครื่องเมื่อค้นหาสำเร็จ (ล้มเหลวได้โดยไม่กระทบผลค้นหา)                                                                                                                      | ✅    |

### 6.2 หน้าจอหลักและการนำทาง

| ID        | Requirement                                                                                                                                           | สถานะ             |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------- |
| FR-KPC-10 | แสดงชื่อศูนย์ จุดบริการ และชื่อเครื่องจาก query `shelter_name`, `shelter_code`, `station_name`, `device_name` · ส่งต่อระหว่างหน้าเฉพาะ 4 ค่านี้       | ✅                |
| FR-KPC-11 | หน้า `/kiosk` แสดงวิธียืนยันตัวตน 4 การ์ด: QR (✅) · บัตร (✅) · เบอร์ (🔄) · ThaiD (⏸ ปิดไว้)                                                        | ✅/🔄             |
| FR-KPC-12 | ทุกหน้าหลังเลือกวิธีต้องมีปุ่ม「กลับ」และแถบขั้นตอน 5 ขั้น: วิธีค้นหา → สแกน/กรอก → ค้นหา → สมาชิก → เสร็จสิ้น                                        | ✅                |
| FR-KPC-13 | ใช้งานได้ครบโดยไม่ต้อง scroll ที่ขนาดจอ 1024×600 และ 540×960                                                                                          | ✅                |
| FR-KPC-14 | ทุกช่องทาง: ไม่มีการแตะจอ 60 วินาทีในหน้าค้นหา / เลือกสมาชิก / ผล → ล้าง state และกลับ `/kiosk` · หยุดนับระหว่างพิมพ์สายรัดข้อมือ                     | 🔄 รอ manual test |
| FR-KPC-15 | ช่องทางบัตร: หน้าถอดบัตรต้องแสดงคำเตือนค้างไว้ตลอดเวลาที่ยังเสียบบัตร · เริ่มนับเวลาไม่ใช้งาน 60 วินาทีหลังได้รับ `kiosk:smart-card-removed` เท่านั้น | 🔄 รอ manual test |

### 6.3 กฎการค้นหา (ทุกช่องทาง)

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                      | สถานะ                      |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------- |
| FR-KPC-20 | ค้นเฉพาะใน DB `shelter_{code}` ของเครื่อง                                                                                                                                                                                                                                                                                                                        | ✅                         |
| FR-KPC-21 | ผู้ที่ค้นเจอได้ = `type:'evacuee'` · `shelter_code` ตรงกับเครื่อง · `registered_via:'web'` · `current_stay.status` เป็นหนึ่งใน `pre_registered, arriving, active, room_confirmed, temporary_leave`                                                                                                                                                               | ✅                         |
| FR-KPC-22 | สมาชิกที่แสดง = ผู้ที่ค้นเจอ + evacuee ที่ `registered_via:'web'` ใน `household_id` เดียวกัน                                                                                                                                                                                                                                                                     | ✅ ถูกแทนที่ด้วย FR-KPC-29 |
| FR-KPC-23 | เลือกรายงานตัวได้ (`selectable`) เมื่อ `registered_via:'web'` และ `status:'pre_registered'`                                                                                                                                                                                                                                                                      | ✅                         |
| FR-KPC-24 | ไม่พบ หรือพบแต่ไม่เข้าเงื่อนไข (ยกเลิก, ออกแล้ว, ย้ายศูนย์, เสียชีวิต, อยู่ศูนย์อื่น) → 404 `PRE_REGISTRATION_NOT_FOUND` ด้วยข้อความเดียวกันทุกกรณี                                                                                                                                                                                                              | ✅                         |
| FR-KPC-25 | ข้อมูลสมาชิกใน response มีเฉพาะ `evacuee_id, first_name, last_name, gender, age, status, is_primary, selectable` · ห้ามมี `phone`, `person_id`, ที่อยู่ หรือข้อมูลสุขภาพ                                                                                                                                                                                         | ✅                         |
| FR-KPC-26 | Response ต้องมี `kind:'household'` และ `name_masked:boolean` เพิ่มเข้ามา (ของเดิมไม่เปลี่ยน · client ที่ได้ response ไม่มี `kind` ให้ถือเป็น household)                                                                                                                                                                                                          | ✅                         |
| FR-KPC-27 | หน้าจอต้องเทียบ `shelter_code` ที่ได้จาก server กับที่แสดงบนจอ ถ้าไม่ตรง → แสดง「ข้อมูลศูนย์ของเครื่องสแกนไม่ตรงกัน」และห้ามยืนยัน                                                                                                                                                                                                                               | ✅                         |
| FR-KPC-28 | ทุกช่องทางปิดนามสกุลบางส่วนด้วย `maskLastName` และตอบ `name_masked:true` เสมอ · หน้าจอแสดง「ชื่อถูกปิดบางส่วนเพื่อความเป็นส่วนตัว」· สายรัดข้อมือพิมพ์นามสกุลแบบปิดบางส่วน · ขยายขอบเขต FR-KPC-58 และ Q2 จากช่องทางเบอร์ไปทุกช่องทาง                                                                                                                             | 🔄 รอ manual test          |
| FR-KPC-29 | รายชื่อสมาชิก = ทุกคนใน `household_id` เดียวกันในศูนย์นี้ที่สถานะ `pre_registered` หรือรายงานตัวแล้ว (`arriving, active, room_confirmed, temporary_leave`) · ไม่แสดงคนที่ยกเลิก / ออกแล้ว / ย้ายศูนย์ / เสียชีวิต และคนที่ `privacy.search_excluded:true` · แสดงสมาชิกที่ `registered_via` ไม่ใช่ `web` แต่เลือกไม่ได้ · เลือกได้เฉพาะ FR-KPC-23 · แทน FR-KPC-22 | 🔄 รอ manual test          |

### 6.4 ช่องทาง QR

| ID        | Requirement                                                                                                     | สถานะ |
| :-------- | :-------------------------------------------------------------------------------------------------------------- | :---- |
| FR-KPC-30 | อ่าน QR ผ่านกล้องหลังของเครื่อง · รับเฉพาะ `evacuee:<ULID>` (ไม่สนตัวพิมพ์เล็ก/ใหญ่ แล้วแปลงเป็นตัวใหญ่)        | ✅    |
| FR-KPC-31 | QR รูปแบบอื่น (รวมถึงใบจองแบบยังไม่ระบุศูนย์ที่เป็น Mongo id) → แสดง「QR นี้ใช้รายงานตัวไม่ได้」และไม่เรียก API | ✅    |
| FR-KPC-32 | ไม่อ่าน QR ซ้ำภายใน 1.5 วินาที · เปิดกล้องไม่ได้ → แสดงปุ่ม「ลองอีกครั้ง」                                      | ✅    |
| FR-KPC-33 | ค้นหาด้วย `_id` ตรงตัว ได้ไม่เกิน 1 ราย                                                                         | ✅    |

### 6.5 ช่องทางบัตรประชาชน

| ID        | Requirement                                                                                                                                                                                          | สถานะ             |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------- |
| FR-KPC-40 | `scanner_client` อ่าน **เฉพาะเลข 13 หลัก** จากชิป · ห้ามส่งชื่อ ที่อยู่ หรือรูปเข้า server                                                                                                           | ✅                |
| FR-KPC-41 | เสียบบัตร → หน้า「กำลังอ่านบัตร」(แสดงอย่างน้อยช่วงสั้น ๆ เพื่อไม่ให้จอกระพริบ) → อ่านเสร็จ → หน้าถอดบัตรรับ event `kiosk:smart-card-read`                                                           | ✅                |
| FR-KPC-42 | อ่านบัตรไม่สำเร็จ หรือเลขไม่ครบ 13 หลัก → ไปหน้า `/kiosk/scanner/error` พร้อมคำแนะนำ                                                                                                                 | ✅                |
| FR-KPC-43 | ปุ่มยืนยันรายงานตัวกดได้หลังถอดบัตรแล้วเท่านั้น (`kiosk:smart-card-removed`)                                                                                                                         | ✅                |
| FR-KPC-44 | ค้นหาด้วย `_find` บน `person_id.number` · ถ้าพบผู้เข้าเงื่อนไขไม่ใช่ 1 รายพอดี → 404                                                                                                                 | ✅                |
| FR-KPC-45 | เสียบบัตรขณะอยู่หน้าใดก็ตาม → flow บัตรมาก่อน (พาไปหน้าอ่านบัตรทันที)                                                                                                                                | ✅                |
| FR-KPC-46 | หลังถอดบัตรแล้ว ระหว่างที่หน้าจอยังอยู่ที่หน้าเลือกสมาชิกหรือหน้าผล ถ้ามีบัตรเสียบเข้ามาใหม่ `scanner_client` ต้องเริ่ม flow อ่านบัตรใหม่ทันที (ไม่ต้องรอกลับ `/kiosk`) และ state ของหน้าเดิมถูกล้าง | 🔄 รอ manual test |

### 6.6 ช่องทางเบอร์โทร

| ID        | Requirement                                                                                                                                                                                                                                                                                                  | สถานะ                                        |
| :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------- |
| FR-KPC-50 | หน้า `/kiosk/phone` ใช้ numpad บนจอ (0–9, ลบ, ล้าง) ปุ่มสูงอย่างน้อย 64px · ห้ามใช้คีย์บอร์ดของระบบหรือ autocomplete                                                                                                                                                                                         | 🔄                                           |
| FR-KPC-51 | กดค้นหาได้เมื่อกรอก 9–10 หลักที่ขึ้นต้นด้วย `0` · แสดงผลแบบ `0xx-xxx-xxxx`                                                                                                                                                                                                                                   | 🔄                                           |
| FR-KPC-52 | เก็บเบอร์ไว้ใน state ของหน้าจอเท่านั้น ห้ามอยู่ใน URL, `page.state`, storage หรือ log ของ server (log ตอนพัฒนาแสดงได้แค่ 4 หลักท้าย) · ต้องล้างเบอร์หลังค้นหา เมื่อกดกลับ หรือเมื่อไม่มีการแตะจอ 60 วินาที (แล้วกลับไป `/kiosk`)                                                                             | 🔄                                           |
| FR-KPC-53 | API รับ `{source:'phone', phone, primary_evacuee_id?}` · server แปลงรูปแบบเบอร์ (ตัดอักขระที่ไม่ใช่ตัวเลข, `66…` → `0…`) ผลต้องตรง `^0\d{8,9}$` ไม่อย่างนั้นตอบ 400                                                                                                                                          | 🔄                                           |
| FR-KPC-54 | จับคู่กับเบอร์ของ **สมาชิกคนใดก็ได้** · จัดกลุ่มตาม `household_id` (ถ้าเป็น null ให้เป็นกลุ่มเดี่ยว) · กลุ่มต้องผ่านเงื่อนไข FR-KPC-21                                                                                                                                                                       | 🔄                                           |
| FR-KPC-55 | คนหลักของกลุ่ม = สมาชิกที่เบอร์ตรงและ `_id === household.head_evacuee_id` → ถ้าไม่มี ใช้คนที่เบอร์ตรงและ `created_at` เก่าที่สุด (เท่ากันให้ดู `_id`)                                                                                                                                                        | 🔄                                           |
| FR-KPC-56 | พบ 0 กลุ่ม → 404 · 1 กลุ่ม → `kind:'household'` · 2–5 กลุ่ม → `kind:'candidates'` (`primary_evacuee_id, contact_display, member_count, pending_count`) · เกิน 5 → 409 `KIOSK_TOO_MANY_MATCHES`「พบหลายรายการ กรุณาติดต่อเจ้าหน้าที่」                                                                        | 🔄                                           |
| FR-KPC-57 | เมื่อผู้ใช้เลือกครัวเรือน → ส่ง `phone + primary_evacuee_id` กลับมา · server ต้องค้นซ้ำและยืนยันว่า id อยู่ในกลุ่มของเบอร์นั้น **และจำนวนกลุ่มไม่เกิน 5** · ไม่ผ่าน → 404 / 409                                                                                                                              | ✅                                           |
| FR-KPC-58 | ช่องทางเบอร์: ปิดนามสกุลบางส่วนของทุกคน (รวมใน `contact_display`) ด้วย `maskLastName` · ตั้ง `name_masked:true` · หน้าจอแสดง「ชื่อถูกปิดบางส่วนเพื่อความเป็นส่วนตัว」                                                                                                                                        | 🔄                                           |
| FR-KPC-59 | จำกัดจำนวนครั้งเฉพาะช่องทางเบอร์ (นับหลังยืนยันเครื่องผ่านแล้ว): 10 ครั้ง/นาที/เครื่อง และ 5 ครั้ง/นาที/เบอร์สำหรับค้นหาเบื้องต้น · request ที่มี `primary_evacuee_id` ข้าม limit ต่อเบอร์แต่ยังนับ limit ต่อเครื่อง · เกินตอบ 429 `KIOSK_RATE_LIMITED` + `retry-after: 60` · หน้าจอปิดปุ่มลองใหม่ 60 วินาที | 🔄                                           |
| FR-KPC-60 | ช่องทางเบอร์: ถ้ามีสมาชิกที่เลือกได้อย่างน้อย 1 คน ให้ไปหน้าเลือกสมาชิก (เลือกให้ทุกคนที่เลือกได้ไว้ก่อน) · แสดงผลรายงานตัวเดิมทันทีเฉพาะเมื่อไม่มีใครเลือกได้เลย                                                                                                                                            | 🔄                                           |
| FR-KPC-61 | evacuee ที่ตั้ง `privacy.search_excluded:true` ค้นด้วยเบอร์ไม่พบ (ตาม Q1)                                                                                                                                                                                                                                    | 🔄                                           |
| FR-KPC-62 | Mango index `['type','phone']` ในชุด `KIOSK_LOOKUP_MANGO_INDEXES` deploy ตอนสร้างศูนย์ใหม่, admin redeploy, `scripts/redeploy-access.ts` และ seed; query ใช้ exact match ต่อค่าที่จัดเก็บและ query ค่า `+66…` เพิ่มเพื่อรองรับข้อมูลเก่า                                                                     | 🔄 (local ผ่าน; รอ staging/production)       |
| FR-KPC-63 | ชุด `KIOSK_LOOKUP_MANGO_INDEXES` มี 3 ตัว: `['type','phone']` (`evacuee-type-phone-idx`) · `['type','person_id.number']` (`evacuee-type-person-id-idx`) · `['type','household_id']` (`evacuee-type-household-idx`) · ไม่มี `shelter_code` ใน index                                                           | 🔄 (local ผ่าน; รอ staging/production)       |
| FR-KPC-64 | ชุด index ของ kiosk deploy ด้วย function / loop / step ของตัวเองทุกจุด (provisioner, admin redeploy, `scripts/redeploy-access.ts`, seed) · `REFERRAL_MANGO_INDEXES` และ `deployReferralMangoIndexes` แยกเดิม · redeploy script warm-up 1 query ต่อ index หลังสร้าง                                           | ✅ (code commit แล้ว; deploy จริงยังรอ)      |
| FR-KPC-65 | ทุก `_find` ของ kiosk (ค้นบัตร, ขยายครัวเรือน, คำนวณสถานะครัวเรือน, นับสมาชิกตอนแสดงตัวเลือกครัวเรือน) ใช้ equality บน field ที่มี index · ไม่มี `$in`; ตัวเลือกครัวเรือนค้นทีละครัวเรือน ไม่เกิน 5 ครั้ง                                                                                                    | ✅ (code commit แล้ว; local `_explain` ผ่าน) |

### 6.7 เลือกสมาชิกและยืนยันรายงานตัว

| ID        | Requirement                                                                                                                                                                                    | สถานะ |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---- |
| FR-KPC-70 | QR / บัตร: เลือกคนที่ถูกสแกนไว้ก่อน (ถ้าเลือกได้) · ผู้ใช้ติ๊กสมาชิกอื่นเพิ่มหรือเอาออกได้ · สมาชิกที่เลือกไม่ได้ให้แสดงสถานะแต่ติ๊กไม่ได้                                                     | ✅    |
| FR-KPC-71 | `POST /kiosk/check-in` รับ `primary_evacuee_id` + `evacuee_ids` จำนวน 1–20 · ตัด id ที่ซ้ำออก                                                                                                  | ✅    |
| FR-KPC-72 | Server ต้องตรวจว่าคนหลักและสมาชิกแต่ละคนอยู่ศูนย์เดียวกัน ครัวเรือนเดียวกับคนหลัก เป็น `web` และไม่มี `privacy.search_excluded:true` ก่อนรับรายงานตัว · ไม่ผ่าน → `not_eligible` / `not_found` | ✅    |
| FR-KPC-73 | ถ้าเป็น `pre_registered` → PUT `current_stay: {status:'arriving', zone:null, since:<เวลาปัจจุบัน>}` + `updated_at` พร้อม `_rev` ล่าสุด → ตอบ `checked_in` + `qr_payload = evacuee_id`          | ✅    |
| FR-KPC-74 | สถานะอื่น → `already_checked_in` (มี `qr_payload` เฉพาะ `arriving`) หรือ `not_eligible` · ถ้าเขียนแล้วชน (conflict) → อ่านใหม่แล้วรายงานตามสถานะจริง                                           | ✅    |
| FR-KPC-75 | เมื่อมีคน `checked_in` อย่างน้อย 1 คน → คำนวณ `household.status` ใหม่ด้วย `deriveHouseholdStatus` (ถ้าล้มเหลวต้องไม่ทำให้การรายงานตัวล้มตาม)                                                   | ✅    |
| FR-KPC-76 | ครัวเรือนเกิน 20 คน: ทุกช่องทางแบ่งส่งครั้งละไม่เกิน 20 และยืนยันได้ครบ · ถ้าชุดถัดไปล้มเหลว ต้องแสดงผล/QR ของชุดที่สำเร็จและให้ลองรายการค้างซ้ำได้                                            | ✅    |
| FR-KPC-77 | ทุก request จากหน้าจอมี timeout 10 วินาที → แสดง「เชื่อมต่อช้า กรุณาลองอีกครั้ง」                                                                                                              | 🔄    |

### 6.8 สแกนซ้ำและสิ่งที่ผู้ใช้ได้รับ

| ID        | Requirement                                                                                                                                                                                                                                                                                          | สถานะ                      |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------- |
| FR-KPC-80 | QR / บัตร: ถ้าคนที่ถูกสแกนรายงานตัวไปแล้ว → ข้ามหน้าเลือกสมาชิก แสดง「พบผลรายงานตัวเดิม ไม่มีการบันทึกซ้ำ」เฉพาะคนที่ถูกสแกน                                                                                                                                                                         | ✅ ถูกแทนที่ด้วย FR-KPC-83 |
| FR-KPC-81 | พิมพ์สายรัดข้อมือเฉพาะคนที่มี `qr_payload` · ใบละ 1 คน มีชื่อ ศูนย์ QR (`evacuee:<ULID>`) และข้อความ「สแกน QR นี้เพื่อค้นหาข้อมูลในศูนย์พักพิง」                                                                                                                                                     | ✅                         |
| FR-KPC-82 | กด「เสร็จสิ้น」→ กลับหน้าเริ่มของช่องทางนั้น (บัตร → `/kiosk`) และล้าง state ทั้งหมด                                                                                                                                                                                                                 | ✅                         |
| FR-KPC-83 | ทุกช่องทางใช้กฎเดียวกันหลังค้นเจอ: มีสมาชิกเลือกได้อย่างน้อย 1 คน → หน้าเลือกสมาชิก (QR / บัตร เลือกไว้ก่อนเฉพาะคนที่ถูกสแกนถ้าเลือกได้ · เบอร์เลือกทุกคนที่เลือกได้) · ไม่มีใครเลือกได้ → หน้าผลแสดงทุกคนที่รายงานตัวแล้ว และพิมพ์ QR ซ้ำได้ทุกคนที่ยัง `arriving` · แทน FR-KPC-80 และรวม FR-KPC-60 | 🔄 รอ manual test          |

### 6.9 ของเดิมที่ปิดไป

| ID        | Requirement                                                                                                  | สถานะ |
| :-------- | :----------------------------------------------------------------------------------------------------------- | :---- |
| FR-KPC-90 | `POST /api/v1/scanner/draft` ยืนยันเครื่องแล้วตอบ 410 `KIOSK_DRAFT_DISABLED` เสมอ · ไม่สร้างหรือแก้ doc ใด ๆ | ✅    |
| FR-KPC-91 | `scanner_client` ไม่เรียก `read_all_data()` ใน flow ปกติ (`test_card.py` ใช้ตรวจฮาร์ดแวร์เท่านั้น)           | ✅    |

---

## 7. สัญญา API

| Endpoint                              | Request                                                                                                       | 200                                                                                                                                | Error                                                                                                                                                         |
| :------------------------------------ | :------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/scanner/bootstrap`      | `{client_version}`                                                                                            | `{device:{device_id,name,shelter_code,shelter_name,station_name,status,last_seen_at}, server_time}`                                | 401 `DEVICE_AUTH_FAILED` · 503 `DEPENDENCY_UNAVAILABLE`                                                                                                       |
| `POST /api/v1/scanner/kiosk/lookup`   | `{source:'smart-card', citizen_id}` · `{source:'qr', token}` · `{source:'phone', phone, primary_evacuee_id?}` | `{kind:'household', name_masked, shelter_code, primary_evacuee_id, members[]}` · `{kind:'candidates', shelter_code, candidates[]}` | 400 `INVALID_GATE_INPUT` · 401 · 404 `PRE_REGISTRATION_NOT_FOUND` · 409 `KIOSK_TOO_MANY_MATCHES` · 429 `KIOSK_RATE_LIMITED` · 503 · 500 `KIOSK_LOOKUP_FAILED` |
| `POST /api/v1/scanner/kiosk/check-in` | `{primary_evacuee_id, evacuee_ids[1..20]}`                                                                    | `{shelter_code, members:[{evacuee_id, status, stay_status?, qr_payload?}]}`                                                        | 400 `INVALID_CHECK_IN_INPUT` · 401 · 503 · 500 `KIOSK_CHECK_IN_FAILED`                                                                                        |
| `POST /api/v1/scanner/draft`          | —                                                                                                             | —                                                                                                                                  | **410 `KIOSK_DRAFT_DISABLED`** · 401 · 503                                                                                                                    |
| `POST /api/v1/scanner/devices`        | `scannerDeviceInputSchema` (session ของ `system_admin`)                                                       | ข้อมูลเครื่อง + `plaintext_secret` (ครั้งเดียว)                                                                                    | 403 · 404 ไม่พบศูนย์ · 409 `CONFLICT` · 503                                                                                                                   |

ค่า `member.status` ที่ API report-in ส่งกลับ (คง enum เดิม): `checked_in` · `already_checked_in` · `not_found` · `not_eligible` · `failed`

---

## 8. ผลกระทบต่อข้อมูล

| Doc                         | การเปลี่ยน                                                                                                                    | schema_v    |
| :-------------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :---------- |
| `evacuee`                   | แก้ `current_stay` (`pre_registered → arriving`, `zone:null`, `since`) + `updated_at` — ไม่มี field ใหม่                      | คงเดิม (10) |
| `household`                 | คำนวณ `status` ใหม่ (ค่าที่ derive มา)                                                                                        | คงเดิม      |
| `scanner_device` (registry) | `last_seen_at`                                                                                                                | คงเดิม (1)  |
| Mango index                 | ชุด `KIOSK_LOOKUP_MANGO_INDEXES`: เบอร์ (Q6) + เลขบัตร + ครัวเรือน (Q10) · แยกจาก index ของ referral · ไม่มี field ใหม่ใน doc | —           |
| `card_snapshot`             | kiosk **เลิกเขียน** · field ยังอยู่ใน schema สำหรับ record เก่า                                                               | คงเดิม      |

---

## 9. การย้ายข้อมูล

- ไม่ bump `schema_v` · ไม่แก้ doc ที่บันทึกไว้แล้ว
- evacuee ที่ `registered_via:'kiosk'` ซึ่งสร้างก่อนปิด `/draft` ยังอยู่ใน `shelter_{code}` · kiosk ใหม่ **ไม่** รับรายงานตัวให้ (ค้นเฉพาะ `web`) → ให้เจ้าหน้าที่จัดการที่ Station 1 / `PullPreRegisteredDialog` ตามเดิม (ดู Q7)
- Index ใหม่: ศูนย์ใหม่ได้ตอนสร้างศูนย์ · ศูนย์เดิมรัน `pnpm redeploy:access` (dry-run) แล้ว `pnpm redeploy:access --write --confirm` หรือ admin redeploy · ระหว่างที่ยังไม่ deploy `_find` ยังทำงานได้ แต่ต้องไล่อ่านทั้ง DB
- CouchDB build index ตอนค้นครั้งแรก → redeploy script ยิง query อุ่นเครื่องหลังสร้าง (FR-KPC-64) เพื่อไม่ให้ผู้ใช้คนแรกที่ kiosk ต้องรอ
- Index ชื่อเดิมระหว่างพัฒนา (`evacuee-type-shelter-phone-idx`) ยังไม่เคย merge จึงไม่มีใน staging / prod · เครื่อง dev ที่เคย seed ไว้ลบเองได้
- ย้อนกลับ: ลบ index ของชุด kiosk ได้โดยไม่กระทบ referral · query ยังทำงานได้แบบไล่อ่านทั้ง DB
- `scanner_client` ที่ติดตั้งแล้วไม่ต้องอัปเดตเพื่อใช้ช่องทางเบอร์ (ใช้ `/lookup` เดิม)

---

## 10. เกณฑ์ตรวจรับ (Acceptance criteria)

| AC        | สิ่งที่ตรวจ                                                                                                             | อ้าง FR-KPC |
| :-------- | :---------------------------------------------------------------------------------------------------------------------- | :---------- |
| AC-KPC-01 | เครื่องที่ `inactive` หรือ secret ผิด → bootstrap ได้ 401 และ `scanner_client` หยุดทำงาน                                | 03, 05      |
| AC-KPC-02 | Request จาก browser ที่ปลอม `X-Device-Secret` ไปยัง path อื่น → header ถูกลบออก                                         | 06          |
| AC-KPC-03 | QR ใบจองของศูนย์นี้ → เห็นสมาชิกครัวเรือน · QR ของศูนย์อื่น → 404                                                       | 20, 24, 33  |
| AC-KPC-04 | QR ใบจองแบบยังไม่ระบุศูนย์ → 「QR นี้ใช้รายงานตัวไม่ได้」และไม่มี request ไป `/lookup`                                  | 31          |
| AC-KPC-05 | เสียบบัตรค้างไว้ → กดปุ่มยืนยันไม่ได้จนกว่าจะถอดบัตร                                                                    | 43          |
| AC-KPC-06 | ยืนยัน 2 คนจาก 3 คน → เฉพาะ 2 คนนั้นเป็น `arriving` และ household status อัปเดต                                         | 73, 75      |
| AC-KPC-07 | สแกนซ้ำคนที่ `arriving` → เห็นผลเดิมและพิมพ์ QR ได้ · คนที่ `active` → เห็นผลเดิม ไม่มี QR                              | 74, 80      |
| AC-KPC-08 | เจ้าหน้าที่เปลี่ยนสถานะระหว่างค้นหากับกดยืนยัน → ผลเป็น `already_checked_in` ไม่ใช่ error                               | 74          |
| AC-KPC-09 | `POST /scanner/draft` → 410 และไม่มี doc ใหม่ใน DB                                                                      | 90          |
| AC-KPC-10 | เบอร์: เบอร์ของสมาชิกที่ไม่ใช่หัวหน้า → ได้ครัวเรือนเต็ม และนามสกุลถูกปิดบางส่วน                                        | 54, 58      |
| AC-KPC-11 | เบอร์: ใช้ร่วมกัน 2 ครัวเรือน → ให้เลือก 2 รายการ · 6 ครัวเรือน → 409                                                   | 56          |
| AC-KPC-12 | เบอร์: `primary_evacuee_id` ไม่อยู่ในกลุ่มของเบอร์ → 404 · มีเกิน 5 กลุ่มแล้วส่ง id มา → 409                            | 57          |
| AC-KPC-13 | เบอร์: ค้นครั้งที่ 11 ภายใน 1 นาทีจากเครื่องเดียว → 429                                                                 | 59          |
| AC-KPC-14 | เบอร์: ตลอด flow ไม่มีเบอร์ใน URL, history หรือ storage · ไม่แตะจอ 60 วินาที → กลับ `/kiosk`                            | 52          |
| AC-KPC-15 | เบอร์: คนที่เบอร์ตรงรายงานตัวแล้ว แต่สมาชิกคนอื่นยัง → ยังเลือกสมาชิกที่เหลือได้                                        | 60          |
| AC-KPC-16 | เบอร์: ค้นได้จริงกับ CouchDB (ไม่ใช่แค่ผ่าน mock) — ทดสอบแบบ integration หรือ manual                                    | 53–56       |
| AC-KPC-17 | ครัวเรือน 25 คน → ยืนยันได้ครบทุกช่องทาง                                                                                | 76          |
| AC-KPC-18 | หลัง redeploy: `_explain` ของ query ค้นเบอร์ใช้ `evacuee-type-phone-idx` (ไม่ใช่ `_all_docs`)                           | 62          |
| AC-KPC-19 | หลัง redeploy `_explain` ของค้นบัตร / ขยายครัวเรือน / คำนวณสถานะครัวเรือนใช้ index ที่กำหนด ไม่ใช้ `_all_docs`          | 63, 65      |
| AC-KPC-20 | `git diff develop` ไม่มีการเปลี่ยน `REFERRAL_MANGO_INDEXES` หรือ `deployReferralMangoIndexes`                           | 64          |
| AC-KPC-21 | บัตรหัวหน้า `arriving` + สมาชิกอีก 2 คน `pre_registered` → เสียบบัตรหัวหน้าซ้ำ → เห็น 3 คน และรายงานตัว 2 คนที่เหลือได้ | 29, 83      |
| AC-KPC-22 | ทั้ง 3 คน `arriving` → เสียบบัตรซ้ำ → หน้าผลแสดง 3 คน และพิมพ์ QR ได้ 3 ใบ                                              | 83          |
| AC-KPC-23 | หน้าผลของ flow บัตรค้างอยู่ แล้วเสียบบัตรใหม่ → เริ่มอ่านบัตรใหม่ภายใน 1 รอบ polling                                    | 46          |
| AC-KPC-24 | QR / บัตร: ไม่แตะจอ 60 วินาทีที่หน้าผล → กลับ `/kiosk` · ระหว่างพิมพ์ไม่ตัด                                             | 14          |
| AC-KPC-25 | QR / บัตร / เบอร์: นามสกุลบนหน้าจอและบนสายรัดข้อมือถูกปิดบางส่วน                                                        | 28          |
| AC-KPC-26 | เสียบบัตรค้างเกิน 60 วินาที → ยังเห็นคำเตือนให้ดึงบัตร · หลังดึงบัตรแล้วไม่แตะจอ 60 วินาที → กลับ `/kiosk`              | 14, 15      |
| AC-KPC-27 | ส่ง `evacuee_id` ของสมาชิกที่ตั้ง `search_excluded:true` หรือใช้เป็นคนหลักโดยตรง → `not_eligible` และไม่มี PUT          | 72          |

---

## 11. กรณีขอบ (Edge cases)

| ID   | กรณี                                                                              | ผลที่ต้องได้                                                       |
| :--- | :-------------------------------------------------------------------------------- | :----------------------------------------------------------------- |
| E-01 | Server ไม่ตอบเกิน 10 วินาที                                                       | แสดงข้อความเชื่อมต่อช้า + ปุ่มลองใหม่                              |
| E-02 | เครื่องถูกตั้งเป็น `inactive` ระหว่างใช้งาน                                       | request ถัดไปได้ 401 → 「ไม่สามารถยืนยันเครื่อง kiosk ได้」        |
| E-03 | เปิด `/kiosk` จาก browser ทั่วไปโดยไม่มี `scanner_client`                         | lookup / check-in ได้ 401 เพราะไม่มี header                        |
| E-04 | มีคนแก้ query แสดงผลให้ `shelter_code` ผิด                                        | FR-KPC-27 บล็อกการยืนยัน · server ยังใช้ศูนย์จากข้อมูลเครื่อง      |
| E-05 | QR ใบจองของครัวเรือนที่ถูกยกเลิก                                                  | 404                                                                |
| E-06 | บัตรที่มี record web 2 รายในศูนย์เดียวกัน (จองซ้ำ)                                | 404 → ติดต่อเจ้าหน้าที่ (FR-KPC-44)                                |
| E-07 | บัตรของคนที่มี record `registered_via:'kiosk'` เดิม                               | 404 → ไป Station 1 (Q7)                                            |
| E-08 | อ่านบัตรไม่สำเร็จ หรือถอดบัตรเร็วเกินไป                                           | หน้า error + คำแนะนำ                                               |
| E-09 | ไม่มีกล้อง หรือไม่ได้รับสิทธิ์ใช้กล้อง                                            | 「เปิดกล้องไม่ได้」+ ปุ่มลองอีกครั้ง                               |
| E-10 | เสียบบัตรขณะอยู่หน้า QR หรือหน้าเบอร์                                             | flow บัตรมาก่อน · state ของหน้าเดิมหายไป                           |
| E-11 | สมาชิกที่เจ้าหน้าที่เพิ่มเอง (`registered_via` ไม่ใช่ `web`) ในครัวเรือนเดียวกัน  | แสดงสถานะและชื่อที่ปิดนามสกุล แต่เลือกไม่ได้ (Q12)                 |
| E-12 | ครัวเรือนเกิน 20 คน                                                               | ตาม Q5 / FR-KPC-76                                                 |
| E-13 | พิมพ์ไม่สำเร็จ หรือสร้างรูป QR ไม่ได้                                             | 「สร้าง QR สำหรับพิมพ์ไม่สำเร็จ」+ พิมพ์ซ้ำได้ (ไม่รายงานตัวซ้ำ)   |
| E-14 | เบอร์: กรอก `+66…` มีขีด หรือเบอร์บ้าน 9 หลัก                                     | แปลงรูปแบบแล้วค้นได้                                               |
| E-15 | เบอร์: doc เก็บเบอร์ไว้ในรูปแบบอื่น (เช่นมีขีด)                                   | ค้นไม่พบ (ข้อจำกัดที่รู้อยู่แล้ว)                                  |
| E-16 | เบอร์: ตอนจองเลือก「ไม่มีเบอร์」                                                  | 404 + แนะนำให้ใช้ QR / บัตร / ติดต่อเจ้าหน้าที่                    |
| E-17 | เบอร์: มีคนไล่เดาเบอร์                                                            | 429 + ปิดนามสกุลบางส่วน + 404 แบบเดียวกันทุกกรณี                   |
| E-18 | เบอร์: ครอบครัวที่ใช้เบอร์ร่วมกันกดกลับหรือลองใหม่หลายรอบ                         | อาจชนเพดาน 5 ครั้ง/นาที/เบอร์ (ดู Q8)                              |
| E-19 | Server รันหลาย instance                                                           | ตัวจำกัดจำนวนครั้งนับแยกต่อ process (ข้อจำกัดที่รู้อยู่แล้ว)       |
| E-20 | หมดเวลาไม่มีการแตะจอระหว่างพิมพ์สายรัดข้อมือ                                      | ต้องไม่ตัดการพิมพ์ (หยุดนับเวลาขณะพิมพ์)                           |
| E-21 | เสียบบัตรใบเดิมซ้ำระหว่างหน้าผลยังค้าง                                            | เริ่ม flow ใหม่ แสดงผลเดิม ไม่บันทึกซ้ำ (FR-KPC-46)                |
| E-22 | คนถัดไปเสียบบัตรตัวเองระหว่างหน้าผลของครอบครัวก่อนหน้ายังค้าง                     | เริ่ม flow ของคนใหม่ · รายชื่อครอบครัวก่อนหน้าหายจากจอ (FR-KPC-46) |
| E-23 | ครัวเรือนมีสมาชิกที่เจ้าหน้าที่เพิ่มที่ Station 1 (`registered_via` ไม่ใช่ `web`) | แสดงสมาชิกแต่ละคนที่เข้าเกณฑ์สถานะ โดยไม่ให้เลือก                  |
| E-24 | คนที่ถือบัตรรายงานตัวแล้ว แต่สมาชิกคนอื่นยัง `pre_registered`                     | แสดงทั้งครัวเรือน และเลือกรายงานตัวสมาชิกที่ยังรอได้               |
| E-25 | เสียบบัตรค้างไว้และไม่มีการแตะจอเกิน 60 วินาที                                    | คงคำเตือนให้ดึงบัตรไว้บนจอ; เริ่มนับ 60 วินาทีหลังดึงบัตร          |

---

## 12. ช่องว่างที่พบจาก review และสถานะ

| #       | ปัญหา                                                                                                                                                                                  | ไฟล์                                                                                           | อ้าง                 |
| :------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- | :------------------- |
| G-1 ✅  | เพิ่ม `type` ใน projection และให้ mock ตัด field ตาม `fields` เพื่อจำลอง Mango จริง                                                                                                    | `kiosk/server/kiosk-check-in.server.ts` และ test                                               | FR-KPC-53, AC-KPC-16 |
| G-2 ✅  | เช็คเพดาน 5 กลุ่มก่อนแยกทางเลือก `primary_evacuee_id`                                                                                                                                  | `lookupByPhone`                                                                                | FR-KPC-57            |
| G-3 ✅  | ทุก gate ส่งครั้งละไม่เกิน 20; ผลบางส่วนกับ QR ยังแสดง และปุ่ม retry ส่งเฉพาะรายการค้าง                                                                                                | `kiosk/data/kiosk-check-in.api.ts`, `kiosk/ui/kiosk-pre-registered-check-in.svelte`            | FR-KPC-76            |
| G-4 ✅  | เพิ่ม test ของ `checkInSelectedMembers` และ route `/kiosk/check-in`                                                                                                                    | `kiosk-check-in.api.test.ts`, `check-in/server.test.ts`                                        | F-17                 |
| G-5 🔄  | Phone index และ exact-match query ตาม Q6 ผ่าน `_explain` บน local ทั้ง 4 ฐาน; รอ staging/production                                                                                    | `shelter-access-design.ts`                                                                     | Q6                   |
| G-9 🔄  | Index ค้นบัตรและครัวเรือนผ่าน `_explain` ทั้ง 4 selector บน local ทั้ง 4 ฐาน ไม่มี `_all_docs`; รอ staging/production                                                                  | `kiosk-check-in.server.ts`, `shelter-access-design.ts`                                         | Q10                  |
| G-10 ✅ | `scripts/redeploy-access.ts` และ `scripts/seed/registry-shelters.ts` แยก deploy index kiosk จาก loop/function ของ referral แล้ว (commit `bbb244f3`)                                    | `frontend/scripts/*`                                                                           | FR-KPC-64            |
| G-6 ⏸   | ไม่บันทึกว่าเครื่องใดทำรายงานตัวใน CR นี้; provenance และ audit log การค้นเบอร์เลื่อนไป backlog ตาม Q4                                                                                 | —                                                                                              | Q4                   |
| G-7 ✅  | หยุดและเริ่ม idle timer ใหม่รอบการพิมพ์สายรัดข้อมือ                                                                                                                                    | `ui/phone-identity-entry.svelte`                                                               | E-20                 |
| G-8     | `scanner_client/.env.example` ตั้งขนาดหน้าต่าง 1024×600 แต่ค่าเริ่มต้นในโค้ดเป็น 540×960 · ยังไม่มี `BOOTSTRAP_*` และ `CLIENT_VERSION`                                                 | `scanner_client/`                                                                              | —                    |
| G-11 🔄 | แก้ polling เสียบบัตรซ้ำและ idle timeout ทุกช่องทางแล้ว; automated tests ผ่าน · รอ manual test M6–M8 บน kiosk                                                                          | `scanner_client/app/manager.py`, `kiosk/ui/*`, `routes/kiosk/scanner/remove-card/+page.svelte` | FR-KPC-14, FR-KPC-46 |
| G-12 🔄 | แสดงสมาชิกทั้งครัวเรือนทุกช่องทาง, รวมสมาชิกที่เจ้าหน้าที่เพิ่มแบบเลือกไม่ได้, และแสดงผลรายงานตัวเดิมพร้อม QR ที่ยังพิมพ์ซ้ำได้; automated tests ผ่าน · รอ manual test M1–M5 บน kiosk  | `kiosk/server/kiosk-check-in.server.ts`, `kiosk/ui/kiosk-pre-registered-check-in.svelte`       | FR-KPC-29, FR-KPC-83 |
| G-13    | Seed มี `registered_via` ปนกันในครัวเรือน · Q12 รองรับการแสดงสมาชิกที่ไม่ใช่ `web` แบบเลือกไม่ได้แล้ว · ใช้ seed ทดสอบรายชื่อได้ แต่ AC-KPC-21/22 ต้องจัดสถานะสมาชิกให้ตรงกับกรณีทดสอบ | `frontend/scripts/seed/*`                                                                      | FR-KPC-29, FR-KPC-83 |

**ผลแก้ review รอบ 2026-09-25:** code commit `14a6a1f2` เริ่ม idle timer หลังถอดบัตร, ใช้กฎ opt-out เดียวกันใน lookup และ check-in, ปรับ `untrack` / `$derived` / generation guard · unit tests ที่เกี่ยวข้อง 40 รายการผ่าน, `svelte-check` ไม่มี error/warning, ESLint ผ่าน, `svelte-autofixer` ไม่พบ issue ใน 3 ไฟล์ที่แก้ · `docs/data/schema.md` และ CR ฉบับนี้ยังอยู่ใน working tree ตามคำสั่งเจ้าของโครงการ ไม่ commit เอกสารก่อน · คง `id: draft`, `status: proposed`; ยังไม่รันเลข CR

**Gate ที่ยังรอ:** deploy และตรวจ `_explain` บน staging/production (local `shelter_sh001`–`sh004` ผ่านแล้ว) · ทดสอบ M1–M8 บน kiosk จริง โดยเพิ่มกรณี AC-KPC-26 · เจ้าของโครงการอนุมัติ CR และรันเลขภายหลัง

---

## 13. คำตอบการตัดสินใจ

- **Q1 — ตัดคนที่ตั้ง `privacy.search_excluded:true` ออกจากผลเบอร์ และตอบ 404 แบบเดียวกับไม่พบ** (เจ้าของโครงการตอบ 2026-09-24)

- **Q2 — สายรัดข้อมือจาก phone gate พิมพ์นามสกุลแบบปิดบางส่วน** (เจ้าของโครงการตอบ 2026-09-24)

- **Q3 — ไม่เปิดเอกสาร T-task แยก; ติดตามงาน kiosk ใน CR นี้** (เจ้าของโครงการตอบ 2026-09-24)

> **Q4 — provenance การรายงานตัว:** ไม่บันทึก device / `updated_by` / audit document ใน CR นี้; เลื่อนไป backlog (เจ้าของโครงการตอบ 2026-09-24)

- **Q5 — แบ่งการรายงานตัวทุกช่องทางเป็นชุดละไม่เกิน 20 คน และคง contract ของ API `/check-in` เดิม** (เจ้าของโครงการตอบ 2026-09-24)

> **Q6 — phone index:** ใช้ `['type','phone']`; query เบอร์แต่ละรูปแบบแบบ exact match และ query ค่า `+66…` เพิ่มเพื่อรองรับข้อมูลเก่า (เจ้าของโครงการตอบ 2026-09-24)

> **Q7 — evacuee เดิมที่ `registered_via:'kiosk'`:** ให้เจ้าหน้าที่จัดการที่ Station 1 เหมือนเดิม; kiosk ใหม่ค้นและรับรายงานตัวเฉพาะ record จากเว็บ (เจ้าของโครงการตอบ 2026-09-24)

> **Q8 — rate limit ตอนเลือกครัวเรือน:** request ที่มี `primary_evacuee_id` ไม่นับ limit ต่อเบอร์ แต่ยังนับ limit ต่อเครื่อง (เจ้าของโครงการตอบ 2026-09-24)

> **Q9 — คำเรียก:** เอกสารใช้ Report-in / รายงานตัว; คงชื่อ endpoint และ identifier `check-in` เดิมเพื่อไม่เปลี่ยน API (เจ้าของโครงการตอบ 2026-09-24)

> **Q10 — ขยาย Q6 เป็นชุด index kiosk lookup (FR-KPC-63..65):** เลือกทางเลือก (a) ใช้ `KIOSK_LOOKUP_MANGO_INDEXES` ครบ 3 ตัว (`phone`, `person_id.number`, `household_id`), deploy แยกจาก referral ทุกจุด และใช้ equality query (เจ้าของโครงการสั่ง implement ตามแผนนี้ เมื่อ 2026-09-24). CR ยังคง `proposed`; Q10 นี้เป็นการตัดสินขอบเขต implementation ไม่ใช่การอนุมัติ CR.

- **Q11 — ปิดนามสกุลบางส่วนทุกช่องทาง** ทั้งบนหน้าจอและบนสายรัดข้อมือ (QR / บัตร / เบอร์) ตาม FR-KPC-28 (เจ้าของโครงการตอบ 2026-09-24)

- **Q12 — ใช้กฎรายชื่อครัวเรือนเดียวกันทุกช่องทาง** รวมถึงสแกนซ้ำหลังรายงานตัว; สมาชิกที่ `registered_via` ไม่ใช่ `web` ให้แสดงแต่เลือกไม่ได้ ตาม FR-KPC-29 และ FR-KPC-83 (เจ้าของโครงการตอบ 2026-09-24)

---

## 14. สิ่งที่ต้องแก้ตาม CR นี้

| ชั้น          | ไฟล์                                                                                                                                 | สิ่งที่ต้องแก้                                                                                                       |
| :------------ | :----------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| เอกสาร        | `docs/features/smart-card-registration-spec.md`                                                                                      | ใส่ข้อความต้นไฟล์ว่า FR-CARD-01..04 ถูกแทนที่ → ชี้มาที่ CR นี้                                                      |
| เอกสาร        | `docs/changes/CR-097-smart-card-evacuee-draft-flow.md`                                                                               | เพิ่มใน Decision log ว่าปิดการสร้าง evacuee จาก kiosk แล้ว → ชี้มาที่ CR นี้                                         |
| เอกสาร        | `docs/data/api-contract.md`                                                                                                          | เพิ่มหัวข้อ Scanner / Kiosk ตาม §7                                                                                   |
| เอกสาร        | `docs/data/schema.md` §1.1                                                                                                           | index เบอร์ (ตาม Q6) + เลขบัตร / ครัวเรือน (ตาม Q10) + อัปเดต `updated:`                                             |
| เอกสาร        | `CONTEXT.md`                                                                                                                         | Report-in ทำได้ที่ Station 1 หรือ kiosk (QR / บัตร / เบอร์)                                                          |
| เอกสาร        | `docs/features/kiosk-phone-report-in-implementation-plan.md`                                                                         | แผน implement ช่องทางเบอร์ (§6.6)                                                                                    |
| เอกสาร        | `docs/features/kiosk-lookup-mango-index-implementation-plan.md`                                                                      | แผน implement ชุด index kiosk lookup (FR-KPC-62..65, Q10)                                                            |
| เอกสาร        | `docs/features/kiosk-household-list-card-rescan-implementation-plan.md`                                                              | แผน implement FR-KPC-14, 28, 29, 46, 83 (Q11, Q12, G-11, G-12)                                                       |
| Frontend      | `features/kiosk/**`, `routes/kiosk/**`, `routes/api/v1/scanner/**`                                                                   | ตาม §5                                                                                                               |
| Frontend      | `features/scanners/**`, `lib/server/scanners/**`                                                                                     | ลงทะเบียนและยืนยันเครื่อง (รอบนี้ไม่เปลี่ยน)                                                                         |
| Infra         | `shelter-access-design.ts`, `shelters.admin.ts`, `provisioner.ts`, `scripts/redeploy-access.ts`, `scripts/seed/registry-shelters.ts` | นิยามและ deploy ชุด `KIOSK_LOOKUP_MANGO_INDEXES` แยกจาก referral (คืนส่วน referral ใน scripts เป็นเหมือนเดิม — G-10) |
| เครื่อง kiosk | `scanner_client/**`                                                                                                                  | อ่านเฉพาะเลขบัตร · allowlist · เช็คบัตรใหม่ระหว่างรอกลับหน้าแรก (FR-KPC-46) · README · tests                         |

---

## 15. บันทึกการตัดสินใจ

- 2026-08-29 — CR-097: kiosk สร้าง evacuee จากบัตร (เริ่มจาก `draft` ภายหลังเปลี่ยนเป็น `pre_registered` + `kiosk`)
- 2026-09-24 — ทีม kiosk เปลี่ยนทิศทางในโค้ด: kiosk = รับรายงานตัวผู้จองทางเว็บ · `/scanner/draft` → 410 (commit `52c08e7d`, `59d799cd`, `6079b9af`, `90693285`) — **ยังไม่มี CR รองรับ จนกระทั่งร่างฉบับนี้**
- 2026-09-24 — เจ้าของโครงการตัดสินเรื่องช่องทางเบอร์:
  - ขอบเขต = รับรายงานตัวเท่านั้น (ไม่ทำ walk-in ที่ kiosk)
  - การยืนยันตัวตน = ใช้เบอร์อย่างเดียว + ปิดนามสกุลบางส่วน + จำกัดจำนวนครั้ง (ไม่เลือก: ถามปีเกิด — `birth_year` ไม่ครบทุก record · ใช้รหัสจอง + เบอร์ — คนที่ QR หายมักไม่มีรหัสด้วย)
  - เบอร์ร่วมหลายครัวเรือน = ให้เลือกได้ไม่เกิน 5 (ไม่เลือก: ปฏิเสธทุกกรณีที่เจอมากกว่า 1 — ครอบครัวใช้เบอร์ร่วมกันบ่อย)
  - วิธีติดตามการเปลี่ยนแปลง = ไฟล์ draft CR
- 2026-09-24 — เจ้าของโครงการตอบ Q1–Q5 จาก draft phone gate:
  - Q1: `privacy.search_excluded:true` ไม่ปรากฏในผลค้น และได้ 404 เดียวกับไม่พบ
  - Q2: phone gate พิมพ์นามสกุลแบบปิดบางส่วนบนสายรัดข้อมือ
  - Q3: ไม่สร้าง T-task แยก; ติดตามใน CR นี้
  - Q4 เดิม (audit log ของการค้นเบอร์: device, เวลา, hash เบอร์, outcome): เลื่อนไป backlog
  - Q5: แบ่งการรายงานตัวทุกช่องทางเป็นชุดไม่เกิน 20 รายต่อ request; คง contract ของ `/check-in`
- 2026-09-24 — เจ้าของโครงการตอบคำถาม Q4 และ Q6–Q9 ของ CR นี้:
  - Q4 provenance ของเครื่องที่ทำรายงานตัว: เลื่อนไป backlog
  - Q6 index: `['type','phone']`; query exact match แยก canonical และ legacy `+66…`
  - Q7 record `registered_via:'kiosk'` เดิมให้ Station 1 จัดการ
  - Q8 ข้าม per-phone limiter เมื่อเลือกครัวเรือน; คง per-device limiter
  - Q9 ใช้ Report-in / รายงานตัวในเอกสารและคงชื่อ API เดิม
- 2026-09-24 — เจ้าของโครงการสั่ง implement `kiosk-lookup-mango-index-implementation-plan.md` ซึ่งตรงกับ Q10 ทางเลือก (a): ใช้ index 3 ตัว, deploy แยกจาก referral และใช้ equality query · CR ยังคง `proposed`
- 2026-09-24 — เจ้าของโครงการตัดสิน Q11: ปิดนามสกุลทุกช่องทาง ทั้งหน้าจอและสายรัดข้อมือ
- 2026-09-24 — เจ้าของโครงการตัดสิน Q12: ทุกช่องทางแสดงรายชื่อครัวเรือนเดียวกัน; สมาชิกที่ไม่ใช่ `web` แสดงแต่เลือกไม่ได้
- 2026-09-25 — implement แผน `docs/features/kiosk-household-list-card-rescan-implementation-plan.md`: C1–C5 และ automated tests ผ่าน; code commits `11f4b4b3`, `bcd87dc2`, `f7da61f9` · manual M1–M8 บน kiosk ยัง pending · CR คง `proposed` จนกว่าเจ้าของโครงการจะอนุมัติ
- 2026-09-25 — เจ้าของโครงการให้บันทึกผลแก้ review เพิ่มใน draft CR และยังไม่ commit เอกสาร; คงสถานะ `proposed` และเลข `draft` ระหว่างรออนุมัติ CR
- 2026-09-24 — ช่องทาง ThaiD **พักไว้** (ปุ่มยังปิดอยู่)
- 2026-09-24 — รวม `draft-kiosk-phone-report-in.md` เข้ามาใน CR นี้ให้เป็นเอกสารเดียว
- เหตุผลที่ใช้ `/lookup` เดิมสำหรับเบอร์แทนการสร้าง endpoint ใหม่: allowlist ของ `scanner_client` ครอบคลุมอยู่แล้ว จึงไม่ต้อง deploy ฝั่ง Python ใหม่
