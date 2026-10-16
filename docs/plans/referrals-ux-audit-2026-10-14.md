# UX/UI และ performance audit: `/back-office/referrals`

> วันที่: 2026-10-14 · สถานะ: **reference** สำหรับงานปรับปรุงหน้า referrals · ตรวจที่ commit `4af23f5f` (เลขบรรทัดอาจเลื่อนหลังจากนี้) · วิธี: อ่านโค้ดอย่างเดียว ยังไม่มีการวัดเวลาจริงหรือทดสอบบนเบราว์เซอร์

## สรุป (TL;DR)

- **pagination:** หน้ามี pagination บน UI แต่เป็นการหั่น 10 กลุ่มจากข้อมูลที่ BFF ส่งมาไม่เกิน 50 แถว (`GET /api/back-office/referral` ไม่ส่ง `limit`/`skip`/`sort`) referral เก่ากว่า 50 รายการล่าสุดหายไปเงียบๆ
- **bulk:** มีเฉพาะ "ทั้งกลุ่มตามสถานะ" ไม่มีการเลือกหลายแถว "ปิดทั้งหมด" ไม่มี confirm ทั้งที่ย้อนกลับไม่ได้ ถ้าบางรายการล้มเหลวเห็นแค่จำนวน และรันทีละรายการ
- **PC/mobile:** master-detail บน PC ใช้ได้ แต่ error ถูกแสดงเป็น "ไม่พบข้อมูล" บน mobile ตารางมี 6 คอลัมน์ ปุ่มจัดการอยู่ท้ายสุด ปุ่มสูง 28px และแถบ bulk ไม่ติดขอบล่าง
- **ผลตรวจ 51 ข้อ:** ความรุนแรง สูง 13 · กลาง 20 · ต่ำ 18 · ตรวจซ้ำกับโค้ด: ยืนยัน 35, แก้ไข 3, ยังเป็นการอนุมาน 3, ยังไม่ตรวจ 10

## ขอบเขตและวิธี

1. subagent (haiku) อ่านทั้งหน้า: route, `features/referrals/{ui,application,data,domain,server}` และ BFF `routes/api/back-office/referral/**` แล้วรายงาน finding พร้อมไฟล์:บรรทัด
2. session หลักเปิดโค้ดตรวจซ้ำ finding สำคัญ และแก้ข้อที่ไม่ถูก (ดูหัวข้อถัดไป)
3. owner ตัดสินใจรายข้อ ผลอยู่ที่หัวข้อ "การตัดสินใจ" และถูกบันทึกเป็น CR-167 / CR-168

สถานะการตรวจซ้ำ: **ยืนยัน** = เปิดโค้ดแล้วตรงตามรายงาน · **แก้ไข** = ตรวจแล้วและแก้ข้อสรุป · **อนุมาน** = ยังต้องทดสอบจริง · **ยังไม่ตรวจ** = เป็นของ subagent อย่างเดียว

## ข้อที่แก้จากรายงานแรก

- **F-04, F-05:** รายงานแรกเสนอให้ใช้ `useSearchEvacuees` / `useEvacueesPaginated` แทน แต่ทั้งสองยังโหลดทั้งหมดแล้วกรองใน browser (`people.remote.ts` `searchEvacuees` และ `listEvacueesPaginated` เมื่อมี search/filter เรียก `allByType`) มีแต่ `pageByType` แบบไม่กรองที่ bounded จริง ทางแก้จริงคือ search ฝั่ง server พร้อม index
- **scale:** `useEvacuees` อ่านจาก DB ของ shelter เดียว owner ยืนยันว่า peak ต่อ shelter อยู่ระดับหลายพัน F-04 และ F-05 จึงเป็นความรุนแรงสูง
- **F-08:** จำนวน refetch ที่ "N รอบ" เป็นการอนุมาน TanStack Query ยกเลิกแล้วเริ่มใหม่เมื่อ invalidate ซ้ำ ส่วน request ทีละรายการและการ invalidate ทุกครั้งที่สำเร็จเป็นจริงตามโค้ด
- **F-42:** ยืนยันได้เฉพาะว่า `evacuee-search-input.svelte` ไม่มีไฟล์ใดนำเข้า คำอธิบายเรื่อง server search ของรายงานแรกไม่ได้ถูกตรวจ

