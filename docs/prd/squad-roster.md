---
title: "Squad Roster — K-13 Closed (14 คน → 2 lead + 4 ทีม×3)"
status: active
created: 2026-06-05
updated: 2026-06-15
owner: PM/SA (เน็ท) + Lead
purpose: บันทึกสมาชิกจริง + domain grouping ที่ปิด K-13 แล้ว. อิง kickoff §6 และ task-breakdown/teamplanning.md.
---

# Squad Roster — K-13 Closed

> **สถานะ: ปิดแล้ว (K-13, sync 2026-06-15)** — สมาชิกจริงและ domain owner ใช้ตาม [Team Planning & Balancing](../task-breakdown/teamplanning.md)

**โครงสร้างใหม่: 14 คน = 2 Lead (Platform/Core) + 4 ทีม × 3 คน**

ใช้ roster นี้เป็น owner canonical สำหรับ task breakdown. อิง [kickoff §6](kickoff.html) + FD-14 (EOC = aggregate API).

> **คอขวด:** Platform/Core (Lead pair) ปิด data model (T-02) + RBAC (T-01) ก่อน → ทุกทีมขึ้นกับมัน.
> Lead 2 คน = **คนเก่งสุด** + floating + freeze API contract วันแรก.

## Lead pair — Platform/Core (2 คน)

| Role | Domain ถาวร | Active | ชื่อ |
| --- | --- | --- | --- |
| **Lead 1 — Platform/Core** ⭐ | auth, RBAC, data model, shared API, sync, DevOps, integration | R2-R4 | แจ็ก — สรวิศ สุขการณ์ |
| **Lead 2 — Integration/Floating** ⭐ | shared core review, cross-team unblock, integration/handover | R2-R4 | เด่น — สุธินันท์ รองพล |

## 4 ทีม × 3 คน (จับ domain + กรอกชื่อ)

| ทีม | Domain | สมาชิก 1 | สมาชิก 2 | สมาชิก 3 | Active |
| --- | --- | --- | --- | --- | --- |
| **Team A** | Donation + Volunteer | ชิโน — ทนุธรรม ศุภผล | นัท — อาณัส อาเก๊ะ | กาน — คุณานนต์ หนูแสง | R2-R3 |
| **Team B** | Household/People + Family Search + Security | พีค — สักก์ธนัชญ์ ประดิษฐอุกฤษฎ์ | โฮป — พัฒนชัย พันธุ์เกตุ | ปิ๊ก — สิรวิชญ์ น้อยผา | R2-R4 |
| **Team C** | Supply/Inventory + Kitchen/Food | ก้อง — กรธัช สุขสวัสดิ์ | มิว — คีตศิลป์ คงสี | พัฟ — ฉัตรชนก นิโครธานนท์ | R2-R3 |
| **Team D** | SOP/Resource Calc + Referral | เน — เนติวุฒิ เกตุกำพล | ภูดิท — ภูดิท ชูจันทร์ | วิลเลียม — อภิชาติ จะหย่อ | R2-R4 |

## Domain Ownership

EOC/Open API deferred owner = **Lead pair**; Team D support หลัง SOP/Referral stabilized.

| Domain | Module / scope | Owner | Active | dependency note |
| --- | --- | --- | --- | --- |
| People & Search | Household, zoning, pets/assets, family search | Team B | R2, R4 | standalone; R3 เบา |
| Supply & Inventory | Module C | Team C | R2-R3 | Kitchen ตัด stock จาก inventory (FD-10) → คู่กับ Kitchen |
| Donation | reservation, cut-off, redirect, transparency | Team A | R2→R3 | feed inventory |
| Kitchen & Food | Module D | Team C | R3 | ขึ้นกับ Supply (requisition) |
| Volunteer | Module A | Team A | R3 | demand มาจาก SOP calc |
| SOP & Resource Calc | Module B | Team D | R3, R4 | SOP calc ขึ้นกับ resource (T-31) |
| Security | Module E | Team B | R3 | ผูก People/Movement |
| Referral | Module F | Team D | R3 | ผูก SOP/resource/capacity |
| EOC/Open API | Module 10 = aggregate API + API KEY (FD-14) | Lead pair + Team D support | deferred ≤14 ก.ย. | machine-to-machine, no PII |

*capacity ทีม 3 คน ≈ 96 MD/3 เดือน → load ไม่ binding. **ไม่ติดคน ติด dependency ข้าม team*** (kickoff §6)

## Cross-train

- ทีม 3 คน = ทนกว่าเดิม (เดิม 2 คน) แต่ยังต้อง **ทำแทนกันได้** ในทีม.
- **Lead pair = floating** — ช่วยทีมที่ติด dependency / คนหาย.
- R2: ทีมที่ยังไม่มี module หลัก (Kitchen/Volunteer/Security) → มอบ groundwork จริง (schema, prototype, เก็บค่า SOP) อย่า idle.

## Checklist เคาะ (Kickoff Exit, kickoff §12)

- [x] 2 Lead = คนเก่งสุด, ยืนยันชื่อ
- [x] 4 ทีม × 3 คน มีสมาชิกจริง (รวม 12 + 2 lead = 14)
- [x] จับ domain ลง 4 ทีมครบ (ตาม dependency)
- [x] mark cross-train ในทีม
- [x] owner ชัดทุก slice (vertical: UI+API+data+validation+test+demo)
- [x] บันทึกผลกลับ decision-log (K-13 / A2 ปิด)
