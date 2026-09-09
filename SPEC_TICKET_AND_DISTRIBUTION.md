# ข้อกำหนดระบบตั๋วเบิกคลังและแจกจ่ายสิ่งของหน้างาน
## (Requisition Ticket & Frontline Distribution Specification)

> **สรุปภาพรวม (TL;DR):**  
> จัดการวงจรเบิกจ่ายพัสดุและอาหาร 3 ประเภท เชื่อมโยง **โรงครัว ➔ คลังสินค้า ➔ จุดแจกจ่ายหน้างาน** รองรับการตัดสต็อกคลังอัตโนมัติ การสแกน QR ตรวจสิทธิ์และเงื่อนไขพิเศษรายบุคคล (Default = 1 ชิ้น, ปรับจำนวนได้) พร้อมระบบกระทบยอด (Reconciliation) ปิดรอบการแจกจ่าย

---

## 1. ประเภทของตั๋วเบิกจ่าย (3 Requisition Types)

อ้างอิงสถาปัตยกรรมคลังสินค้าและเหตุผลการตัดสต็อกตาม `CR-059`:

| ประเภทตั๋ว (Type)            | ชื่อเอกสาร         | วัตถุประสงค์                      | ปลายทาง            | Stock Ledger Reason    |
| :------------------------- | :--------------- | :----------------------------- | :----------------- | :--------------------- |
| **Type 1: TKT-KITCHEN**    | ตั๋วเบิกวัตถุดิบเข้าครัว | เบิกวัตถุดิบ/เครื่องปรุงไปประกอบอาหาร | โรงครัวของศูนย์       | `reason: use`          |
| **Type 2: TKT-DIST-BATCH** | ตั๋วเบิกของไปแจกจ่าย | เบิกอาหารปรุงสุก/ของใช้ไปแจกผู้พักพิง  | จุดแจกจ่ายหน้างาน     | `reason: distribute`   |
| **Type 3: TKT-TRANSFER**   | ตั๋วโอนย้ายพัสดุ      | โอนย้ายของระหว่างคลังหรือข้ามศูนย์    | คลังปลายทาง / ศูนย์อื่น | `reason: transfer_out` |

### 1.1 การรวมศูนย์ผ่าน Ticket Dashboard (Single Table with Type Filter)
ตั๋วเบิกทั้ง 3 ประเภทถูกรวมศูนย์ไว้ที่หน้าจอหลัก **`/back-office/tickets`** หน้าเดียว เพื่อความเรียบง่ายและไม่ซับซ้อน โดยใช้ **ตารางเดียวร่วมกับแถบตัวกรองประเภท (Type Filter Pills)**:
* **แถบตัวกรองประเภท:** `[ ทั้งหมด ]` `[ 🍳 เบิกเข้าครัว ]` `[ 📦 เบิกไปแจกจ่าย ]` `[ 🚚 โอนย้ายข้ามศูนย์ ]`
* **กลไกการทำงาน:** โหลดข้อมูล Ticket มารอบเดียว แล้วใช้ State กรองข้อมูลบนตารางทันที (Client-side / Query Filter) รวดเร็ว ลื่นไหล ไม่โหลดหน้าใหม่
* **Badge Counters:** แสดงตัวเลขตั๋วที่รออนุมัติกำกับบนแต่ละปุ่มกรอง เช่น `เบิกเข้าครัว (2)` ช่วยให้คลังเห็นงานค้างได้ทันที

---

## 2. ผังกระบวนการทำงานหลัก (End-to-End Workflow)

กระบวนการแบ่งเป็น 3 ช่วงตามลำดับจากบนลงล่าง: **1. ยื่นคำขอ ➔ 2. อนุมัติและตัดสต็อกคลัง ➔ 3. ปลายทางรับไปปฏิบัติการ**

