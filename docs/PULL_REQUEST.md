# [PR] feat(public): Bilingual Donations, Shelter Map OSM, Landing Clean Hero & Rich Mockup Data

## 📌 ภาพรวมการเปลี่ยนแปลง (Summary)
PR นี้รวบรวมการพัฒนาและปรับปรุงระบบฝั่ง **Public Portal (ภาคประชาชน)** ให้รองรับการทำงาน 2 ภาษา (TH / EN) อย่างสมบูรณ์ในส่วนของการบริจาคสิ่งของและการติดตามสถานะ, แก้ปัญหาแผนที่โดยเปลี่ยนมาใช้ OpenStreetMap (ฟรี ไม่มีค่าบริการ/ข้อจำกัด), ปรับหน้า Landing Page ให้สะอาดและรวดเร็วตาม **[CR-017](file:///home/chinochi866/import_star/tent/docs/changes/CR-017-dashboard-api-architecture.md)** และเติมข้อมูล Mockup ศูนย์พักพิง (`SH001` - `SH004`) พร้อมที่อยู่ภูมิลำเนาเดิมตาม **[CR-011](file:///home/chinochi866/import_star/tent/docs/changes/CR-011-household-address-fields.md)** ครบถ้วน 100%

---

## 🌟 1. ฟีเจอร์หลัก (Primary Features)

### 1.1 ระบบ 2 ภาษาสำหรับหน้าบริจาคสิ่งของและติดตามสถานะ (Bilingual Public Donations & Tracking)
* เพิ่ม Dictionary คำแปลไทย-อังกฤษ (`PUBLIC_DONATIONS_I18N`) ครอบคลุมทุกขั้นตอน:
  * หน้าเลือกรายการสิ่งของที่ศูนย์ต้องการ (`PublicDonorNeeds`)
  * แบบฟอร์มกรอกข้อมูลผู้บริจาคและเลือกเวลานัดหมายส่งมอบ (`FormDonor`, `DonorTimeSelectionForm`)
  * ตั๋วใบเสร็จยืนยันการบริจาคและ QR Tracking (`PublicDonorSuccessTicket`)
  * หน้าค้นหาและติดตามสถานะสิ่งของบริจาค (`/donations/track` และ `/donations/track/[token]`)
  * Dialog สำหรับแก้ไขรายการสิ่งของและยกเลิกคำขอรับบริจาค
* ปรับฟังก์ชัน Helper จัดการเวลาและสถานะ (`formatTrackTimestamp`, `formatTrackSchedule`, `deliveryMethodLabel`, `vehicleLabel`) ให้รองรับ Locale (`'th' | 'en'`)

### 1.2 การปรับปรุง Master Data ประเภทศูนย์พักพิงและระบบแผนที่ฟรี (Shelter Type Master & Free OSM Map)
* **Master Data Resolution:** รองรับการดึงและ Resolve ป้ายชื่อประเภทศูนย์พักพิง (`shelter_type`) จาก Master Data API (`/api/public/v1/config/shelter-types`) แทนการ Hardcode
* **Free Basemap:** สลับระบบแผนที่ใน [`frontend/src/lib/constants/maps.ts`](file:///home/chinochi866/import_star/tent/frontend/src/lib/constants/maps.ts) มาใช้ **OpenStreetMap Raster Tile (`OSM_RASTER_STYLE`)** เป็นค่าเริ่มต้น ซึ่งฟรี 100% ไม่ต้องใช้ API Key และแก้ปัญหา MapLibre Vector Expression Error
* **Strong Typing:** ขจัด `any` ออกจาก [`shelter-map.svelte`](file:///home/chinochi866/import_star/tent/frontend/src/lib/features/public-portal/ui/shelter-map.svelte) โดยระบุ Type ของ MapLibre GL อย่างเคร่งครัด

---

## 🔧 2. ฟีเจอร์รองและการปรับปรุงระบบ (Secondary Features & Improvements)

### 2.1 ปรับปรุงหน้าแรก Public Landing Page ตาม [CR-017](file:///home/chinochi866/import_star/tent/docs/changes/CR-017-dashboard-api-architecture.md)
* นำแผง Metrics / Polling Transparency เดิมที่ถูก Deprecate ออกจาก [`frontend/src/routes/(public)/+page.svelte`](file:///home/chinochi866/import_star/tent/frontend/src/routes/(public)/+page.svelte) และ [`+page.ts`](file:///home/chinochi866/import_star/tent/frontend/src/routes/(public)/+page.ts)
* แสดงผลเฉพาะส่วน Hero Metrics ที่เรียบหรู โหลดเร็ว และไม่ยิง Request ไปยัง Endpoint ที่ยกเลิกแล้ว

### 2.2 เติมข้อมูลจำลองศูนย์พักพิง (SH001-SH004) และภูมิลำเนาเดิม [CR-011](file:///home/chinochi866/import_star/tent/docs/changes/CR-011-household-address-fields.md)
* **ข้อมูลศูนย์พักพิง Presentation-Ready:** เพิ่มข้อมูลครบ 6 หมวด (Hero, อาคาร/โซน, สุขอนามัย, สาธารณูปโภค, การเดินทาง/ความสูง, ข้อมูลผู้จัดการศูนย์ และ FAQ) ใน [`frontend/scripts/seed.ts`](file:///home/chinochi866/import_star/tent/frontend/scripts/seed.ts) และ [`backend/apiapp/modules/shelter/use_case.py`](file:///home/chinochi866/import_star/tent/backend/apiapp/modules/shelter/use_case.py)
* **ภูมิลำเนาเดิม (Domicile Address):** เพิ่มฟิลด์ที่อยู่หลัก 6 ฟิลด์ (`address_no`, `village_no`, `subdistrict`, `district`, `province`, `postal_code`) ให้กับทุกครัวเรือนและผู้อพยพในระบบ Seed Database

---

## 📁 3. รายการไฟล์ที่มีการเปลี่ยนแปลง (Files Changed)

### 🟢 กลุ่มที่ 1: ระบบ 2 ภาษาสำหรับการบริจาค (Public Donations i18n)
* `frontend/src/lib/constants/i18n.ts`: Export `PUBLIC_DONATIONS_I18N`
* `frontend/src/lib/constants/i18n/public-donations.ts`: พจนานุกรมคำแปล TH/EN สำหรับระบบบริจาค
* `frontend/src/lib/constants/i18n/public-donations.test.ts`: Unit Tests ตรวจสอบความครบถ้วนของคำแปล
* `frontend/src/lib/features/donations/domain/tracking.ts`: ปรับปรุง Helper Formatting ให้รองรับ 2 ภาษา
* `frontend/src/lib/features/donations/domain/tracking.test.ts`: Unit Tests สำหรับ Tracking Formatting
* `frontend/src/lib/features/donations/ui/cancel-donation-dialog.svelte`: Dialog ยกเลิกรองรับ 2 ภาษา
* `frontend/src/lib/features/donations/ui/edit-donation-items-dialog.svelte`: Dialog แก้ไขรายการรองรับ 2 ภาษา
* `frontend/src/lib/components/form/donor-time-selection-form.svelte`: ฟอร์มเลือกเวลารองรับ 2 ภาษา
* `frontend/src/lib/components/form/form-donor.svelte`: ฟอร์มผู้บริจาครองรับ 2 ภาษา
* `frontend/src/lib/components/public-donor-needs.svelte`: ตารางความต้องการรองรับ 2 ภาษา
* `frontend/src/lib/components/public-donor-success-ticket.svelte`: ตั๋วการบริจาครองรับ 2 ภาษา
* `frontend/src/routes/(public)/donations/+page.svelte`: หน้าหลักการบริจาครองรับ 2 ภาษา
* `frontend/src/routes/(public)/donations/track/+page.svelte`: หน้าค้นหาเลขอ้างอิงรองรับ 2 ภาษา
* `frontend/src/routes/(public)/donations/track/[token]/+page.svelte`: หน้ารายละเอียดติดตามสถานะรองรับ 2 ภาษา

### 🔵 กลุ่มที่ 2: Master Data ประเภทศูนย์และแผนที่ (Shelter Master & Maps)
* `frontend/src/lib/constants/maps.ts`: กำหนด `OSM_RASTER_STYLE` และตั้งเป็นค่าเริ่มต้น
* `frontend/src/lib/constants/i18n/public-filter-panel.ts`: เพิ่มคำแปล Filter ประเภทศูนย์
* `frontend/src/lib/constants/i18n/public-shelter-card.ts`: เพิ่มคำแปล Card แสดงข้อมูลศูนย์
* `frontend/src/lib/constants/i18n/public-shelter-details.ts`: เพิ่มคำแปลหน้ารายละเอียดศูนย์
* `frontend/src/lib/constants/i18n/public-shelter-map.ts`: เพิ่มคำแปลใน Popup และ Control ของแผนที่
* `frontend/src/lib/features/public-portal/data/public-api.ts`: เพิ่ม Helper ดึง Shelter Types จาก API
* `frontend/src/lib/features/public-portal/index.ts`: รวม Export ฟังก์ชันและ Type ของ Shelter Types
* `frontend/src/lib/features/public-portal/ui/public-shelter-card.svelte`: Resolve ประเภทศูนย์จาก Master Data
* `frontend/src/lib/features/public-portal/ui/shelter-filter-panel.svelte`: ดึงตัวเลือก Filter จาก Master Data
* `frontend/src/lib/features/public-portal/ui/shelter-map.svelte`: ปรับใช้แผนที่ OSM และเพิ่ม Type Definition
* `frontend/src/routes/(public)/shelters/+page.ts`: โหลด Shelter Types คู่ขนานกับข้อมูลศูนย์
* `frontend/src/routes/(public)/shelters/[id]/+page.svelte`: ปรับ UI หน้ารายละเอียดศูนย์
* `frontend/src/routes/(public)/shelters/[id]/+page.ts`: Resolve ชื่อประเภทศูนย์ในหน้ารายละเอียด
* `frontend/src/routes/(public)/shelters/[id]/components/shelter-hero.svelte`: แสดงผลประเภทศูนย์ตาม Master Data
* `frontend/src/routes/(public)/shelters/page.test.ts`: Tests การเรียงลำดับพิกัดและการแปลงประเภทศูนย์
* `frontend/src/routes/api/public/v1/config/shelter-types/+server.ts`: Endpoint คืนค่ารายการประเภทศูนย์
* `frontend/src/routes/api/public/v1/config/shelter-types/server.test.ts`: Unit Tests สำหรับ Endpoint ประเภทศูนย์

### 🟡 กลุ่มที่ 3: ปรับโครงสร้างหน้าแรก (Landing Hero per CR-017)
* `frontend/src/routes/(public)/+page.svelte`: ลบ Transparency Polling เหลือเฉพาะ Hero Metrics
* `frontend/src/routes/(public)/+page.ts`: ลบ Fetch Transparency Summary

### 🟣 กลุ่มที่ 4: Mock Data ศูนย์พักพิง & ภูมิลำเนาเดิม (Seed & Domicile)
* `backend/apiapp/modules/shelter/use_case.py`: คืนค่าคำถาม-คำตอบ (FAQ) และข้อมูลติดต่อของศูนย์
* `frontend/scripts/seed.ts`: เพิ่มข้อมูลศูนย์ `SH001` - `SH004` ครบทุกหมวด และเพิ่มที่อยู่ภูมิลำเนาเดิมให้ทุกครัวเรือน

---

## 🧪 4. การตรวจสอบคุณภาพ (Quality Gates & Testing)

| การทดสอบ / ตรวจสอบ | ผลลัพธ์ | รายละเอียด |
| :--- | :---: | :--- |
| **Svelte-Check (TypeScript)** | ✅ ผ่าน | **0 errors, 0 warnings** (ไม่ใช้ `any`) |
| **Frontend Unit Tests (Vitest)** | ✅ ผ่าน | **1,679 passed** (119 test files) |
| **Backend Pytest** | ✅ ผ่าน | **104 passed** |
| **Worker Pytest** | ✅ ผ่าน | **163 passed** |
| **Code Formatting (Prettier / Ruff)** | ✅ ผ่าน | จัดฟอร์แมตถูกต้องทุกไฟล์ |
| **Linter (ESLint / Ruff)** | ✅ ผ่าน | ไม่มี Lint Warnings/Errors |
