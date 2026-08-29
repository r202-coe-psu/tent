---
id: CR-084
title: ระบบอ่านบัตรประชาชน Smart Card — ย้าย scanner_draft สู่ evacuee:draft, รองรับ pre_registered fast-track, และ autofill ที่อยู่ Step 3
status: approved
date: 2026-08-29
requested_by: Jk (Project Owner)
decided_by: Jk (Project Owner)
layer: volatile
affects:
  - docs/data/schema.md §1.1
  - docs/features/smart-card-registration-spec.md
  - frontend/src/lib/features/scanners/
  - frontend/src/lib/features/people/
  - frontend/src/lib/server/shelter-access-design.ts
  - frontend/src/routes/(protected)/onsite/people/
  - frontend/src/routes/api/v1/scanner/
---

# CR-084 — ระบบอ่านบัตรประชาชน Smart Card สู่ Evacuee Draft Flow

**สรุป (BLUF):**  
ยกเลิก doc type `scanner_draft` โดยเปลี่ยนมาสร้าง entity `evacuee` โดยตรง กำหนดสถานะ `current_stay.status = 'draft'` พร้อมเก็บข้อมูลชิปการ์ดและที่อยู่ตามบัตรในฟิลด์ `card_snapshot` · สำหรับผู้ที่ลงทะเบียนล่วงหน้า (`pre_registered`) เมื่อเสียบบัตรหน้างานให้ **overwrite ข้อมูลส่วนตัว (ชื่อ-นามสกุล, เพศ, ปีเกิด, อายุ, รูปถ่าย, เลข 13 หลัก) จากบัตรประชาชนลงใน doc เดิมทันที** และคงสถานะ `pre_registered` ไว้ · หน้าจอ Kiosk หากตรวจพบการเสียบบัตรซ้ำ ให้แสดงผล **UI สีเหลือง (Amber Warning)** พร้อมข้อความ *"ท่านได้เคยเสียบบัตรเพื่อบันทึกข้อมูลแล้ว"* · ระบบรองรับการคำนวณอายุอัตโนมัติจากปีเกิด (พ.ศ.) · หน้าจอเจ้าหน้าที่ (`/onsite/people`) ใช้ช่องค้นหาเดิมตรวจพบสถานะ *"เสียบบัตรแล้ว"* แล้วเข้าสู่กระบวนการคัดกรองสุขภาพ (Step 1 EWAR) ตั้งแต่ต้นทุกกรณี · Autofill ข้อมูลบุคคล (Step 2) และที่อยู่ตามบัตร (Step 3) เพื่อให้เจ้าหน้าที่ถามยืนยันและแก้ไขได้อิสระ · ไม่นับยอดสถานะ `draft` ใน Occupancy และไม่แสดงใน Public Portal

---

## Why
1. **ลดความซ้ำซ้อนของ Entity:** การเก็บ `scanner_draft` แยก doc type ทำให้เกิด overhead ในการแปลงข้อมูลข้าม collection และเสี่ยงต่อการเกิด orphan drafts
2. **Unified Search-First Registration:** เจ้าหน้าที่สามารถค้นหาผู้ที่เสียบบัตรประชาชนได้จากช่องค้นหาเดิมด้วยเลขบัตร 13 หลัก (`person_id.number`) ผ่าน index ของ `evacuee` ได้ทันที
3. **รักษาความปลอดภัยและระบาดวิทยา (Sphere Standard):** การเสียบบัตรได้เพียงข้อมูลส่วนตัวและที่อยู่ แต่ผู้ประสบภัยทุกคนจำเป็นต้องผ่านการคัดกรองสุขภาพหน้างาน (Step 1 EWAR) ใหม่ตั้งแต่ต้นก่อนเข้าพัก
4. **Authoritative Overwrite & Fast-Track สำหรับ Pre-registered:** ผู้ที่จองล่วงหน้ามาแล้วสามารถเสียบบัตรเพื่อ Quick Verify และ overwrite ข้อมูลที่อาจสะกดผิดตอนจองออนไลน์ด้วยข้อมูลทางการจากชิปบัตรประชาชนทันที
5. **Clear Warning UX:** แยกสถานะสแกนซ้ำด้วย UI สีเหลืองและข้อความชัดเจน ไม่ทำให้ผู้ใช้งานสับสนกับข้อผิดพลาดทั่วไป (สีแดง)

---

## Change

### 1. Data Model (`evacuee` schema)
* เพิ่ม `'draft'` ใน `stayStatusSchema`
* เพิ่มฟิลด์ `card_snapshot` (optional object) ใน `evacuee` สำหรับเก็บข้อมูลชิปการ์ด, ที่อยู่ตามบัตร, รูปถ่าย, และเวลาที่เสียบบัตร
* Invariant: `household_id` อนุญาตให้เป็น `null` ได้เมื่อ `current_stay.status === 'draft'`
* คำนวณ `age` อัตโนมัติจาก `birth_year` (พ.ศ.) เสมอ

