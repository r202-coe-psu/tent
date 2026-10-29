# Bulk return pool (v3) E2E plan

Status: implemented, 2026-10-24 (first run pending). Branch base `e080abfa4` of PR #768 (issues
#658 / #659 / #660). The specs described below now exist: `bulk-return-pool-flow.test.ts`,
`bulk-return-pool-storage.test.ts`, `bulk-return-pool-access.test.ts`, with `bulk-return-pool.ts`
and `pages/bulk-return-pool.page.ts`. Where source differed from the first draft this document was
corrected (see the notes marked "verified"). Language and conventions follow `e2e/README.md`.

## 1. Scope

End-to-end coverage of the bulk return pool v3 on both staff surfaces and on the CouchDB
validate-doc-update (VDU) layer:

- Lifecycle: open, add / move / void entries, submit, receive, cancel.
- Loan side effects: `applied_bulk_entry_ids`, `partially_returned`, void reopening a loan.
- Stock side effects: `stock_ledger` rows written only at receive, with the actual quantity.
- Storage points (CR-139), name rules, late entries, immutability, role matrix.

Out of scope and risks:

- QR scan inside the add dialog (the picker scan is covered elsewhere).
- Mobile layout.
- Concurrency race windows (two users submitting at once).
- Edge endpoint: pool mutations are central-only.
- Risk: no `data-testid` exists; locators use roles, labels and ids (see 3.4). Label copy changes
  will break specs, so labels are centralised in the page object.

## 2. Sources

| Source                                                                                                                              | Used for                                 |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `docs/changes/draft-bulk-return-pool-redesign.md`                                                                                   | v3 shape, state machine, ledger row      |
| `e2e/README.md` §3, §4, §5, §8.4, §9.0                                                                                              | tags, data safety, fixtures, suite table |
| `e2e/distribution/{fixtures,distribution,checks,distribution-desk-setup}.ts`, `pages/*.page.ts`                                     | harness to extend                        |
| `distribution-desk-access.test.ts` (`expectWrites`; V5 since removed)                                                               | VDU matrix pattern                       |
| `distribution-desk-returns-close.test.ts` (`issueLoan`; T4-6/T4-7 since removed)                                                    | loan issuing through desk UI             |
| `src/lib/features/distribution/ui/bulk-return/`, `ui/frontline/LoanReturnCard.svelte`, `ui/back-office/TicketManagementPage.svelte` | UI under test                            |
| `src/lib/server/shelter-access-design.ts` (search `bulk_return`)                                                                    | VDU rules                                |

### 2.1 Business decisions (kong, 2026-10-22), cited as rule ids

| Id  | Rule                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Roles. Open pool, edit name/location, cancel, submit, receive: `warehouse_staff`, `supply_coordinator`, `shelter_manager`. Add / move / void entry: those plus `distribution_staff`. `system_admin` NOT included. Forward-only (SUBMITTED to OPEN not allowed). Empty pool (net entry count 0) cannot submit; cancel instead. |
| D3  | Name and location editable while OPEN, immutable from SUBMITTED.                                                                                                                                                                                                                                                              |
| D4  | CANCELLED is terminal. OPEN to CANCELLED only when empty. Doc never deleted. List hides CANCELLED by default.                                                                                                                                                                                                                 |
| D5  | Fence: submit snapshots `entry_ids`. Late entries (after lock) are shown as "ค้าง" and must be moved to another OPEN pool.                                                                                                                                                                                                    |
| D6  | Void entry through an append-only void doc, only while OPEN. Void reopens the loan (`qty_returned` reduced, entry id removed from `applied_bulk_entry_ids`).                                                                                                                                                                  |
| D7  | No separate ticket. Receive (SUBMITTED to RECEIVED) records actual qty / discrepancy / reason per `item_id` (`damaged`, `missing`, `miscount`, `other`; note required for `other`; only for mismatched items). `stock_ledger` is written with the ACTUAL received qty to the storage point chosen at receive.                 |
| D8  | Location = CR-139 storage point (`sub_storage[].id`) plus name snapshot; optional.                                                                                                                                                                                                                                            |
| D9  | Name unique among OPEN pools of the shelter (advisory; UI checks at create/rename). Max 80 chars.                                                                                                                                                                                                                             |
| D10 | `returner_type` is `evacuee`, `volunteer` or `unspecified`. `unspecified` implies `returner_id` null and `loan_refs` empty.                                                                                                                                                                                                   |
| D11 | `applied_bulk_entry_ids` on `distribution_log`. Partial release through a pool gives `partially_returned`.                                                                                                                                                                                                                    |
| D12 | `sum(loan_refs.qty) <= entry.qty`.                                                                                                                                                                                                                                                                                            |
| D13 | Returner without an outstanding loan is allowed (empty `loan_refs`); UI warns.                                                                                                                                                                                                                                                |
| D14 | No `condition_on_return` on the entry. Damage is recorded as a receive discrepancy reason.                                                                                                                                                                                                                                    |

