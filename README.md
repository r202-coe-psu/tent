# Smart Shelter — ศูนย์พักพิงอัจฉริยะ

> Working title ในโค้ด: **"Tent"** (`tent`)

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

| มิติ                      | ใจความ                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1. Local Participation    | ออกแบบร่วม (co-design) กับ อปท./ชุมชน/อาสาสมัคร — SOP สะท้อนบริบทจริง                                     |
| 2. Real-time Registration | ลงทะเบียนดิจิทัลเหลือ 2–3 นาที/ครอบครัว (QR / ThaID / เจ้าหน้าที่), ญาติค้นหาผู้ประสบภัยออนไลน์ได้        |
| 3. Resource Planning      | คำนวณ/แจ้งเตือนปริมาณอาหาร–น้ำ–เวชภัณฑ์–อาสาสมัครต่อวัน อิงยอดผู้พักพิง real-time + มาตรฐาน Sphere (2018) |
| 4. Strategic Dashboard    | สรุปข้อมูลเชิงกลยุทธ์ ส่งต่อ One Data / EOC ระดับอำเภอ–จังหวัด                                            |

## สถานะปัจจุบันของ codebase

ระยะ prototype — domain และ data layer ของ Smart Shelter เริ่มเป็นรูปเป็นร่างใน
`frontend/src/lib/features/` (people, operations, users, …) บน architecture ดังนี้:

**Topology (central-first + LAN fallback):**

```
device (PouchDB) ⇄ WAN ⇄ central (CouchDB 3.5)
      │                        │ edge fallback replica
      └──── LAN (fallback) ⇄ edge (CouchDB @ศูนย์)
```

App เขียน local PouchDB ก่อนเสมอ; sync กับ active remote เดียว (central ปกติ,
edge เฉพาะ WAN outage, local-only ถ้าไม่เห็นทั้งคู่)

สิ่งที่มีในโค้ดตอนนี้:

- **Domain model** — evacuee, household, medical, movement, stock, donation, donation campaign
  (`features/people`, `features/operations`)
- **Role-based access** — CouchDB `_session`; roles: `system_admin` | `shelter:{code}` + function roles
- **Offline-first** — PouchDB sync ผ่าน `/couch` proxy (same-origin, first-party cookie)
- **Admin ops** — dev-server API routes (`/api/register`, `/api/admin/users`) ถือ admin credentials ฝั่ง server

> demo เก่า (shelter A/B/C) ถูกย้ายไป `demo/` แล้ว — ไม่ได้ build ใน production

## Tech stack (ย่อ)

- **Frontend**: SvelteKit 2 + Svelte 5 (runes) + TypeScript, Tailwind CSS v4, shadcn-svelte
- **Data**: client-side ล้วน — TanStack Query, PouchDB (offline) sync กับ CouchDB 3.5
- **Backend**: CouchDB 3.5 ตรงจาก browser (cookie session auth ผ่าน dev proxy `/couch`)
- **Deploy**: SPA/PWA เสิร์ฟด้วย Node server (`adapter-node`, `ssr = false`) — Node รัน `/api/*` server endpoints ด้วย

## เริ่มต้นใช้งาน

```bash
# 0. Git hooks (repo root — ครั้งแรกหลัง clone)
pnpm install          # ติดตั้ง lefthook + register pre-commit hook

# 1. ยก CouchDB และ Worker ขึ้น (ต้องมี .env — copy จาก .env.example)
cp .env.example .env
cp couchdb-session-example.ini couchdb-session.ini
docker compose up -d

# 2. seed CouchDB (จาก frontend/)
cd frontend
pnpm install
pnpm seed

# 3. Sync worker — bootstrap + continuous _changes (เลือกอย่างใดอย่างหนึ่ง)
# ผ่าน Docker (รันอัตโนมัติเมื่อ docker compose up)
# หรือ local debug:
cd ..
uv sync --project worker
uv run --project worker sync-worker
# re-sync ทั้งก้อน: uv run --project worker sync-worker --bootstrap

# 4. ดู MongoDB ด้วย Compass: mongodb://localhost:27017/tentdb
#    collections: public_shelters, public_persons, _sync_checkpoints

# 5. frontend dev server
cd frontend
pnpm dev          # http://localhost:5173
```

## การตรวจคุณภาพโค้ด (pre-commit)