```mermaid
flowchart TD
    %% ==========================================
    %% ส่วนที่ 1: การร้องขอ (Request & Ticket Management)
    %% ==========================================
    subgraph Part1 ["ส่วนที่ 1: การร้องขอ (Request & Ticket Management)"]
        direction TB
        R1["1. เบิกวัตถุดิบเข้าครัว<br/>(TKT-KITCHEN)"]
        R2["2. เบิกของไปแจกจ่าย<br/>(TKT-DIST-BATCH)"]
        R3["3. โอนย้ายไประหว่างศูนย์<br/>(TKT-TRANSFER)"]

        T_IN["รวมที่ศูนย์รับคำขอ Ticket Management"]
        T_CHK["ตรวจสอบรายการ & แก้ไข (Edit / Update)"]
        T_APP{"ผลการพิจารณาอนุมัติ?"}
        T_REJ["ไม่อนุมัติ / ยกเลิกคำขอ"]

        R1 --> T_IN
        R2 --> T_IN
        R3 --> T_IN
        T_IN --> T_CHK --> T_APP
        T_APP -->|ไม่อนุมัติ| T_REJ
    end

    %% ==========================================
    %% ส่วนที่ 2: คลังตัดสต็อก (Warehouse & Stock Card)
    %% ==========================================
    subgraph Part2 ["ส่วนที่ 2: คลังตัดสต็อก (Warehouse & Stock Card)"]
        direction TB
        WH_AUTO["ระบบตรวจตัดสต็อกอัตโนมัติ (Auto Stock Deduction)<br/>• ตัดของออกจากคลังตาม Ticket ทันที"]
        WH_CARD["Card คลังสินค้า / สต็อกการ์ด (Stock Card Ledger)<br/>• ลงบัญชี stock_ledger ทันที (use / distribute / transfer_out)<br/>• ปรับยอดคงเหลือใน Stock Card<br/>• ออกใบ/ป้ายปล่อยของ (Release Slip / Active Batch ID)"]

        WH_AUTO --> WH_CARD
    end

    %% ==========================================
    %% ส่วนที่ 3: ส่งมอบและปฏิบัติการ (Dispatch & Execution)
    %% ==========================================
    subgraph Part3 ["ส่วนที่ 3: ส่งมอบและปฏิบัติการ (Dispatch & Execution)"]
        direction TB
        OUT1["โรงครัวประกอบอาหาร (Kitchen)<br/>(รับของไปปรุง -> บันทึก Portion Yield กลับเข้าคลัง)"]
        OUT2["Staff นำของไปจุดแจก (Active Batch)<br/>(ตั้งโต๊ะ/เปิดรอบแจก ➔ สแกน)"]
        OUT3["จัดส่งไปศูนย์อื่น (Transfer)<br/>(ขึ้นรถขนส่งไปยังปลายทาง)"]

        %% ซับโฟลว์การแจกจ่ายหน้างาน
        D1["สแกนผู้รับด้วย QR (รายบุคคล / ครอบครัว)"]
        D2{"ตรวจสิทธิ์อัตโนมัติ<br/>(โควตา & Special Needs)"}
        D3["ส่งมอบของ & ตัดยอดแจกจริง (Actual +1)"]
        D4{"เคยรับไปแล้วในรอบนี้?"}
        D5["อนุมัติพิเศษ (Special Override)<br/>ระบุสาเหตุ & บันทึก Audit Log"]
        D6["ปฏิเสธการจ่าย"]
        D7["ปิดรอบ: กระทบยอด เบิก vs แจกจริง & คืนของเหลือเข้าคลัง"]

        OUT2 --> D1 --> D2
        D2 -->|ยังไม่ได้รับ / ข้อมูลถูกต้อง| D3
        D2 -->|พบประวัติรับซ้ำในรอบนี้| D4
        D4 -->|มีเหตุจำเป็นพิเศษ| D5 --> D3
        D4 -->|ไม่มีเหตุจำเป็น| D6
        D3 --> D7
    end

    %% เชื่อมต่อระหว่าง 3 ส่วน จากบนลงล่าง
    T_APP -->|อนุมัติ Ticket| WH_AUTO
    WH_CARD -->|"จ่ายวัตถุดิบ (reason: use)"| OUT1
    WH_CARD -->|"จ่ายชุดแจก (reason: distribute)"| OUT2
    WH_CARD -->|"จ่ายของย้ายศูนย์ (reason: transfer_out)"| OUT3
```

### วงจรสถานะของตั๋วเบิก (Ticket Lifecycle)
* `DRAFT` ➔ อยู่ระหว่างร่างรายการ
* `REQUESTED` ➔ ยื่นคำขอ รออนุมัติ
* `APPROVED` ➔ อนุมัติแล้ว รอจัดของ
* `ALLOCATED / DISPATCHED` ➔ คลังตัดสต็อกและส่งมอบของให้ผู้ถือตั๋ว
* `IN_DISTRIBUTION` ➔ กำลังแจกจ่ายหน้างาน (เฉพาะ Type 2)
* `COMPLETED` ➔ สรุปยอดแจกจริงและคืนของเหลือเข้าคลังเสร็จสิ้น
* `CANCELLED` ➔ ยกเลิกคำขอ

---

## 3. การเชื่อมต่อ ครัว ↔ คลัง และ Master Data (Kitchen Yield Integration)

เพื่อป้องกันปัญหา **Master Data บวม (Catalog Bloat)** จากเมนูอาหารที่เปลี่ยนทุกวันตามของบริจาค ระบบใช้แนวทาง **"Standard Archetypes + Dynamic Lot Metadata"**

