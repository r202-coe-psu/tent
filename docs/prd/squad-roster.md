---
title: "Squad Roster Template — K-13 (14 คน → 2 lead + 4 ทีม×3)"
status: template
created: 2026-06-05
updated: 2026-06-05
owner: PM/SA (เน็ท) + Lead
purpose: เคาะสมาชิกจริง + domain grouping ในห้อง kickoff (K-13 / A2). อิง kickoff §6.
---

# Squad Roster — เคาะในห้อง (K-13)

> **สถานะ: รอตัดสินใจ (K-13)** — ยังไม่ได้จับ domain เข้าทีม/กรอกชื่อ (อัปเดต 2026-06-11)

**โครงสร้างใหม่: 14 คน = 2 Lead (Platform/Core) + 4 ทีม × 3 คน**

กรอกชื่อสด, จับ domain ลง 4 ทีม, mark cross-train. อิง [kickoff §6](kickoff.html) + FD-14 (EOC = aggregate API).

> **คอขวด:** Platform/Core (Lead pair) ปิด data model (T-02) + RBAC (T-01) ก่อน → ทุกทีมขึ้นกับมัน.
> Lead 2 คน = **คนเก่งสุด** + floating + freeze API contract วันแรก.

## Lead pair — Platform/Core (2 คน)

| Role | Domain ถาวร | Active | ชื่อ |
| --- | --- | --- | --- |
| **Lead 1** ⭐ | auth, RBAC, data model, shared API, sync, DevOps, integration | R2-R4 | ________ |
| **Lead 2** ⭐ | (ควบ integrator) — shared core review, cross-team unblock, floating | R2-R4 | ________ |

## 4 ทีม × 3 คน (จับ domain + กรอกชื่อ)

| ทีม | Domain (เคาะในห้อง) | สมาชิก 1 | สมาชิก 2 | สมาชิก 3 | Active |
| --- | --- | --- | --- | --- | --- |
| **D1** | ________ | ____ | ____ | ____ | ____ |
| **D2** | ________ | ____ | ____ | ____ | ____ |
| **D3** | ________ | ____ | ____ | ____ | ____ |
| **D4** | ________ | ____ | ____ | ____ | ____ |

## Domain ที่ต้องจับลง 4 ทีม (6 ก้อน — จาก kickoff §6)

จับ 6 domain นี้กระจายลง D1-D4 (บางทีมรับ >1 domain). load = อ้างอิง, capacity เหลือพอ — **จัดตาม dependency เป็นหลัก**.

| Domain | Module / scope | Active | MD เดิม | dependency note |
| --- | --- | --- | --- | --- |
| People & Search | Household, zoning, pets/assets, family search | R2, R4 | 29 | standalone; R3 เบา |
| Supply & Inventory | Module C | R2-R3 | 19.5 | Kitchen ตัด stock จาก inventory (FD-10) → คู่กับ Kitchen |
| Donation | reservation, cut-off, redirect, transparency | R2→R3 | 24.5 | feed inventory |
| Kitchen & Food | Module D | R3 | 15.5 | ขึ้นกับ Supply (requisition) |
| Volunteer & SOP | Module A + Module B | R3, R4 | 24.5 | SOP calc ขึ้นกับ resource (T-31) |
| Security/Referral/EOC | Module E, F, EOC = **aggregate API + API KEY** (FD-14) | R3→R4 | 26 | EOC API เป็น machine-to-machine, R4 หนัก |

*capacity ทีม 3 คน ≈ 96 MD/3 เดือน → load ไม่ binding. **ไม่ติดคน ติด dependency ข้าม team*** (kickoff §6)

## Cross-train

- ทีม 3 คน = ทนกว่าเดิม (เดิม 2 คน) แต่ยังต้อง **ทำแทนกันได้** ในทีม.
- **Lead pair = floating** — ช่วยทีมที่ติด dependency / คนหาย.
- R2: ทีมที่ยังไม่มี module หลัก (Kitchen/Volunteer/Security) → มอบ groundwork จริง (schema, prototype, เก็บค่า SOP) อย่า idle.

## Checklist เคาะ (Kickoff Exit, kickoff §12)

- [ ] 2 Lead = คนเก่งสุด, ยืนยันชื่อ
- [ ] 4 ทีม × 3 คน มีสมาชิกจริง (รวม 12 + 2 lead = 14)
- [ ] จับ 6 domain ลง D1-D4 ครบ (ตาม dependency)
- [ ] mark cross-train ในทีม
- [ ] owner ชัดทุก slice (vertical: UI+API+data+validation+test+demo)
- [ ] บันทึกผลกลับ decision-log (K-13 / A2 ปิด)
