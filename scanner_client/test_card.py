"""
สคริปต์สำหรับทดสอบอ่านข้อมูลบัตรประชาชนไทยผ่าน Terminal (CLI Test Inspector)
"""
import sys
import time
from pprint import pprint

from app.scard import ThaiSmartCardReader


def test_reader():
    print("=" * 60)
    print("🔌 เริ่มต้นทดสอบเครื่องอ่านบัตรประชาชนไทย (Thai Smart Card Reader)")
    print("=" * 60)

    try:
        reader = ThaiSmartCardReader()
    except Exception as e:
        print(f"❌ ไม่พบเครื่องอ่านบัตร หรือเกิดข้อผิดพลาด: {e}")
        print("คำแนะนำ: ตรวจสอบการเสียบสาย USB และการติดตั้ง pcscd (sudo systemctl start pcscd)")
        sys.exit(1)

    print("🟢 เชื่อมต่อเครื่องอ่านบัตรสำเร็จ")
    print("👉 กรุณาเสียบบัตรประชาชนเพื่อเริ่มอ่านข้อมูล (กด Ctrl+C เพื่อยกเลิก)...")

    while True:
        try:
            if reader.is_card_inserted():
                print("\n💳 ตรวจพบบัตรประชาชน! กำลังอ่านข้อมูล...")
                t0 = time.time()
                data = reader.read_all_data()
                duration = time.time() - t0

                photo_data = data.pop("photo_base64", None)
                print("\n--- ผลลัพธ์ข้อมูลบัตรประชาชน (ใช้เวลา {:.2f}s) ---".format(duration))
                pprint(data)

                if photo_data:
                    print(f"\n🖼️  รูปถ่ายหน้าบัตร: พบข้อมูล Base64 (ความยาว {len(photo_data)} ตัวอักษร)")
                else:
                    print("\n⚠️  ไม่พบรูปถ่ายหน้าบัตร")

                print("\n✅ อ่านข้อมูลสำเร็จ! กรุณาถอดบัตรออก...")
                while reader.is_card_inserted():
                    time.sleep(0.5)
                print("\n👉 ถอดบัตรเรียบร้อย พร้อมรับบัตรใบถัดไป...\n")

            time.sleep(0.5)
        except KeyboardInterrupt:
            print("\nจบการทดสอบ.")
            break
        except Exception as e:
            print(f"❌ เกิดข้อผิดพลาดขณะอ่านบัตร: {e}")
            time.sleep(1)


if __name__ == "__main__":
    test_reader()
