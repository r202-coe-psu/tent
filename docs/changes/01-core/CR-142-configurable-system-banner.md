---
id: CR-142
title: System banner ตั้งค่าได้ — config:app.banner_* (เปิด/ปิด · ข้อความ · 4 สี) จัดการผ่าน System Management
status: done
date: 2026-10-01
requested_by: project owner
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §3.2 (config:app +3 fields)
  - docs/data/api-contract.md (new BFF GET /api/public/v1/system-banner)
  - frontend/src/lib/features/shared/domain/app-config.ts (schema + AppConfigPatchKey)
  - frontend/src/lib/features/shared/application/app-config-queries.ts
  - frontend/src/routes/api/v1/app-config/+server.ts (PUT patch schema)
  - frontend/src/routes/api/public/v1/system-banner/+server.ts (new)
  - frontend/src/lib/components/testing-banner.svelte → system-banner.svelte + system-banner-host.svelte (props-driven, 4 variants)
  - frontend/src/routes/+layout.svelte · frontend/src/app.css (--testing-banner-height dynamic, --info-* tokens)
  - frontend/src/routes/(protected)/system-management/system-banner/ (new SA page)
  - frontend/src/lib/components/system-management-navbar/static.ts
migration: N/A — additive fields ใน config:app (อ่านแบบ per-field .catch); ไม่ bump schema_v
---

# System banner ตั้งค่าได้ — config:app.banner_*

> **สรุป (TL;DR):**
> - แทน banner "ระบบอยู่ในช่วงการทดสอบ" ที่ hardcode ด้วย banner ที่ SA ตั้งค่า เปิด/ปิด · ข้อความ (1 ข้อความ) · สี `success | warning | destructive | info` ได้
> - เก็บใน `config:app` (+3 fields); ผู้ใช้ทุกคน (รวม anonymous) อ่านผ่าน BFF `GET /api/public/v1/system-banner`
> - หน้าใหม่ `/system-management/system-banner` (SA only) — ฟอร์ม + live preview + ปุ่มบันทึก
> - ไม่ bump `schema_v` · default = ปิด → หลัง deploy banner จะหายจนกว่า SA จะตั้งค่า

## Why
- ข้อความทดสอบ hardcode ใน `testing-banner.svelte` — เปลี่ยน/ปิดได้ต้อง deploy ใหม่
- ต้องใช้ banner เดียวกันสื่อสารสถานะระบบหลายแบบ (ทดสอบ, ปิดปรับปรุง, เหตุขัดข้อง, แจ้งข่าว) จึงต้องมีหลายสี

## Change

### Data — `config:app` (registry, singleton) · before → after
| Field | ชนิด | default | หมายเหตุ |
| --- | --- | --- | --- |
| `banner_enabled` | bool | `false` | ใหม่ — master switch |
| `banner_message` | string ≤120 | `''` | ใหม่ — trim; ห้ามขึ้นบรรทัดใหม่; ว่าง = ไม่แสดง |
| `banner_variant` | enum `success \| warning \| destructive \| info` | `warning` | ใหม่ — ค่านอก enum → fallback `warning` (reader) / reject (PUT) |

