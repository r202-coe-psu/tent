---
id: CR-062
title: "CR-062 - Announcements CRUD"
status: proposed
date: 2026-07-29
requested_by: ชิโน ทนุธรรม
decided_by: 
layer: volatile
affects:
  - docs/data/schema.md
  - frontend/src/lib/features/announcements/
  - frontend/src/routes/(protected)/portal/system-management/announcements/
  - packages/tent-model/src/tent_model/announcement.py
  - worker/src/worker/projectors/announcements.py
  - worker/src/worker/couch/processor.py
  - backend/apiapp/modules/announcements/
---

# CR-062 — Announcements CRUD

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เพิ่ม doc type `announcement` ในฐานข้อมูล `registry` (schema_v 1) เพื่อใช้สำหรับแสดงประกาศด่วนบนหน้า Public Portal
- **เพื่อใคร/ทำไม:** เพื่อให้ผู้ดูแลระบบ (System Admin) สามารถเพิ่ม/แก้ไข/ลบ และเปิด/ปิดประกาศฉุกเฉินหรือประกาศทั่วไป และให้ประชาชนทั่วไปสามารถอ่านประกาศได้ผ่าน FastAPI
- **กระทบ scope:** เพิ่มฟีเจอร์ใหม่ ไม่กระทบระบบเดิม

## Schema: `announcement` (ใน DB `registry`)

`_id`: `announcement:{ulid}`
`schema_v`: 1

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `title` | str | req | หัวข้อประกาศ |
| `description` | str | req | รายละเอียดประกาศ |
| `severity` | enum(`info`,`warning`,`emergency`) | req | ระดับความสำคัญ |
| `is_active` | bool | req | สถานะเปิด/ปิดการแสดงผล |

## ฝั่ง Public Plane
- **Worker Projector:** คอยฟัง `announcement` จาก `registry` แล้ว upsert ลง MongoDB `public_announcements`
- **FastAPI Backend:** เพิ่ม endpoint `GET /public/v1/announcements` เพื่อดึงประกาศ (อาจจะ filter เฉพาะที่ `is_active=true`)
