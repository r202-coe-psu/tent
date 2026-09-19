---
name: SmartShelter Shelter Import History
description: ตารางประวัติและ modal สำหรับติดตามงานนำเข้าศูนย์พักพิงจาก Excel
status: draft
updated: 2026-09-15
colors:
  surface-base: '#F8FAFC'
  surface-card: '#FFFFFF'
  text-primary: '#0A2647'
  text-secondary: '#475569'
  status-progress: '#0369A1'
  status-success: '#047857'
  status-warning: '#B45309'
  status-error: '#B91C1C'
typography:
  page-heading:
    fontFamily: 'inherit'
    fontSize: '1.875rem'
    fontWeight: 800
  body:
    fontFamily: 'inherit'
    fontSize: '0.875rem'
    lineHeight: 1.5
rounded:
  sm: '0.5rem'
  md: '0.75rem'
  lg: '1rem'
  full: '9999px'
spacing:
  gutter: '1.5rem'
  table-cell: '1rem'
components:
  history-table:
    surface: '{colors.surface-card}'
    border: '1px solid #E2E8F0'
    radius: '{rounded.md}'
  detail-dialog:
    surface: '{colors.surface-card}'
    radius: '{rounded.lg}'
  status-badge:
    radius: '{rounded.full}'
---

## Brand & Style

หน้าประวัติการนำเข้ายึด Civic Light Design System ของ SmartShelter: ชัดเจน เป็นระบบ และเหมาะกับงานปฏิบัติการที่ต้องตรวจสอบผลลัพธ์เร็ว สีและ typography ใช้ token ของระบบที่มีอยู่แล้ว ไม่สร้าง visual language ใหม่เฉพาะ feature นี้

## Colors

ใช้ `{colors.surface-base}` เป็น canvas และ `{colors.surface-card}` เป็นพื้นผิวของตารางและ modal `{colors.text-primary}` ใช้กับ heading/ข้อมูลสำคัญ และ `{colors.text-secondary}` ใช้กับ metadata

สถานะใช้ทั้ง icon และข้อความเสมอ: `{colors.status-progress}` สำหรับกำลังทำงาน, `{colors.status-success}` สำหรับสำเร็จ, `{colors.status-warning}` สำหรับเสร็จพร้อมข้อผิดพลาด และ `{colors.status-error}` สำหรับล้มเหลว สีไม่เป็นตัวบอกสถานะเพียงอย่างเดียว

## Typography

Heading หลักใช้ `{typography.page-heading}` ส่วนข้อมูลตารางและคำอธิบายใช้ `{typography.body}` พร้อมตัวเลขแบบ tabular เมื่อเปรียบเทียบจำนวนรายการ

## Layout & Spacing

ตารางหลักเป็น surface เดียวที่อ่านเป็นประวัติย้อนหลังได้ทันที ใช้ `{spacing.gutter}` เป็นระยะขอบ page และ `{spacing.table-cell}` เป็นจังหวะภายใน cell ตารางมี horizontal scroll บนหน้าจอแคบ ส่วน modal จำกัดความสูงและให้ตารางย่อย scroll ได้

## Elevation & Depth

ใช้ border บางและ shadow ระดับต่ำเพื่อแบ่ง surface โดยไม่ทำให้หน้าประวัติดูเหมือน dashboard ที่มีการ์ดซ้อนหลายชั้น

## Shapes

Table ใช้ `{components.history-table.radius}` และ modal ใช้ `{components.detail-dialog.radius}` สถานะใช้ `{components.status-badge.radius}` หลีกเลี่ยงมุมโค้งใหญ่เกินพื้นที่เนื้อหา

## Components

- **History table:** แสดงไฟล์ ผู้ดำเนินการ สถานะ สรุปผล จำนวนแถว และ action เท่านั้น ไม่แสดงชื่อหรือรหัสศูนย์
- **Progress dialog:** แสดง progress bar, ตัวเลขสรุป และรายการราย shelter ที่กำลังทำ/รอ/สำเร็จ/ล้มเหลว
- **Result dialog:** แสดงตารางศูนย์ที่สำเร็จหรือรายการผิดพลาด พร้อมปุ่มสลับมุมมองและลิงก์เปิดศูนย์เมื่อมีรหัส
- **Status badge:** มี icon และ text label รองรับสถานะ `กำลังทำงาน`, `เสร็จสมบูรณ์`, `เสร็จพร้อมข้อผิดพลาด`, `ล้มเหลว`

## Do's and Don'ts

- แสดงผลรวมในตารางหลัก และเปิดรายละเอียดเมื่อผู้ใช้ต้องการตรวจรายแถว
- ใช้ข้อความที่บอกผลกระทบชัดเจนว่า failure ราย shelter ไม่หยุดทั้ง job
- ให้ action มี touch target ตามระบบและใช้งานด้วย keyboard ได้
- อย่าใส่รายชื่อ shelter กลับเข้าไปในตารางหลัก
- อย่าใช้สีอย่างเดียวเพื่อสื่อสถานะ
