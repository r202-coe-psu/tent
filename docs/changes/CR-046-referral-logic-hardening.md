---
id: CR-046
title: Referral Logic Hardening — 3 Business Rule Fixes
status: proposed (implementation complete — pending owner sign-off)
date: 2026-07-24
requested_by: PO / Dev Team
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/schema.md §2.11 (referral business logic validation & direction UI helpers)
  - docs/task-breakdown/09-F-referral.md (T-34 hardening DoD)
  - frontend/src/lib/features/referrals/
  - frontend/src/routes/api/back-office/referral/+server.ts
---

# CR-046 — Referral Logic Hardening (3 Business Rule Fixes)

> **สรุป (TL;DR):** ปรับปรุงกฎธุรกิจโมดูล Referral (T-34) 3 จุดสำคัญ: (1) ป้องกันการส่งต่อศูนย์เดียวกัน (Self-Referral) ผ่าน UI Combobox filtering, Zod schema refinement และ Server 422 guard, (2) ป้องกันการสร้างคำร้องส่งต่อซ้ำซ้อนสำหรับผู้อพยพรายเดิมที่มีคำร้องเปิดอยู่ (`status` ไม่ใช่ `closed` หรือ `rejected`) ผ่าน Server 409 guard และ Remote repo check, (3) แสดงป้ายบอกทิศทางคำร้อง ("ขาออก" / "ขาเข้า" / "ภายใน") บน Referral Card ใน UI

---

## Why — เหตุผลความจำเป็น

1. **Self-Referral Risk:** ระบบอนุญาตให้ผู้ใช้เลือกศูนย์ส่งต่อปลายทางเป็นศูนย์เดียวกับศูนย์ต้นทาง ทำให้เกิดข้อมูลขยะและกระบวนการส่งต่อไร้ความหมาย
2. **Duplicate Active Referrals:** ผู้อพยพ 1 รายสามารถมีคำร้องส่งต่อที่ยังดำเนินงานไม่เสร็จได้หลายใบพร้อมกัน ทำให้เกิดความสับสนในการย้ายศูนย์และจัดการทรัพยากร
3. **Lack of Direction Context:** ในหน้ารายการ Referral Card ผู้ใช้ดูไม่ออกว่าคำร้องใดเป็นคำร้องย้ายออก (Outgoing) หรือคำร้องย้ายเข้า (Incoming) ต้องคลิกเข้าไปดูรายละเอียดด้านใน

---

## Changes & Requirements Specifications

### Phase 1: FR-001 — Prevent Self-Referral

* **FR-001.1 (UI Filtering):** เพิ่ม prop `excludeCode` ใน `shelter-combobox.svelte` เพื่อกรองศูนย์ต้นทางปัจจุบันออกจากตัวเลือก
* **FR-001.2 (Form Wiring):** ส่งรหัสศูนย์ปัจจุบันจาก `getShelterCode()` เข้า `ShelterCombobox` ใน `capacity-referral-form.svelte`
* **FR-001.3 (Schema Guard):** เพิ่ม `.refine()` ใน `capacityInputSchema` (`referral.schema.ts`) เพื่อตรวจสอบความถูกต้องเชิงโครงสร้าง
* **FR-001.4 (Server Authorization Gate):** ใน `POST /api/back-office/referral` เพิ่มการตรวจสอบหาก `referral_type === 'capacity'` และ `to_shelter_code === shelterCode` ให้ตอบกลับด้วย HTTP status `422 Unprocessable Entity` และข้อความความผิดพลาดภาษาไทย

#### Specific Requirements
* **FR-001-REQ-1:** `shelter-combobox.svelte` ต้องไม่แสดงศูนย์ที่ตรงกับ `excludeCode` (Case-insensitive matching)
* **FR-001-REQ-2:** `POST /api/back-office/referral` ต้องปฏิเสธ Self-referral ด้วย HTTP 422 พร้อมข้อความ `"ไม่สามารถส่งต่อผู้ประสบภัยไปยังศูนย์พักพิงเดียวกันได้"`

---

### Phase 2: FR-002 — Prevent Duplicate Active Referrals