### Requirements
- **FR-01** — banner แสดงก็ต่อเมื่อ `banner_enabled = true` **และ** `banner_message.trim() !== ''`; เงื่อนไขอื่นทั้งหมด = ไม่ render และ `--testing-banner-height = 0`
- **FR-02** — banner แสดงทุก route (public portal, staff, kiosk, login) ตำแหน่งเดิม (fixed bottom, สูง 1.625rem, บรรทัดเดียว)
- **FR-03** — ข้อความยาวเกินจอให้ตัดด้วย ellipsis (`truncate`) และมี `title` แสดงข้อความเต็ม
- **FR-04** — สไตล์ soft (bg muted + text เข้ม + `border-t`) ทั้ง 4 variant; `warning` คงโทนเดิม (amber)
- **FR-05** — เพิ่ม design token `--info`, `--info-foreground`, `--info-muted`, `--info-subtle`, `--info-border` (light + dark) + `--color-info-*` ใน `app.css` ตาม pattern `--success-*`/`--warning-*` (banner ใช้ Tailwind soft palette เพราะ `--warning-muted` เป็นโทนเข้ม; token info เตรียมไว้ reuse)
- **FR-06** — BFF `GET /api/public/v1/system-banner` (ไม่ต้อง auth) อ่าน `registry/config:app` ด้วย admin credential ฝั่ง server แล้วคืนเฉพาะ `{ enabled, message, variant }`; doc ไม่มี/อ่านไม่ได้ = `{ enabled: false, message: '', variant: 'warning' }`
- **FR-07** — client query: `staleTime` 5 นาที, `refetchInterval` 5 นาที, `refetchOnWindowFocus: true`; ถ้า fetch error ให้ไม่แสดง banner
- **FR-08** — `PUT /api/v1/app-config` รับ 3 field ใหม่ใน patch (SA only, เหมือนเดิม); validate ตามตารางด้านบน; บันทึกสำเร็จ invalidate ทั้ง query `app-config` และ `system-banner`
- **FR-09** — หน้า `/system-management/system-banner` (SA only ผ่าน layout guard เดิม) มี: Switch เปิด/ปิด · input ข้อความ (นับตัวอักษร /120) · radio เลือก 4 สี · live preview ของ banner จริง · ปุ่มบันทึก (บันทึกทั้งชุดครั้งเดียว) · toast ผลลัพธ์
- **FR-10** — preview แสดงข้อความ "ไม่แสดง banner — ยังไม่ได้ระบุข้อความ" เมื่อเปิดแต่ข้อความว่าง และ "ปิดอยู่" เมื่อ switch ปิด
- **FR-11** — เพิ่มเมนู "แบนเนอร์ระบบ" ใต้ "ตั้งค่าระบบ" ใน system-management navbar
- **FR-12** — ผู้ใช้ปิด (dismiss) banner เองไม่ได้

### Acceptance
- doc เดิมไม่มี field ใหม่ → ไม่มี banner, layout ไม่มีช่องว่างด้านล่าง
- SA เปิด + ข้อความ + เลือก `destructive` → บันทึก → banner แดงขึ้นทันทีบนจอ SA และขึ้นบนจออื่นภายใน 5 นาที/เมื่อ focus
- เปิดแต่ข้อความว่าง (หรือเป็น space ล้วน) → ไม่มี banner
- PUT ข้อความ >120 ตัว / มี newline / variant นอก enum → 422
- non-SA เรียก PUT → 403 (ไม่มี session → 401); anonymous เรียก GET public → ได้แค่ 3 field
- unit test: domain helper `isBannerVisible` + Zod parse/catch; test endpoint patch validation

## Impact
- `schema.md` §3.2 +3 rows; `api-contract.md` +1 BFF route
- Component `testing-banner.svelte` เปลี่ยนเป็น data-driven (rename → `system-banner.svelte`); ผู้ใช้ `--testing-banner-height` เดิม 5 จุดไม่ต้องแก้ (ค่าถูก set เป็น 0 เมื่อซ่อน)
- worker projector `config.py` ไม่เปลี่ยน (field ใหม่ไม่อยู่ใน `PUBLIC_APP_CONFIG_FIELDS`)

## Migration
N/A — additive; reader เติม default ผ่าน `.catch`; ไม่ bump `schema_v`; ไม่ backfill

## Decision log
- 2026-10-01 — proposed. ทางเลือกที่ตัดทิ้ง: doc แยก `config:banner` (endpoint/query ซ้ำซ้อน), projection ผ่าน worker→Mongo→FastAPI (ล่าช้า + moving parts มาก), เลือกกลุ่มผู้ชม public/staff (ยังไม่มี use case), banner สูงตามข้อความ (ต้อง ResizeObserver), dismiss ได้ (ไม่จำเป็น), default เปิดพร้อมข้อความทดสอบ (owner เลือก default ปิด)
- 2026-10-01 — approved (project owner สั่ง implement + ปิด CR) → implemented → done. Implementation note: PUT ใช้ strict `bannerPatchSchema` แยกจาก reader schema (`.catch` ของ reader จะ default ค่าผิดเงียบๆ); `VALIDATION` map เป็น HTTP 422
