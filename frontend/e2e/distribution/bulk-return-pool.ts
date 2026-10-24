/**
 * Bulk return pool v3 helpers for the `bulk-return-pool-*.test.ts` suites
 * (BULK_RETURN_POOL_E2E_PLAN.md §3.2).
 *
 * - Seeders (`seedOpenPool`, `seedSubmittedPool`, `seedEntry`, `seedLoan`) write v3-shaped docs
 *   with the admin API. They stand in for steps a test is NOT about (README §8.4 "Setup"); a test
 *   whose subject is an action performs it through the UI.
 * - Body builders (`buildPoolBody`, `submitBody`, …) give the exact doc shapes the
 *   validate_doc_update expects, for the direct-write role matrix (BRP-V*) and the seeders.
 * - Readers fold nothing: they return the raw docs so a test asserts what CouchDB holds.
 *
 * Everything lives in the E2E shelter database, which is dropped with the shelter.
 */

import { expect, type Page } from '@playwright/test';
import { ulid } from '../../src/lib/db/ulid';
import { deriveDeterministicLedgerId } from '../../src/lib/features/operations/domain/deterministic-ledger-id';
import { putDocument, type CouchDocument, type TestUser } from '../helpers/couch';
import { injectSession } from '../helpers/login';
import { expectTicketLogs, ledgerRows } from './checks';
import {
	addScenarioActor,
	couchAsUser,
	findShelterDocuments,
	getShelterDocument,
	roleSet,
	scenarioPoint,
	seedDistributionLog,
	seedItemWithStock,
	seedRecipient,
	seedTicket,
	shelterCode,
	shelterDb,
	type DistributionScenario,
	type SeededItem,
	type SeededRecipient,
	type SeededTicket
} from './distribution';
import { DeskPage } from './pages/desk.page';

export { couchAsUser };

export const POOL_SCHEMA_V = 3;
export const CREATED = 201;
export const FORBIDDEN = 403;

/** A storage point reference as the pool stores it: id plus the name snapshot. */
export interface PointRef {
	id: string;
	name: string;
}

export interface SeededPool {
	poolId: string;
	name: string;
}

export type Returner = SeededRecipient | 'unspecified';

export interface LoanRef {
	logId: string;
	qty: string;
}

export interface ItemSummaryRow {
	item_id: string;
	qty: string;
}

export interface ReceivedItemRow {
	item_id: string;
	expected_qty: string;
	received_qty: string;
	discrepancy_reason?: 'damaged' | 'missing' | 'miscount' | 'other';
	discrepancy_note?: string;
}

// ── Actors and the role matrix (pattern of distribution-desk-access) ─────────────────────────

export interface Actor {
	label: string;
	roles: string[];
	expected: typeof CREATED | typeof FORBIDDEN;
}

export function actor(label: string, roles: string[], allowed: boolean): Actor {
	return { label, roles, expected: allowed ? CREATED : FORBIDDEN };
}

/** Run `write` once per actor (a fresh user each time) and compare the HTTP status. */
export async function expectWrites(
	scenario: DistributionScenario,
	actors: Actor[],
	write: (session: string, name: string) => Promise<number>
): Promise<void> {
	const results: Record<string, number> = {};
	const expected: Record<string, number> = {};
	for (const a of actors) {
		const { user, session } = await addScenarioActor(scenario, a.label, a.roles);
		results[a.label] = await write(session, user.name);
		expected[a.label] = a.expected;
	}
	expect(results).toEqual(expected);
}

/**
 * Create a flat-role user for `capability` in this scenario and sign the page in as it. The next
 * `goto` loads the app as that user (same pattern as T5-7).
 */
export async function switchUser(
	page: Page,
	scenario: DistributionScenario,
	label: string,
	capability: string
): Promise<{ user: TestUser; session: string }> {
	const switched = await addScenarioActor(scenario, label, roleSet(capability, 'flat'));
	await injectSession(page, switched.user, switched.session);
	return switched;
}

// ── Ids and paths ───────────────────────────────────────────────────────────────────────────

export function newPoolId(): string {
	return `bulk_return_pool:${ulid()}`;
}

export function newEntryId(): string {
	return `bulk_return_entry:${ulid()}`;
}

/** CouchDB path of a doc in the run's shelter database (for `couchAsUser`). */
export function docPath(id: string): string {
	return `/${shelterDb()}/${encodeURIComponent(id)}`;
}

// ── Names ───────────────────────────────────────────────────────────────────────────────────

/** Pool name unique to the scenario (≤ 80 chars: `tag` + 4 + label + 27). */
export function poolName(scenario: DistributionScenario, tag: string): string {
	return `${tag} ${scenario.namespace}`;
}

// ── Doc bodies ──────────────────────────────────────────────────────────────────────────────