repo root ใช้ **[Lefthook](https://github.com/evilmartians/lefthook)** เป็น quality gate ก่อน commit
— ตรวจ code smell เบื้องต้นของ frontend ตามลำดับเดียวกับ Jenkins CI:

1. `pnpm lint` — Prettier + ESLint
2. `pnpm check` — `svelte-check` (type-check)
3. `pnpm test` — Vitest unit tests

Hook รันเฉพาะเมื่อมีไฟล์ใน `frontend/` ถูก stage; commit ที่แตะแค่ docs/config ที่ root จะข้าม
การตรวจนี้

```bash
# ทดสอบ hook โดยไม่ commit
pnpm exec lefthook run pre-commit

# ข้าม hook ชั่วคราว (กรณีจำเป็น)
LEFTHOOK=0 git commit -m "..."
# หรือ git commit --no-verify
```

ตั้งค่าอยู่ใน [`lefthook.yml`](lefthook.yml) ที่ repo root — ต้อง `pnpm install` ที่ root
(แยกจาก `frontend/`) หลัง clone เพื่อให้ hook ทำงาน

คำสั่งที่ใช้บ่อย (รันใน `frontend/`):

- `pnpm dev` — Vite dev server
- `pnpm lint` — format + ESLint check
- `pnpm check` — type-check (รันก่อนปิดงานทุกครั้ง)
- `pnpm test` — unit tests (Vitest)
- `pnpm test:e2e` — Playwright e2e
- `pnpm seed` — Create mock data (purge old data first)
- `pnpm unseed --confirm` — Wipe all CouchDB databases except `_users`

การจัดการข้อมูลตัวอย่างด้วย Docker Compose (รันที่ repo root; ต้องมี `couchdb` / `mongodb` จาก base compose):

- **Seed** (Couch อย่างเดียว):
  `docker compose -f docker-compose.yml -f docker-compose.seed.yml run --rm seed`
- **Unseed** (ลบ Couch DBs ยกเว้น `_users`):
  `docker compose -f docker-compose.yml -f docker-compose.seed.yml run --rm unseed`
- **Wipe Mongo** (`dropDatabase` ตาม `DATABASE_URI`):
  `docker compose -f docker-compose.yml -f docker-compose.seed.yml run --rm mongo-wipe`
- **Bootstrap Mongo** (project จาก Couch แล้ว exit):
  `docker compose -f docker-compose.yml -f docker-compose.seed.yml run --rm bootstrap`
- **Full reset** (unseed → wipe Mongo → seed → bootstrap; **หยุด worker ก่อน**):
  ```bash
  docker compose -f docker-compose.yml stop worker
  docker compose -f docker-compose.yml -f docker-compose.seed.yml --profile reset run --rm reset
  docker compose -f docker-compose.yml start worker
  ```
  ใช้กับ staging ได้เช่นกัน ถ้า base compose มี service ชื่อ `couchdb` + `mongodb` (และ ideally `worker`)

คำสั่ง worker (จาก repo root):

- `uv run --project worker pytest worker/tests` — projector unit tests
- `uv run --project worker sync-worker` — CouchDB → MongoDB sync
- `uv run --project worker sync-worker --bootstrap` — force full re-sync แล้ววิ่ง continuous
- `uv run --project worker sync-worker --bootstrap-only` — bootstrap แล้ว exit (ใช้ใน compose reset)

## Staging / production deploy (public plane)

Jenkins staging ใช้ `docker-compose.staging.no-nginx.yml`; production ใช้
`docker-compose.production.no-nginx.yml` (nginx อยู่บน **host** ทั้งคู่):

```bash
docker compose -f docker-compose.staging.no-nginx.yml up -d --build
docker compose -f docker-compose.production.no-nginx.yml up -d --build
```

Services: CouchDB, frontend, MongoDB, sync worker, FastAPI (`127.0.0.1:9000`).
ตั้ง `DATABASE_URI` / `SECRET_KEY` / `EXTERNAL_API_SECRET` ใน `.env` บน server
(ค่าเดียวสำหรับ worker + FastAPI).

Volume dirs:
- staging: `/mnt/tent-data/couchdb/data`, `/mnt/tent-data/mongodb/data`
- production: `../deployment/tent/data` (Couch), `../deployment/tent/mongodb/data` (Mongo)

Host nginx ต้อง proxy exact-path ไป FastAPI (อย่า proxy ทั้ง `/public`):

```nginx
location = /public/v1/family-search {
    proxy_pass http://127.0.0.1:9000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /public/v1/shelters {
    proxy_pass http://127.0.0.1:9000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

ตัวอย่างเต็มสำหรับ compose-nginx อยู่ที่ [`nginx/nginx.conf`](nginx/nginx.conf)
(`docker-compose.staging.yml` / `docker-compose.production.yml` — proxy ไป `http://fastapi:9000`)

## แหล่งอ้างอิง

- ข้อเสนอโครงการฉบับสมบูรณ์: [docs/source/psu-smart-shelter-f-20260522.txt](docs/source/psu-smart-shelter-f-20260522.txt)
- เอกสารสถาปัตยกรรม (เบื้องต้น): [docs/architecture.html](docs/architecture.html)

---

_โครงสร้าง repo ยังเปลี่ยนได้ — เอกสารนี้จะ update ตามความคืบหน้า_