### 2.2 Facts the plan relies on (verify against code while writing the specs)

- Back office: `/back-office/distribution`; guard allows SA/SM/WH/SC, DST is redirected. The board
  is the `Tabs.Trigger` "กองรับคืนพัสดุ" (no URL param).
- Onsite: `/onsite/distribution`; guard allows SA/SM/DST, WH cannot reach it. The board sits in
  tab "4. รับคืนสิ่งของ" under `LoanReturnCard`. DST sees add / move / void only.
  `LoanReturnCard` has "คืนเข้ากองรับคืน" on active loans (opens the add dialog prefilled).
- Board flags `canManage` / `canWriteEntry` come from the session, not a surface prop; SM on
  onsite therefore also sees the manage actions. The UI helpers also admit `system_admin`
  (`canManageBulkReturnPool`), like the VDU (open point a).
- The new pool's detail sheet opens by itself after create, and an OPEN sheet follows the live
  overview row (entries, title after rename, status and buttons after submit / receive); fixed in
  PR #768 (GAP BRP-F10, §7). The page object waits on the open sheet (`expectDetail`) instead of
  closing and reopening it. Cancel closes the sheet itself (`onClose()`), so nothing is awaited
  after it. The board header buttons ("เปิดกองใหม่", "รับของเข้ากอง") are behind the sheet while it is
  open.
  Submit and cancel confirmations have no reason field (the "reason" is the explanatory text
  `#submit-pool-reason` / `#cancel-pool-reason`); void has none either. A voided entry is folded out
  of the sheet (it is not shown as "voided"). The board reads the pool list once on mount, so a
  seeded pool must exist before the page loads.
- Ledger row: id `deriveDeterministicLedgerId('bulk_return_receive', poolId, itemId)` (from
  `src/lib/features/operations/domain/deterministic-ledger-id`), `reason: 'receive'`,
  `ref_id: 'bulk_return_pool:<ULID>'`, `qty` = received qty, `lot.note: 'bulk_return_pool'`,
  `lot.storage_point_id` / `storage_zone` only when a point is chosen, no `ref_type`. Items
  received as 0 get no row. Submit writes no stock.
- Storage points live on the registry shelter doc `common_areas.sub_storage[{id,name,type,area_m2?}]`.

## 3. Harness decisions

### 3.1 New files

| File                                                | Content                                     |
| --------------------------------------------------- | ------------------------------------------- |
| `e2e/distribution/bulk-return-pool.ts`              | v3 helpers (see 3.2)                        |
| `e2e/distribution/pages/bulk-return-pool.page.ts`   | `BulkReturnPoolBoard` page object (see 3.4) |
| `e2e/distribution/bulk-return-pool-flow.test.ts`    | lifecycle and rules (BRP-F*)                |
| `e2e/distribution/bulk-return-pool-storage.test.ts` | storage points (BRP-S*)                     |
| `e2e/distribution/bulk-return-pool-access.test.ts`  | roles in UI and VDU (BRP-A*, BRP-V*)        |

### 3.2 Helpers in `bulk-return-pool.ts`

- `seedOpenPool(scenario, { name, location? })` and `seedEntry(scenario, pool, { item, qty, returner, loanRefs })`:
  v3-shaped docs written with the admin API. Used only where creation is NOT the subject of the
  test; this is the existing README §8.4 "Setup" exception (see §4). Tests whose subject is the
  UI action create through the UI.
- `expectedReceiveLedgerId(poolId, itemId)`: wraps `deriveDeterministicLedgerId`.
- Readers: `readPool`, `readEntries(poolId)`, `readMoves(entryId)` (move doc `:0001`),
  `readVoids(entryId)`, `receiveLedgerRows(poolId)` (filter `reason 'receive'`, `ref_id` prefix).