## Findings

### Pagination และปริมาณข้อมูล

| ID | ระดับ | เรื่อง | ไฟล์:บรรทัด | สถานะ | หมายเหตุ |
| --- | --- | --- | --- | --- | --- |
| F-01 | สูง | รายการถูกตัดที่ 50 แถวล่าสุด ไม่มีคำเตือน | `api/back-office/referral/+server.ts:37`<br>`referral.schema.ts:206` | ยืนยัน | BFF เรียก repo.list({ status, evacuee_id }) แล้ว schema ตั้ง limit เริ่มต้น 50 หน้าไม่ได้ส่ง filter ใดๆ |
| F-02 | สูง | BFF ไม่ส่ง limit/skip/sort ต่อ และหน้าไม่ส่ง status filter | `api/back-office/referral/+server.ts:33-34`<br>`referral.remote.ts:55-59` | ยืนยัน | client ส่ง limit/skip ได้ แต่ server อ่านเฉพาะ status กับ evacuee_id ส่วน repository รองรับ limit/skip/sort อยู่แล้ว |
| F-03 | สูง | "pagination" คือ slice 10 กลุ่มจาก array ที่โหลดมาแล้ว | `ui/referral-list.svelte:60-91` | ยืนยัน | นับเป็นกลุ่มไม่ใช่ referral ชุด 10 คนนับเป็น 1 แถว และกรอง/ค้นหา/จัดกลุ่มรันใหม่ทุกครั้งที่พิมพ์ |
| F-04 | สูง | list, ชุดส่งต่อ และ picker โหลด evacuee ทั้ง shelter | `ui/referral-list.svelte:42`<br>`people.remote.ts:205` | แก้ไข | ระดับ high ตามปริมาณที่ owner ยืนยัน (หลายพัน) ข้อเสนอของ haiku ให้ใช้ search/paginated hook ผิด เพราะ search ก็โหลดทั้งหมด ทางแก้สำหรับ list คือใช้ evacuee_summary ที่มีใน doc อยู่แล้ว ส่วน picker ต้องมี search ฝั่ง server |
| F-05 | สูง | picker เรนเดอร์ evacuee ทุกคนเป็นแถว DOM | `ui/evacuee-picker-table.svelte:121,139` | แก้ไข | ระดับ high ตามปริมาณที่ owner ยืนยัน ต้องทำ paging หรือ virtualization และ "เลือกทั้งหมด" ใน picker ควรหมายถึงเฉพาะแถวที่โหลดอยู่ในหน้า |
| F-06 | ต่ำ | .find() ต่อแถวต่อ render (O(แถว × evacuee)) | `ui/referral-batch-cards.svelte:147-159`<br>`ui/referral-list.svelte:47-48` | ยืนยัน | ใช้ Map ที่สร้างครั้งเดียวแทนได้ |
| F-10 | กลาง | ดึง detail ซ้ำทั้งที่ list มี doc ครบอยู่แล้ว | `routes/(protected)/back-office/referrals/+page.svelte:33-38` | ยืนยัน |  |
| F-11 | กลาง | $or + sort อาจสแกนข้าม shelter และ skip ช้าเมื่อลึก | `server/referral.server-repository.ts:273-288` | อนุมาน | ต้องรัน _explain กับ DB จริงก่อนลงมือ |
| F-43 | ต่ำ | list.filter(isReferral) ทิ้ง doc ที่ parse ไม่ได้โดยไม่แจ้ง | `data/referral.remote.ts:69` | ยืนยัน |  |

### Bulk operations

