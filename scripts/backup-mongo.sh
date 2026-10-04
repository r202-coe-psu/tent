#!/bin/bash
set -e

# กำหนดชื่อไฟล์ Backup พร้อม Timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="mongo_backup_${TIMESTAMP}.archive.gz"
BACKUP_DIR="backups"

# สร้างแฟ้ม backups หากยังไม่มี
mkdir -p "$BACKUP_DIR"

echo "⏳ กำลังเริ่มทำการ Backup Database จาก Container..."

# รับชื่อ Container ผ่าน Argument หากไม่ระบุให้ใช้ 'tent-mongodb' เป็นค่า Default
CONTAINER_NAME=${1:-tent-mongodb}

if ! docker ps | grep -q "$CONTAINER_NAME"; then
    echo "❌ ไม่พบ Container ชื่อ '$CONTAINER_NAME' ที่กำลังทำงานอยู่"
    echo "💡 การใช้งาน: $0 [CONTAINER_NAME]"
    echo "   ตัวอย่าง (Local): $0"
    echo "   ตัวอย่าง (Staging): $0 tent-mongodb-staging"
    echo "   ตัวอย่าง (Production): $0 tent-mongodb-production"
    exit 1
fi

echo "📦 ชื่อ Container: $CONTAINER_NAME"
echo "📂 ไฟล์จะถูกบันทึกที่: ${BACKUP_DIR}/${BACKUP_FILE}"

# ใช้ docker exec เข้าไปรัน mongodump แล้วดึง Output ออกมาเขียนเป็นไฟล์บนเครื่อง Host
docker exec "$CONTAINER_NAME" mongodump \
    --uri="mongodb://localhost:27017/tentdb" \
    --archive --gzip > "${BACKUP_DIR}/${BACKUP_FILE}"

echo "✅ ทำการ Backup เสร็จสมบูรณ์!"
ls -lh "${BACKUP_DIR}/${BACKUP_FILE}"