- `lendViaDesk(...)`: thin reuse of the `issueLoan` flow (tab 3) so partial-return loans come from
  the real UI, not a seeder (used by F2 and F5; F1/F6/F-drift use `seedLoan`).
- Also in the helper file: v3 body builders (`buildPoolBody`, `submitBody`, `cancelBody`,
  `receiveBody`, `buildEntryBody`, `buildMoveBody`, `buildVoidBody`, `buildReceiveLedgerBody`) for the
  direct-write matrix, `seedSubmittedPool`, `expectWrites` / `actor` (copied from
  `distribution-desk-access.test.ts`: a spec file cannot be imported) and `switchUser`.

### 3.3 Storage point fixture (`fixtures.ts`)

- Add a worker-scoped option fixture `shelterStoragePoints` (default `[]`).
- Applied right after `createShelterViaUi`: write `common_areas.sub_storage` onto the run's OWN
  `E2E Distribution <ulid>` shelter registry doc via the admin API. No dependency on the PR #829
  seed.
- `bulk-return-pool-storage.test.ts` uses `test.use({ shelterStoragePoints: [...] })`. Playwright
  starts a separate worker for different option values, so that spec gets its own shelter with
  points; every other spec keeps a shelter without points (the "คลังหลัก" case).
- Teardown unchanged: the shelter is deleted when the worker ends and `assertRunLeftNothing` runs.
- Direct-write tests (BRP-V1, F6, ...) share the worker's shelter with the UI tests, and the board
  folds every entry / move / void of the shelter (GAP BRP-F11, fixed in PR #768: an orphan move /
  void is now skipped and shown as "รอซิงก์"; GAP BRP-F12: a move gap is shown the same way; but
  other fold invariants still throw for everyone).
  They must leave fold-consistent data whether the write is accepted or rejected: real seeded pools and
  entries, move / void item_id and qty copied from the entry, void pool_id = the entry's pool.
- Verified: the app reads the registry shelter doc through TanStack Query on every page load, and
  the fixture writes the points before the worker's first test, so no page can have cached a
  point-less doc. The write is refused for any shelter whose name does not start with
  `E2E Distribution`.

### 3.4 Page object `BulkReturnPoolBoard`

Works on both surfaces (constructed with the page; the host differs only in how the board is
reached: tab "กองรับคืนพัสดุ" at back-office, tab "4. รับคืนสิ่งของ" onsite).
Covers: board and cards, detail sheet, and the open / edit / add / move / void / cancel / submit /
receive dialogs.

Locators (no `data-testid`): `#open-pool-name`, `#open-pool-location`, `#add-entry-pool`,
`#add-entry-unspecified`, `#add-entry-item-{ulid}`, `#add-entry-qty-{ulid}`, `#move-entry-target`,
`#receive-qty-{item_id}`, `#receive-reason-{item_id}`, `#receive-note-{item_id}`,
`#receive-storage-point`, `#submit-pool-reason`, `#cancel-pool-reason`,
`#bulk-pool-show-cancelled`.
Caveat: `#recipient-search-input` exists twice (`LoanReturnCard` and the add dialog); always scope
to `getByRole('dialog')`.

### 3.5 Conventions

- Tags: `DESK_TAGS` (`@critical @distribution`). Test ids prefix `BRP-F*`, `BRP-S*`, `BRP-A*`, `BRP-V*`.
- Each test uses `scenarioAs('<unique label>')`. Extra roles via `addScenarioActor` plus
  `injectSession` to switch user on the same page.
- Direct VDU writes use `couchAsUser` and the `expectWrites` / `actor` / `roleSet` pattern from `distribution-desk-access.test.ts`.
- All created docs go through existing recording so teardown by id stays complete (pool,
  entry, move, void, ledger docs live in the E2E shelter database, which is dropped with the shelter).

## 4. Data safety (README §4)

- Own shelter only (worker fixture); no SH002 mutation.
- No `.only`, no cleanup by pattern; everything is deleted by id or with the shelter.
- Admin-API seeding is limited to prerequisites that are not the test subject (3.2).
- `assertRunLeftNothing` must stay green; the storage fixture edits only the E2E shelter doc.

## 5. Scenarios: flow (`bulk-return-pool-flow.test.ts`)