| ID | ระดับ | เรื่อง | ไฟล์:บรรทัด | สถานะ | หมายเหตุ |
| --- | --- | --- | --- | --- | --- |
| F-07 | สูง | สร้างเป็นชุดแบบทีละคน: N request (ร่าง) หรือ 2N (ส่ง) | `data/referral.remote.ts:145-159` | ยืนยัน | จำนวน round-trip ยืนยันจากโค้ด เวลาจริงยังไม่ได้วัด ไม่มี progress รายตัว |
| F-08 | สูง | bulk transition ทีละรายการ และ invalidate cache ทุกครั้งที่สำเร็จ | `ui/referral-batch-cards.svelte:171-179`<br>`application/queries.ts:88` | ยืนยัน | "refetch N รอบ" เป็นการอนุมานและน่าจะน้อยกว่านั้น เพราะ TanStack ยกเลิกแล้วเริ่มใหม่ |
| F-09 | กลาง | live changes feed invalidate cache ของ referral ทั้งหมด | `application/queries.ts:92-99` | ยืนยัน | ความถี่ของ event ยังเป็นการอนุมาน |
| F-13 | สูง | ไม่มีการเลือกหลายแถว (ไม่มี checkbox / เลือกทั้งหมด) | `ui/referral-batch-cards.svelte:466-471, 615-703` | ยืนยัน | bulk มีเฉพาะ "ทั้งกลุ่มตามสถานะ" |
| F-14 | สูง | "ปิดทั้งหมด" ไม่มี confirm และปิดแล้วย้อนกลับไม่ได้ | `ui/referral-batch-cards.svelte:686-701`<br>`domain/referral.transitions.ts:12` | ยืนยัน | ไม่มี confirm ยืนยันจากโค้ด ส่วน closed เป็น terminal ตาม haiku ผมไม่ได้เปิดไฟล์ transitions เอง "ยกเลิกร่างทั้งหมด" และ "ส่งทั้งหมด" ก็ไม่มี confirm |
| F-15 | สูง | ล้มเหลวบางรายการ แสดงแค่จำนวน ไม่บอกว่ารายการไหน | `ui/referral-batch-cards.svelte:176-178` | ยืนยัน | catch {} ทิ้ง error และ id ไม่มีปุ่มลองใหม่ |
| F-16 | กลาง | overrides ไม่เคยถูกล้าง บังข้อมูลใหม่จาก list | `ui/referral-batch-cards.svelte:65,69,174` | ยืนยัน | กลไกยืนยันจากโค้ด ผลกระทบจริงยังเป็นการอนุมาน |
| F-17 | กลาง | "ชุด" เป็นการเดาจากช่วงเวลา 2 นาที | `domain/referral.batch-group.ts:11` | ยังไม่ตรวจ | ชุดที่คร่อมขอบเวลาจะแตกเป็นสองกลุ่ม และ bulk อาจรวมคนละชุดที่ข้อความเหมือนกัน |
| F-48 | กลาง | picker ไม่ทำเครื่องหมายคนที่มี referral ค้างอยู่ | `ui/evacuee-picker-table.svelte:22-33` | ยืนยัน | ยืนยันว่า picker ไม่ใช้ข้อมูล referral เลย รู้ว่าซ้ำเมื่อ server ตอบ 409 หลังกดส่ง |

### Mobile

| ID | ระดับ | เรื่อง | ไฟล์:บรรทัด | สถานะ | หมายเหตุ |
| --- | --- | --- | --- | --- | --- |
| F-22 | สูง | แถบ bulk ไม่ sticky อยู่หลังตารางทั้งหมด | `ui/referral-batch-cards.svelte:574-576` | ยืนยัน | container แม่ใน +page.svelte เป็น grid ธรรมดา ไม่ใช่ scroll container แถบจึงอยู่ใน flow ปกติ |
| F-23 | สูง | ตาราง 6 คอลัมน์บนมือถือ และปุ่มจัดการอยู่คอลัมน์สุดท้าย | `ui/referral-batch-cards.svelte:455-496` | ยืนยัน | picker ใช้ hidden sm:table-cell ซ่อนคอลัมน์ แต่ตารางนี้ไม่มี |
| F-24 | สูง | ปุ่มและช่องสูงต่ำกว่า 44px | `ui/referral-list.svelte:124,136,241`<br>`components/ui/button/button.svelte:25` | ยืนยัน | Button ขนาด sm = h-7 (28px) ช่องค้นหา h-9 ปุ่ม "รายละเอียด" h-6 (24px) |
| F-25 | กลาง | checkbox ใน picker ขนาด 16px | `ui/evacuee-picker-table.svelte:126-131` | ยังไม่ตรวจ | ทั้งแถวกดเลือกได้ พื้นที่กดจริงจึงใหญ่กว่า |
| F-26 | กลาง | combobox และปุ่มเลือกความเร่งด่วนเล็กกว่า 44px | `ui/shelter-combobox.svelte:176,186` | ยังไม่ตรวจ |  |
| F-27 | กลาง | ปุ่ม submit เลื่อนหายบนฟอร์มยาว | `ui/medical-referral-form.svelte:157-175` | อนุมาน | ดูจากตำแหน่งในโค้ด ผลต่อการใช้งานจริงยังไม่ได้ลอง |
| F-46 | ต่ำ | ขอบข้างบนมือถือเหลือ 4px (p-1) | `routes/(protected)/back-office/referrals/+page.svelte:92` | อนุมาน | ยังไม่ได้ดู padding ของ protected layout |

