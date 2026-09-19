---
name: Volunteer Assign Surface
status: working
sources: []
updated: 2026-09-09
colors:
  primary: '{shadcn.primary}'
  success: '{shadcn.success}'
  warning: '{shadcn.warning}'
  destructive: '{shadcn.destructive}'
  surface: '{shadcn.card}'
  muted: '{shadcn.muted}'
typography:
  heading: '{shadcn.font-sans}'
  body: '{shadcn.font-sans}'
rounded:
  card: '{shadcn.radius-lg}'
  control: '{shadcn.radius-md}'
spacing:
  unit: 4px
components:
  volunteer-card:
    surface: '{colors.surface}'
    radius: '{rounded.card}'
  identity-status:
    success: '{colors.success}'
    warning: '{colors.warning}'
---

# Volunteer Assign Surface

## Brand & Style

[ASSUMPTION] ใช้ visual system เดิมของ shadcn/Tailwind และโทน SmartShelter เดิม ไม่สร้าง palette ใหม่สำหรับ flow นี้

## Colors

สถานะสำคัญต้องอ่านได้จากข้อความและ icon ร่วมกับสีเสมอ: ยืนยันตัวตนแล้ว, รอตรวจสอบ, ยังไม่ยืนยัน, พร้อมมอบหมาย, มีเวลาชน

## Typography

ใช้ heading/body ของระบบเดิม; ชื่ออาสาสมัครเป็นจุดเด่นหนึ่งระดับ รายละเอียดรองลดเป็น metadata ไม่เกินสองบรรทัดก่อนเปิดรายละเอียด

## Layout & Spacing

หน้าหลักเน้น scan ได้เร็ว: search + filter ด้านบน, card list แบบหนึ่งแถวต่อคน, primary assign action อยู่ตำแหน่งเดิมทุก card

## Elevation & Depth

ใช้ surface และ border ของระบบเดิม; ไม่เพิ่ม shadow/gradient เพื่อแยกสถานะ

## Shapes

ใช้ radius เดิมของ shadcn; status เป็น compact badge ไม่ใช้ emoji

## Components

- **Volunteer card** — ชื่อ, identity status, availability state, skill summary และ action ที่ทำได้ทันที
- **Volunteer detail modal** — รายละเอียดเชิงลึกเปิดเมื่อกดดูข้อมูล ไม่ขยายความสูงของทุก card
- **Identity status badge** — icon + label ชัดเจน และมี accessible text
- **Capacity summary** — แสดงตัวเลขจาก source เดียวกับ selected shift ไม่ผสม aggregate job counter

## Do's and Don'ts

| Do | Don't |
|---|---|
| แสดง action หลักที่ตำแหน่งคงที่และกดได้ทั้ง desktop/mobile | ทำให้ผู้ใช้ต้องเปิดรายละเอียดก่อนจึง assign ได้ |
| ใช้ข้อความสถานะคู่กับ icon | ใช้ emoji หรือสีอย่างเดียวแทนความหมาย |
| ซ่อนรายละเอียดรองไว้ใน modal | ยัด phone, skill, history และ audit ลงใน card ทุกใบ |
