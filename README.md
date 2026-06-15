# Smart Shelter — ศูนย์พักพิงอัจฉริยะ

> Working title ในโค้ด: **"CouchDB Lab"** (`tent`)

แพลตฟอร์มบริหารจัดการศูนย์พักพิงผู้ประสบภัยน้ำท่วม พัฒนาภายใต้โครงการวิจัย
**"การพัฒนารูปแบบศูนย์พักพิงอัจฉริยะ (Smart Shelter) อย่างมีส่วนร่วม เพื่อรองรับภัยพิบัติน้ำท่วม
ในพื้นที่เทศบาลนครหาดใหญ่ จังหวัดสงขลา"** (Participatory Development of a Smart Shelter Model
to Support Flood Disaster Relief in Hat Yai Municipality, Songkhla Province) โดยมหาวิทยาลัย
สงขลานครินทร์ ภายใต้กรอบแผนงาน "น้ำมั่นคง ไม่ท่วม ไม่แล้ง" (ววน.)

## ที่มา

อุทกภัยหาดใหญ่ปี 2568 (19–29 พ.ย.) เผยช่องว่างสำคัญของการจัดการศูนย์พักพิง — ระบบลงทะเบียน
และบริหารฐานข้อมูลแบบกระดาษ (paper-based) ทำให้ลงทะเบียนช้า (15–30 นาที/ครอบครัว) ติดตามยอด
ผู้พักพิงไม่ได้แบบ real-time จัดสรรทรัพยากร (อาหาร น้ำ เวชภัณฑ์) ไม่แม่นยำ และดูแลกลุ่มเปราะบาง
ได้ยาก โครงการมุ่งแก้เฉพาะ **"ระบบจัดการภายในศูนย์พักพิง"** (ไม่รวมระบบเตือนภัยก่อนน้ำท่วม
หรือการฟื้นฟูหลังภัย)

## ขอบเขตของโครงการวิจัย

วัตถุประสงค์ 3 ประการ:

1. ศึกษา/วิเคราะห์สภาพปัญหาและศักยภาพศูนย์พักพิงที่มีอยู่ในพื้นที่หาดใหญ่
2. พัฒนารูปแบบศูนย์พักพิงที่เหมาะกับบริบทใน 3 ระดับ — ชุมชน, อปท., เมือง
3. พัฒนาแพลตฟอร์มบริหารจัดการศูนย์พักพิงตามบริบทพื้นที่ทั้ง 3 ระดับ

**repo นี้คือผลผลิตข้อที่ (3)** — ตัวแพลตฟอร์ม ส่วนผลผลิตอื่น (รายงานสถานการณ์ + แผนที่ความเสี่ยง
GIS, Model 3 ระดับ, SOP, ข้อเสนอเชิงนโยบาย) อยู่นอก codebase นี้

## "อัจฉริยะ" หมายถึงอะไร

ตามข้อเสนอ ความ Smart ครอบคลุม 4 มิติ:

| มิติ | ใจความ |
| --- | --- |
| 1. Local Participation | ออกแบบร่วม (co-design) กับ อปท./ชุมชน/อาสาสมัคร — SOP สะท้อนบริบทจริง |
| 2. Real-time Registration | ลงทะเบียนดิจิทัลเหลือ 2–3 นาที/ครอบครัว (QR / ThaID / เจ้าหน้าที่), ญาติค้นหาผู้ประสบภัยออนไลน์ได้ |
| 3. Resource Planning | คำนวณ/แจ้งเตือนปริมาณอาหาร–น้ำ–เวชภัณฑ์–อาสาสมัครต่อวัน อิงยอดผู้พักพิง real-time + มาตรฐาน Sphere (2018) |
| 4. Strategic Dashboard | สรุปข้อมูลเชิงกลยุทธ์ ส่งต่อ One Data / EOC ระดับอำเภอ–จังหวัด |

## สถานะปัจจุบันของ codebase

ระยะเริ่มต้น — เป็น demo/prototype ของแพลตฟอร์มจัดการศูนย์พักพิง สร้างจาก template
[sveltekitten](#) (SvelteKit SPA) ตอนนี้มีโดเมน Smart Shelter เริ่มเป็นรูปเป็นร่างแล้วใน
[frontend/src/lib/features/shelter/](frontend/src/lib/features/shelter/)

สิ่งที่มีในโค้ดตอนนี้:

- **โดเมนศูนย์พักพิง** — config (ชื่อ + capacity), occupant (เช็คอิน/เช็คเอาท์), inventory item,
  และ stock transaction แบบ event-sourced (ยอดคงเหลือ = ผลรวม delta ของ txn เพื่อให้ merge
  การแก้ไขแบบ offline ได้โดยไม่ชน) — ดู [shelter.ts](frontend/src/lib/features/shelter/domain/shelter.ts)
- **3 ศูนย์ตัวอย่าง** (A / B / C) แต่ละศูนย์เป็น CouchDB database แยกกัน (`shelter_a`/`_b`/`_c`)
- **Role-based access** — `shelter_<id>_manager` / `shelter_<id>_volunteer` map กับ CouchDB roles
- **UI** — inventory panel, intake form, capacity card, occupant list + หน้า admin (shelter/users/demo)
- **Offline-first** — sync ผ่าน PouchDB ↔ CouchDB

> หมายเหตุ: README นี้เน้นภาพรวม ยังไม่ลงรายละเอียดสถาปัตยกรรม — ดู [CLAUDE.md](CLAUDE.md)
> และ [frontend/AGENTS.md](frontend/AGENTS.md) สำหรับ convention การพัฒนา

## Tech stack (ย่อ)

- **Frontend**: SvelteKit 2 + Svelte 5 (runes) + TypeScript, Tailwind CSS v4, shadcn-svelte
- **Data**: client-side ล้วน — TanStack Query, PouchDB (offline) sync กับ CouchDB 3.5
- **Backend**: CouchDB 3.5 ตรงจาก browser (cookie session auth ผ่าน dev proxy `/couch`)
- **Deploy**: SPA/PWA เสิร์ฟด้วย Node server (`adapter-node`, `ssr = false`) — Node รัน `/api/*` server endpoints ด้วย

## เริ่มต้นใช้งาน

```bash
# 1. ยก CouchDB ขึ้น (ต้องมี .env — copy จาก .env.example)
cp .env.example .env
docker compose up -d

# 2. frontend (ใช้ pnpm)
cd frontend
pnpm install
pnpm dev          # http://localhost:5173
```

คำสั่งที่ใช้บ่อย (รันใน `frontend/`):

- `pnpm dev` — Vite dev server
- `pnpm check` — type-check (รันก่อนปิดงานทุกครั้ง)
- `pnpm test` — unit tests (Vitest)
- `pnpm test:e2e` — Playwright e2e

## แหล่งอ้างอิง

- ข้อเสนอโครงการฉบับสมบูรณ์: [docs/source/psu-smart-shelter-f-20260522.txt](docs/source/psu-smart-shelter-f-20260522.txt)
- เอกสารสถาปัตยกรรม (เบื้องต้น): [docs/architecture.html](docs/architecture.html)

---

*โครงสร้าง repo ยังเปลี่ยนได้ — เอกสารนี้จะ update ตามความคืบหน้า*