### PC และสถานะของหน้า

| ID | ระดับ | เรื่อง | ไฟล์:บรรทัด | สถานะ | หมายเหตุ |
| --- | --- | --- | --- | --- | --- |
| F-18 | กลาง | ไม่มี sort หรือ filter เพิ่ม (วันที่ ความเร่งด่วน ทิศทาง) | `ui/referral-list.svelte:57-100` | ยืนยัน | server รองรับ sort แล้ว แต่ UI ไม่เปิดให้ใช้ |
| F-19 | กลาง | เมื่อโหลดไม่สำเร็จ จะแสดงเหมือนไม่มีรายการ | `routes/(protected)/back-office/referrals/+page.svelte:29-31, 142-155` | ยืนยัน | ไม่มี isError ผู้ใช้แยกไม่ออกว่าเครือข่ายล้มหรือไม่มีข้อมูล |
| F-20 | กลาง | แผง detail ว่างเปล่าเมื่อโหลดไม่สำเร็จ | `routes/(protected)/back-office/referrals/+page.svelte:162-196` | ยืนยัน | chain if/else if ไม่มี {:else} |
| F-21 | กลาง | เปลี่ยนประเภทแล้วฟอร์มถูกล้าง | `ui/referral-create-form.svelte:161-181` | ยังไม่ตรวจ | เหตุผลและหมายเหตุที่พิมพ์ไว้หาย |
| F-49 | กลาง | เปิด prompt เหตุผลแล้ว focus ไม่ย้ายไป | `ui/referral-batch-cards.svelte:193-196` | ยืนยัน | บนรายการยาว ปุ่มตอบรับ/ปฏิเสธจึงดูเหมือนไม่ทำงาน เพราะ prompt อยู่ล่างตาราง |
| F-50 | กลาง | ปุ่ม transition ใน detail ไม่ disable ระหว่างรอ | `ui/referral-detail.svelte:355-413` | ยืนยัน | ไฟล์นี้ไม่มี disabled เลย ส่วน batch view มี ผลของการกดซ้ำยังเป็นการอนุมาน |
| F-51 | กลาง | กดส่งโดยไม่เลือกผู้ประสบภัย ไม่มีอะไรเกิดขึ้น | `ui/referral-create-form.svelte:36-41` | ยืนยัน | กลไกยืนยัน: evacuee_id ว่างทำให้ schema ไม่ผ่านก่อนถึง guard และไม่มีช่องแสดง error ยังไม่ได้ลองบนเบราว์เซอร์ |
| F-44 | ต่ำ | แสดง _id ดิบของ CouchDB เป็นคอลัมน์ | `ui/referral-batch-cards.svelte:491-496` | ยืนยัน |  |
| F-45 | ต่ำ | ข้อความสำรองของชื่อไม่เหมือนกัน (id ดิบ กับ "ไม่พบชื่อผู้ประสบภัย") | `ui/referral-batch-cards.svelte:153`<br>`ui/referral-list.svelte:53` | ยืนยัน |  |

### Accessibility