function envelope(type: string, schemaV: number, id: string, createdBy: string) {
	const now = new Date().toISOString();
	return {
		_id: id,
		type,
		schema_v: schemaV,
		shelter_code: shelterCode(),
		created_at: now,
		updated_at: now,
		created_by: createdBy
	};
}

export interface PoolBodyOptions {
	poolId?: string;
	name: string;
	createdBy: string;
	location?: PointRef;
	notes?: string;
}

/** A schema_v 3 OPEN pool exactly as `createBulkReturnPoolV3` writes it. */
export function buildPoolBody(options: PoolBodyOptions): CouchDocument {
	return {
		...envelope(
			'bulk_return_pool',
			POOL_SCHEMA_V,
			options.poolId ?? `bulk_return_pool:${ulid()}`,
			options.createdBy
		),
		name: options.name,
		status: 'OPEN',
		...(options.location
			? {
					location_storage_point_id: options.location.id,
					location_storage_zone: options.location.name
				}
			: {}),
		...(options.notes ? { notes: options.notes } : {})
	};
}

/** OPEN → SUBMITTED, as `submitBulkReturnPoolV3` writes it (`actorName` must be the writer). */
export function submitBody(
	pool: CouchDocument,
	actorName: string,
	snapshot: { itemsSummary: ItemSummaryRow[]; entryIds: string[] }
): CouchDocument {
	const at = new Date().toISOString();
	return {
		...pool,
		status: 'SUBMITTED',
		lock: null,
		items_summary: snapshot.itemsSummary,
		entry_ids: snapshot.entryIds,
		submitted_at: at,
		submitted_by: actorName,
		updated_at: at
	};
}

/** OPEN → CANCELLED, as `cancelBulkReturnPoolV3` writes it. */
export function cancelBody(pool: CouchDocument, actorName: string): CouchDocument {
	const at = new Date().toISOString();
	return {
		...pool,
		status: 'CANCELLED',
		lock: null,
		cancelled_at: at,
		cancelled_by: actorName,
		updated_at: at
	};
}

/** SUBMITTED → RECEIVED, as `receiveBulkReturnPoolV3` writes it. */
export function receiveBody(
	pool: CouchDocument,
	actorName: string,
	receivedItems: ReceivedItemRow[],
	point?: PointRef
): CouchDocument {
	const at = new Date().toISOString();
	return {
		...pool,
		status: 'RECEIVED',
		received_at: at,
		received_by: actorName,
		received_items: receivedItems,
		...(point ? { received_storage_point_id: point.id, received_storage_zone: point.name } : {}),
		updated_at: at
	};
}

export interface EntryBodyOptions {
	entryId?: string;
	poolId: string;
	itemId: string;
	qty: string;
	returner: Returner;
	loanRefs?: LoanRef[];
	notes?: string;
	createdBy: string;
}

/** A `bulk_return_entry` (schema_v 1). `unspecified` carries `returner_id: null`, no loan refs. */
export function buildEntryBody(options: EntryBodyOptions): CouchDocument {
	const returner = options.returner;
	const unspecified = returner === 'unspecified';
	return {
		...envelope(
			'bulk_return_entry',
			1,
			options.entryId ?? `bulk_return_entry:${ulid()}`,
			options.createdBy
		),
		pool_id: options.poolId,
		item_id: options.itemId,
		qty: options.qty,
		returner_type: unspecified
			? 'unspecified'
			: returner.recipientId.startsWith('volunteer:')
				? 'volunteer'
				: 'evacuee',
		returner_id: unspecified ? null : returner.recipientId,
		loan_refs: (options.loanRefs ?? []).map((ref) => ({
			distribution_log_id: ref.logId,
			qty: ref.qty
		})),
		...(options.notes ? { notes: options.notes } : {})
	};
}

export interface MoveBodyOptions {
	entryId: string;
	seq?: number;
	fromPoolId: string;
	toPoolId: string;
	itemId: string;
	qty: string;
	createdBy: string;
}

/** `bulk_return_entry_move:{entryULID}:{seq}` with a 4-digit seq. */
export function buildMoveBody(options: MoveBodyOptions): CouchDocument {
	const seq = options.seq ?? 1;
	const entryUlid = options.entryId.slice('bulk_return_entry:'.length);
	return {
		...envelope(
			'bulk_return_entry_move',
			1,
			`bulk_return_entry_move:${entryUlid}:${String(seq).padStart(4, '0')}`,
			options.createdBy
		),
		entry_id: options.entryId,
		seq,
		from_pool_id: options.fromPoolId,
		to_pool_id: options.toPoolId,
		item_id: options.itemId,
		qty: options.qty
	};
}

export interface VoidBodyOptions {
	entryId: string;
	poolId: string;
	itemId: string;
	qty: string;
	createdBy: string;
}

