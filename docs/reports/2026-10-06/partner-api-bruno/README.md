# Smart Shelter Partner Data API — Bruno

คู่มือยิง API สำหรับพันธมิตร M2 / M6 / M7 เปิดโฟลเดอร์นี้ใน [Bruno](https://www.usebruno.com/) (Open Collection) สัญญาอยู่ที่ `../partner-api-as-built.md` (เวอร์ชัน 2.1)

## เริ่มใช้

1. ติดตั้ง Bruno แล้วเลือก **Open Collection** ชี้มาที่โฟลเดอร์นี้
2. มุมขวาบนเลือก environment **Staging** หรือ **Production**
3. เปิด environment แล้วกรอก `client_id` กับ `client_secret` ที่ทีม Shelter ออกให้ ค่า secret อยู่บนเครื่องผู้ใช้ ไม่ถูกเก็บในไฟล์นี้
4. ยิง **EXT-001 Get token** สคริปต์เก็บ `access_token` ให้อัตโนมัติ (อายุประมาณ 3600 วินาที ไม่มี refresh token — หมดอายุแล้วยิง EXT-001 ใหม่)
5. ยิง endpoint อื่นได้เลย header `Authorization: Bearer` ถูกใส่จากคอลเลกชัน

## ใครยิงโฟลเดอร์ไหน

| โฟลเดอร์ | ใครใช้ | Scope |
| --- | --- | --- |
| `01-auth` | ทุกโมดูล | ไม่ใช้ Bearer |
| `02-locations` | M2, M6, M7 | `location-read` |
| `03-operations` | M6, M7 | `location-stock-read`, `occupancy-read`, `location-read` |
| `04-occupants` | M7 เมื่อได้รับอนุมัติ | `occupancy-pii-read` |
| `05-bookings` | M2 เมื่อได้รับอนุมัติ | `booking-write` |
| `06-residency` | M2 เมื่อได้รับอนุมัติ | `residency-read` |

พารามิเตอร์ที่มี `~` นำหน้าถูกปิดไว้ เปิดในแท็บ Params เมื่อต้องการกรอง

## ลำดับฝั่ง M2

1. EXT-002 หา `location_code` แล้วนำไปใส่ตัวแปร environment
2. EXT-008 จอง สคริปต์เก็บ `booking_id` — **201 คือรับเข้าคิว** ไม่ใช่ check-in และเป็นการเขียนข้อมูลจริง
3. รอประมาณ 10 วินาที แล้วยิง EXT-010 เพื่อดู `booking_status`
4. ยกเลิกก่อนผู้จองไปถึงศูนย์ด้วย EXT-009
5. EXT-011 ใช้หลังเจ้าหน้าที่ check-in แล้ว ก่อนหน้านั้นได้ 404 `residency_not_found`

ค่า `cid`, ชื่อ และเบอร์ใน environment เป็นตัวอย่างจากเอกสาร as-built เปลี่ยนเป็นข้อมูลจริงก่อนยิง EXT-008 บน Staging หรือ Production

## สิ่งที่ไฟล์นี้ไม่ใส่มา

- `client_id` / `client_secret` — ขอจากทีม Shelter
- ข้อมูลผู้พักจริง