Implementation note: F7 is split into F7a (UI maxlength), F7b (VDU) and F7c (duplicate); F8 into
F8a (unspecified) and F8b (no outstanding loan); V1 into V1a (create), V1b (submit / receive /
cancel), V1c (entry / move / void) and V1d (ledger row). BRP-F-drift is a real `test` in this file
(loan drift decided: closed refs are skipped, warning shown). The regression tests BRP-F10, F13
and F14 (§7) live in the same file.

### BRP-F1 Mixed-surface happy path (D1, D5, D7, D10, D11)

- Setup: shelter without points; two returnable items A (loan of 3), B (loan of 2) lent to evacuee
  E with `seedLoan` (the desk lending path is covered by F2/F5); a third item C with no loan.
- Steps:
  1. WH at back-office opens pool "Pool F1" (UI).
  2. DST at onsite adds entries: E returns A (2) and B (2) (two lines); one unspecified-returner
     line for C; one more line for A (1) via `LoanReturnCard` "คืนเข้ากองรับคืน" (dialog prefilled).
  3. WH at back-office submits (confirm dialog, no reason field).
  4. WH receives with item B one short, reason `damaged`. The storage point select is still
     rendered (verified): with no points it offers only "ไม่ระบุ (คลังหลัก)" plus a hint.
- UI assertions: after submit the card shows SUBMITTED and the item summary; receive dialog only
  asks reason for the mismatched item; receive record shows "คลังหลัก"; pool shows RECEIVED.
- CouchDB assertions:
  - after submit: zero `stock_ledger` rows with this `ref_id`; pool `SUBMITTED` with
    `items_summary` and `entry_ids` equal to the entries added.
  - after receive: pool `RECEIVED` with `received_items` (B discrepancy, `damaged`); ledger rows
    with ACTUAL qty, ids equal `expectedReceiveLedgerId`, `reason 'receive'`, `ref_id`
    `bulk_return_pool:<ULID>`, `lot.note 'bulk_return_pool'`, no `lot.storage_point_id`.
  - loans: `returned` or `partially_returned` per qty, each with the applying entry id in
    `applied_bulk_entry_ids`.

### BRP-F2 Partial return (D11, D12)

- Setup: lend 3 of item X to E through desk tab 3 (as `issueLoan`); OPEN pool seeded.
- Steps: tab 4, `LoanReturnCard` "คืนเข้ากองรับคืน", qty 2, pick the pool, save.
- UI: loan card still lists 1 outstanding.
- Couch: `distribution_log` `partially_returned`, `qty_returned` 2,
  `applied_bulk_entry_ids == [entryId]`; entry `loan_refs` qty 2.

### BRP-F3 Empty pool (D1, D4)

- Steps: open pool, observe submit disabled with the empty reason (`#submit-pool-reason`); cancel
  (confirm dialog, no reason field); pool leaves the board; tick `#bulk-pool-show-cancelled` to
  see it.
- Couch: pool `CANCELLED`, doc still exists (not deleted).

### BRP-F4 Non-empty pool cannot cancel; move then cancel (D4, D5)

- Setup: pools A and B OPEN; one entry in A.
- Assert cancel on A disabled with "ย้ายของออกให้หมดก่อน". Move the entry to B through
  `#move-entry-target`. Cancel on A now works.
- Couch: move doc `...:0001` exists; entry's effective pool is B; A `CANCELLED`.

### BRP-F5 Void reopens loan (D6, D11)

- Setup: loan of 2 returned fully through an entry in an OPEN pool (UI via `LoanReturnCard`).
- Steps: void the entry (confirm dialog, no reason field).
- Couch: loan back to `active`, `qty_returned` 0, `applied_bulk_entry_ids` empty; void doc
  exists; entry doc still present (append-only). UI (verified): the voided entry is folded out of
  the sheet ("ยังไม่มีรายการในกองนี้"), pool count net 0 so submit is disabled again.

### BRP-F6 Late entry after submit (D5)

- Setup: pool with one entry, submitted by WH.
- Steps: DST direct-PUT (`couchAsUser`) a `bulk_return_entry` with the SUBMITTED pool's id (VDU
  cannot check pool state). WH/DST reload the board.
- UI: "ค้าง" badge plus notice; DST moves it to another OPEN pool via UI.
- Couch: the entry is absent from the original `items_summary` and `entry_ids`. The test's late
  entry carries no `loan_refs`; a late entry that does carry refs has them applied when it is moved
  into an OPEN pool (BRP-F13), not before.

### BRP-F7 Name rules (D9)