/** `bulk_return_entry_void:{entryULID}` — one void per entry, ever. */
export function buildVoidBody(options: VoidBodyOptions): CouchDocument {
	const entryUlid = options.entryId.slice('bulk_return_entry:'.length);
	return {
		...envelope(
			'bulk_return_entry_void',
			1,
			`bulk_return_entry_void:${entryUlid}`,
			options.createdBy
		),
		entry_id: options.entryId,
		pool_id: options.poolId,
		item_id: options.itemId,
		qty: options.qty
	};
}

/** Ledger id the receive writes for one pool item (put-if-absent, one row per item). */
export function expectedReceiveLedgerId(poolId: string, itemId: string): Promise<string> {
	return deriveDeterministicLedgerId('bulk_return_receive', poolId, itemId);
}

/** The `stock_ledger` row a receive writes (`lot.note 'bulk_return_pool'`, point only when chosen). */
export async function buildReceiveLedgerBody(options: {
	poolId: string;
	itemId: string;
	qty: string;
	createdBy: string;
	point?: PointRef;
	unit?: string;
}): Promise<CouchDocument> {
	const id = await expectedReceiveLedgerId(options.poolId, options.itemId);
	const base = envelope('stock_ledger', 6, id, options.createdBy);
	return {
		...base,
		item_id: options.itemId,
		qty: options.qty,
		unit: options.unit ?? 'piece',
		reason: 'receive',
		ref_id: options.poolId,
		lot_ref: id,
		lot: {
			note: 'bulk_return_pool',
			...(options.point
				? { storage_point_id: options.point.id, storage_zone: options.point.name }
				: {})
		},
		occurred_at: base.created_at
	};
}

// ── Seeders (admin API) ─────────────────────────────────────────────────────────────────────

/** A returnable durable item with stock — the only kind the add-entry dialog offers. */
export async function seedReturnableItem(
	scenario: DistributionScenario,
	label: string
): Promise<SeededItem> {
	return seedItemWithStock(scenario, {
		name: `E2E brp ${label} ${scenario.namespace}`,
		stockQty: '20',
		returnable: true,
		typeClass: 'DURABLE'
	});
}

/** An OPEN v3 pool. Seed BEFORE the page loads: the board reads the pool list once on mount. */
export async function seedOpenPool(
	scenario: DistributionScenario,
	options: { name: string; location?: PointRef; notes?: string }
): Promise<SeededPool> {
	const body = buildPoolBody({ ...options, createdBy: scenario.user.name });
	await putDocument(shelterDb(), body);
	return { poolId: body._id, name: options.name };
}

/** A SUBMITTED v3 pool with a consistent snapshot (for direct-write tests; entries not seeded). */
export async function seedSubmittedPool(
	scenario: DistributionScenario,
	options: { name: string; items: Array<{ item: SeededItem; qty: string }> }
): Promise<SeededPool> {
	const open = buildPoolBody({ name: options.name, createdBy: scenario.user.name });
	const body = submitBody(open, scenario.user.name, {
		itemsSummary: options.items.map(({ item, qty }) => ({ item_id: item.itemId, qty })),
		entryIds: options.items.map(() => `bulk_return_entry:${ulid()}`)
	});
	await putDocument(shelterDb(), body);
	return { poolId: body._id, name: options.name };
}

/**
 * One drop-off entry in `pool`. Writes ONLY the entry: when `loanRefs` is given the loan itself is
 * not touched, so pass them only where the test does not look at the loan.
 */
export async function seedEntry(
	scenario: DistributionScenario,
	pool: Pick<SeededPool, 'poolId'>,
	options: { item: SeededItem; qty: string; returner: Returner; loanRefs?: LoanRef[] }
): Promise<string> {
	const body = buildEntryBody({
		poolId: pool.poolId,
		itemId: options.item.itemId,
		qty: options.qty,
		returner: options.returner,
		loanRefs: options.loanRefs,
		createdBy: scenario.user.name
	});
	await putDocument(shelterDb(), body);
	return body._id;
}

export interface SeededLoan {
	item: SeededItem;
	ticket: SeededTicket;
	logId: string;
}

/** An outstanding `qty` loan of a fresh returnable item to `recipient` (admin API, not the desk). */
export async function seedLoan(
	scenario: DistributionScenario,
	recipient: SeededRecipient,
	label: string,
	qty: string
): Promise<SeededLoan> {
	const item = await seedReturnableItem(scenario, label);
	const ticket = await seedTicket(scenario, {
		type: 'supplies',
		status: 'DISTRIBUTING',
		lines: [{ item, allocatedQty: qty }]
	});
	const logId = await seedDistributionLog(scenario, {
		ticket,
		item,
		recipient,
		qty,
		returnable: true
	});
	return { item, ticket, logId };
}

export interface LentLoan extends SeededLoan {
	desk: DeskPage;
	recipient: SeededRecipient;
}

