---
name: Volunteer Assign Surface
status: working
sources: []
updated: 2026-09-09
---

# Volunteer Assign Surface — Experience Spine

## Foundation

Responsive web back-office สำหรับเจ้าหน้าที่จัดกะอาสาสมัคร ใช้ shadcn/Svelte component system เดิมของโปรเจกต์ คู่กับ `DESIGN.md` เป็น visual identity reference. Primary job คือเลือกคนที่พร้อมและมอบหมายให้กะที่เลือกได้เร็ว โดยไม่ทำให้รายละเอียดรองกลบ action หลัก

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Job detail / shift summary | Job board → job | ตรวจภาพรวม quota ทุกกะ โดยใช้ aggregate job totals |
| Assign volunteers | Job detail → selected shift | คัดเลือกและมอบหมายคนให้กะเดียว โดยใช้ exact shift roster |
| Volunteer detail modal | Assign volunteers → ดูรายละเอียด | อ่าน identity, skills, contact และ assignment context โดยไม่ออกจากหน้า |

## Voice and Tone

| Do | Don't |
|---|---|
| “ยืนยันตัวตนแล้ว”, “รอตรวจสอบ”, “ยังไม่ยืนยัน” | “verified”, “pending” ปะปนโดยไม่มีคำแปล |
| “มอบหมาย” เป็น action หลัก | “ส่ง”, “เลือก”, “ดำเนินการ” หลายคำใน flow เดียว |
| อธิบายเหตุผลสั้น ๆ เมื่อกดไม่ได้ | ปล่อยปุ่ม disabled โดยไม่มีเหตุผล |

## Component Patterns

| Component | Behavioral rules |
|---|---|
| Shift selector | แสดงวัน/เวลา/จำนวน `อยู่ในกะแล้ว / quota`; text truncate โดยไม่ทำให้ layout แตก |
| Capacity summary | target, exact roster count, remaining ต้องมาจาก selected shift เดียวกัน |
| Volunteer card | primary action มอบหมายอยู่บน card; card click เปิด detail ได้เฉพาะพื้นที่ที่ไม่ใช่ control |
| Identity badge | แสดงทั้ง label และ icon; state เป็นข้อมูลประกอบการตัดสินใจ ไม่ใช่ตัวกรองที่ซ่อนอยู่ |
| Detail modal | เปิดด้วยปุ่ม “ดูรายละเอียด”; ปิดด้วย Esc/backdrop; assign จาก modal ได้เมื่อ row ยัง assignable |

## State Patterns

| State | Treatment |
|---|---|
| Loading | skeleton card/summary และ disable submit เฉพาะ action ที่ข้อมูลยังไม่พร้อม |
| Available | แสดง primary “มอบหมาย” พร้อม identity/availability badges |
| Accepted/on shift | ปุ่ม action เปลี่ยนเป็นสถานะอ่านอย่างเดียว “อยู่ในกะนี้แล้ว” |
| Collision | แสดงกะที่ชนและเวลาสั้น ๆ; ไม่ให้เลือก; รายละเอียดเต็มอยู่ใน modal |
| Not verified | แสดง warning badge และข้อความ policy ถ้ามีข้อจำกัด แต่ไม่ซ่อนคนจาก list โดยอัตโนมัติ |
| Capacity full | แสดงเหตุผลจาก exact selected-shift count และ disable assign ทั้งกลุ่ม |
| Mutation error | อยู่บนหน้าเดิม, toast + คง search/filter/selection ที่ยัง valid |

## Interaction Primitives

- กดปุ่ม “มอบหมาย” โดยตรงได้จาก card ไม่ต้องเปิด modal
- กด “ดูรายละเอียด” เพื่อเปิด modal; click บน action ไม่เปิด modal ซ้ำ
- Tab order: search → filters → card action → detail action → next card
- Esc ปิด modal; focus กลับไปยังปุ่มที่เปิด modal
- หลัง assign สำเร็จ refresh exact roster และล้าง selection ของคนที่ถูกมอบหมาย

## Accessibility Floor

- ทุก status badge มีข้อความ ไม่ใช้สีหรือ icon อย่างเดียว
- ปุ่มทุกปุ่มมี accessible name ที่บอกทั้ง action และชื่ออาสาเมื่อจำเป็น
- target interactive อย่างน้อย 44px; focus ring เห็นชัด
- modal ใช้ dialog semantics, trap focus และคืน focus หลังปิด
- รองรับข้อความยาวด้วย wrapping/truncation ที่ไม่ตัดข้อมูลสำคัญ

## Responsive & Platform

| Breakpoint | Behavior |
|---|---|
| desktop | card แบ่ง content กับ action เป็นสองโซน; modal กว้างอ่านง่าย |
| tablet | card ยังคง action อยู่ขวาหรือท้ายแถวโดยไม่ซ้อนกับ badges |
| mobile | card stack; action full-width; detail modal เป็น nearly-fullscreen sheet |

## Key Flows

### Flow 1 — เจ้าหน้าที่เลือกคนเข้ากะ

1. เจ้าหน้าที่เปิดกะที่ต้องการ
2. เห็น target/exact roster/remaining ของกะเดียวกัน
3. ค้นชื่อและ scan identity + availability บน card
4. กด “มอบหมาย” จาก card โดยตรง
5. **Climax:** card เปลี่ยนเป็น “อยู่ในกะนี้แล้ว” และ summary เพิ่มทันทีโดยไม่เปลี่ยนหน้า

### Flow 2 — ตรวจรายละเอียดก่อนตัดสินใจ

1. เจ้าหน้าที่กด “ดูรายละเอียด” บน card
2. modal แสดงข้อมูล identity, skills, contact และเหตุผลที่ assign ได้/ไม่ได้
3. เจ้าหน้าที่ปิด modal หรือกด “มอบหมายอาสาคนนี้”
4. **Climax:** หลังสำเร็จ modal ปิดและกลับ focus ไปยัง card ที่อัปเดตแล้ว
