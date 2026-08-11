# Smart Shelter — UAT Checklist

ชุดทดสอบ User Acceptance สำหรับทีม QA / UAT

| ไฟล์ | ใช้ทำอะไร |
| --- | --- |
| [`smart-shelter-uat-checklist.csv`](./smart-shelter-uat-checklist.csv) | เคสทดสอบหลัก (~100 เคส) — import เป็น Sheet แรก |
| [`uat-reference.csv`](./uat-reference.csv) | ค่าอ้างอิง (Role, Status, Priority) — import เป็น Sheet ที่ 2 |

## Import เข้า Google Sheets (แนะนำ)

1. เปิด [Google Sheets](https://sheets.google.com) → **Blank spreadsheet**
2. ตั้งชื่อเช่น `Smart Shelter UAT — YYYY-MM-DD`
3. **File → Import → Upload** → เลือก `smart-shelter-uat-checklist.csv`
4. Import location: **Replace current sheet** · Separator: **Comma** · ติ๊ก **Convert text to numbers…** ได้ตามชอบ → **Import data**
5. เปลี่ยนชื่อแท็บเป็น `Checklist`
6. (Optional) **File → Import** อีกครั้ง → `uat-reference.csv` → **Insert new sheet(s)** → ชื่อแท็บ `Reference`
7. แชร์ให้ทีม (Viewer / Commenter / Editor ตามบทบาท)

### จัดชีตให้ง่ายต่อการทดสอบ

- เปิด **Filter** ที่แถวหัวตาราง (Data → Create a filter)
- กรอง `Priority = P0` สำหรับรอบ smoke / gate
- กรอง `Roles` ตามบัญชีที่เทสเตอร์ถืออยู่
- กรอง `Status = Not Tested` เพื่อดูคิวที่เหลือ
- แช่แข็งแถวหัว: View → Freeze → 1 row
- (Optional) Data validation คอลัมน์ `Status` จากชีต Reference

### สูตรสรุป (ใส่ในชีต Summary ใหม่)

```text
=COUNTIF(Checklist!K:K,"Pass")
=COUNTIF(Checklist!K:K,"Fail")
=COUNTIF(Checklist!K:K,"Blocked")
=COUNTIF(Checklist!K:K,"Skip")
=COUNTIF(Checklist!K:K,"Not Tested")
```

## คอลัมน์สำคัญ

| คอลัมน์ | ความหมาย |
| --- | --- |
| `Test_ID` | รหัสเคส (อย่าเปลี่ยน) |
| `Priority` | `P0` ต้องผ่านก่อน go-live · `P1` สำคัญ · `P2` รอง · `P3` stub/ต่ำ |
| `Roles` | บัญชีที่ใช้ทดสอบ |
| `Status` | `Not Tested` / `Pass` / `Fail` / `Blocked` / `Skip` / `N/A` |
| `Bug_Link` | ลิงก์ issue / Linear / GitHub เมื่อ Fail |
| `Notes` | หมายเหตุจาก spec (stub, privacy, CR) |

## บัญชีขั้นต่ำที่ควรมี

1. **SA** — system_admin  
2. **SM** — shelter_manager (ศูนย์ A)  
3. **REG** — registration_staff  
4. **KS** — kitchen_staff  
5. **WS** — warehouse_staff  
6. **Anonymous** — ไม่ login (public / บริจาค / สืบค้นญาติ)

## ลำดับรอบแนะนำ

1. **Setup** `UAT-000`–`001` + Auth + Portal hub  
2. **P0 staff** — Onsite registration/scan → Evacuee/Household → Shelter/Capacity → Supply/Purchase  
3. **P0 public** — Landing → Shelters → Family search (privacy) → Donation + track  
4. **Kitchen + SOP + Referral + Users/RBAC**  
5. **Happy path** `UAT-205` เป็น regression gate  
6. **P3 stubs** — บันทึก Skip ไม่ถือว่า Fail

## Known stubs (คาดว่า Skip)

- Onsite: ค้นหาและแก้ไขข้อมูล (disabled)  
- Public: CTA ลงทะเบียนผู้ประสบภัย / อาสาสมัคร (เร็วๆนี้)  
- `/volunteers`, host-houses, kitchen production-board  
- แท็บ donation “รายการรอตรวจสอบ” (demo)  
- เมนู back-office ที่ยังไม่มีหน้า (อาสาสมัคร, รายงานความโปร่งใส, GIS, …)

## สร้าง Google Sheet ไม่ได้จากที่นี่

repo นี้ไม่มี Google Sheets API — ใช้ CSV + Import ตามด้านบน จะได้ชีตที่ทีมแก้ Status ร่วมกันได้ทันที