### 3.1 รายการอาหารปรุงสำเร็จมาตรฐาน (Standard Meal Archetypes)
กำหนด Master Data กลางไว้ 5 รายการใน `catalog` ตามข้อจำกัดทางอาหาร (`target_restrictions`):

| รหัสสินค้า (`_id`)               | ชื่อสินค้า                      | หมวดหมู่          | หน่วย     | กลุ่มเป้าหมายที่แจกได้                      |
| :---------------------------- | :-------------------------- | :-------------- | :------- | :------------------------------------ |
| `item_master:meal_general`    | ข้าวกล่องปรุงสำเร็จ (อาหารทั่วไป)  | `prepared_food` | กล่อง     | ผู้พักพิงทั่วไปทุกคน                         |
| `item_master:meal_halal`      | ข้าวกล่องปรุงสำเร็จ (ฮาลาล)      | `prepared_food` | กล่อง     | ชาวมุสลิม (`halal`)                     |
| `item_master:meal_vegetarian` | ข้าวกล่องปรุงสำเร็จ (มังสวิรัติ/เจ)  | `prepared_food` | กล่อง     | มังสวิรัติ (`vegetarian`)                 |
| `item_master:meal_soft`       | อาหารปรุงสำเร็จ (อาหารอ่อน/โจ๊ก) | `prepared_food` | ถ้วย/กล่อง | ผู้สูงอายุ/ติดเตียง (`elderly`/`bedridden`) |
| `item_master:meal_infant`     | อาหารเสริมเด็กอ่อน/ทารก        | `prepared_food` | ถ้วย      | ทารกและเด็กเล็ก (`infant`)              |

### 3.2 กฎการบันทึก Lot และความปลอดภัยทางอาหาร (Food Safety Invariants)
1. **ชื่อเมนูจริง:** บันทึกลงในฟิลด์ `lot.note` เช่น `"ข้าวกะเพราไก่ไข่ดาว"` โดยไม่ต้องเปิด SKU ใหม่
2. **รหัสล็อต:** ออกอัตโนมัติรูปแบบ `L-YYMMDD-XXX` (CR-088) พร้อมระบุโซนพักของ (`storage_zone`)
3. **⚠️ อายุอาหารปรุงสุก (Shelf-Life) = 4 ชั่วโมง:**
   * คำนวณ `lot.expiry = เวลาปรุงเสร็จ + 4 ชม.`
   * หากเกิน 4 ชม. สต็อกจะขึ้นสถานะ **"🚨 หมดอายุ (EXPIRED)"** และ **บล็อกการสแกนแจกจ่ายทันที**

### 3.3 โฟลว์การบันทึกผลผลิตเข้าคลังแบบชุดรายการ (Batch Yield as Array)

ใน 1 รอบมื้อ ครัวมักปรุงอาหารหลายประเภทพร้อมกัน (เช่น ข้าวทั่วไป 300 กล่อง, ข้าวฮาลาล 50 กล่อง, ข้าวต้ม 20 ถ้วย) ระบบจึงรองรับการส่งผลผลิตเป็น **Array ของรายการอาหาร (`items: [...]`)** เพื่อบันทึกเข้าคลังใน Transaction เดียว:

```mermaid
flowchart TD
    K1["1. ครัวปรุงอาหารเสร็จในรอบมื้อ<br/>(เช่น กะเพราไก่ 300 กล่อง + ข้าวผัดฮาลาล 50 กล่อง)"] --> K2["2. บันทึกผลผลิตที่ <code>/kitchen/yield</code> เป็นชุดรายการ (Array):<br/>• รายการที่ 1: <code>meal_general</code> (กะเพราไก่) ยอด 300 กล่อง<br/>• รายการที่ 2: <code>meal_halal</code> (ข้าวผัดไก่) ยอด 50 กล่อง"]
    K2 --> T1["3. ระบบบันทึกคู่ขนานในคราวเดียว (Batch Commit):<br/>• <code>meal_service</code> (actual_yield รวม = 350)<br/>• <code>stock_ledger</code> 2 แถว (+300 กล่อง และ +50 กล่อง, Expiry: +4 ชม.)"]
    T1 --> W1["4. คลังอัปเดตสต็อกพร้อมเปิดเบิกทันที<br/>🍱 ข้าวกล่องทั่วไป (กะเพราไก่) [300 กล่อง]<br/>🍱 ข้าวกล่องฮาลาล (ข้าวผัดไก่) [50 กล่อง]"]
    W1 --> D1["5. จุดแจกเปิด Ticket <code>TKT-DIST-BATCH</code> เบิกไปแจกจ่าย"]
```

---

## 4. การเบิกของและแจกจ่ายจริงหน้างาน (On-site Distribution)

