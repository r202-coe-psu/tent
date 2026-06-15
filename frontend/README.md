# CouchDB Lab — Frontend

SPA/PWA frontend สำหรับ **Tent** (`เต็นท์`) เสิร์ฟด้วย Node server. สร้างจาก template **sveltekitten**
คุยกับ **CouchDB 3.5** ตรงจาก browser ด้วย cookie-based session auth ผ่าน same-origin dev proxy.

## Stack

- **SvelteKit 2** + **Svelte 5** (runes only) + **Vite** + **TypeScript**
- **Tailwind CSS v4** (`@tailwindcss/vite`, ไม่มี config file)
- UI: **shadcn-svelte** บน **bits-ui** primitives (`src/lib/components/ui/`)
- Forms: **Superforms** + **Zod** (`zod4Client`)
- Data fetching: **TanStack Query** (`@tanstack/svelte-query`) — client-side ล้วน
- Local/sync DB: **PouchDB** (`pouchdb-browser`) ↔ CouchDB
- Toast: **svelte-sonner** (feedback ทาง toast เท่านั้น)

### Architecture

SPA/PWA บน Node — `@sveltejs/adapter-node` กับ `ssr = false` (หน้า app render ฝั่ง browser).
ไม่มี SSR load function (`+page.server.ts` / `+layout.server.ts`) — ดึงข้อมูลหน้าเว็บ client-side หมด.
Node server รัน `/api/*` `+server.ts` endpoints (admin, register) ใน production ด้วย — endpoint พวกนี้ `prerender = false`.

Feature-sliced layering ใต้ `src/lib/features/<name>/` แยกเป็น `domain/` `data/` `application/` `ui/`.
Route หรือ feature อื่น import ได้แค่ผ่าน barrel (`$lib/features/<name>`) — reach เข้า layer ภายในเป็น ESLint error.

## Prerequisites

- **Node.js** 20+
- **pnpm** (ผ่าน corepack: `corepack enable`)
- **Docker** + Docker Compose (สำหรับ CouchDB backend)

## Setup

```bash
# 1. ติดตั้ง deps (รันจาก frontend/)
pnpm install

# 2. สร้าง .env จาก template
cp .env.example .env
```

`.env` keys:

| Key | ค่า default | คำอธิบาย |
|---|---|---|
| `PUBLIC_APP_TITLE` | `Tent` | ชื่อแอป |
| `PUBLIC_COUCHDB_URL` | `http://localhost:5984` | CouchDB base URL (ห้ามใส่ credentials — ค่านี้ bundle เข้า browser) |
| `PUBLIC_COUCH_PROXY` | `/couch` | Vite dev proxy path ให้ CouchDB อยู่ same-origin (session cookie ทำงานได้) |

## รัน Development

```bash
# 1. start CouchDB backend (รันจาก repo root)
cd ..
cp .env.example .env          # ตั้ง COUCHDB_USER / COUCHDB_PASSWORD
docker compose up -d
cd frontend

# 2. start dev server
pnpm dev
```

- Dev server: http://localhost:5173
- CouchDB: http://localhost:5984 (Fauxton UI: http://localhost:5984/_utils)
- คำขอที่ `/couch/*` ถูก proxy ไป `PUBLIC_COUCHDB_URL` (ดู `vite.config.ts`) เพื่อให้ same-origin

> Docker: `pnpm dev` bind `0.0.0.0` อยู่แล้ว

## Scripts

| Command | ทำอะไร |
|---|---|
| `pnpm dev` | Vite dev server (port 5173) |
| `pnpm build` | Build production (static output) |
| `pnpm preview` | Preview build ที่ build แล้ว |
| `pnpm check` | `svelte-check` type-check — **รันก่อนจบงานทุกครั้ง** |
| `pnpm lint` | `prettier --check` + `eslint` |
| `pnpm format` | Prettier เขียนทับ |
| `pnpm test` | Unit test (Vitest) |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:e2e` | Build แล้วรัน Playwright e2e |
| `pnpm openapi:update` | Regenerate API types จาก OpenAPI spec |

## โครงสร้าง

```
src/
├── app.css            # Tailwind v4 entry
├── app.html
├── lib/
│   ├── components/ui/  # shadcn-svelte (vendored — ห้ามแก้มือ)
│   ├── db/             # couch.ts / pouch.ts — DB clients
│   ├── features/       # feature slices (domain/data/application/ui)
│   ├── guards/         # route guards (requireAuth)
│   ├── stores/         # auth.svelte.ts ฯลฯ
│   └── utils/
└── routes/
    ├── (protected)/    # route group ที่ require auth
    ├── login/
    └── api/
```

## Testing

- **Unit** (Vitest): test อยู่ติดกับ code (`*.test.ts`), environment `node`
- **E2E** (Playwright): อยู่ใน `e2e/`, `e2e/mock-api.js` เป็น mock backend, ยิงไป built preview (`localhost:4173`)

## Conventions

- Svelte 5 runes only — `$state` / `$derived` / `$props` / `onclick`, snippets + `{@render}`, `{@attach}` แทน `use:`
- ใช้ class กับ `$state` fields แทน Svelte stores สำหรับ shared state
- รัน `npx @sveltejs/mcp svelte-autofixer ./src/path/Component.svelte` กับทุกไฟล์ `.svelte` ก่อนส่ง
- Prettier: tabs, single quotes, no trailing comma, printWidth 100
- รายละเอียดเพิ่ม: ดู `AGENTS.md`, `agent-role.md`, `CONTRIBUTING.md`