- UI: type 90 chars in `#open-pool-name`; value truncated to 80 (counter shows 80). The >80 UI
  error is unreachable because the input has `maxlength=80`.
- VDU: direct PUT of a pool with an 81-char name by WH is rejected with
  `bulk_return_pool name must be 1 to 80 characters`.
- Duplicate: create pool "Same", open a second with "Same": amber warning and submit BLOCKED
  ("มีกองที่เปิดรับอยู่ใช้ชื่อนี้แล้ว กรุณาตั้งชื่ออื่น"). Cancel the first (empty), the same name
  is accepted (only OPEN pools count).

### BRP-F8 Returner variants (D10, D13)

- Unspecified: add with `#add-entry-unspecified`; entry `returner_type 'unspecified'`,
  `returner_id` null, `loan_refs []`.
- Evacuee without loan: picking a returner with no outstanding loan shows the warning; the entry
  is saved with empty `loan_refs`.

### BRP-F9 Immutable after submit (D3)

- UI: after submit the "แก้ไขข้อมูลกอง" button is gone.
- VDU: WH direct PUT changing the name of a SUBMITTED pool gives 403.
- VDU forward-only (D1): PUT SUBMITTED to OPEN gives 403. Strip the snapshot fields
  (`items_summary`, `entry_ids`, `submitted_*`) to reach
  `Invalid bulk_return_pool status transition SUBMITTED -> OPEN`; with the fields kept it fails
  earlier on `OPEN bulk_return_pool must not have items_summary`. Both are 403; the test asserts
  the transition reason on the stripped variant.

## 6. Scenarios: storage points (`bulk-return-pool-storage.test.ts`, `test.use({ shelterStoragePoints })`)

### BRP-S1 Point at open and a different point at receive (D7, D8)

- Setup: points P1 and P2 on the shelter. WH opens a pool with location P1 (`#open-pool-location`).
- UI: card and detail show the P1 name; pool location fields hold P1 id and name snapshot.
  Submit with one entry; receive choosing P2 in `#receive-storage-point`.
- Couch: `received_storage_point_id` / zone = P2; every ledger row has `lot.storage_point_id` /
  `storage_zone` = P2 (not P1). Receive record shows P2.

### BRP-S2 Receive requires a point when the shelter has points (D7)

- Receive without picking: the confirm button stays enabled but pressing it shows the inline
  alert "เลือกจุดเก็บของ" and writes nothing (verified: not a disabled button); first select option
  is "ไม่ระบุ (คลังหลัก)" and does not count as a choice. After picking, receive succeeds.
- Counterpart (no points, "คลังหลัก" fallback, board "ไม่ระบุ") is covered in F1.

## 7. Scenarios: access (`bulk-return-pool-access.test.ts`)

### BRP-A1 Onsite DST (D1)

- Add, move and void are visible and succeed. Not offered: "เปิดกองใหม่", "แก้ไขข้อมูลกอง",
  "เก็บเข้าคลัง", "ตรวจรับ", cancel section.
- Note: SM on onsite also sees manage actions (flags come from the session). Not asserted for DST.

### BRP-A2 Back-office WH, SC, SM (loop) (D1)

- For each role: open, add (unspecified), submit, receive succeed through the UI.

### BRP-A3 Surface guards

- DST redirected from `/back-office/distribution`; WH cannot reach `/onsite/distribution`. If
  `distribution-desk-access.test.ts` already asserts this, cite it and add no new test.

### BRP-V1 VDU matrix (`expectWrites`)

| Write                                                                | Allowed               | Denied (403) |
| -------------------------------------------------------------------- | --------------------- | ------------ |
| Pool create (schema v3)                                              | WH, SC, SM (201)      | DST, REG     |
| Submit / receive / cancel transitions                                | WH, SC, SM            | DST          |
| Entry create, move doc, void doc                                     | WH, SC, SM, DST (201) | REG          |
| Receive ledger row (`reason 'receive'`, `ref_id bulk_return_pool:*`) | WH, SC, SM            | DST          |

Each row is one `expectWrites` call with unique doc ids per actor. The v3 pool shape comes from
the helper, not from the removed v2 V5 body.

### BRP-A-SA (open point a, decided)

kong decided system_admin keeps the usual `isRole()` override; no SA-specific block. The test
asserts SA sees "เปิดกองใหม่" and a direct pool create as SA gets 201.