### 4.1 ผังกระบวนการแจกจ่าย 3 จังหวะ (3-Step Distribution Flow)

```mermaid
flowchart TD
    subgraph StepA ["จังหวะที่ 1: เลือกชุดของที่จะแจก (Setup Session)"]
        direction TB
        A1["Staff เข้าหน้า <code>/onsite/distribution</code>"] --> A2["เลือกรอบมื้อ & ระบุจุดแจก"]
        A2 --> A3["เลือกชุดของที่คลังอนุมัติแล้ว (Active Batches)<br/>เช่น ข้าวกะเพราไก่ 300 กล่อง"]
        A3 --> A4["กด <b>'เริ่มรอบแจก'</b>"]
    end

    subgraph StepB ["จังหวะที่ 2: สแกนแจกจริง (Live Scanning)"]
        direction TB
        A4 --> B1["เข้าสู่โหมดสแกน <code>/onsite/distribution/scan</code>"]
        B1 --> B2["สแกน QR ผู้พักพิง / หัวหน้าครอบครัว"]
        B2 --> B3{"ตรวจสิทธิ์อัตโนมัติ"}
        B3 -->|ยังไม่ได้รับ| B4["แสดงข้อมูล + Badge อาหารพิเศษ<br/>จำนวนเริ่มต้น <b>Default = 1</b> (กด +/- ปรับได้)"]
        B3 -->|รับไปแล้วในมื้อนี้| B5["แจ้งเตือนสีแดง 'รับไปแล้วเมื่อ 11:45'<br/>(มีปุ่ม 'กรณีพิเศษ Override' หากจำเป็น)"]
        B4 --> B6["กดยืนยันจ่าย ➔ ตัดยอดในมือทันที (300 ➔ 299)<br/>พร้อมสแกนคนถัดไปทันที"]
        B5 --> B6
    end

    subgraph StepC ["จังหวะที่ 3: สรุปปิดรอบ (Close & Reconcile)"]
        direction TB
        B6 --> C1["แจกเสร็จ/หมดเวลา ➔ กด <b>'สรุปปิดรอบมื้อ'</b>"]
        C1 --> C2["ระบบกระทบยอด: เบิก 300 | แจก 285 | เหลือ 15"]
        C2 --> C3["ยืนยันส่งคืนของเหลือ 15 ชิ้นกลับเข้าคลัง"]
    end
```

### 4.2 กฎการทำงานสำคัญ (Business Rules)
1. **การตรวจจับมื้ออาหาร (Meal Period Resolution):**
   * ล็อกตาม Ticket ที่เลือกเป็นหลัก
   * หรือตรวจจับตามเวลาจริง: เช้า (`06:00–09:30`), กลางวัน (`11:00–13:30`), เย็น (`17:00–19:30`), นอกเวลานี้คือของว่าง (`snack`)
   * Staff มีสิทธิ์กดสลับมื้อได้เองบน Header หากแจกเหลื่อมเวลา
2. **การตรวจสิทธิ์และเงื่อนไขพิเศษ (Validation & Flags):**
   * โควตามาตรฐาน: 1 สิทธิ์ ต่อ 1 คน ต่อ 1 มื้อ
   * แสดง Badge แจ้งเตือนเงื่อนไขพิเศษทันทีเมื่อสแกน: ⚠️ ฮาลาล, ⚠️ อาหารเด็ก, ⚠️ แพ้อาหาร, ⚠️ ผู้ป่วยติดเตียง
   * หากสแกน QR หัวหน้าครอบครัว ระบบจะแสดงจำนวนสมาชิกในบ้านที่ Active อยู่เพื่อใช้อ้างอิง
3. **การปรับจำนวนและการรับซ้ำ:**
   * **Default Quantity = 1:** จำนวนจ่ายตั้งต้นเป็น 1 ชิ้นเสมอ
   * **Quantity Stepper (`[-] 1 [+]`):** Staff กดปรับเพิ่ม/ลดจำนวนได้หน้างานจริง (เช่น รับแทนครอบครัว)
   * **Special Override:** กรณีสแกนซ้ำแต่มีความจำเป็น (อาหารหก/มีสมาชิกเพิ่ม) Staff สามารถกดอนุมัติพร้อมบันทึกเหตุผลลง Audit Log

### 4.3 องค์ประกอบหน้าจอหลัก (Key Screen Specs)
* **หน้าเลือกชุดของ (`/onsite/distribution`):** แสดงตัวเลือกมื้ออาหาร, รายการ Ticket ที่คลังปล่อยของแล้ว (Active Batches) พร้อมจำนวนคงเหลือในมือ และปุ่มเริ่มรอบแจก
* **หน้าจอสแกนจริง (`/onsite/distribution/scan`):** โหมดกล้องสแกน QR อัตโนมัติ (พร้อมช่องค้นหาชื่อ/เต็นท์), การ์ดแสดงข้อมูลผู้พักพิงและ Badge อาหารพิเศษ, Stepper ปรับจำนวน `[-] [1] [+]`, ปุ่มยืนยันจ่ายขนาดใหญ่ และปุ่ม Override สีส้ม

