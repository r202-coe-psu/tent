## รอบแก้ไขที่ 2 — T-25 completion + review fixes

ขอบคุณสำหรับรีวิวครับ @net-lynx

**หมายเหตุสำคัญ:** commit ก่อนหน้าที่ push ขึ้นมา **ตกไฟล์ `docs/` ไปทั้งหมด** (schema.md + CR ไม่ได้ถูก add เข้า commit) — งาน occupancy/override/schema จริงๆ ทำไว้แล้วแต่ยังไม่ได้ push. รอบนี้ commit ครบทั้ง docs + code + CR แล้ว. รายละเอียดตามด้านล่าง

### Blockers — ปิดครบ 2/2

- **schema.md not updated** → อัปเดต `docs/data/schema.md` §2.5 (`calc_source`, schema_v 1→2, migration note, headcount source, per-field invariant) + §2.7.1 `gas_cylinder_type` ใหม่ พร้อม **CR-021** และ **CR-022** ใน `docs/changes/` + ลง `_index.md`
- **Production-board navigation misleading** → เอาปุ่ม "เพิ่มสูตรมาตรฐาน (BOM)" / "กำหนดสูตรเอง (Custom)" ออกจาก header, เปลี่ยนเป็น chip disabled "ฐานสูตร BOM (เร็วๆ นี้)"; ปุ่ม "จัดการ" ของ confirmed plan เปลี่ยนเป็น "—" (ไม่มี nav ไป stub แล้ว) — ไม่มี `goto('/back-office/kitchen/production-board')` เหลือในโค้ด

### Warnings — ปิด 5/6 (1 ข้อ out-of-scope พร้อมเหตุผล)

- ✅ **No live occupancy** → `deriveHeadcountFromOccupancy()` ดึงจาก evacuee ที่ `checked_in` (T-06), hook `useOccupancyHeadcount()`, live-query watch `evacuee`/`movement` → re-calc อัตโนมัติ. "LIVE COUNT" badge ผูกยอดจริงแล้ว (ไม่ decorative). ฟอร์ม auto-fill headcount จาก occupancy + ปุ่ม "ใช้ยอดล่าสุด" (CR-022)
- ✅ **No manual override path** → แก้ headcount ต่างจาก occupancy snapshot → **บังคับกรอก `override_reason`** (ปุ่ม disable จนกว่าจะกรอก), persist ลง doc, ตารางโชว์ ⚑ พร้อมเหตุผล (CR-022)
- ✅ **planned_qty unit ambiguity** → ชี้แจงใน `schema.md` §2.5 ว่าหน่วยขึ้นกับ `recipe_id` (`ingredient:rice` = กรัม); เพิ่ม handoff contract `RECIPE_TO_STOCK_ITEM` (rice → `item:rice`, unit `g`) (CR-022)
- ✅ **Route guard requireAuth only** → เพิ่ม guard `requireKitchen()` (`system_admin` | `shelter_manager` | `kitchen_staff`) ใช้กับ kitchen 3 routes แทน `requireAuth` + helper `hasStaffCapability` + **CR-024** (permission change, tracked)
- ✅ **Duplicate meal plan UX** → ฟอร์มจับ 409 แสดง toast บอกชัดว่ามีแผนวัน/มื้อนี้แล้ว *(pre-check/link ไปแผนเดิมเป็น enhancement รอบถัดไป — 409 กันการสร้างซ้ำได้จริงแล้ว)*
- ⚠️ **getActiveSopProfile hardcoded SHELTER_CODE** → **out-of-scope T-25**: เป็น pattern single-shelter ทั้งแอป (people/kitchen/sop-ratios ใช้ `SHELTER_CODE` constant เหมือนกันหมด). การ wire `shelterStore` / multi-shelter เป็นงาน cross-cutting แยก task — แก้ใน PR นี้จะกระทบทั้งระบบเกินขอบเขต

### Suggestions — ปิด 2/4

- 📝 **Integration test e2e ของ useCreateMealPlanCalc** — ปัจจุบันมี repository-level test (persist calc_source) + domain test ครบ. e2e ผ่าน createMutation hook ต้อง mount Svelte context — จะเพิ่มใน test รอบ E2E (Playwright) แยก
- ✅ **Hide/disable production-board buttons** → ทำแล้ว (ดู Blocker 2)
- ⏭️ **Redundant `+page.ts requireAuth`** → moot แล้ว — เปลี่ยนเป็น `requireKitchen` ซึ่ง **ไม่ redundant** กับ layout (`requireAuth`) เพราะเพิ่ม capability check ที่ layout ไม่มี
- 📝 **Dedupe startKitchenLiveQuery $effect** → ข้ามรอบนี้ — helper ต้องใช้ `$effect` ซึ่งต้องย้าย `queries.ts` เป็น `.svelte.ts` (เสี่ยงเกินคุณค่าของ suggestion); boilerplate 4 บรรทัด × 2 ไฟล์

### Nitpicks — ปิด 2/2

- ✅ **formatId column header "รหัส"** → เปลี่ยนเป็น "แผน (วัน:มื้อ) / เวลาบันทึก" (ไม่สื่อว่าเป็น production code)
- ✅ **PR description mentions Seed banner** → UI ไม่มีปุ่ม seed แล้ว (แทนด้วยข้อความ SA-only); จะอัปเดต PR description ให้ตรง

---

### เพิ่มเติมรอบนี้ (นอกรีวิว — ปิด DoD T-25)
- **Handoff T-26**: `toRequisitionInput(mealPlan)` pure adapter → `KitchenRequisitionInput` + tests
- **Check-in stopgap**: ปุ่ม "เช็คอิน" ใน evacuee-management (ใช้ `movement` domain ที่มีอยู่) เพื่อให้ occupancy ขยับจริงได้ (T-06 ยังไม่มี flow เต็ม) — เพิ่มคอลัมน์สถานะในตาราง

### การตรวจสอบ
- `pnpm check` — 0 errors (6699 files)
- `pnpm test` — 181/181 ผ่าน (เพิ่ม: occupancy mapping, toRequisitionInput, per-field invariant, calc_source persist)
- `pnpm lint` — clean บนไฟล์ที่แก้ทั้งหมด (kitchen / people / guards / auth)

### Change records
- **CR-021** — calc_source audit trail + gas_cylinder_type (schema_v meal_plan 1→2)
- **CR-022** — occupancy→headcount mapping + override rule + T-26 handoff contract
- **CR-024** — kitchen route capability guard (kitchen_staff)

พร้อม re-review ครับ 🙏