### 2. Inbound Scanner API (`POST /api/v1/scanner/draft`)
* หาก CID ยังไม่มีในระบบ $\rightarrow$ สร้าง `evacuee` ใหม่: `status: 'draft'`, บันทึก `card_snapshot` และคำนวณอายุจากปีเกิด
* หาก CID มีสถานะ `pre_registered` $\rightarrow$ **Overwrite ข้อมูลส่วนตัว (ชื่อ-นามสกุล, เพศ, ปีเกิด, อายุ, รูปถ่าย, เลข 13 หลัก) จากบัตรประชาชนลงใน doc เดิมทันที** แนบ `card_snapshot` และคงสถานะ `pre_registered`
* หาก CID มีสถานะ `draft` รออยู่แล้ว $\rightarrow$ ตอบกลับสถานะ `duplicate_draft` พร้อมข้อความแจ้งเตือน *"ท่านได้เคยเสียบบัตรเพื่อบันทึกข้อมูลแล้ว"*
* หาก CID มีสถานะ `active` $\rightarrow$ แจ้งเตือนว่าเช็คอินเข้าพักแล้ว

### 3. Kiosk Display & Manager Handling
* New Walk-in (สำเร็จ): UI สีเขียว — *"อ่านบัตรสำเร็จ กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรองและยืนยันข้อมูล"*
* Pre-registered (สำเร็จ & Overwrite): UI สีเขียว — *"อ่านบัตรสำเร็จ พบข้อมูลการจองล่วงหน้าและอัปเดตข้อมูลจากบัตรแล้ว กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรอง"*
* Duplicate Draft (สแกนซ้ำ): **UI สีเหลือง (Amber Warning)** — *"ท่านได้เคยเสียบบัตรเพื่อบันทึกข้อมูลแล้ว"* พร้อมคำแนะนำให้ถอดบัตรออกไปพบเจ้าหน้าที่
* Active (เข้าพักแล้ว): UI สีฟ้า/เหลือง — *"ท่านได้เช็คอินเข้าพักในศูนย์แล้ว"*
* Error (อ่านบัตรไม่ผ่าน): UI สีแดง — แสดงคำแนะนำการเสียบบัตรใหม่

### 4. Staff Onsite Search & Registration Flow (`/onsite/people`)
* ค้นหาเลขบัตร 13 หลัก / ชื่อในช่องค้นหาเดิม $\rightarrow$ แสดง Badge สีเหลือง/อำพัน `[ 🪪 เสียบบัตรแล้ว (รอคัดกรอง) ]`
* กดเริ่มฟอร์ม $\rightarrow$ เข้า **Step 1 (EWAR Screening)** เสมอ
* **Step 2 (Personal Info):** Autofill ชื่อ-นามสกุล, เลข 13 หลัก, เพศ, วันเกิด/อายุ (คำนวณอายุอัตโนมัติจากปีเกิด พ.ศ.)
* **Step 3 (Household & Address):** **Autofill ที่อยู่เดิมตามบัตรประชาชนลงฟอร์มอัตโนมัติไปก่อน** เจ้าหน้าที่สอบถามยืนยันกับผู้ประสบภัย และสามารถแก้ไขได้ทันที พร้อมทำ Family Matching
* เมื่อ Submit สำเร็จ $\rightarrow$ เปลี่ยนสถานะเป็น `active`, ผูก `household_id`, บันทึก `movement:check_in`

---

## Impact

* **Specification Docs:**
  * [`docs/features/smart-card-registration-spec.md`](../features/smart-card-registration-spec.md) (Master Feature Spec)
  * [`docs/data/schema.md`](../data/schema.md) §1.1 (Evacuee Schema)
* **Backend & API:**
  * `frontend/src/routes/api/v1/scanner/draft/+server.ts`
  * `frontend/src/lib/features/scanners/server.ts`
  * `frontend/src/lib/server/shelter-access-design.ts` (`validate_doc_update`)
* **Domain & UI:**
  * `frontend/src/lib/features/people/domain/people.ts`
  * `frontend/src/lib/features/people/ui/evacuee-search.svelte`
  * `frontend/src/lib/features/people/ui/evacuee-form.svelte`
  * `frontend/src/lib/features/people/ui/evacuee-registration.svelte`
  * `frontend/src/lib/features/people/ui/household-register-form.svelte`
  * `frontend/src/routes/kiosk/scanner/remove-card/+page.svelte`
  * `scanner_client/app/manager.py`

---

## Migration
* Purely additive: เพิ่มค่า `'draft'` ใน `current_stay.status` และเพิ่มฟิลด์ `card_snapshot` (optional)
* เอกสาร `evacuee` เดิมไม่ต้อง backfill
* เอกสาร `scanner_draft` เดิมในระบบทดสอบสามารถล้างทิ้งหรือปล่อยให้หมดอายุได้

---

## Decision Log
- 2026-08-29 — Jk (Project Owner) เคาะแนวทางย้ายสู่ `evacuee:draft`, จัดการ `pre_registered + card_snapshot`, คัดกรอง Step 1 ใหม่ และ Autofill ที่อยู่ Step 3
- 2026-08-29 — Jk (Project Owner) เพิ่มข้อกำหนด: 1) UI สีเหลืองแจ้งเตือนสแกนซ้ำ "ท่านได้เคยเสียบบัตรเพื่อบันทึกข้อมูลแล้ว", 2) คำนวณอายุอัตโนมัติจากปีเกิด, 3) Overwrite ข้อมูลจากบัตรสำหรับผู้ลงทะเบียนล่วงหน้า