---

## 5. การกระทบยอดและส่งคืนคลัง (Reconciliation & Returns)

เมื่อสิ้นสุดรอบการแจกจ่าย หัวหน้าจุดแจกต้องปิดรอบผ่านสมการกระทบยอด:

$$\text{ยอดเบิกจากคลัง (Allocated)} = \text{แจกจ่ายจริง (Distributed)} + \text{ส่งคืนคลัง (Returned)} + \text{สูญหาย/เสียหาย (Waste)}$$

* **ของเหลือสภาพดี:** ระบบสร้าง `stock_ledger` รับคืนเข้าคลัง (`reason: adjust` หรือ `return`, qty: `+Returned`)
* **ของเสีย/บูด (เกิน 4 ชม.):** บันทึกเป็นของเสีย (`waste`) ไม่รับกลับเข้าสต็อกที่ใช้ได้

---

## 6. โครงสร้างข้อมูล (Data Architecture & Schema)

### 6.1 ผังความสัมพันธ์โครงสร้างข้อมูล (Entity Relationship Diagram - ERD)

แผนภาพแสดงความเชื่อมโยงของฐานข้อมูลระหว่าง **Catalog (Master Data) ➔ คลังสินค้า (Stock Ledger) ➔ ตั๋วเบิก (Ticket) ➔ โรงครัว (Kitchen) ➔ หน้างานแจกจ่าย (Distribution) ➔ ผู้พักพิง (Evacuee)**:

```mermaid
erDiagram
    ITEM_MASTER ||--o{ TICKET_ITEM : "item_id"
    ITEM_MASTER ||--o{ STOCK_LEDGER : "item_id"
    ITEM_MASTER ||--o{ KITCHEN_YIELD_ITEM : "item_id"

    REQUISITION_TICKET ||--|{ TICKET_ITEM : "items"
    REQUISITION_TICKET ||--o{ STOCK_LEDGER : "ref_id (approve/dispatch)"
    REQUISITION_TICKET ||--o{ DISTRIBUTION_SCAN_LOG : "ticket_id"

    MEAL_PLAN ||--o| MEAL_SERVICE : "meal_plan_id"
    MEAL_SERVICE ||--|{ KITCHEN_YIELD_ITEM : "items"
    MEAL_SERVICE ||--o{ STOCK_LEDGER : "ref_id (reason: receive)"

    HOUSEHOLD ||--o{ EVACUEE : "household_id"
    EVACUEE ||--o{ DISTRIBUTION_SCAN_LOG : "evacuee_id"
    HOUSEHOLD ||--o{ DISTRIBUTION_SCAN_LOG : "household_id"

    ITEM_MASTER {
        string _id PK "item_master:sku or ulid"
        string name "ชื่อสินค้า"
        string category "prepared_food / food / hygiene"
        string base_unit "กล่อง / ชิ้น / kg"
        enum distribution_type "recurring / one_time"
        json target_restrictions "diet_religions / vulnerable_groups"
    }

    REQUISITION_TICKET {
        string _id PK "ticket:shelter_id:ulid"
        string shelter_id FK "รหัสศูนย์"
        string ticket_no "e.g. TKT-DIST-BATCH-0081"
        enum type "kitchen / distribution / transfer"
        enum status "draft / requested / approved / allocated / in_distribution / completed / cancelled"
        enum meal_round "breakfast / lunch / dinner / snack"
        string source_location "e.g. warehouse:main"
        string destination_location "e.g. distribution_point:zone_a"
        string requested_by FK "user_id"
        string approved_by FK "user_id"
    }

    TICKET_ITEM {
        string item_id FK "item_master id"
        string item_name "ชื่อสินค้า"
        string category "หมวดหมู่สินค้า"
        number requested_qty "ยอดขอเบิก"
        number allocated_qty "ยอดจัดสรรจริง"
        number distributed_qty "ยอดแจกจริง"
        number returned_qty "ยอดส่งคืนคลัง"
    }

    STOCK_LEDGER {
        string _id PK "stock_ledger:ulid"
        string item_id FK "item_master id"
        string qty "signed decimal string (+ / -)"
        string unit "base_unit"
        enum reason "receive / distribute / use / transfer_out / adjust"
        string ref_id FK "ticket:id / meal_service:id"
        json lot "lot_no / note / expiry / storage_zone"
        timestamp occurred_at "เวลาทำรายการ"
    }

    MEAL_PLAN {
        string _id PK "meal_plan:ulid"
        string date "YYYY-MM-DD"
        enum meal "breakfast / lunch / dinner / snack"
        json headcount "total / halal / soft_food / infant"
    }

    MEAL_SERVICE {
        string _id PK "meal_service:ulid"
        string meal_plan_id FK "meal_plan id"
        number actual_yield "ยอดผลผลิตรวม"
        number served "ยอดเสิร์ฟจริง"
        number waste "ยอดสูญเสีย"
    }

    KITCHEN_YIELD_ITEM {
        string item_id FK "item_master id"
        string menu_name "ชื่อเมนูจริง e.g. กะเพราไก่"
        number actual_yield "จำนวนที่ทำได้"
        string unit "กล่อง / ถ้วย"
        string storage_zone "จุดพักอาหารปรุงสุก"
    }

    DISTRIBUTION_SCAN_LOG {
        string _id PK "dist_log:ulid"
        string ticket_id FK "ticket id"
        string shelter_id FK "รหัสศูนย์"
        string evacuee_id FK "evacuee id"
        string household_id FK "household id opt"
        enum meal_round "มื้ออาหาร"
        json items_received "item_id และ qty"
        string scanned_by FK "staff_id"
        boolean is_override "อนุมัติพิเศษ"
        string override_reason "สาเหตุ override"
        timestamp scanned_at "เวลาสแกนรับ"
    }

    EVACUEE {
        string _id PK "evacuee:ulid"
        string full_name "ชื่อ-นามสกุล"
        string household_id FK "household id"
        enum stay_status "active / leave / discharged"
        json special_needs "infant / elderly / bedridden"
        string religion "muslim -> halal flag"
    }

    HOUSEHOLD {
        string _id PK "household:code"
        string shelter_code "รหัสศูนย์"
        string tent_no "เลขเต็นท์ / โซน"
        number member_count "จำนวนสมาชิก"
    }
```

