---
title: "Step 01 — หน้า /back-office/volunteers + แท็บ 1 Job Board & Capacity"
status: ready
created: 2026-08-26
updated: 2026-08-26
depends_on: 00-foundation.md
---

# Step 01 — Shell + แท็บ 1 (Job Board & Capacity)

## เป้าหมาย

หน้า `/back-office/volunteers` ใช้งานได้จริง: Control Hub + สลับ 3 แท็บ + แท็บ 1 ครบ (กระดานงาน + สร้าง/แก้ job + dispatch จากหน้ารายละเอียด)

## 01.1 Route shell

```
src/routes/(protected)/back-office/volunteers/
  +page.ts          → requireManager(fetch)   (ตาม back-office/referrals/+page.ts)
  +page.svelte      → shell + <Tabs> (bits-ui, มีใน components/ui/tabs)
```

- [ ] แท็บเก็บสถานะใน URL `?tab=jobs|roster|people` เพื่อ refresh แล้วอยู่ที่เดิม
- [ ] เพิ่มเมนู "จัดการอาสาสมัคร" ใน sidebar back-office
- [ ] **ห้าม** สร้าง route `/admin/*` (CR-094 AC-094-01)

## 01.2 Control Hub header (`ui/volunteer-hub-header.svelte`)

- [ ] แสดง 5 ตัวนับ: พร้อมปฏิบัติงาน · รับกะแล้ว · เช็คอินอยู่ตอนนี้ · รออนุมัติ · รอยืนยันตัวตน — **ดึงจาก `useHubMetrics` ตัวเดียว** ห้ามคำนวณซ้ำในแท็บ (FR-VOL-08.2)
- [ ] ตัวเลือกศูนย์ — จำกัดตาม shelter scope ของ `authStore` เสมอ (FR-VOL-08.3)
- [ ] ไม่มีปุ่ม Debug View / โหมดสาธิต / แบนเนอร์ offline (FR-VOL-08.7)

## 01.3 แท็บ 1 — กระดานงาน

| Component | หน้าที่ |
| --- | --- |
| `ui/job-capacity-summary.svelte` | KPI 4 ใบ: อัตราจองกะรวม % · ขาดแคลนหนัก (<50%) · ใกล้ครบเป้า (50–99%) · ครบตามเป้า (100%) — คลิกแล้วกรองกระดานด้านล่าง (FR-VOL-09.4, คำนวณจาก `capacity.ts` ระดับ **กะ**) |
| `ui/job-filter-chips.svelte` | ไม่รวมงานที่ปิดแล้ว (default) · ด่วนพิเศษ · เปิดรับ · พักรับ · เต็มโควตา · ร่าง · ปิดงาน · แสดงทั้งหมด (FR-VOL-09.3) |
| `ui/job-card.svelte` | badge สถานะ + `ด่วนพิเศษ` · ชื่อ/คำอธิบาย · skill tags · **Quota Bar 3 สี** (ตอบรับแล้ว 🟢 / เสนอแล้ว 🟡 / ยังขาดอีก ⚪) · จำนวนกะ · จำนวนผู้สมัคร · ปุ่มแก้ไข · ลิงก์ดูรายละเอียด |
| `ui/job-quota-bar.svelte` | แถบ 3 สีใช้ซ้ำได้ รับค่าจาก `computeQuota()` |

- [ ] `{#each}` ทุกอันต้อง key ด้วย `job._id`
- [ ] empty state + skeleton ระหว่างโหลด

## 01.4 Job CRUD (FR-VOL-09.1/09.5)

- [ ] `ui/job-form-dialog.svelte` — Superforms + Zod (`zod4Client`) จาก `job.schema.ts`
- [ ] ฟิลด์: ชื่อ · รายละเอียด · `tier` · `required_roles[]` (แสดงเมื่อ `tier=staff-capable`) · `skills_required[]` · `quota` · `shift_template` · `auto_accept` · `is_urgent` · `status`
- [ ] `auto_accept` ต้อง disable + บังคับ `false` เมื่อ `tier = staff-capable` (F-AUTO)
- [ ] สร้างใหม่ default `status: open` (มติเจ้าของโครงการ 2026-08-26 — ตรงกับ schema.md §2.17); `draft` เลือกได้เองในฟอร์มถ้าต้องการร่างไว้ก่อน แล้วกด "เผยแพร่" เปลี่ยนเป็น `open`
- [ ] ตอนสร้าง set `slots_confirmed=0, slots_dispatched=0, slots_remaining=quota`; แก้ `quota` ต้องคำนวณ `slots_remaining` ใหม่และ reject ถ้าต่ำกว่า `confirmed+dispatched`
- [ ] feedback ทุกกรณีผ่าน `svelte-sonner` — ห้าม `console.log`

## 01.5 Job detail + dispatch

```
src/routes/(protected)/back-office/volunteers/jobs/[id]/+page.svelte
```

- [ ] สรุปงาน + Quota Bar + ตารางกะของงานนี้
- [ ] คิวผู้สมัคร — อนุมัติ (`pending_review → confirmed`) / ปฏิเสธ (`→ rejected`) พร้อม `review_notes`
- [ ] **Dispatch panel**: ค้นหาอาสาที่ `skills ⊇ job.skills_required` (`skills.ts`) และ **ไม่ชนกะ** (`collision.ts`) → เลือกหลายคน → `[🚀 ยืนยันมอบหมายงาน]` สร้าง `shift_assignment` `dispatch_status='dispatched'` ทีเดียว
- [ ] ทุก mutation ปรับ `job.slots_*` ตาม `quota.ts` แล้วตรวจ invariant ก่อน `put` (AC-094-05)

## Tests

- [ ] unit: filter chips mapping → `JobStatus[]`, bucket ของ KPI, การคำนวณ `slots_remaining` ตอนแก้ quota
- [ ] e2e: สร้าง job `draft` → เผยแพร่ → dispatch 2 คน → ยอด 🟡 +2 / ⚪ −2 → decline 1 คน → ⚪ +1 (AC-094-05)

## DoD

- [ ] `pnpm lint` · `pnpm check` · `pnpm test` ผ่าน · ทุก `.svelte` ผ่าน `svelte-autofixer`
- [ ] เดโมได้: เปิดหน้า → เห็น KPI + กระดานงาน → สร้างงานใหม่ → dispatch ได้