| ID | ระดับ | เรื่อง | ไฟล์:บรรทัด | สถานะ | หมายเหตุ |
| --- | --- | --- | --- | --- | --- |
| F-28 | กลาง | Button ซ้อนอยู่ใน button (HTML ไม่ถูกต้อง) | `ui/referral-list.svelte:158, 234-245` | ยืนยัน |  |
| F-29 | กลาง | แถวตารางกดได้แต่ใช้คีย์บอร์ดไม่ได้ | `ui/referral-batch-cards.svelte:467-471` | ยืนยัน | ไม่มี tabindex, role หรือ key handler |
| F-30 | กลาง | tab กรองไม่มี role/aria-selected และบอกสถานะด้วยสีกับเส้นใต้ | `ui/referral-list.svelte:129-144` | ยืนยัน |  |
| F-31 | กลาง | ช่องค้นหาและช่องเหตุผลไม่มีชื่อที่ screen reader อ่านได้ | `ui/referral-list.svelte:120-124`<br>`ui/referral-batch-cards.svelte:589-593` | ยืนยัน | มีแค่ placeholder |
| F-32 | ต่ำ | ปุ่มเลือกความเร่งด่วนไม่มี aria-pressed และบอกด้วยสีอย่างเดียว | `ui/medical-referral-form.svelte:99-118` | ยังไม่ตรวจ |  |
| F-33 | ต่ำ | tab กรองและแถวไม่มี focus-visible ที่ชัดเจน | `ui/referral-list.svelte:131-141` | ยืนยัน | ดูจาก class ที่ไม่มี focus-visible ยังไม่ได้ลองด้วยคีย์บอร์ด |
| F-34 | ต่ำ | id="shelter-listbox" ตายตัว ชนกันถ้ามีสอง combobox | `ui/shelter-combobox.svelte:153,231` | ยังไม่ตรวจ |  |

### Convention และงานเก็บกวาด