---

### 6.2 โครงสร้างข้อมูล (TypeScript Interfaces)

```typescript
export type RequisitionType = 'kitchen' | 'distribution' | 'transfer';
export type TicketStatus = 'draft' | 'requested' | 'approved' | 'allocated' | 'in_distribution' | 'completed' | 'cancelled';

export interface RequisitionTicket {
  _id: string; // ticket:SH01:20260908-001
  shelter_id: string;
  ticket_no: string;
  type: RequisitionType;
  status: TicketStatus;
  meal_round?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  source_location: string; // warehouse:main
  destination_location: string; // distribution_point:zone_a
  requested_by: string; // user_id
  approved_by?: string;
  dispatched_by?: string;
  items: Array<{
    item_id: string;
    item_name: string;
    category: string;
    requested_qty: number;
    allocated_qty: number;
    distributed_qty: number;
    returned_qty: number;
  }>;
  created_at: string;
  updated_at: string;
}

export interface DistributionScanLog {
  _id: string; // dist_log:01J...
  ticket_id: string;
  shelter_id: string;
  meal_round?: string;
  evacuee_id: string;
  household_id?: string;
  items_received: Array<{ item_id: string; qty: number }>;
  scanned_by: string;
  is_override: boolean;
  override_reason?: string;
  scanned_at: string;
}

export interface KitchenYieldItem {
  item_id: 'item_master:meal_general' | 'item_master:meal_halal' | 'item_master:meal_vegetarian' | 'item_master:meal_soft' | 'item_master:meal_infant';
  menu_name: string; // เช่น "ข้าวกะเพราไก่ไข่ดาว" -> บันทึกลง stock_ledger.lot.note
  actual_yield: number; // ยอดปรุงเสร็จจริงของเมนูนี้ เช่น 300
  unit: string; // "กล่อง" | "ถ้วย"
  storage_zone?: string; // เช่น "จุดพักอาหารปรุงสุก โซนครัว"
}

export interface KitchenYieldInput {
  meal_plan_id: string;
  meal_round: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  cooking_completed_at: number; // epoch ms (ระบบตั้ง lot.expiry = cooking_completed_at + 4 ชม.)
  items: KitchenYieldItem[]; // รองรับบันทึกหลายเมนูพร้อมกันใน 1 รอบมื้อ (Array)
}
```

---

## 7. แผนผังเว็บไซต์และโมดูล (Sitemap & System Modules)

