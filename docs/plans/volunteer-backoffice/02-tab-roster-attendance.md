---
title: "Step 02 — แท็บ 2 ตารางกะและเช็คอิน + Kiosk หน้างาน"
status: ready
created: 2026-08-26
updated: 2026-08-26
depends_on: 01-tab-job-board.md
---

# Step 02 — แท็บ 2 (Roster & Live Attendance) + Kiosk

## เป้าหมาย

เห็นสถานะรายงานตัวสดประจำวัน และเช็คอิน/เช็คเอาต์อาสาได้จริงจากหน้า kiosk พร้อม audit trail

## 02.1 แท็บ 2

| Component | หน้าที่ |
| --- | --- |
| `ui/attendance-summary-bar.svelte` | 3 ค่า: ปฏิบัติหน้าที่อยู่ขณะนี้ (`checked_in`) · รอมารายงานตัวเข้ากะ (`standby`/`assigned` ของวันนี้) · เสร็จสิ้น/เช็คเอาต์แล้ว (`completed`) + ยอดรวมวันนี้ (FR-VOL-11.3) |
| `ui/shift-roster-table.svelte` | ตารางกะรายวัน: อาสา · งาน · กะ + `duty_window` · สถานะ · เวลาเข้า/ออก · วิธีเช็คอิน (`qr` / `manual_override`) |
| `ui/audit-trail-sheet.svelte` | ประวัติ override + grant/revoke role พร้อมตัวนับบนปุ่ม (FR-VOL-11.2) |

- [ ] ปุ่ม `[เปิดหน้าจอเช็คอินหน้างาน (On-Site Kiosk)]` → `/back-office/volunteers/checkin`
- [ ] live update ผ่าน `subscribeDataChanges` → invalidate `volunteerKeys` เมื่อ `shift_assignment` เปลี่ยน
- [ ] ตัวกรอง: วันที่ (default วันนี้) · กะ · สถานะ

## 02.2 Kiosk `/back-office/volunteers/checkin`

```
src/routes/(protected)/back-office/volunteers/checkin/
  +page.ts       → requireManager (หรือ role หน้าด่านตาม role matrix หลัง CR-094 §4)
  +page.svelte   → layout เต็มจอ 40/60
```

- [ ] **ซ้าย 40%** — กล้องสแกน QR + ช่องพิมพ์ค้นหา (เบอร์ 4 ตัวท้าย / ชื่อ / token)
- [ ] **ขวา 60%** — การ์ดอาสาตัวใหญ่ (ชื่อ · เบอร์ mask · กะ · ทักษะ) + ปุ่ม `[🟢 เช็คอิน]` / `[🚪 เช็คเอาต์]` + Live Feed รายการล่าสุด
- [ ] ปุ่ม `[⤢ Fullscreen]` (Fullscreen API)
- [ ] QR บรรจุ signed token — ตรวจ token ต่อ `shift_assignment.tracking_token` / `volunteer.tracking_token`
- [ ] **Manual override** (FR-VOL-11.1/11.2): ปุ่ม "เช็คอินแทน" → บังคับกรอกเหตุผล → เขียน `check_in_method='manual_override'` + `check_in_reason` + `check_in_by`
- [ ] เช็คอินสำเร็จ → `status='checked_in'`, `check_in_at=now`, `volunteer.checked_in=true`, `volunteer.current_shelter_code` และตัวนับ Control Hub +1 ทันที
- [ ] เช็คเอาต์ → `status='completed'`, `check_out_at`, `volunteer.checked_in=false`
- [ ] **hook ไว้สำหรับ step 04**: ทั้ง check-in และ check-out เรียก `POST /api/back-office/volunteers/duty-grant` / `duty-revoke` (ยังไม่ทำงานจนกว่า step 04 จะ merge — ให้เป็น no-op ที่ log audit ไปก่อน)

## Tests

- [ ] unit: token lookup, quick search ตัดเบอร์ 4 ตัวท้าย, การเปลี่ยนสถานะ `standby → checked_in → completed`
- [ ] e2e: walk-through เช็คอินด้วย QR + เช็คอินแทน แล้ว Audit Trail มีรายการเพิ่ม (AC-094-07)

## DoD

- [ ] `pnpm lint` · `pnpm check` · `pnpm test` + `svelte-autofixer`
- [ ] เดโมบน tablet viewport (1024×768) แล้ว layout 40/60 ไม่แตก
