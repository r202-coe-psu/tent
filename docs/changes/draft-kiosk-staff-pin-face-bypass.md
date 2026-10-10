---
id: draft
title: Kiosk staff PIN — ข้ามการตรวจใบหน้าได้เฉพาะเมื่อเจ้าหน้าที่ใส่ PIN ของเครื่อง (PIN ต่อเครื่อง เก็บใน DB scanner_secrets)
status: proposed
date: 2026-10-10
requested_by: ทีม kiosk
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/features/kiosk/02-walk-in-registration-and-face-check.md ส่วน B (กฎ "ผลไม่ผ่านไม่ปฏิเสธใคร" → ต้องใช้ staff PIN) — ไฟล์ใหม่ที่ร่างมาในชุดเดียวกับ CR นี้
  - docs/features/kiosk/01-pre-registration-check-in.md (check-in ด้วยบัตร: พักรายชื่อสมาชิกจนกว่า match หรือ PIN ผ่าน) — ไฟล์ใหม่ที่ร่างมาในชุดเดียวกับ CR นี้
  - docs/data/schema.md §3.11 scanner_device (schema_v 1 → 2, field staff_pin_*) + §3.11.1 DB scanner_secrets ใหม่
  - docs/data/api-contract.md (scanner devices staff-pin, kiosk staff-pin/verify, DELETE devices/[id])
  - scanner_device schema_v 1 → 2
  - frontend/scripts/sync-central-db.ts (สร้าง DB scanner_secrets + _security admin-only + สร้าง default PIN ให้เครื่องที่ยังไม่มี)
  - frontend/src/lib/server/scanners/{staff-pin.ts,staff-pin-store.ts,staff-pin-http.ts,device-repository.ts}
  - frontend/src/routes/api/v1/scanner/devices/[id]/{+server.ts,staff-pin/+server.ts,staff-pin/reveal/+server.ts}
  - frontend/src/routes/api/v1/scanner/kiosk/staff-pin/verify/+server.ts
  - frontend/src/lib/features/scanners/{domain/scanner.schema.ts,data/scanner.api.ts,data/scanner.remote.ts,application/queries.ts,ui/*staff-pin*,ui/reveal-scanner-secret-dialog.svelte,ui/scanner-list.svelte}
  - frontend/src/lib/features/kiosk/{domain/face-check.ts,data/kiosk-staff-pin.api.ts,application/face-check-pin-flow.svelte.ts,application/staff-pin-entry.svelte.ts,application/walk-in-session.svelte.ts,ui/kiosk-face-check.svelte,ui/kiosk-staff-pin-entry.svelte,ui/kiosk-numpad-panel.svelte}
  - frontend/src/routes/kiosk/register/{card,face,done}/+page.svelte, frontend/src/routes/kiosk/scanner/remove-card/+page.svelte
  - scanner_client/app/manager.py (allowlist /staff-pin/verify, end reason staff_bypass)
why: ปุ่ม「ข้าม ให้เจ้าหน้าที่ตรวจแทน」ที่หน้ากล้องกดได้โดยไม่มีการยืนยันใดๆ ผู้ที่ใช้บัตรของคนอื่นจึงข้ามการตรวจใบหน้าแล้วบันทึกต่อได้เอง
migration: additive — doc scanner_device v1 อ่านเป็น "ยังไม่มี PIN"; `pnpm sync:central --write` สร้าง default PIN ให้เครื่องเดิมที่ยังไม่มี PIN doc และ stamp v2 (ไม่ทับ PIN ที่มีอยู่); server stamp v2 เมื่อตั้ง PIN
---

# Kiosk staff PIN — ข้ามการตรวจใบหน้าได้เฉพาะเมื่อเจ้าหน้าที่ใส่ PIN ของเครื่อง

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ในโหมดตรวจใบหน้า `on` ผลที่ไม่ใช่ `match` (ไม่ตรง / ข้าม / กล้องเสีย / ไม่ยินยอม) **ไม่บันทึกต่อเอง** ต้องให้เจ้าหน้าที่ใส่ **PIN 6 หลักของเครื่อง** ก่อน ทั้ง walk-in และ check-in ด้วยบัตร
> - **เพื่อใคร/ทำไม:** ปิดช่องที่ใครก็กดข้ามการตรวจใบหน้าเองได้ ให้การข้ามต้องผ่านเจ้าหน้าที่ที่ตรวจบัตรด้วยตาแล้ว
> - **Dev ต้อง build:** PIN ต่อเครื่องใน DB ใหม่ `scanner_secrets` (admin-only, central เท่านั้น) · SA ตั้ง/สุ่ม/ดู PIN ที่ `/system-management/scanners` · endpoint ตรวจ PIN ด้วย device credential พร้อมหน่วงเวลาเมื่อ PIN ผิด (ไม่ล็อกเครื่อง) · panel แป้นกด PIN ที่ kiosk · `sync:central` สร้าง default PIN ให้เครื่องเดิม
> - **กระทบ schema/scope:** `scanner_device` schema_v 1 → 2 (metadata อย่างเดียว ไม่มี PIN ใน registry) · DB ใหม่ `scanner_secrets` · เปลี่ยนกฎธุรกิจใน 02 ส่วน B · ไม่รวมเรื่องตรวจหน้า 3 ครั้ง, รูปจากชิปตอน check-in, token ยืนยันฝั่ง server และการบันทึกการข้ามลง evacuee (แยกไป CR ของ face check Phase 3)

---

## 1. Why

1. **ช่องโหว่เดิม:** ปุ่มข้ามที่หน้ากล้อง (`kiosk-face-camera-panel.svelte`) ให้ผล `skipped / user_skipped` แล้วบันทึกต่อได้ทันที และกฎใน 02 ส่วน B ("ผลไม่ผ่านไม่ปฏิเสธใคร") ปล่อย `not_confirmed` บันทึกต่อเองด้วย การตรวจใบหน้าจึงไม่มีผลกับคนที่ตั้งใจสวมรอย
2. **เจ้าหน้าที่เป็นด่านสุดท้าย:** การตรวจใบหน้ายังไม่ได้ calibrate กับรูปในชิปบัตร จึง**ไม่ปฏิเสธใครถาวร** แต่ส่งให้เจ้าหน้าที่ตรวจบัตรด้วยตาแล้วยืนยันด้วย PIN แทน
3. **`declined` ต้องใช้ PIN ด้วย:** ถ้าไม่ยินยอมแล้วบันทึกต่อเองได้ คนที่รู้ว่าหน้าจะไม่ตรงก็แค่กดไม่ยินยอม การใช้ PIN ไม่ใช่การบังคับให้ยินยอม biometric (PDPA) เพราะผู้ปฏิเสธยังได้รับบริการผ่านการตรวจบัตรโดยเจ้าหน้าที่
4. **PIN ต่อเครื่อง:** แต่ละศูนย์/จุดตั้งตู้มีเจ้าหน้าที่ต่างกัน PIN รั่วที่เครื่องหนึ่งไม่กระทบเครื่องอื่น

## 2. Change

### 2.1 กฎการไปต่อ (mode `on`)

| ผลตรวจ | before | after |
| --- | --- | --- |
| `match` | ไปต่อเอง | ไปต่อเอง (เหมือนเดิม) |
| `not_confirmed` | ไปต่อเอง + บอกให้พบเจ้าหน้าที่ | **ต้องใช้ PIN** |
| ปุ่ม「เจ้าหน้าที่ข้ามขั้นตอนนี้」ที่หน้ากล้อง | ข้ามทันที | **ต้องใช้ PIN** |
| `skipped` จากระบบ (ไม่มีรูปในชิป, หมดเวลา, ถอดบัตร) | ไปต่อเอง | **ต้องใช้ PIN** |
| `unavailable` (กล้อง / scanner_client เสีย) | ไปต่อเอง | **ต้องใช้ PIN** |
| `declined` (ไม่ยินยอม) | ไปต่อเอง | **ต้องใช้ PIN** |

mode `off`: ไม่เปลี่ยน ไม่มี PIN (mode `shadow` ถูกเอาออกแล้ว — เหลือแค่ `off` / `on` กันตั้งค่าผิด)

### 2.2 Data

| ที่ | before | after |
| --- | --- | --- |
| `registry` / `scanner_device` | schema_v 1 | schema_v 2: `staff_pin_set`, `staff_pin_is_default`, `staff_pin_updated_at`, `staff_pin_updated_by` (metadata เท่านั้น **ไม่มี PIN / hash / ciphertext**) |
| DB `scanner_secrets` | ไม่มี | ใหม่: doc `staff_pin:{device_id}` (`type: 'scanner_staff_pin'`, schema_v 1, `pin` plaintext, `is_default`, `updated_at`, `updated_by`) `_security` = `_admin` เท่านั้น · **อยู่บน central เท่านั้น** ไม่ replicate ลง edge ไม่ sync เข้า MongoDB |

### 2.3 API

| Endpoint | สิทธิ์ | หน้าที่ |
| --- | --- | --- |
| `POST /api/v1/scanner/devices` (เดิม) | SA | สร้างเครื่องพร้อม default PIN, response เพิ่ม `plaintext_staff_pin` |
| `POST /api/v1/scanner/devices/[id]/staff-pin` | SA | `{ pin }` ตั้ง PIN เอง หรือ `{ regenerate: true }` สุ่มใหม่ (คืน PIN) |
| `POST /api/v1/scanner/devices/[id]/staff-pin/reveal` | SA | ดู PIN ปัจจุบัน `{ pin, is_default, updated_at, updated_by }` |
| `DELETE /api/v1/scanner/devices/[id]` | SA | ลบเครื่องฝั่ง server (ลบ PIN doc ด้วย) แทนการลบจาก browser |
| `POST /api/v1/scanner/kiosk/staff-pin/verify` | device credential | `200 { ok }` · `401 staff_pin_invalid` (ตอบหลังหน่วง ~1 วินาที) · `401 DEVICE_AUTH_FAILED` · `409 staff_pin_not_set` · `503` |

### 2.4 ขอบเขตการทำงานและ trust boundary

- **Central เท่านั้น:** endpoint ของ kiosk ทั้งหมด (`/api/v1/scanner/kiosk/*` รวม register / check-in / staff-pin/verify) อยู่บน SvelteKit server ของ central และ device auth อ่าน `scanner_device` จาก `registry` ของ central ส่วน kiosk แบบ edge / offline อยู่นอกขอบเขตตั้งแต่ CR-149 และ CR-151 ช่วงที่ศูนย์อยู่ใน edge fallback ตู้ kiosk ก็ลงทะเบียน / check-in ไม่ได้อยู่แล้ว การเก็บ PIN ไว้บน central อย่างเดียวจึง**ไม่ได้เพิ่มจุดที่ใช้งานไม่ได้** และไม่มี PIN plaintext ไปอยู่บน edge server ที่ตั้งในศูนย์ ถ้าวันหนึ่งเปิดให้ kiosk ใช้ edge ได้ (คำถามที่ค้างใน CR-097) ต้องออก CR ใหม่เพื่อตัดสินเรื่อง PIN บน edge
- **Trust boundary = เครื่อง kiosk:** ทั้งผล `match` และการผ่าน PIN ถูกตัดสินที่เครื่อง (scanner_client + หน้า kiosk ใน Chromium lockdown) ตอนนี้ server ไม่ได้รับหลักฐานของทั้ง face match และ PIN ตอน register / check-in ใครก็ตามที่ถือ device credential ของเครื่องจึงเรียก register / check-in ได้โดยตรงเหมือนเดิม CR นี้ปิดช่อง "**คนที่ยืนหน้าตู้**กดข้ามเอง" ไม่ได้ปิดช่อง "คนที่คุมเครื่องหรือขโมย device secret ไป" token ยืนยันฝั่ง server ต้องออกแบบพร้อมผล `match` ที่ server ตรวจซ้ำได้ จึงยกไปไว้ใน CR ของ face check Phase 3

## 3. Requirements

### Server และ data

- **FR-1** — ระบบต้องเก็บ PIN ใน DB `scanner_secrets` เท่านั้น ห้ามมี PIN, hash หรือ ciphertext ใน `registry` หรือใน response รายการเครื่อง
- **FR-2** — `scanner_secrets` ต้องมี `_security` เป็น `_admin` ทั้ง `members` และ `admins` ถ้าพบ member ที่ไม่ใช่ admin ระบบต้องไม่เขียน PIN และตอบ `503` (fail closed) และห้ามตั้ง replication ของ `scanner_secrets` ไปที่ edge หรือที่อื่น
- **FR-3** — สร้างเครื่องใหม่ต้องได้ default PIN สุ่ม (`crypto.randomInt`) และ `staff_pin_is_default: true`
- **FR-4** — PIN ต้องเป็นตัวเลข 6 หลัก (`^\d{6}$`) และต้องไม่เป็น PIN ที่เดาง่าย ทั้ง PIN ที่ SA ตั้งเองและ default PIN ที่สุ่ม PIN ที่เดาง่ายคือ:
  - เลขเดียวกันทั้งชุด เช่น `000000`
  - เลขเรียงขึ้นหรือลง เช่น `123456`, `654321`
  - เลขซ้ำเป็นคู่ เช่น `112233`
  - ชุดเลขที่วนซ้ำ เช่น `121212`, `123123`
  - มีเลขต่างกันไม่เกิน 2 ตัว เช่น `111222`, `101010`
- **FR-5** — ตั้ง / สุ่มใหม่ / ดู PIN ได้เฉพาะ SA (`authorizeUserWrite` + `isSA`)
- **FR-6** — ทุก response ที่เกี่ยวกับ PIN ต้องมี `cache-control: no-store` และ endpoint ดู PIN ต้องเป็น `POST`
- **FR-7** — ระบบต้อง log ทุกครั้งที่ดู/ตั้ง/ตรวจ PIN (ใคร หรือเครื่องไหน, เมื่อไร, ผล) และ**ห้าม log ค่า PIN**
- **FR-8** — endpoint ตรวจ PIN ต้องยืนยันเครื่องด้วย `x-device-id` / `x-device-secret` และเทียบ PIN แบบ constant-time (`timingSafeEqual`)
- **FR-9** — ตรวจ PIN ต้องอ่านจาก `scanner_secrets` เสมอ ไม่เชื่อ `staff_pin_set` ใน registry; ไม่มี PIN doc = `409 staff_pin_not_set`
- **FR-10** — ไม่ล็อกเครื่องและไม่จำกัดจำนวนครั้ง แต่ต้องชะลอการไล่เดา:
  - PIN ผิด → server หน่วงประมาณ 1 วินาทีก่อนตอบ `401 staff_pin_invalid`
  - ตรวจ PIN ได้ทีละ request ต่อเครื่อง request ที่ซ้อนเข้ามาต้องรอคิว ยิงพร้อมกันหลาย request เพื่อเลี่ยงการหน่วงไม่ได้ ไล่เดาครบ 10⁶ แบบจึงใช้เวลาอย่างน้อย ~11 วันต่อเครื่อง
  - PIN ผิดติดกันครบทุก 5 ครั้งต่อเครื่อง → log ระดับ `warn` (`device_id`, จำนวนครั้งที่ผิดติดกัน, เวลา) ห้าม log ค่า PIN
  - ตัวนับครั้งที่ผิดเก็บใน memory ของ server process ไม่ persist และ reset เมื่อ PIN ถูกหรือเมื่อ server restart ตัวนับใช้แค่ส่ง alert **ห้ามใช้ล็อกเครื่อง**
- **FR-11** — ตั้ง / เปลี่ยน PIN: เขียน PIN doc ก่อนแล้วจึงเขียน registry ถ้าเขียน registry ไม่สำเร็จ ต้อง rollback PIN doc แบบ rev-guarded:
  - ตั้งครั้งแรก (ไม่มี PIN doc เดิม) → ลบ PIN doc ที่เพิ่งเขียน
  - เปลี่ยน PIN (มี PIN doc เดิม) → เขียนค่าเดิม (`pin`, `is_default`, `updated_at`, `updated_by`) กลับคืน **ห้ามลบ** ไม่งั้นเครื่องจะกลายเป็นไม่มี PIN
  - `_rev` ชนตอนเขียน → `409`
- **FR-12** — ลบเครื่อง: ลบ doc ใน `registry` ก่อนแล้วจึงลบ PIN doc ถ้าลบ registry ไม่สำเร็จจะไม่แตะ PIN doc (`404` / `409` / `503` ตามสาเหตุ) ถ้าลบ PIN doc ไม่สำเร็จให้ log แล้วตอบสำเร็จ PIN doc ที่ค้างอยู่ใช้ไม่ได้ เพราะเครื่องที่ไม่มีใน registry ไม่ผ่าน device auth (`401 DEVICE_AUTH_FAILED` ก่อนถึงขั้นตรวจ PIN) และจะถูกเขียนทับถ้าลงทะเบียน id เดิมใหม่ (FR-3)
- **FR-13** — `pnpm sync:central --write` ต้องสร้าง default PIN สุ่ม (ตาม FR-3, FR-4) ให้ทุก `scanner_device` ที่ยังไม่มี PIN doc แล้ว stamp registry เป็น v2 (`staff_pin_set: true`, `staff_pin_is_default: true`, `staff_pin_updated_by: 'system:sync-central'`):
  - ห้ามทับ PIN doc ที่มีอยู่แล้ว รันซ้ำต้องได้ผลเดิม (idempotent)
  - ถ้ารันโดยไม่ใส่ `--write` (dry-run) ให้แสดงจำนวนและ id ของเครื่องที่จะได้ PIN แต่ไม่เขียนอะไร
  - ห้ามพิมพ์ค่า PIN ออก stdout หรือ log SA ดู PIN ผ่าน「ดู PIN」(FR-27, FR-28)

### scanner_client

- **FR-14** — แนบ device credential ให้ `POST /api/v1/scanner/kiosk/staff-pin/verify` เฉพาะ request same-origin จากหน้า kiosk
- **FR-15** — `face/cancel` รับ reason `staff_bypass`

### Kiosk

- **FR-16** — mode `on`: เรียก `onfinish` ได้เฉพาะ `match` หรือเมื่อ PIN ผ่าน (`skipped / staff_bypass`)
- **FR-17** — walk-in: ห้ามเรียก `register()` ก่อน PIN ผ่าน ถ้าหน้า face รู้ mode ไม่ได้ ให้ถือเป็น `on`
- **FR-18** — check-in ด้วยบัตร: พักรายชื่อสมาชิก (`holdMembers`) จนกว่า `match` หรือ PIN ผ่าน
- **FR-19** — ปุ่มที่หน้ากล้องแสดง「เจ้าหน้าที่ข้ามขั้นตอนนี้」 กดแล้วพักการตรวจ (`hold()`) และเปิด panel PIN
- **FR-20** — ผลไม่ใช่ `match` แสดงหน้าผลพร้อมปุ่ม「เจ้าหน้าที่ดำเนินการต่อ」(เปิด panel PIN) และ「ยกเลิก」(จบ session กลับหน้าแรก ไม่บันทึก ล้างข้อมูลบัตร)
- **FR-21** — ยกเลิก panel PIN (ปุ่มยกเลิก, Esc หรือไม่มีการแตะ 30 วินาที) ให้ผลตามจุดที่เปิด panel:

  | เปิด panel จาก | ผลเมื่อยกเลิก |
  | --- | --- |
  | หน้ากล้อง ระหว่างตรวจยังไม่จบ | ตรวจต่อ (`resume()`) |
  | หน้ากล้อง แต่การตรวจจบไปแล้วระหว่างที่ panel เปิด | แสดงหน้าผล (FR-20) ให้ตัดสินใจอีกครั้ง |
  | หน้าผล (「เจ้าหน้าที่ดำเนินการต่อ」) | จบ session กลับหน้าแรก ไม่บันทึก ล้างข้อมูลบัตร |

- **FR-22** — panel PIN ใช้ `KioskNumpad` ผ่าน wrapper ร่วมกับหน้ากรอกเบอร์โทร, แสดงเป็นจุด 6 ช่อง, ยืนยันด้วยปุ่มหรือ Enter (ไม่ส่งเองเมื่อครบ 6 หลัก)
- **FR-23** — ล้างค่า PIN ทุกทางออกของ panel (สำเร็จ, ยกเลิก, หมดเวลา, ออกจากหน้า) ห้ามใส่ PIN ใน URL, log หรือ storage
- **FR-24** — PIN ผิด → แจ้ง「PIN ไม่ถูกต้อง กรุณาลองใหม่」และกรอกใหม่ได้ ระหว่างรอ server (รวมช่วงหน่วงตาม FR-10) แป้นกดต้องแสดงสถานะกำลังตรวจและกดยืนยันซ้ำไม่ได้; server/เน็ตผิดพลาด → ลองใหม่ได้; `not_set` → ปิดแป้นและแจ้งให้ติดต่อผู้ดูแลระบบ
- **FR-25** — ระหว่างตรวจหน้าหรือ panel PIN เปิด หน้าต้องพัก idle timeout ของหน้า (`onbusychange`)

### Admin (`/system-management/scanners`)

- **FR-26** — หลังสร้างเครื่อง dialog แสดง default PIN คู่กับ device secret พร้อมปุ่มคัดลอก
- **FR-27** — รายการเครื่องแสดง badge「PIN เริ่มต้น」หรือ「ยังไม่ตั้ง PIN」 และปุ่ม「ดู PIN」「ตั้ง PIN」
- **FR-28** — dialog ดู PIN เรียก reveal เมื่อกดเท่านั้น ไม่เก็บใน query cache, แสดงแบบซ่อนพร้อมปุ่มแสดง/คัดลอก และล้างค่าเมื่อปิด
- **FR-29** — dialog ตั้ง PIN มีช่อง PIN + ยืนยัน PIN และปุ่มสุ่ม PIN ใหม่ แจ้งผลด้วย toast และไม่ค้างค่า PIN ไว้เมื่อเปิดใหม่ PIN ที่เดาง่ายตาม FR-4 ต้องแจ้ง error ที่ช่องกรอก

## 4. Acceptance

- **AC-1** — mode `on`: `not_confirmed`, `skipped`, `unavailable`, `declined` ไม่สร้าง evacuee (walk-in) และไม่แสดงรายชื่อสมาชิก (check-in) จนกว่า PIN ผ่าน
- **AC-2** — PIN ถูก → walk-in สร้าง evacuee / check-in แสดงรายชื่อสมาชิก; PIN ผิด 20 ครั้งติดกันแล้ว PIN ถูกยังผ่าน (ไม่ล็อก)
- **AC-3** — ยกเลิกที่ panel PIN ที่เปิดจากหน้าผล → กลับหน้าแรก ไม่มี doc ใหม่และข้อมูลบัตรถูกล้าง; ยกเลิกที่ panel PIN ที่เปิดจากหน้ากล้องระหว่างตรวจ → ตรวจต่อ
- **AC-4** — mode `off` ไม่มี panel PIN
- **AC-5** — non-SA เรียก set/reveal ได้ `403`, ไม่ login ได้ `401`; response มี `no-store`; log ไม่มีค่า PIN
- **AC-6** — เครื่องที่ไม่มี PIN doc → verify `409 staff_pin_not_set` แม้ registry เขียน `staff_pin_set: true`
- **AC-7** — `scanner_secrets` มี member ที่ไม่ใช่ admin → ตั้ง PIN ได้ `503` และไม่มี PIN ถูกเขียน
- **AC-8** — device credential ผิด → verify `401 DEVICE_AUTH_FAILED` (ไม่ใช่ `staff_pin_invalid`)
- **AC-9** — doc `scanner_device` v1 ยังแสดงในรายการเครื่องเป็น「ยังไม่ตั้ง PIN」
- **AC-10** — PIN ผิด → response ใช้เวลา ≥ ~1 วินาที; ส่ง verify ที่ผิด 3 request พร้อมกันจากเครื่องเดียว → ใช้เวลารวม ≥ ~3 วินาที (ถูกเข้าคิว); ผิดติดกัน 5 ครั้ง → มี log `warn` 1 บรรทัดที่ไม่มีค่า PIN; PIN ถูก → ตอบทันทีไม่หน่วง
- **AC-11** — เปลี่ยน PIN แล้วจำลองให้เขียน registry ไม่สำเร็จ → PIN doc กลับเป็นค่าเดิมและ PIN เดิมยัง verify ผ่าน; ตั้งครั้งแรกแล้วจำลองแบบเดียวกัน → ไม่มี PIN doc เหลือ
- **AC-12** — `pnpm sync:central --write` บนเครื่อง v1 ที่ไม่มี PIN → ได้ PIN doc + registry v2 `staff_pin_is_default: true`; รันซ้ำ → PIN เดิมไม่เปลี่ยน; เครื่องที่ SA ตั้ง PIN ไว้แล้วไม่ถูกแตะ; stdout ไม่มีค่า PIN
- **AC-13** — ตั้ง PIN `112233`, `121212`, `123123`, `111222` → ถูกปฏิเสธ; default PIN ที่สุ่ม 10,000 ครั้งไม่มีแบบที่เดาง่ายตาม FR-4
- **AC-14** — `pnpm lint`, `pnpm check`, `pnpm test`, scanner_client unittest และ svelte-autofixer ผ่าน

## 5. Impact

- **Docs:** `docs/features/kiosk/02` ส่วน B (กฎผลไม่ผ่าน), `docs/features/kiosk/01` (check-in ด้วยบัตร), `docs/data/schema.md` §3.11 + §3.11.1, `docs/data/api-contract.md` (endpoint ตาม §2.3), `scanner_client/README.md` (ข้อความ "ผลไม่ผ่านไม่ปฏิเสธใคร")
- **Code / test:** ตาม `affects:` ด้านบน
- **Deploy:** ต้องรัน `pnpm sync:central --write` (สร้าง `scanner_secrets` + default PIN ให้เครื่องเดิมตาม FR-13) **ก่อนเปิด face check mode `on`** แล้ว SA ใช้「ดู PIN」แจ้ง PIN ให้เจ้าหน้าที่หน้างาน และควรเปลี่ยน PIN เริ่มต้นเป็นค่าที่ศูนย์ตั้งเอง ถ้าไม่ได้รัน เครื่องเดิมจะข้ามด้วย PIN ไม่ได้ (`staff_pin_not_set`)
- **Backup:** PIN อยู่เป็น plaintext ในไฟล์ข้อมูลและ backup ของ CouchDB ใต้ `deployment/` ผู้ถือ admin credential อ่านได้ ซึ่งเป็นระดับเดียวกับคนที่เขียน check-in ตรงได้อยู่แล้ว ต้องเพิ่มใน checklist deploy / backup ว่า backup ของ central เก็บแบบจำกัดสิทธิ์เท่ากับ admin credential และถ้า backup รั่วให้ SA สุ่ม PIN ใหม่ทุกเครื่อง (`{ regenerate: true }`)
- **ไม่กระทบ:** check-in ด้วย QR / เบอร์โทร, หน้าที่ไม่มี face check, MongoDB / public plane, edge server (ไม่มี `scanner_secrets`)

## 6. Migration

- `scanner_device` v1 → v2 แบบ additive: parser อ่าน v1 เป็น `staff_pin_set: false`, `staff_pin_is_default: false`, `staff_pin_updated_at: null`, `staff_pin_updated_by: null`
- เครื่องเดิม: `pnpm sync:central --write` สร้าง default PIN และ stamp v2 ให้เครื่องที่ยังไม่มี PIN doc (FR-13) ส่วนเครื่องที่สร้างใหม่เป็น v2 พร้อม default PIN ตั้งแต่สร้าง
- DB `scanner_secrets`: สร้างโดย `sync-central-db.ts` หรือโดย server ตอนเขียน PIN ครั้งแรก (idempotent)
- browser แก้ชื่อ/สถานะเครื่องผ่าน `scannerRepository.updateDevice` ยังทำได้ (spread doc เดิม ไม่แตะ `staff_pin_*`)

## 7. Decision log

- 2026-10-08 — proposed (ทีม kiosk): PIN ต่อเครื่อง, default PIN ตอนสร้าง, SA แก้ได้
- 2026-10-08 — SA ต้องดู PIN ได้ตลอด → ตัดตัวเลือก hash ทางเดียว
- 2026-10-08 — ทุกผลที่ไม่ใช่ `match` รวม `declined` ต้องใช้ PIN
- 2026-10-09 — ตัดตัวนับครั้งที่ผิด (เดิม 5 ครั้งล็อก 5 นาที) ไม่ล็อกเครื่อง พึ่ง device credential เป็นด่านเดียว
- 2026-10-09 — เก็บ PIN plaintext ใน DB `scanner_secrets` (admin-only) แทน AES-256-GCM ใน registry: registry ไม่มีข้อมูล PIN เลย ไม่ต้องจัดการ encryption key (ทำ key หาย = ถอด PIN ไม่ได้)
- 2026-10-10 — ทีม kiosk เสนอหลัง review รอบ 1:
  - ชะลอการไล่เดาด้วยการหน่วง ~1 วินาทีเมื่อ PIN ผิด, ตรวจทีละ request ต่อเครื่อง และ warn log ทุก 5 ครั้งที่ผิดติดกัน (FR-10) ยังไม่ล็อกเครื่อง ตัวนับมีไว้ alert เท่านั้น
  - ระบุให้ชัดว่า `scanner_secrets` อยู่บน central เท่านั้น สอดคล้องกับที่ kiosk edge / offline อยู่นอกขอบเขตของ CR-149 และ CR-151 (§2.4)
  - token ยืนยันฝั่ง server และการบันทึกว่า "เจ้าหน้าที่ข้ามด้วย PIN" ลง `identity_check` ของ evacuee ยกไป CR ของ face check Phase 3 เพราะตอนนี้ผล `match` ก็ตัดสินที่เครื่องเหมือนกัน CR นี้บันทึก trust boundary ไว้แทน (§2.4) ช่วงนี้ trace ได้จาก log ของ verify (FR-7) เท่านั้น ซึ่งไม่ได้ผูกกับ `evacuee_id`
  - `sync:central` สร้าง default PIN ให้เครื่องเดิม (FR-13) แทนให้ SA ตั้งเองทุกเครื่อง
  - ขยายรายการ PIN ที่เดาง่าย (FR-4)
  - ระบุ rollback แบบคืนค่าเดิม (FR-11) และลำดับการลบเครื่อง (FR-12) ตามที่ implement ไว้