โครงสร้างระบบแบ่งออกเป็น **2 โมดูลใหญ่ (Major Modules)** ครอบคลุม **4 โมดูลย่อย รวม 10 หน้าจอ**:
1. **ระบบหลังบ้าน (Back-office Module):** ครอบคลุม Ticket Center, คลังสินค้า (Warehouse) และโรงครัว (Kitchen)
2. **ระบบส่วนหน้า (On-site Frontline Module):** ครอบคลุมจุดแจกจ่ายหน้างานและการสแกน QR (Distribution)

```mermaid
flowchart TD
    %% สไตล์สีตามระดับชั้น (Root = กรมท่า, Major Module = น้ำเงิน, Sub-module = ฟ้าสดใส, Pages = เขียว)
    classDef rootStyle fill:#0d47a1,stroke:#0a3880,stroke-width:2px,color:#fff,font-weight:bold,font-size:16px;
    classDef majorStyle fill:#1976d2,stroke:#1565c0,stroke-width:2px,color:#fff,font-weight:bold,font-size:14px;
    classDef subModStyle fill:#29b6f6,stroke:#0288d1,stroke-width:2px,color:#fff,font-weight:bold,font-size:13px;
    classDef pageStyle fill:#66bb6a,stroke:#388e3c,stroke-width:1.5px,color:#fff,font-size:12px;

    %% Level 0: Root
    HOME["Smart Shelter Portal<br/>(หน้าหลักระบบ)"]:::rootStyle

    %% Level 1: โมดูลใหญ่ (Major Modules)
    BACK["ระบบหลังบ้าน<br/>(Back-office)"]:::majorStyle
    FRONT["ระบบส่วนหน้า<br/>(On-site Frontline)"]:::majorStyle

    HOME --- BACK
    HOME --- FRONT

    %% Level 2: โมดูลย่อยใต้ Back-office
    SUB_TICKET["ศูนย์บริหาร Ticket<br/>(Ticket Center)"]:::subModStyle
    SUB_WH["คลังสินค้าและสต็อก<br/>(Warehouse)"]:::subModStyle
    SUB_KITCHEN["โรงครัวและอาหาร<br/>(Kitchen)"]:::subModStyle

    BACK --- SUB_TICKET
    BACK --- SUB_WH
    BACK --- SUB_KITCHEN

    %% Level 2: โมดูลย่อยใต้ ระบบส่วนหน้า
    SUB_DIST["จุดแจกจ่ายหน้างาน<br/>(Distribution)"]:::subModStyle

    FRONT --- SUB_DIST

    %% Level 3: หน้าย่อยใต้ Ticket Center
    P1_1["1.1 รายการและค้นหา Ticket<br/><code>/back-office/tickets</code>"]:::pageStyle
    P1_2["1.2 แบบฟอร์มสร้างตั๋วเบิก<br/><code>/back-office/tickets/new</code>"]:::pageStyle
    P1_3["1.3 ตรวจสอบตั๋ว & อนุมัติ<br/><code>/back-office/tickets/[id]</code>"]:::pageStyle

    SUB_TICKET --- P1_1
    P1_1 --- P1_2
    P1_2 --- P1_3

    %% Level 3: หน้าย่อยใต้ Warehouse
    P2_1["2.1 คลังสต็อก & สต็อกการ์ด<br/><code>/back-office/supply</code>"]:::pageStyle
    P2_2["2.2 ใบปล่อยของ & Active Batch<br/><code>/back-office/supply/batches</code>"]:::pageStyle

    SUB_WH --- P2_1
    P2_1 --- P2_2

    %% Level 3: หน้าย่อยใต้ Kitchen
    P3_1["3.1 วางแผนมื้อ & เปิดคำขอเบิก<br/><code>/back-office/kitchen</code>"]:::pageStyle
    P3_2["3.2 บันทึกการปรุง & ผลผลิต Yield<br/><code>/back-office/kitchen/production-board</code>"]:::pageStyle

    SUB_KITCHEN --- P3_1
    P3_1 --- P3_2

    %% Level 3: หน้าย่อยใต้ Distribution
    P4_1["4.1 เลือกมื้ออาหาร & ชุดแจกจ่าย<br/><code>/onsite/distribution</code>"]:::pageStyle
    P4_2["4.2 สแกน QR แจกจริง & ตรวจสิทธิ์<br/><code>/onsite/distribution/scan</code>"]:::pageStyle
    P4_3["4.3 สรุปยอดแจก & ส่งคืนของเหลือ<br/><code>/onsite/distribution/reconcile</code>"]:::pageStyle

    SUB_DIST --- P4_1
    P4_1 --- P4_2
    P4_2 --- P4_3
```

### สรุปสารบบหน้าจอและเส้นทาง (Module & Page Directory)