### BRP-F-drift (open point b, decided; `test`)

Loan changed between allocation and apply (for example cleared lost/waived): the closed ref is
skipped at apply (no partial apply, loan untouched), the entry stays in the pool and counts in the
item total, and the entry row shows the closed-loan warning. The retry after a failed first save
settles instead of failing forever.

### GAP (fixed): BRP-F10 the open sheet was stale (regression `test`, in `bulk-return-pool-flow.test.ts`)

The overview query refetched after each mutation (the board card showed the new count), but the
open detail sheet kept the old row: stale entries after add / move / void, stale title after
rename, "เก็บเข้าคลัง" instead of "ตรวจรับ" after submit; and a pool opened through "เปิดกอง" never
opened its sheet, although `onOpened` sets `selectedPoolId`. Fixed in PR #768: the sheet now follows
the live overview row while open and opens by itself after create. The regression test asserts the
new pool's sheet is visible with its name after create, and that after moving the only entry from
the open sheet it shows "ยังไม่มีรายการในกองนี้" without reopening. The page object no longer
closes / reopens the sheet (`expectDetail`, §2.2).

### GAP (fixed): BRP-F11 one orphan move/void broke the whole board (regression `test`, in `bulk-return-pool-gap-isolation.test.ts`)

The VDU cannot check that the entry a move / void refers to exists, so such a doc is accepted
(direct write, or an event replicated before its entry, e.g. edge to central).
`resolveBulkReturnEntries` then threw ("Void references unknown entry ...") for the whole overview
and the board showed "ไม่สามารถโหลดข้อมูลกองรับคืนได้" to every user of the shelter. Fixed in
PR #768: the fold skips the orphan, the pool card shows an amber "รอซิงก์ <n>" badge and the detail
sheet a `role="status"` notice "รอซิงก์ข้อมูล: ...". The regression test seeds an OPEN pool, PUTs an
orphan void as a DST user (expect 201), opens the board, and expects the pool card visible and
containing "รอซิงก์". It lives in its own `GAP isolation` describe with its own
`shelterStoragePoints` value, so it gets a separate worker and shelter and can never break other
tests.

### GAP (fixed): BRP-F12 a move gap broke the whole board (regression `test`, in `bulk-return-pool-gap-isolation.test.ts`)

Move docs replicate independently, so move seq 2 can arrive before move seq 1 (out-of-order
replication). `resolveEntryPool` then threw "Move seq must be contiguous from 1" for the whole
overview and the board showed "ไม่สามารถโหลดข้อมูลกองรับคืนได้" to every user of the shelter. Now,
while the chain has a gap, the entry counts in no pool and the pools it references (its original
`pool_id` and the `from` / `to` of the known moves) show the amber "รอซิงก์ <n>" badge. When the
missing move arrives the board heals itself and counts the entry in its final pool. A duplicate seq,
a wrong first `from_pool_id` and a chain mismatch still throw, and moving or voiding a pending entry
is rejected.

The regression test seeds three OPEN pools A, B, C, a returnable item and one entry in A. As a DST
user it PUTs only move seq 2 (B to C; expect 201), opens the board and expects cards A, B and C
visible (no crash), each containing "รอซิงก์" and each showing "0 รายการ" (the entry counts in no
pool). It then PUTs move seq 1 (A to B), reloads the board and expects card C to show "1 รายการ",
cards A and B to show "0 รายการ" and none of the three cards to contain "รอซิงก์". It is a
second describe in the same file as F11, so it shares that file's isolation worker and shelter
(Playwright forbids a worker-forcing `test.use` inside a describe); its own scenario, pools and
entry keep it apart from the F11 test.

### GAP (fixed): BRP-F13 a late entry never cleared its loan when moved (regression `test`, in `bulk-return-pool-flow.test.ts`)

Found in kong's review of PR #768 (B1), fixed in PR #768. An entry written into a SUBMITTED pool
(direct PUT) never had its `loan_refs` applied, and `moveBulkReturnEntry` did not apply them either,
so the loan stayed open although the goods were back. Now a move into an OPEN pool applies the
entry's not-yet-applied refs (idempotent through the loan's `applied_bulk_entry_ids`, same drift
rules as add: closed, missing or too-short refs are skipped). The move toast ends with
" · ตัดยอดยืม <n> รายการ" when n > 0.

