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
ยกเลิก doc type `scanner_draft` โดยเปลี่ยนมาสร้าง entity `evacuee` โดยตรง กำหนดสถานะ `current_stay.status = 'draft'` พร้อมเก็บข้อมูลชิปการ์ดและที่อยู่ตามบัตรในฟิลด์ `card_snapshot` · สำหรับผู้ที่ลงทะเบียนล่วงหน้า (`pre_registered`) ให้คงสถานะเดิมไว้และแนบ `card_snapshot` เข้า doc เดิม · หน้าจอเจ้าหน้าที่ (`/onsite/people`) ใช้ช่องค้นหาเดิมตรวจพบสถานะ *"เสียบบัตรแล้ว"* แล้วเข้าสู่กระบวนการคัดกรองสุขภาพ (Step 1 EWAR) ตั้งแต่ต้นทุกกรณี · Autofill ข้อมูลบุคคล (Step 2) และที่อยู่ตามบัตร (Step 3) เพื่อให้เจ้าหน้าที่ถามยืนยันและแก้ไขได้อิสระ · ไม่นับยอดสถานะ `draft` ใน Occupancy และไม่แสดงใน Public Portal

---

## Why
1. **ลดความซ้ำซ้อนของ Entity:** การเก็บ `scanner_draft` แยก doc type ทำให้เกิด overhead ในการแปลงข้อมูลข้าม collection และเสี่ยงต่อการเกิด orphan drafts
2. **Unified Search-First Registration:** เจ้าหน้าที่สามารถค้นหาผู้ที่เสียบบัตรประชาชนได้จากช่องค้นหาเดิมด้วยเลขบัตร 13 หลัก (`person_id.number`) ผ่าน index ของ `evacuee` ได้ทันที
3. **รักษาความปลอดภัยและระบาดวิทยา (Sphere Standard):** การเสียบบัตรได้เพียงข้อมูลส่วนตัวและที่อยู่ แต่ผู้ประสบภัยทุกคนจำเป็นต้องผ่านการคัดกรองสุขภาพหน้างาน (Step 1 EWAR) ใหม่ตั้งแต่ต้นก่อนเข้าพัก
4. **Fast-Track สำหรับ Pre-registered:** ผู้ที่จองล่วงหน้ามาแล้วสามารถเสียบบัตรเพื่อ Quick Verify โดยไม่ถูกลดระดับสถานะเป็น draft

---

## Change

### 1. Data Model (`evacuee` schema)
* เพิ่ม `'draft'` ใน `stayStatusSchema`
* เพิ่มฟิลด์ `card_snapshot` (optional object) ใน `evacuee` สำหรับเก็บข้อมูลชิปการ์ด, ที่อยู่ตามบัตร, รูปถ่าย, และเวลาที่เสียบบัตร
* Invariant: `household_id` อนุญาตให้เป็น `null` ได้เมื่อ `current_stay.status === 'draft'`

### 2. Inbound Scanner API (`POST /api/v1/scanner/draft`)
* หาก CID ยังไม่มีในระบบ $\rightarrow$ สร้าง `evacuee` ใหม่: `status: 'draft'`, บันทึก `card_snapshot`
* หาก CID มีสถานะ `pre_registered` $\rightarrow$ คงสถานะ `pre_registered` และแนบ `card_snapshot` เข้า doc เดิม
* หาก CID มีสถานะ `draft` รออยู่แล้ว $\rightarrow$ ปฏิเสธการสแกนซ้ำ พร้อมแจ้งเตือนให้ไปพบเจ้าหน้าที่
* หาก CID มีสถานะ `active` $\rightarrow$ แจ้งเตือนว่าเช็คอินเข้าพักแล้ว

### 3. Kiosk Display Messages
* New Walk-in: *"อ่านบัตรสำเร็จ กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรองและยืนยันข้อมูล"*
* Pre-registered: *"อ่านบัตรสำเร็จ พบข้อมูลการจองล่วงหน้า กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรอง"*
* Active: *"ท่านได้เช็คอินเข้าพักในศูนย์แล้ว"*

### 4. Staff Onsite Search & Registration Flow (`/onsite/people`)
* ค้นหาเลขบัตร 13 หลัก / ชื่อในช่องค้นหาเดิม $\rightarrow$ แสดง Badge `[ 🪪 เสียบบัตรแล้ว (รอคัดกรอง) ]`
* กดเริ่มฟอร์ม $\rightarrow$ เข้า **Step 1 (EWAR Screening)** เสมอ
* **Step 2 (Personal Info):** Autofill ชื่อ-นามสกุล, เลข 13 หลัก, เพศ, วันเกิด/อายุ
* **Step 3 (Household & Address):** **Autofill ที่อยู่เดิมตามบัตรประชาชนลงฟอร์มอัตโนมัติไปก่อน** เจ้าหน้าที่สอบถามยืนยันกับผู้ประสบภัย และสามารถแก้ไขได้ทันที พร้อมทำ Family Matching
* เมื่อ Submit สำเร็จ $\rightarrow$ เปลี่ยนสถานะเป็น `active`, ผูก `household_id`, บันทึก `movement:check_in`

---

## Impact

* **Specification Docs:**
  * [`docs/features/smart-card-registration-spec.md`](../features/smart-card-registration-spec.md) (Master Feature Spec)
  * [`docs/data/schema.md`](../data/schema.md) §1.1 (Evacuee Schema)
* **Backend & API:**
  * `frontend/src/routes/api/v1/scanner/draft/+server.ts`
  * `frontend/src/lib/server/shelter-access-design.ts` (`validate_doc_update`)
* **Domain & UI:**
  * `frontend/src/lib/features/people/domain/people.ts`
  * `frontend/src/lib/features/people/ui/evacuee-search.svelte`
  * `frontend/src/lib/features/people/ui/evacuee-form.svelte`
  * `frontend/src/lib/features/people/ui/household-register-form.svelte`

---

## Migration
* Purely additive: เพิ่มค่า `'draft'` ใน `current_stay.status` และเพิ่มฟิลด์ `card_snapshot` (optional)
* เอกสาร `evacuee` เดิมไม่ต้อง backfill
* เอกสาร `scanner_draft` เดิมในระบบทดสอบสามารถล้างทิ้งหรือปล่อยให้หมดอายุได้

---

## Decision Log
- 2026-08-29 — Jk (Project Owner) เคาะแนวทางย้ายสู่ `evacuee:draft`, จัดการ `pre_registered + card_snapshot`, คัดกรอง Step 1 ใหม่ และ Autofill ที่อยู่ Step 3
