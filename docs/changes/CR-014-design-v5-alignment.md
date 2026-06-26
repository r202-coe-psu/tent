---
id: CR-014
title: Design v5 Alignment (Missing Schema & Tasks)
status: proposed
date: 2026-06-26
requested_by: development team B
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §1.1, §1.3, §3.1
  - docs/data/data-model.md
  - docs/task-breakdown/02-people.md
  - docs/task-breakdown/12-public.md
---

# CR-014 — Design v5 Alignment (Missing Schema & Tasks)

## Why
จากการอ้างอิงเอกสาร Design v5 ล่าสุด (โมดูล 3.17, 3.18, 3.19) พบว่าระบบ Spec และ Schema ปัจจุบันยังขาดฟีเจอร์และ Data Field หลายส่วนเพื่อนำไปสู่การพัฒนาหน้าบ้านที่สมบูรณ์ ได้แก่ การเชื่อมต่อ Smart Card, Flow ถ่ายรูปภาพทรัพย์สิน, กฎจำกัดเพศเข้าโซน (GBV), สถานะความเสียหายของบ้าน, การพิมพ์ใบเสร็จ (Thermal Slip) และระบบบ้านพี่เลี้ยง (Host House)

## Change

### 1. Schema Changes (Bump `schema_v` ของหลาย Type)
| Doc Type | Before | After |
| --- | --- | --- |
| `household` (v2->3) | ไม่มีฟิลด์ความเสียหายของบ้าน | เพิ่ม `house_damage` (enum) และ `utilities_status` (array) |
| `evacuee` (v2->3) | ไม่มีฟิลด์รูปภาพทรัพย์สิน | เพิ่ม `asset_photos` (array ของ url/attachment id) |
| `shelter.zones` | มีแค่ name, capacity | เพิ่ม `allowed_gender` (enum: 'all', 'female_only', 'male_only') |
| `host_house` (New) | ไม่มี | สร้าง Document Type ใหม่สำหรับ "บ้านพี่เลี้ยง" พร้อมฟิลด์ Checklist พื้นที่ปลอดภัย |

### 2. Task Breakdown Changes
| Task | การปรับปรุง |
| --- | --- |
| `T-48` (Registration) | ปรับ Flow เป็น 4-Step Wizard รวม Triage และรองรับการดึงข้อมูลจาก **Smart Card Reader** |
| `T-07` (Pet/Asset) | รองรับการเปิดกล้อง (Camera Flow) และอัปโหลดภาพ |
| `T-09` (Zone) | เพิ่มกฎความปลอดภัย **GBV Protection** (GBV = Gender Base Violence) ควบคุมเพศในการเข้าโซน และระบบพิมพ์ **Thermal Slip / SMS** ทันทีหลังจัดโซน |
| `New Task` (Public) | สร้างหน้าฟอร์มลงทะเบียน **บ้านพี่เลี้ยง (Host House E-Form)** สำหรับประชาชนจิตอาสา (T-61) |
| `New Task` (Admin) | เพิ่มระบบ **อนุมัติ/จัดการบ้านพี่เลี้ยง (Host-House Admin Approval)** ฝั่ง Back-office (T-62) |

## Open Question
1. เก็บรูปยังไง - ในส่วนการ implement developer-guide.md ไม่ได้กล่าวถึงการจัดการรูปภาพบน couchdb และยังไม่มี practices ในส่วนนี้
   **คำตอบแนะนำจาก Ai:** ให้ใช้ **CouchDB Attachments (Blob)** สำหรับจัดเก็บภาพ (เช่น `asset_photos`, ภาพบ้านพี่เลี้ยง) เนื่องจากระบบเป็น Offline-first การใช้ Attachments จะช่วยให้ PouchDB เซฟรูปไว้ใน IndexedDB ได้เมื่อออฟไลน์ และทำการ Sync แบบ Binary อัตโนมัติเมื่อกลับมาออนไลน์ (แต่ควรมีการ Compress รูปจากฝั่ง Frontend เช่น Resize กว้างไม่เกิน 800px, บีบอัด WebP/JPEG คุณภาพ 70% ก่อนบันทึกลง PouchDB เสมอ เพื่อลดขนาด Storage)

## Impact
- `docs/data/schema.md` — เพิ่มและแก้ไขฟิลด์ พร้อม Bump Version
- `docs/data/data-model.md` — เพิ่มคำอธิบาย `host_house`
- `docs/task-breakdown/02-people.md` — แก้ไขรายละเอียด `T-48`, `T-07`, `T-09`
- `docs/task-breakdown/12-public.md` — เพิ่ม Task ของบ้านพี่เลี้ยง

## Migration
- **household (v2 -> v3)**: ให้ default ค่า `house_damage` เป็น null หรือ `'unknown'`
- **evacuee (v2 -> v3)**: ให้ default ค่า `asset_photos` เป็น array ว่าง `[]`
- **zones**: ให้ default `allowed_gender` เป็น `'all'` เพื่อไม่ให้เกิด Breaking Change

## Decision log
- 2026-06-26 — proposed