| โมดูลหลัก (Major)                             | โมดูลย่อย (Sub-module)                              |  ลำดับ  | หน้าจอ (Page Name)                                         | URL Route                               | ผู้ใช้งานหลัก (Roles)                  | หน้าที่และความสามารถหลัก (Primary Functions)                                                                                        |
| ------------------------------------------- | ------------------------------------------------- | :---: | --------------------------------------------------------- | --------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **1. ระบบหลังบ้าน**<br/>*(Back-office)*       | **1.1 ศูนย์บริหาร Ticket**<br/>*(Ticket Center)*     |   1   | **ศูนย์ควบคุมตั๋วเบิก (Ticket Dashboard)**                      | `/back-office/tickets`                  | Admin, Warehouse, Kitchen, Staff   | แดชบอร์ดแบบตารางเดียว (Single Table) พร้อมแถบตัวกรองประเภท (`ทั้งหมด`, `🍳 เบิกเข้าครัว`, `📦 เบิกไปแจก`, `🚚 โอนย้าย`) และ Badge ตัวเลขรออนุมัติ |
|                                             |                                                   |   2   | **แบบฟอร์มสร้างตั๋วเบิก (Create Ticket)**                      | `/back-office/tickets/new`              | Kitchen, Staff จุดแจก, ผู้ประสานงาน   | ฟอร์มขอเบิกพัสดุและอาหาร ระบุรายการ สิ่งของ/Lot จำนวนที่ต้องการ                                                                            |
|                                             |                                                   |   3   | **ตรวจสอบตั๋ว & อนุมัติ (Ticket Detail & Approve)**            | `/back-office/tickets/[id]`             | Warehouse Manager, Center Director | ตรวจสอบรายการ ตรวจสต็อกคงเหลือ และกด **อนุมัติ (Approve)** เพื่อตัดสต็อกคลัง                                                              |
|                                             | **1.2 คลังสินค้าและสต็อก**<br/>*(Warehouse & Ledger)* |   4   | **สต็อกการ์ด & ยอดคงเหลือ (Stock Balance & Ledger)**         | `/back-office/supply`                   | Warehouse Staff, Admin             | เช็กยอดคงเหลือตาม Master Data, บันทึกความเคลื่อนไหว `stock_ledger` ทุกเหตุผล (`use`, `distribute`, `transfer_out`)                      |
|                                             |                                                   |   5   | **ใบปล่อยของ & ชุดแจกจ่าย (Release Slips & Batches)**        | `/back-office/supply/batches`           | Warehouse Staff                    | ตรวจสอบการปล่อยของ (Release Slip) และติดตามสถานะ Active Batch สำหรับจุดแจก                                                           |
|                                             | **1.3 โรงครัวและอาหาร**<br/>*(Kitchen Operations)* |   6   | **วางแผนมื้อ & เบิกวัตถุดิบ (Kitchen Planning & Requisition)**  | `/back-office/kitchen`                  | Kitchen Lead, Dietitian            | วางแผนรอบมื้ออาหาร คำนวณวัตถุดิบ (BOM) ตาม Headcount และสร้าง Ticket เบิกวัตถุดิบ (`TKT-KITCHEN`)                                          |
|                                             |                                                   |   7   | **บันทึกผลผลิตอาหารปรุงสุก (Production Board & Yield)**        | `/back-office/kitchen/production-board` | Kitchen Staff                      | บันทึกยอดปรุงเสร็จจริง (Actual Portion Yield) รับอาหารเข้าสต็อกคลัง (Shelf-life 4 ชม.)                                                   |
| **2. ระบบส่วนหน้า**<br/>*(On-site Frontline)* | **2.1 จุดแจกจ่ายหน้างาน**<br/>*(Distribution Point)* |   8   | **เลือกมื้อ & ชุดของที่จะแจก (Distribution Setup)**             | `/onsite/distribution`                  | Distribution Staff                 | เลือก Ticket / Active Batch ที่คลังปล่อยของแล้ว เลือกรอบมื้อ (เช้า/กลางวัน/เย็น) เปิดรอบการแจก                                               |
|                                             |                                                   |   9   | **สแกน QR แจกจริง & ตรวจสิทธิ์ (Live QR Scan & Eligibility)** | `/onsite/distribution/scan`             | Distribution Staff                 | สแกน QR ผู้พักพิง/ครอบครัว ตรวจสอบโควตา (Default=1 ชิ้น, ปรับได้) แสดงธงเตือนพิเศษ และปุ่ม Override                                          |
|                                             |                                                   |  10   | **สรุปกระทบยอดปิดรอบมื้อ (Reconciliation & Return)**          | `/onsite/distribution/reconcile`        | Distribution Staff, Warehouse Lead | กระทบยอดส่งมอบ: เบิกมา (Allocated) vs แจกจริง (Actual), คำนวณของเหลือส่งคืนคลัง และปิดรอบ                                                |