The test lends 3 (`seedLoan`) to an evacuee and has 2 returned through the UI into OPEN pool A
(loan `partially_returned`). WH submits A, then a DST user PUTs a late entry (qty 1, `loan_refs` to
that loan; expect 201); the loan is still at `qty_returned` 2 and does not list the late entry. DST
moves the late entry to OPEN pool B at the desk. Couch: the loan is `returned`, `qty_returned` 3 and
`applied_bulk_entry_ids` lists both entries once. A further return of the same item from the same
evacuee through the UI shows the no-outstanding-loan warning and is saved with empty `loan_refs`;
the loan is unchanged and the qty applied through its entries never exceeds 3.

### GAP (fixed): BRP-F14 void claimed to revert a loan it never touched (regression `test`, in `bulk-return-pool-flow.test.ts`)

Found in kong's review of PR #768 (B2), fixed in PR #768. The entry line ("ตัดยอดยืม n รายการ") and
the void toast were based on the entry's `loan_refs`, not on what was applied on the loan. Now both
count only refs whose loan lists the entry id in `applied_bulk_entry_ids`: the line reads
"ไม่ได้ตัดยอดยืม" and the void toast reads "ยกเลิกรายการแล้ว (รายการนี้ไม่ได้ตัดยอดยืม จึงไม่มียอดยืมต้องคืนสถานะ)"
instead of "คืนสถานะยอดยืม <n> รายการ".

The test lends 2 (`seedLoan`) and has a DST user PUT an entry with a `loan_refs` entry straight into
an OPEN pool (expect 201), so the ref is never applied. The detail sheet shows "ไม่ได้ตัดยอดยืม" and
not "ตัดยอดยืม 1". After voiding, the visible toast is the no-revert text and none contains "คืนสถานะยอดยืม";
the loan doc keeps the same `_rev`, status and `qty_returned`; one void doc exists.

## 8. Old tests and helpers (removed)

| Item                    | Location                                  | Action now                                                                                                                          | Follow-up (#661) |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| T4-6/T4-7               | `distribution-desk-returns-close.test.ts` | removed (replaced by the `LoanReturnCard` path in BRP-F1/F2)                                                                        | —                |
| V5                      | `distribution-desk-access.test.ts`        | removed (replaced by BRP-V1)                                                                                                        | —                |
| `seedBulkReturnPool`    | `distribution.ts` (v2 shape)              | removed (no other caller in `e2e/`)                                                                                                 | —                |
| `DeskPage.bulkDialog()` | `pages/desk.page.ts`                      | removed (no other caller in `e2e/`)                                                                                                 | —                |
| README §8.4 rows        | `e2e/README.md:327-338`                   | add rows for the three new suites; adjust the `returns-close` row (drop "bulk pool") and the "Setup" sentence (a counted bulk pool) | final wording    |

Note: the old tests cover the v2 `bulk_return_claim` / `unclaimed_quota` model, which PR #768
removes; they must not run against v3. The v2 UI files and the `bulk_pool_id` field cleanup stay in #661.

## 9. Open points and skipped

From PR #768 "Not included, open points for kong":

- (a) system_admin: decided, SA keeps the usual `isRole()` override. BRP-A-SA asserts SA can open.
- (b) Loan drift: decided and implemented. A closed (lost / waived / returned / voided), missing or
  too-short loan ref is skipped at apply (all-or-nothing, no partial apply; the loan is untouched,
  no throw), the entry still counts in the pool, and the entry row shows a read-time warning
  (`data-testid="bulk-return-entry-closed-loan-warning"`). BRP-F-drift is now a real `test`.
- (c) Defaults to confirm (tests currently encode them; flag if kong changes any):
  - oldest-first allocation;
  - items received as 0 get no ledger row;
  - receive storage point required only in UI when the shelter has points (VDU does not enforce);
  - voided loan returning to active keeps `clear_reason` `bulk_dropoff`;
  - WH/SC can update loans through the bulk path.

Other:

- A >80-char name cannot be typed (maxlength), so only the VDU rejection proves it.
- Late entries can only be produced by direct PUT; the UI never writes into a SUBMITTED pool.

## 10. How to run

From `frontend/` (env from `frontend/.env`):

```
node_modules/.bin/vite build --mode test
env -u E2E_BASE_URL PLAYWRIGHT_TEST_BASE_URL=http://localhost:4187 \
  node_modules/.bin/playwright test e2e/distribution/bulk-return-pool-*
```
