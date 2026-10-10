# 🔌 SSH Reverse Tunnel: ให้ kiosk เปิด dev server ของเครื่อง local ผ่าน `localhost`

เอกสารนี้อธิบายวิธีให้ตู้ kiosk (`scanner_client`) เปิดหน้า `/kiosk` จาก **dev server บนเครื่องนักพัฒนา** โดยใช้ SSH reverse tunnel ใช้ตอนพัฒนา/ทดสอบเท่านั้น (production ใช้ HTTPS ตามหัวข้อ [ใช้กับ staging / production](#-ใช้กับ-staging--production))

---

## 📋 สารบัญ

1. [ทำไมต้องใช้ tunnel](#-ทำไมต้องใช้-tunnel)
2. [ภาพรวม](#-ภาพรวม)
3. [สิ่งที่ต้องมีก่อน](#-สิ่งที่ต้องมีก่อน)
4. [Setup ครั้งแรก](#-setup-ครั้งแรก)
5. [ใช้งานทุกครั้ง](#-ใช้งานทุกครั้ง)
6. [ตรวจว่าใช้ได้แล้ว](#-ตรวจว่าใช้ได้แล้ว)
7. [หลายคนใช้ร่วมกัน](#-หลายคนใช้ร่วมกัน)
8. [ให้ tunnel ขึ้นเอง (ไม่บังคับ)](#-ให้-tunnel-ขึ้นเอง-ไม่บังคับ)
9. [ใช้กับ staging / production](#-ใช้กับ-staging--production)
10. [Troubleshooting](#-troubleshooting)
11. [ความปลอดภัย](#-ความปลอดภัย)

---

## ❓ ทำไมต้องใช้ tunnel

หน้า kiosk ที่ใช้กล้อง (สแกนใบหน้า / `getUserMedia`) ต้องรันใน **secure context** Chromium นับเฉพาะ `https://…` และ `http://localhost` เท่านั้น ถ้าตั้ง `TENT_BASE_URL=http://192.168.x.x:5173` (HTTP ธรรมดาบน IP) หน้าสแกนจะใช้กล้องไม่ได้

tunnel ทำให้ Chromium บน kiosk เห็น URL เป็น `http://localhost:8080` (secure context) แต่ request จริงถูกส่งไปที่ dev server ของเครื่อง local นอกจากนี้ข้อมูลระหว่างสองเครื่องถูกเข้ารหัสโดย SSH (รวมถึง `DEVICE_SECRET`)

โค้ดฝั่ง client รองรับอยู่แล้ว: `app/config.py` ยอมรับ `localhost` ให้ใช้ HTTP ได้โดยไม่ต้องตั้ง `ALLOW_INSECURE_HTTP` และ `manager.py` ให้สิทธิ์กล้องกับ origin ที่ได้จาก `TENT_BASE_URL` เอง

## 🗺️ ภาพรวม

```
เครื่อง local (นักพัฒนา)                          kiosk
┌──────────────────────────┐                ┌──────────────────────────┐
│ pnpm dev  → :5173        │◀═══ ssh -R ════│ localhost:8080           │
│ (Tent dev server)        │   (ต่อออกจาก    │   ▲                      │
└──────────────────────────┘    เครื่อง local)│   └─ Chromium --kiosk    │
                                              │      TENT_BASE_URL=      │
                                              │      http://localhost:8080│
                                              └──────────────────────────┘
```

- ใช้ **`-R` (reverse)** ไม่ใช่ `-L` เพราะเครื่อง local มักอยู่หลัง NAT/Wi-Fi ที่ kiosk ต่อเข้ามาตรงๆ ไม่ได้ เครื่อง local จึงต้องเป็นฝ่ายต่อออกไปหา kiosk
- port `8080` เปิดบน **kiosk** (ฝั่งที่เป็น SSH server) และ bind ที่ `127.0.0.1` เท่านั้น เครื่องอื่นในวงเครือข่ายเข้า port นี้ไม่ได้
- port `5173` คือ dev server บน **เครื่อง local**

## ✅ สิ่งที่ต้องมีก่อน

| ฝั่ง | ต้องมี |
| --- | --- |
| kiosk | เปิดเครื่องและต่อเครือข่ายเดียวกับเครื่อง local, `openssh-server` รันอยู่, `scanner_client/.env` ที่มี `DEVICE_ID` / `DEVICE_SECRET` แล้ว |
| เครื่อง local | `ssh` (Linux / macOS / Windows OpenSSH), repo `tent` + `pnpm`, เข้าถึง IP ของ kiosk ได้ (`ping <kiosk-ip>`) |

> ในเอกสารนี้ `<kiosk-ip>` คือ IP ของ kiosk (หาได้จาก `hostname -I` บน kiosk) ให้แทนด้วยเลขจริงโดยไม่ต้องใส่ `<>` — ใน shell `<` `>` มีความหมายเป็น redirect IP เป็น DHCP อาจเปลี่ยนได้ ถ้าต่อไม่ติดให้เช็กอีกครั้ง

## 🛠️ Setup ครั้งแรก

### A. เครื่อง kiosk

**A1. เปิด sshd**
```bash
sudo apt install -y openssh-server
sudo systemctl enable --now ssh
hostname -I                      # จด IP
```

**A2. ตั้ง `scanner_client/.env`**
```
TENT_BASE_URL=http://localhost:8080
DEVICE_ID=<จาก System Management>
DEVICE_SECRET=<จาก System Management>
```
```bash
chmod 600 .env
```
เลข port ใน `TENT_BASE_URL` ต้องตรงกับเลขหน้า `-R` ในขั้นตอนเปิด tunnel แก้ `.env` แล้วต้อง restart kiosk

### B. เครื่อง local

**B1. สร้าง key** (บนเครื่อง local ไม่ใช่บน kiosk)
```bash
ssh-keygen -t ed25519 -f ~/.ssh/tent_tunnel -N ""
```

**B2. ส่ง public key ไปที่ kiosk** (ใส่รหัสผ่านของ user `kiosk` ครั้งเดียว)
```bash
ssh-copy-id -i ~/.ssh/tent_tunnel.pub kiosk@<kiosk-ip>
```
ถ้าเครื่องไม่มี `ssh-copy-id` (เช่น macOS) ให้ใช้:
```bash
cat ~/.ssh/tent_tunnel.pub | ssh kiosk@<kiosk-ip> 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys'
```

**B3. ทดสอบเข้าโดยไม่ถามรหัส**
```bash
ssh -i ~/.ssh/tent_tunnel kiosk@<kiosk-ip> true
```
ครั้งแรกจะถามเรื่อง host key ให้ตอบ `yes` คำสั่งต้องกลับมาเงียบๆ

**B4. (แนะนำ) จำกัด key ให้ทำได้แค่ tunnel** — ดู [ความปลอดภัย](#-ความปลอดภัย)

## ▶️ ใช้งานทุกครั้ง

### 1. เครื่อง local — เปิด dev server (terminal ที่ 1)
```bash
cd ~/tent/frontend
pnpm dev                          # port 5173
```
ถ้าต้องใช้ login / API เต็มระบบ ให้เปิด stack ตาม `CLAUDE.md` ด้วย: `docker compose up -d` และ `cd backend && ./scripts/run-dev`

### 2. เครื่อง local — เปิด tunnel (terminal ที่ 2 ค้างไว้)
```bash
ssh -N -i ~/.ssh/tent_tunnel \
    -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -R 127.0.0.1:8080:127.0.0.1:5173 \
    kiosk@<kiosk-ip>
```

| ส่วนของคำสั่ง | ความหมาย |
| --- | --- |
| `-N` | ไม่เปิด shell ใช้ทำ tunnel อย่างเดียว |
| `-R 127.0.0.1:8080:127.0.0.1:5173` | **port บน kiosk** `:8080` → ส่งกลับมาที่ **port บนเครื่อง local** `:5173` |
| `ExitOnForwardFailure=yes` | ถ้าเปิด port 8080 บน kiosk ไม่ได้ให้ออกทันที (ไม่ค้างเงียบๆ) |
| `ServerAliveInterval=15` / `CountMax=3` | ตรวจว่าท่อยังอยู่ ถ้าตาย ~45 วินาทีจะออก |
| `kiosk@<kiosk-ip>` | **เครื่องที่ ssh ไปหา คือ kiosk** (ไม่ใช่เครื่อง local) |

ค้างคำสั่งนี้ไว้ตลอดที่ kiosk ใช้งาน ปิดหรือเน็ตหลุดเมื่อไหร่ tunnel ก็ตาย แนะนำให้รัน 2 terminal นี้ใน `tmux` (`tmux new -s kiosk`) จะไม่ตายตอนปิดหน้าต่าง ถ้า laptop suspend หรือเปลี่ยน Wi-Fi ต้องรัน tunnel ใหม่

### 3. kiosk — เปิดหรือ restart kiosk
```bash
cd ~/tent/scanner_client
DEBUG=true ./start_kiosk.sh       # หน้าต่างปกติ (ทดสอบ)
./start_kiosk.sh                  # โหมด --kiosk เต็มจอ
```
ถ้ารันผ่าน SSH ต้องตั้ง `DISPLAY=:0` นำหน้า (ต้องมี session ที่ login อยู่บนจอ kiosk)

## 🔍 ตรวจว่าใช้ได้แล้ว

**ฝั่งเครื่อง local**
```bash
curl -sI http://localhost:5173/kiosk | head -1     # dev server ขึ้นไหม → HTTP/1.1 200 OK
```
เปิด tunnel ด้วย `-v` ครั้งแรก ต้องเห็นบรรทัดนี้:
```
remote forward success for: listen 127.0.0.1:8080, connect 127.0.0.1:5173
```

**ฝั่ง kiosk**
```bash
ss -ltn | grep 8080                                # ต้องเห็น 127.0.0.1:8080 LISTEN
curl -sI http://localhost:8080/kiosk | head -1     # ต้องได้ HTTP/1.1 200 OK
tail -f /tmp/kiosk_autostart.log                   # log ของ kiosk
./smoke_face_permissions.py --headed --live        # สิทธิ์กล้อง ต้องได้ granted
```
`curl` บน kiosk ได้ `200` คือท่อต่อครบ เพราะ response มาจาก dev server ของเครื่อง local

## 👥 หลายคนใช้ร่วมกัน

- port `8080` บน kiosk ถูก listen ได้ **ทีละ tunnel** คนที่สองที่เปิด `-R …:8080` จะเจอ `remote port forwarding failed for listen port 8080`
- ถ้าอยากเปิดค้างพร้อมกัน ให้แต่ละคนใช้เลขคนละตัวหน้า `-R` และใช้ key ของตัวเอง:

  | คน | คำสั่ง |
  | --- | --- |
  | A | `-R 127.0.0.1:8080:127.0.0.1:5173` |
  | B | `-R 127.0.0.1:8081:127.0.0.1:5173` |

  เลข `5173` ท้ายสุดใช้ซ้ำได้ เพราะอยู่คนละเครื่อง
- แต่ kiosk ใช้ได้ **ทีละที่เดียว** (`TENT_BASE_URL` ชี้ได้ที่เดียว) ถ้าสลับไปใช้ของ B ต้องแก้ `.env` เป็น `http://localhost:8081` แล้ว restart kiosk สิทธิ์กล้องผูกกับ origin ตาม URL นี้อัตโนมัติ
- ถ้าจำกัด key ด้วย `permitlisten` ต้องกำหนดเลขให้ตรงกับของแต่ละคน
- ดูว่าใครถือ port อยู่ (บน kiosk): `ss -ltn | grep 80` และ `sudo journalctl -u ssh -n 20 --no-pager | grep -i accepted`
- ถ้าต้องการให้ทุกคนใช้พร้อมกันโดยไม่ต้องสลับ ให้ใช้ staging HTTPS แทน

## ♻️ ให้ tunnel ขึ้นเอง (ไม่บังคับ)

tunnel ที่รันมือหลุดเมื่อเน็ตตกหรือเครื่อง suspend ถ้าอยากให้ต่อใหม่เอง ติดตั้ง `autossh` บนเครื่อง local (`sudo apt install autossh` / `brew install autossh`) แล้วรัน:
```bash
autossh -M 0 -N -i ~/.ssh/tent_tunnel \
    -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -R 127.0.0.1:8080:127.0.0.1:5173 \
    kiosk@<kiosk-ip>
```
`autossh` ช่วยแค่ต่อใหม่เมื่อหลุด ไม่ได้ช่วยตอนเครื่อง local ปิด ใช้ได้ตราบที่เครื่อง local เปิดอยู่และ `pnpm dev` ยังรัน

> ⚠️ **ห้ามสร้าง systemd service บน kiosk ที่ใช้ `-L` ชี้กลับไปหาเครื่อง local** วิธีนั้นใช้ได้เมื่อเครื่อง local มี IP ที่ kiosk ต่อถึงเท่านั้น (ไม่อยู่หลัง NAT) และ IP ที่เปลี่ยนจะทำให้ tunnel หลุดเงียบๆ นอกจากนี้ service จะแย่ง port `8080` กับ reverse tunnel ของคนอื่น หากเคยสร้างไว้ให้ปิด: `sudo systemctl disable --now tent-tunnel`

## 🌐 ใช้กับ staging / production

ถ้า server เป็น HTTPS ที่มี certificate ถูกต้อง **ไม่ต้องใช้ tunnel** เพราะ `https://` เป็น secure context อยู่แล้ว
```
TENT_BASE_URL=https://<staging-host>
```
- `DEVICE_ID` / `DEVICE_SECRET` ต้องเป็นค่าที่สร้างจาก System Management ของ server นั้น (device ผูกกับ server แต่ละตัว)
- certificate ต้องออกโดย CA ที่ kiosk เชื่อถือ ชื่อตรงกับ host และไม่หมดอายุ (client ไม่ข้าม TLS error) และเวลาเครื่อง kiosk ต้องตรง
- ปิด tunnel เดิม แล้ว restart kiosk

## 🧰 Troubleshooting

| อาการ | สาเหตุ / วิธีแก้ |
| --- | --- |
| `bash: ...: No such file or directory` ตอนใส่ `<user>@<ip>` | ใส่ `<>` มาด้วย shell อ่านเป็น redirect ให้แทนด้วยค่าจริง |
| `Connection timed out` / `No route to host` | IP kiosk เปลี่ยน อยู่คนละวงเครือข่าย หรือ kiosk ปิดอยู่ เช็ก `ping` และ `hostname -I` บน kiosk |
| `Connection refused` | sshd บน kiosk ไม่ได้รัน: `sudo systemctl enable --now ssh` |
| `Permission denied (publickey)` | key ยังไม่อยู่ใน `~/.ssh/authorized_keys` ของ kiosk หรือสิทธิ์ไฟล์ผิด (`chmod 600 ~/.ssh/tent_tunnel`) |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | host key ของ kiosk เปลี่ยน (ลง OS ใหม่ / IP ไปตกที่เครื่องอื่น) ถ้ามั่นใจว่าเครื่องเดิม: `ssh-keygen -R <kiosk-ip>` |
| `remote port forwarding failed for listen port 8080` | port 8080 บน kiosk มี tunnel/process อื่นถืออยู่ ดู `ss -ltnp \| grep 8080` ปิดตัวเก่า หรือใช้เลขอื่น (แก้ `.env` ให้ตรงด้วย) |
| `curl` บน kiosk ได้ `Empty reply` / `502` | tunnel ต่อแล้ว แต่ `pnpm dev` บนเครื่อง local ไม่ได้รัน หรือไม่ใช่ port 5173 |
| หน้า kiosk ไม่โหลด / กล้องไม่ขึ้น | `TENT_BASE_URL` ไม่ใช่ `http://localhost:<port>` หรือเลข port ไม่ตรงกับหน้า `-R` แก้ `.env` แล้วลืม restart kiosk |
| `ssh -v` ค้างไม่มีบรรทัด `remote forward success` | key ถูกจำกัดด้วย `permitlisten` ที่ไม่ตรงเลข port ดูบรรทัด `key options:` ใน log |
| smoke test ขึ้น `Missing X server or $DISPLAY` | รันผ่าน SSH ไม่มี display: ใส่ `DISPLAY=:0` นำหน้า หรือรันบนจอ kiosk หรือตัด `--headed` |

## 🔒 ความปลอดภัย

- shell บน kiosk อ่าน `scanner_client/.env` ได้ ซึ่งมี `DEVICE_SECRET` และคุมเครื่องพิมพ์/กล้องได้ ผู้ที่ไม่จำเป็นต้องมี shell ควรได้ key ที่ทำ tunnel ได้อย่างเดียว ใน `~/.ssh/authorized_keys` บน kiosk ใส่ option นำหน้าบรรทัด key:
  ```
  restrict,port-forwarding,permitlisten="127.0.0.1:8080" ssh-ed25519 AAAA... ชื่อ@เครื่อง
  ```
  - `restrict` ปิด shell / pty / agent / X11 forwarding ทั้งหมด
  - `permitlisten` อนุญาตให้เปิดได้เฉพาะ port ที่ระบุบน loopback ของ kiosk
  - หลังตั้งแล้ว ssh ต้องรันด้วย `-N` และ log ของ `ssh -v` ต้องแสดง `key options: port-forwarding` เท่านั้น
- ตรวจว่า key ไหนอยู่ใน `authorized_keys` และมี option อะไร: `cat ~/.ssh/authorized_keys` บน kiosk ลบ key ของคนที่เลิกใช้
- `-R 127.0.0.1:…` (ระบุ `127.0.0.1` ชัดเจน) ทำให้ port เปิดเฉพาะ loopback ของ kiosk อย่าใช้ `-R 0.0.0.0:…` หรือเปิด `GatewayPorts` เพราะจะเปิด dev server ให้เครื่องอื่นเข้าได้
- อย่าเก็บ private key (`~/.ssh/tent_tunnel`) ใน repo หรือแชร์ให้คนอื่น ให้แต่ละคนสร้าง key ของตัวเองแล้วส่งเฉพาะ `.pub`
- tunnel นี้สำหรับ dev/test เท่านั้น อย่าใช้เป็นช่องทางเชื่อมตู้ production กับเครื่องส่วนตัว