/**
 * Lend `qty` of a new returnable item to a new evacuee through the desk (tab 3), then land on
 * tab 4 with the borrower selected. Port of `issueLoan` in distribution-desk-returns-close.test.ts
 * (a spec file cannot be imported). Acts as the page's current user — the scenario's SM by default.
 */
export async function lendViaDesk(
	page: Page,
	scenario: DistributionScenario,
	qty: string
): Promise<LentLoan> {
	const item = await seedItemWithStock(scenario, {
		name: `E2E brp durable ${scenario.namespace}`,
		stockQty: qty,
		returnable: true,
		typeClass: 'DURABLE'
	});
	const recipient = await seedRecipient(
		scenario,
		`Brp${scenario.namespace.slice(-6)}`,
		'Recipient'
	);
	const ticket = await seedTicket(scenario, {
		type: 'supplies',
		status: 'DISTRIBUTING',
		lines: [{ item, allocatedQty: qty }]
	});
	const desk = new DeskPage(page);
	await desk.goto();
	await desk.openTab('supplies');
	await desk.selectPoint(scenarioPoint(scenario));
	await desk.selectTicket('supplies', ticket);
	await desk.itemButton(item.name).click();
	await desk.chooseRecipientBySearch(recipient);
	await desk.fillSuppliesQty(qty);
	await desk.suppliesSubmit('loan').click();
	await expect(desk.toast(/บันทึกยืมสิ่งของสำเร็จ/)).toBeVisible();
	const [log] = await expectTicketLogs(ticket, item, 1, 'Loan issuance');
	expect(log.status).toBe('active');

	await desk.openTab('returns');
	await desk.chooseRecipientBySearch(recipient);
	return { desk, item, ticket, recipient, logId: log._id };
}

// ── Readers (raw docs) ──────────────────────────────────────────────────────────────────────

export async function readPool(poolId: string): Promise<CouchDocument> {
	const doc = await getShelterDocument(poolId);
	if (!doc) throw new Error(`bulk return pool ${poolId} does not exist`);
	return doc;
}

export function readPoolsByName(name: string): Promise<CouchDocument[]> {
	return findShelterDocuments((doc) => doc.type === 'bulk_return_pool' && doc.name === name);
}

/** Wait until a pool with this name exists (created through the UI) and return its id. */
export async function waitForPoolByName(name: string): Promise<string> {
	await expect
		.poll(async () => (await readPoolsByName(name)).length, {
			message: `pool "${name}" was not persisted`
		})
		.toBeGreaterThan(0);
	return (await readPoolsByName(name))[0]._id;
}

/** Entries originally recorded into `poolId` (a moved entry still lists under its first pool). */
export function readEntries(poolId: string): Promise<CouchDocument[]> {
	return findShelterDocuments((doc) => doc.type === 'bulk_return_entry' && doc.pool_id === poolId);
}

/** Move docs of one entry in seq order (`bulk_return_entry_move:{ulid}:0001`, …). */
export async function readMoves(entryId: string): Promise<CouchDocument[]> {
	const moves = await findShelterDocuments(
		(doc) => doc.type === 'bulk_return_entry_move' && doc.entry_id === entryId
	);
	return moves.sort((a, b) => Number(a.seq) - Number(b.seq));
}

export function readVoids(entryId: string): Promise<CouchDocument[]> {
	return findShelterDocuments(
		(doc) => doc.type === 'bulk_return_entry_void' && doc.entry_id === entryId
	);
}

/** The pool an entry sits in now: the target of its last move, else the pool it was recorded in. */
export async function currentPoolOf(entry: CouchDocument): Promise<string> {
	const moves = await readMoves(entry._id);
	const last = moves[moves.length - 1];
	return String(last ? last.to_pool_id : entry.pool_id);
}

/** `stock_ledger` rows of a receive (`reason 'receive'`, `ref_id` = the pool id). */
export function receiveLedgerRows(poolId: string): Promise<CouchDocument[]> {
	return ledgerRows('receive', poolId);
}

/** `status` of a shelter doc (loan, pool), or undefined when it does not exist — for `expect.poll`. */
export async function readStatus(id: string): Promise<unknown> {
	return (await getShelterDocument(id))?.status;
}

/** A shelter doc by id; throws when it is missing (use `getShelterDocument` to allow null). */
export async function readDoc(id: string): Promise<CouchDocument> {
	const doc = await getShelterDocument(id);
	if (!doc) throw new Error(`${id} does not exist`);
	return doc;
}

/** Ids of `docs`, sorted — for comparing id sets with `toEqual`. */
export function sortedIds(docs: CouchDocument[]): string[] {
	return docs.map((doc) => doc._id).sort();
}

/** A string-array field (e.g. `entry_ids`, `applied_bulk_entry_ids`) sorted; `[]` when absent. */
export function sortedStrings(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String).sort() : [];
}