* **FR-002.1 (Server Repository Query):** เพิ่มเมธอด `hasActiveReferral(evacueeId: string)` ใน `referral.server-repository.ts` เพื่อค้นหาคำร้องที่ `status` ไม่อยู่ใน `['closed', 'rejected']`
* **FR-002.2 (Server Conflict Gate):** ใน `POST /api/back-office/referral` ตรวจสอบคำร้องซ้ำก่อนสร้าง หากมีคำร้องเปิดอยู่ ให้ตอบกลับด้วย HTTP status `409 Conflict` และข้อความความผิดพลาดภาษาไทย
* **FR-002.3 (Client Remote Check):** ใน `ReferralRemoteRepository.create()` (`referral.remote.ts`) เพิ่มการตรวจสอบคำร้องที่เปิดอยู่ฝั่ง Client หากพบให้ throw error พร้อมข้อความแจ้งเตือนภาษาไทย

#### Specific Requirements
* **FR-002-REQ-1:** ผู้อพยพ 1 ราย (`evacuee_id`) มีคำร้องในสถานะ Active (`draft`, `sent`, `accepted`) ได้ไม่เกิน 1 คำร้อง
* **FR-002-REQ-2:** ข้อความความผิดพลาดฝั่งผู้ใช้ต้องเป็นภาษาไทย: `"ผู้ประสบภัยรายนี้มีคำร้องส่งต่อที่ยังดำเนินการอยู่ กรุณาปิดคำร้องเดิมก่อน"`

---

### Phase 3: FR-003 — Cross-Shelter Direction Badge

* **FR-003.1 (UI Helpers):** เพิ่ม Helper functions ใน `referral.ui-helpers.ts`:
  * `getReferralDirection(referral)`: ส่งคืน `'outgoing'`, `'incoming'`, หรือ `'internal'`
  * `getDirectionLabel(direction)`: ส่งคืนข้อความภาษาไทย `"ขาออก"`, `"ขาเข้า"`, หรือ `"ภายใน"`
  * `getDirectionBadgeVariant(direction)`: ส่งคืน Tailwind CSS classes สำหรับ Badge แต่ละประเภท
* **FR-003.2 (List Card Rendering):** ใน `referral-list.svelte` เพิ่มการแสดงผล Direction Badge ร่วมกับ Status Badge

#### Specific Requirements
* **FR-003-REQ-1:** คำร้องย้ายศูนย์ (`capacity`) ที่ `shelter_code === currentShelter` ต้องแสดง Badge `"ขาออก → {to_shelter_code}"` ด้วยโทนสีฟ้า (`bg-blue-100 text-blue-700 border-blue-200`)
* **FR-003-REQ-2:** คำร้องย้ายศูนย์ (`capacity`) ที่ `to_shelter_code === currentShelter` ต้องแสดง Badge `"ขาเข้า ← {shelter_code}"` ด้วยโทนสีเขียว (`bg-green-100 text-green-700 border-green-200`)

---

## Acceptance Criteria & Definition of Done (DoD)

### Automated Verification
* `pnpm test` — Unit/Integration tests ต้องผ่านทั้งหมด (671/671 tests หรือมากกว่า)
* `pnpm check` — Svelte-check ต้องไม่พบ Error และ Warning (0 errors, 0 warnings)
* `pnpm lint` — ESLint ต้องผ่านทั้งหมด (0 errors, 0 warnings)

### Manual Test Matrix

| # | Test Scenario | Expected Outcome |
|---|---------------|------------------|
| 1 | เปิดฟอร์มสร้างคำร้องที่ SH001 แล้วคลิกเลือกศูนย์ปลายทางใน `ShelterCombobox` | ไม่อนุญาตให้เห็นและเลือก SH001 ในรายการ |
| 2 | พยายามยิง API `POST /api/back-office/referral` ระบุ `to_shelter_code = SH001` (ศูนย์เดียวกัน) | API ตอบกลับ HTTP 422 พร้อม error message ภาษาไทย |
| 3 | สร้างคำร้องให้ผู้อพยพ A แล้วพยายามสร้างคำร้องใบที่ 2 ให้ผู้อพยพ A ซ้ำขณะที่ใบแรกยังไม่ถูกปิด | ระบบบล็อกการสร้างพร้อมแสดงข้อความเตือนภาษาไทย |
| 4 | เรียกดูรายการคำร้องย้ายออก (`capacity`) | แสดง Badge "ขาออก → SH002" |
| 5 | เรียกดูรายการคำร้องย้ายเข้า (`capacity`) | แสดง Badge "ขาเข้า ← SH001" |

---

## Decision Log

* **2026-07-24 — Proposed:** ร่างข้อกำหนด CR-046 จากความต้องการจัดระเบียบตรรกะการส่งต่อ (Referral Logic Hardening) 3 ข้อสำคัญ พร้อมรอการอนุมัติและเคาะโดยเจ้าของโครงการ