| ID | ระดับ | เรื่อง | ไฟล์:บรรทัด | สถานะ | หมายเหตุ |
| --- | --- | --- | --- | --- | --- |
| F-12 | ต่ำ | transition ทุกประเภทผ่าน BFF แต่คอมเมนต์บอกเฉพาะ capacity | `data/referral.remote.ts:108-116` | ยืนยัน |  |
| F-35 | ต่ำ | ใช้ `<input>` ดิบแทนคอมโพเนนต์ Input | `ui/referral-list.svelte:120-124` | ยืนยัน | จุดใน shelter-combobox ยังไม่ได้ตรวจ |
| F-36 | ต่ำ | ใช้ text-2xs (10px) กับข้อมูลสำคัญ | `app.css:333`<br>`components/ui/button/button.svelte:25` | ยืนยัน | ยืนยันว่า Button sm ใช้ text-2xs จำนวน 14 จุดตามที่ haiku นับ ผมไม่ได้นับเอง |
| F-37 | ต่ำ | ใช้ font-mono กับ id/รหัส | `ui/referral-batch-cards.svelte:492` | ยืนยัน | ยืนยัน 1 จุด จำนวน 10 จุดเป็นของ haiku |
| F-38 | ต่ำ | {#each} ใช้ index เป็น key | `ui/referral-list.svelte:270` | ยังไม่ตรวจ |  |
| F-39 | ต่ำ | ใช้ $effect รีเซ็ต currentPage | `ui/referral-list.svelte:63-67` | ยืนยัน | ควรรีเซ็ตใน handler |
| F-40 | ต่ำ | shadow-md บน card | `ui/referral-detail.svelte:107` | ยังไม่ตรวจ |  |
| F-41 | ต่ำ | $derived คืนค่าเป็นฟังก์ชัน | `ui/shelter-combobox.svelte:44-52` | ยังไม่ตรวจ |  |
| F-42 | ต่ำ | evacuee-search-input.svelte ไม่มีใครใช้ | `ui/evacuee-search-input.svelte` | แก้ไข | ยืนยันว่าไม่มี import คำอธิบายของ haiku ว่าเป็น server search ผมไม่ได้เปิดไฟล์ตรวจ จึงไม่ใช้เป็นหลักฐาน |
| F-47 | ต่ำ | โหลดและเรียงรายการ shelter ฝั่ง client | `ui/shelter-combobox.svelte:28-35` | ยังไม่ตรวจ | จำนวนน้อย ผลกระทบต่ำ |

## ยังไม่ได้ตรวจหรือยืนยัน

- **F-11:** ต้องรัน `_explain` กับ CouchDB จริง ตอนนี้เป็นการอนุมาน
- **F-51:** กลไกในโค้ดยืนยันแล้ว แต่พฤติกรรมของ superforms บนเบราว์เซอร์ยังไม่ได้ลอง
- **F-46:** ขึ้นกับ padding ของ protected layout ที่ยังไม่ได้เปิดดู
- ไม่มีการวัดเวลาจริงของการสร้างและ transition แบบ bulk

## การตัดสินใจของ owner (2026-10-14)

| หัวข้อ | การตัดสินใจ |
| --- | --- |
| ปริมาณ | peak ต่อ shelter ระดับหลายพันขึ้นไป ต้องมี paging และ search ฝั่ง server |
| ขาออก/ขาเข้า | แยกเป็นสอง tab เพื่อให้แต่ละ query ใช้ index เดียวและตัด `$or` |
| batch กับ paging | จัดกลุ่มชุดส่งต่อบนรายการที่โหลดสะสมอยู่ ยังไม่เก็บ `batch_id` |
| confirm | dialog ที่บอกจำนวนและชื่อ ก่อน: ปิด/ปิดทั้งหมด, ยกเลิกร่างทั้งหมด, ส่งทั้งหมดและสร้างแบบส่งทันที, ตอบรับ/ปฏิเสธทั้งหมด |
| ขอบเขต bulk | เลือกได้เฉพาะสถานะเดียวกันใน tab เดียวกัน ไม่จำกัดจำนวนต่อครั้ง |
| สัญญา bulk | สำเร็จบางส่วนพร้อมผลรายตัว ใช้เหตุผลเดียวกันทุกรายการ |
| "เลือกทั้งหมด" | หมายถึงแถวที่โหลดอยู่เท่านั้น การปิด referral ทั้งศูนย์แยกเป็น flow ของตัวเอง |
| mobile | card ต่อคนต่ำกว่า `md` และปุ่ม 44px |
| ค้นหาผู้ประสบภัย | ใช้ flow เดียวกับ people: ชื่อ, สกุล, เบอร์เต็มหรือเลขต้น และสแกน QR (ไม่รองรับชื่อกลางและเลขท้าย) |
| ขาเข้า/ขาออกตอนปิดศูนย์ | ขาเข้า `sent` ปฏิเสธอัตโนมัติด้วยเหตุผล "ศูนย์ปิด" ขาออกปิดได้ทุกสถานะโดยเพิ่ม `sent → closed` ขาเข้าที่ตอบแล้วไม่แตะ |
| เหตุผลปิด | เพิ่ม field `close_reason` (schema_v 1→2) แยกจาก `response_reason` |
| flow ปิดศูนย์ | durable job + service `referral-worker` (Node, image เดียวกับ frontend) job doc เดียว + cursor ไม่ใช้ sync worker ของ Python และไม่เพิ่ม Redis |
| ความเสี่ยงของ job | ยืนยันด้วย search-select (ชื่อหรือรหัสศูนย์) และหน่วง 60 วินาทีก่อนเริ่ม ยกเลิกได้เฉพาะช่วงนั้น ขณะ job active ศูนย์นั้นสร้าง referral ใหม่ไม่ได้ |
| สิทธิ์ | ใช้ชุดเดิมของ referral: `shelter_manager` ของศูนย์ตัวเอง และ `system_admin` |
| การติดตาม | CR ไฟล์ใน `docs/changes/` ระดับเต็ม แยกสองฉบับ (volatile + stable) ใช้ GitHub issue และ board ติดตามงาน ไม่เพิ่ม T-id ใน WBS |

## เอกสารที่เกี่ยวข้อง

- [CR-167](../changes/09-F-referral/CR-167-referral-withdraw-close-reason-bulk.md) (volatile): ถอนคำขอ `sent → closed`, `close_reason`, bulk endpoint
- [CR-168](../changes/09-F-referral/CR-168-referral-shelter-closure-worker.md) (stable): flow ปิดศูนย์ด้วย worker job ต้อง implement หลัง CR-167
- `docs/data/schema.md` §5.4 · `docs/data/api-contract.md` §2.4 · `docs/task-breakdown/09-F-referral.md` T-34
- ธรรมเนียมการทำงานของหน้านี้: `frontend/CONTRIBUTING.md`, `frontend/CONVENTIONS.md`, skill `civic-design-system`
