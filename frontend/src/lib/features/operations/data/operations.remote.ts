import {
	allDocsByIds,
	bulkDocs,
	bulkDocsDetailed,
	findDocsPage,
	getDoc,
	putDocStrict
} from '$lib/db/couch-db';
import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterCode, getShelterDb } from '$lib/db/shelter';
import { now, touch, type AuthorContext } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import { ConflictError } from '$lib/utils/errors';
import {
	makeLotReservationDocId,
	createStockLotReservation,
	assertSemanticReservationMatch,
	InsufficientStockError,
	type StockLotReservation,
	type StockLotPendingClaim
} from '$lib/features/distribution';
import {
	CampaignUnitMismatchError,
	createCampaign as buildCampaign,
	isDonationCampaign,
	isStockLedger,
	isDonation,
	isDonationSlot,
	isStockTransfer,
	TransferForbiddenError,
	TRANSFER_IDS_PER_REQUEST,
	isTransferDestination,
	stockBalance,
	createReceiveEntry,
	createWalkInDonation,
	keyDonationReceipt,
	completeDonationReceipt,
	isDonationOutstanding,
	createDistributeEntry,
	createAdjustEntry,
	projectStockLotBalances,
	assertLotWriteOffsFit,
	type DonationCampaign,
	type CampaignInput,
	type StockLedger,
	type ReceiveInput,
	type DistributeInput,
	type AdjustInput,
	type Donation,
	type WalkInDonationInput,
	type DonationSlot,
	type StockTransfer,
	type TransferDestination,
	type TransferInput,
	type TransferFilter,
	type TransferStatus,
	type DispatchInfoInput,
	type CancelInfoInput,
	type DisputeInfoInput
} from '../domain/operations';
import { assertDonationSlotDeletable, countSlotBookings, slotMode } from '../domain/donation-slot';
import { ItemMergeError, planItemMerge } from '../domain/item-merge';
import type { MergeItemsInput, ItemMergeResult } from '../domain/item-merge';
import { createAuditEntry, type AuditAction } from '$lib/features/shared';
import {
	deriveDonationReceiptLineId,
	donationShortfall,
	isReceivedLine,
	type DonationBatchLine,
	type DonationBatchLineResult,
	type DonationBatchResult
} from '../domain/donation-batch';
import {
	createCycleCountEntries,
	deriveCycleCountLineId,
	type CycleCountLineResult,
	type CycleCountResult,
	type CycleCountSubmission
} from '../domain/cycle-count';
import type { OperationsRepository } from './operations.repository';
import { isLedgerRefDoc, type LedgerRefDoc } from '../domain/ledger-ref';
import { supplyRepository, type SupplyItem } from '$lib/features/supply';
import {
	isItemMaster,
	itemMasterUnit,
	requiresExpiry,
	assertKnownUnitCodes,
	isLegacyUnitLabel,
	catalogRepository,
	type ItemMaster
} from '$lib/features/catalog';
import { addQty, persistQty, qtyAbs, qtyGt, qtyGte, qtyLte, subQty } from '$lib/utils/qty';

/**
 * A catalog row a ledger entry can point at. The `catalog` database holds two
 * shapes: the T-10 `item:{ulid}` supply stub (`unit`, `perishable`) and the
 * CR-013 `item_master:{ulid}` master (`base_unit`, no perishable flag — CR-143 §D
 * derives the expiry requirement from storage / shelf life instead). Item
 * pickers already offer both, so both must survive the guards below.
 */
export type CatalogItem = SupplyItem | ItemMaster;

// A direct distribution is a short-lived browser operation. Claims older than
// this window with no deterministic ledger row are recoverable abandoned work.
// Approval claims use different operation IDs and are deliberately left for
// their own workflow to reconcile.
const DIRECT_DISTRIBUTION_CLAIM_RECOVERY_AGE_MS = 15 * 60 * 1000;

/** The unit + expiry rules a receive/adjust must satisfy, whichever shape it is. */
export function catalogItemRules(item: CatalogItem): { unit: string; requiresExpiry: boolean } {
	return {
		unit: isItemMaster(item) ? itemMasterUnit(item) : item.unit,
		requiresExpiry: requiresExpiry(item)
	};
}

export function assertReceiveAgainstCatalog(
	entry: StockLedger,
	item: CatalogItem | null,
	opts: { requireExpiry?: boolean } = {}
): void {
	if (!item) {
		throw new Error(
			`Unknown item: ${entry.item_id} — item must exist in the catalog before receiving stock`
		);
	}
	const rules = catalogItemRules(item);
	if (rules.unit !== entry.unit) {
		throw new Error(
			`Unit mismatch for item ${entry.item_id}: expected ${rules.unit}, got ${entry.unit}`
		);
	}
	if ((opts.requireExpiry ?? true) && rules.requiresExpiry && !entry.lot?.expiry) {
		throw new Error(`Perishable item ${entry.item_id} requires lot.expiry to be set`);
	}
}

/** Ledger rows of one donation: one per received line, so this is far above any real receipt. */
const DONATION_LEDGER_LIMIT = 1000;

/** Rows per `_find` round when a set of items' ledger history is read to the end. */
const LEDGER_PAGE_LIMIT = 1000;

/** Tries at closing a batch receipt while other writes keep moving its `_rev` (S-R14-1). */
const MAX_CLOSE_ATTEMPTS = 3;

/** What staff are told when the booking changed under a batch receipt (S-R4-1). */
const DONATION_CHANGED_WHILE_KEYING =
	'ใบนี้ถูกแก้ระหว่างบันทึกเข้าคลัง — ของเข้าคลังแล้วแต่ยังไม่ปิดใบ ติดต่อผู้ดูแลเพื่อตรวจยอด';

/**
 * Whether the booking changed in a way the receipt was counted against. A courier number
 * or other logistics edit bumps `_rev` too, but leaves what was counted standing.
 */
function bookingChanged(before: Donation, after: Donation): boolean {
	return (
		before.status !== after.status || JSON.stringify(before.items) !== JSON.stringify(after.items)
	);
}

export class OperationsRemoteRepository implements OperationsRepository {
	private readonly dbName: string;
	private readonly repo: Repository;

	constructor(dbName: string = getShelterDb()) {
		this.dbName = dbName;
		this.repo = createRemoteRepository(dbName);
	}

	/**
	 * Read the catalog row backing a ledger entry. `getItem` fetches by `_id` from
	 * the single `catalog` database, so it returns either shape — the `type`
	 * discriminator, not the typing here, decides which rules apply.
	 */
	private async loadCatalogItem(itemId: string): Promise<CatalogItem | null> {
		const item = await supplyRepository().getItem(itemId);
		if (item) return item;

		if (itemId.startsWith('item_master:')) {
			const shelterCode = this.dbName.startsWith('shelter_')
				? this.dbName.replace('shelter_', '').toUpperCase()
				: null;
			const itemMaster = await catalogRepository().getItemMaster(itemId, shelterCode);
			if (itemMaster) return itemMaster;
		}
		return null;
	}

	// --- Ledger Methods ---

	async addLedgerEntry(entry: StockLedger): Promise<StockLedger> {
		return this.repo.put(entry);
	}

	async getLedgerEntry(id: string): Promise<StockLedger | null> {
		return this.repo.get<StockLedger>(id);
	}

	async listLedger(): Promise<StockLedger[]> {
		return this.repo.allByType('stock_ledger', isStockLedger);
	}

	async listLedgerByItem(itemId: string): Promise<StockLedger[]> {
		const ledger = await this.listLedger();
		return ledger.filter((entry) => entry.item_id === itemId);
	}

	async listDonationLedger(donationId: string): Promise<StockLedger[]> {
		const rows = await this.repo.find<StockLedger>({
			// `item_id` is in the selector so the `['type','ref_id','item_id','reason']` index
			// covers the query; `$gt: null` keeps every item.
			selector: {
				type: 'stock_ledger',
				ref_id: donationId,
				item_id: { $gt: null },
				reason: 'donation'
			},
			limit: DONATION_LEDGER_LIMIT
		});
		return rows.filter(isStockLedger);
	}

	async listLedgerByItems(itemIds: readonly string[]): Promise<StockLedger[]> {
		// One equality read per item, so CouchDB picks `ledger-type-itemid-idx` (`type` + `item_id`):
		// an `$in` cannot range-scan that index and would read every `stock_ledger` row instead.
		const perItem = await Promise.all(
			[...new Set(itemIds)].map((itemId) => this.listLedgerOfItem(itemId))
		);
		return perItem.flat();
	}

	private async listLedgerOfItem(itemId: string): Promise<StockLedger[]> {
		const rows: StockLedger[] = [];
		let bookmark: string | null = null;
		for (;;) {
			const page: { docs: StockLedger[]; bookmark: string | null } =
				await findDocsPage<StockLedger>(this.dbName, {
					selector: { type: 'stock_ledger', item_id: itemId },
					limit: LEDGER_PAGE_LIMIT,
					...(bookmark ? { bookmark } : {})
				});
			rows.push(...page.docs.filter(isStockLedger));
			// A short page is the end; a bookmark that does not move would loop forever.
			if (page.docs.length < LEDGER_PAGE_LIMIT || !page.bookmark || page.bookmark === bookmark) {
				return rows;
			}
			bookmark = page.bookmark;
		}
	}

	async listLedgerRefDocs(refIds: readonly string[]): Promise<LedgerRefDoc[]> {
		// `stock_transfer` lives in `central_ops`, not this shelter's DB (see the transfer methods
		// below), so those ids come from the transfer BFF — by id, since a ref can point at a
		// transfer older than any page of the list. An account it refuses keeps the short ref.
		const transferIds = refIds.filter((id) => id.startsWith('stock_transfer:'));
		const shelterIds = refIds.filter((id) => !id.startsWith('stock_transfer:'));
		const [shelterDocs, transfers] = await Promise.all([
			allDocsByIds(this.dbName, shelterIds, isLedgerRefDoc),
			this.listTransfersByIds(transferIds).catch((e: unknown) => {
				if (e instanceof TransferForbiddenError) return [];
				throw e;
			})
		]);
		return [...shelterDocs, ...transfers];
	}

	private async listTransfersByIds(ids: readonly string[]): Promise<StockTransfer[]> {
		const batches: string[][] = [];
		for (let i = 0; i < ids.length; i += TRANSFER_IDS_PER_REQUEST) {
			batches.push(ids.slice(i, i + TRANSFER_IDS_PER_REQUEST));
		}
		const lists = await Promise.all(batches.map((batch) => this.listTransfers({ ids: batch })));
		return lists.flat();
	}

	async getBalance(): Promise<Map<string, string>> {
		const ledger = await this.listLedger();
		return stockBalance(ledger);
	}

	async receiveStock(input: ReceiveInput, ctx: AuthorContext): Promise<StockLedger> {
		const entry = createReceiveEntry(input, ctx);
		const item = await this.loadCatalogItem(entry.item_id);
		assertReceiveAgainstCatalog(entry, item);
		return this.addLedgerEntry(entry);
	}

	async receiveWalkInDonation(
		donationInput: WalkInDonationInput,
		receiveInput: ReceiveInput,
		ctx: AuthorContext
	): Promise<{ donation: Donation; entry: StockLedger }> {
		const donation = createWalkInDonation(donationInput, ctx);
		// a walk-in is a donation by definition — do not let a caller say otherwise
		// and end up rejected by the R2 guard for a reason it cannot explain
		const entry = createReceiveEntry(
			{ ...receiveInput, source: 'donation', ref_id: donation._id },
			ctx
		);

		const item = await this.loadCatalogItem(entry.item_id);
		assertReceiveAgainstCatalog(entry, item);

		// One request for both docs (mirrors kitchen `issueRequisition` and
		// `receiveStock`). Writing the donation on its own — as a separate
		// button press — would leave a `declared` donation behind whenever the
		// receipt never followed, and `calculateReserved` counts those forever
		// (nothing calls `expireDonation`). Minting both here means an abandoned
		// form leaves nothing at all.
		//
		// NOT atomic, and the gap is asymmetric. `_bulk_docs` runs
		// `validate_doc_update` per document, and the two docs answer to different
		// rules: `donation` has no role gate, while `stock_ledger` requires
		// warehouse_staff / shelter_manager / system_admin
		// (`server/shelter-access-design.ts`). A writer who has lost the warehouse
		// role therefore gets the donation accepted and the ledger row rejected —
		// this call throws, but the donation is already persisted and starts
		// inflating reserved stock. The only realistic trigger is a role revoked
		// while the form sits open: the route guard (`requireWarehouseAccess`) and
		// the design doc read the same roles, so there is no systematic mismatch,
		// and every other rule in the design doc applies equally to both docs or
		// only fires on update. Closing it for real means either gating `donation`
		// the same way (a provisioning change — redeploy `_design/access` on every
		// shelter DB) or sweeping stale `declared` donations; both are their own CR.
		const [savedDonation, savedEntry] = await bulkDocs<Donation | StockLedger>(this.dbName, [
			donation,
			entry
		]);
		return { donation: savedDonation as Donation, entry: savedEntry as StockLedger };
	}

	/** Ids of the donation ledger rows pointing at this booking (CR-143 rows key `ref_id`). */
	private async keyedDonationRowIds(donationId: string, limit: number): Promise<string[]> {
		const rows = await this.repo.find<{ _id: string }>({
			// `item_id` is in the selector only so CouchDB picks `ledger-type-refid-itemid-reason-idx`
			// (shelter-access-design.ts): without it the query scans the whole shelter DB.
			selector: {
				type: 'stock_ledger',
				ref_id: donationId,
				item_id: { $gt: null },
				reason: 'donation'
			},
			fields: ['_id'],
			limit
		});
		return rows.map((row) => row._id);
	}

	/** Any donation ledger row pointing at this booking. */
	private async hasKeyedDonationStock(donationId: string): Promise<boolean> {
		return (await this.keyedDonationRowIds(donationId, 1)).length > 0;
	}

	async receiveDonationBatch(
		donation: Donation,
		counted: readonly DonationBatchLine[],
		ctx: AuthorContext
	): Promise<DonationBatchResult> {
		if (donation.kind !== 'items') {
			throw new Error('Only a goods donation can be received into stock');
		}
		// The booking as it is now, before anything is keyed — the form holds the copy it was
		// opened with. Staff may have refused a line, and since CR-174 the donor may edit or
		// cancel a booking that has its QR (FR-20/21); counting against an older copy keyed
		// goods the booking no longer asks for. A booking already `received` is the FR-B8
		// retry of a transition whose answer was lost: its rows are found by id below.
		const onFile = (await this.repo.get<Donation>(donation._id)) ?? donation;
		if (onFile.status !== 'received') {
			const stale = !isDonationOutstanding(onFile.status)
				? `ใบนี้ปิดไปแล้ว (สถานะ ${onFile.status}) — รับเข้าคลังไม่ได้`
				: onFile._rev !== donation._rev
					? 'ใบนี้ถูกแก้หลังจากเปิดหน้าไว้ — เลือกใบใหม่แล้วนับอีกครั้ง'
					: null;
			if (stale) {
				// Say what is true about the stock: an earlier, interrupted attempt may already
				// have keyed some lines, and "nothing in stock" would invite counting them again.
				throw new Error(
					(await this.hasKeyedDonationStock(donation._id))
						? `${stale} · มีของบางรายการของใบนี้เข้าคลังไปแล้ว อย่านับรายการนั้นซ้ำ — ติดต่อผู้ดูแลเพื่อตรวจยอด`
						: `${stale} · ยังไม่มีของเข้าคลัง`
				);
			}
		}
		// Received already, by a screen other than this copy. A true retry (the answer to a
		// transition that did land was lost) finds every row by id and writes nothing; a
		// second device counting differently would key the goods a second time.
		const receivedElsewhere = onFile.status === 'received' && donation.status !== 'received';
		const seenLineNos = new Set<number>();
		for (const line of counted) {
			if (!Number.isInteger(line.line_no) || line.line_no < 0) {
				throw new Error(`Invalid line number ${line.line_no} — must be a non-negative integer`);
			}
			if (seenLineNos.has(line.line_no)) {
				throw new Error(`Duplicate line number ${line.line_no} in the donation receipt`);
			}
			seenLineNos.add(line.line_no);
			if (!line.item_id) {
				throw new Error(`Line ${line.line_no} has no item — match it to the catalog first`);
			}
			if (!qtyGte(line.qty, 0)) {
				throw new Error(`Line ${line.line_no} has a negative quantity`);
			}
			// CR-174 AC-3 — a line refused at review is not received at the shelf either.
			if (onFile.items?.[line.line_no]?.review_status === 'rejected' && isReceivedLine(line)) {
				throw new Error(
					`รายการที่ ${line.line_no + 1} ถูกปฏิเสธตอนประเมินแล้ว — รับเข้าคลังไม่ได้`
				);
			}
		}
		// Zero lines write nothing (FR-B3). A receipt with nothing received at all must not
		// reach `received`: with no row to key it, `calculateReserved` would hold the whole
		// declaration forever. That donation should be cancelled instead.
		const receivedLines = counted.filter(isReceivedLine);
		if (receivedLines.length === 0) {
			throw new Error('Nothing was received — set at least one line above zero');
		}

		// FR-B4a: the row ids are fixed by (donation, item, line), so a row left by an earlier
		// attempt is found by id and never written twice (AC-B5).
		const ids = await Promise.all(
			receivedLines.map((line) =>
				deriveDonationReceiptLineId(donation._id, line.item_id, line.line_no)
			)
		);
		const existing = await Promise.all(ids.map((id) => this.repo.get<StockLedger>(id)));

		const results = new Map<number, DonationBatchLineResult>();
		for (const line of counted) {
			if (!isReceivedLine(line)) {
				results.set(line.line_no, {
					line_no: line.line_no,
					item_id: line.item_id,
					state: 'skipped'
				});
			}
		}

		const toWrite: { line: DonationBatchLine; id: string }[] = [];
		receivedLines.forEach((line, index) => {
			const id = ids[index];
			const row = existing[index];
			if (!row) {
				toWrite.push({ line, id });
				return;
			}
			// Rows are append-only: a retry that disagrees with what is already recorded must
			// stop here rather than pretend the edit landed.
			if (
				row.item_id !== line.item_id ||
				row.unit !== line.unit ||
				persistQty(row.qty) !== persistQty(line.qty)
			) {
				throw new Error(
					`Line ${line.line_no} was already recorded as ${row.qty} ${row.unit}; it cannot be changed`
				);
			}
			results.set(line.line_no, {
				line_no: line.line_no,
				item_id: line.item_id,
				state: 'saved',
				ledger_id: id
			});
		});
		if (receivedElsewhere && toWrite.length > 0) {
			throw new Error(
				'ใบนี้รับเข้าคลังไปแล้วจากอีกหน้าจอ — ไม่ได้บันทึกซ้ำ เลือกใบใหม่เพื่อดูผลที่บันทึกไว้'
			);
		}
		// Row ids only catch a retry that matches every line the same way. A line keyed as
		// one item and now matched to another (after a reload, or on a second device counting
		// at once) gets a new id, and the goods would go into stock twice — and `_rev` does
		// not move until the booking closes, so it cannot tell either. The ledger can: a row
		// of this booking this count would not write means an earlier or concurrent count
		// recorded something else. Any status — a booking closed before its rows were keyed
		// reads `received` on both screens. One more than `ids` is enough to see one: at
		// most `ids.length` of them are ours.
		const keyedByAnother =
			toWrite.length > 0 &&
			(await this.keyedDonationRowIds(donation._id, ids.length + 1)).some(
				(id) => !ids.includes(id)
			);
		if (keyedByAnother) {
			throw new Error(
				'ใบนี้มีของบันทึกเข้าคลังไว้แล้วที่ไม่ตรงกับรายการที่นับรอบนี้ (เช่น เลือกสินค้าคนละตัวกับครั้งก่อน) — ไม่ได้บันทึกซ้ำ ตรวจรายการ "บันทึกเข้าคลังไว้ก่อนหน้านี้" แล้วเลือกสินค้าให้ตรงกับที่บันทึกไว้ หรือติดต่อผู้ดูแลเพื่อตรวจยอด'
			);
		}

		if (toWrite.length > 0) {
			const entries = keyDonationReceipt(
				donation,
				toWrite.map(({ line }) => line),
				ctx,
				toWrite.map(({ id }) => id)
			);
			// Validate every row against the catalog (unit, FR-D2 expiry) BEFORE writing any:
			// a bad line must not leave its neighbours half recorded.
			const catalog = new Map<string, CatalogItem | null>();
			for (const entry of entries) {
				if (!catalog.has(entry.item_id)) {
					catalog.set(entry.item_id, await this.loadCatalogItem(entry.item_id));
				}
				assertReceiveAgainstCatalog(entry, catalog.get(entry.item_id) ?? null);
			}

			const outcomes = new Map<string, { ok: boolean; reason: string }>();
			try {
				for (const outcome of await bulkDocsDetailed<StockLedger>(this.dbName, entries)) {
					outcomes.set(outcome.id, {
						ok: outcome.ok,
						reason: outcome.ok ? '' : `${outcome.error}: ${outcome.reason}`
					});
				}
			} catch (err) {
				// Transport failure: nothing is known about any row, so each is read back below.
				const reason = err instanceof Error ? err.message : 'bulk write failed';
				for (const { id } of toWrite) outcomes.set(id, { ok: false, reason });
			}

			for (const { line, id } of toWrite) {
				const outcome = outcomes.get(id);
				let saved = outcome?.ok === true;
				const reason = outcome?.reason ?? 'no result for this row';
				if (!saved) {
					// A 409 on a deterministic id means the row is already there, and a lost
					// response may hide a row that did land: the ledger itself decides.
					try {
						saved = (await this.repo.get<StockLedger>(id)) !== null;
					} catch {
						// keep `saved = false`; the original reason stays the one shown
					}
				}
				results.set(line.line_no, {
					line_no: line.line_no,
					item_id: line.item_id,
					state: saved ? 'saved' : 'failed',
					ledger_id: id,
					...(saved ? {} : { error: reason })
				});
			}
		}

		const lines = counted.map((line) => results.get(line.line_no)!);
		const rowsComplete = lines.every((line) => line.state !== 'failed');
		if (!rowsComplete) {
			return { donation, lines, rowsComplete: false, received: false };
		}

		const blocked: DonationBatchResult = {
			donation,
			lines,
			rowsComplete: true,
			received: false,
			transitionError: DONATION_CHANGED_WHILE_KEYING,
			transitionBlocked: true
		};
		// FR-B4b / FR-B8: the donation moves only after every row is in the ledger, and a
		// failure here is retried on its own — the rows above are found by id, not rewritten.
		let closing: Donation | undefined;
		for (let attempt = 0; ; attempt++) {
			try {
				const latest = (await this.repo.get<Donation>(donation._id)) ?? donation;
				// Already closed with its summary: the first receipt stands, nothing is rewritten.
				if (latest.status === 'received' && latest.received_summary) {
					return { donation: latest, lines, rowsComplete: true, received: true };
				}
				// The booking moved while its rows were keyed — a line refused on another screen,
				// the donor editing or cancelling, the TTL lapsing. Closing it from this count
				// would write over that change, so stop and leave it to someone to check.
				if (bookingChanged(onFile, latest)) return blocked;
				closing = latest;
				const nextBase = completeDonationReceipt(latest);
				const declaredLines = latest.items ?? [];
				const countedByLine = new Map(counted.map((c) => [c.line_no, c]));
				// "ไม่รับ" is not "ขาด" (CR-172 FR-13): a line refused at review leaves the
				// comparison. A typed-in line is compared under the item staff matched it to —
				// keyed by its own words it never met its count and read as a shortfall.
				const declaredForShortfall = declaredLines.flatMap((item, index) =>
					item.review_status === 'rejected'
						? []
						: [
								{
									item_id: item.item_id || countedByLine.get(index)?.item_id || item.free_text,
									qty: String(item.qty)
								}
							]
				);
				const countedForShortfall = counted.map((c) => ({
					item_id: c.item_id,
					qty: String(c.qty)
				}));
				const shortfalls = donationShortfall(declaredForShortfall, countedForShortfall);
				// One entry per declared line, in order — the tracking page reads them by position —
				// then any line counted off the ticket.
				const summaryItems = [
					...declaredLines.map((item, index) => {
						if (item.review_status === 'rejected') {
							return {
								...(item.item_id ? { item_id: item.item_id } : {}),
								...(item.free_text ? { free_text: item.free_text } : {}),
								qty: '0',
								unit: item.unit,
								rejected: true,
								...(item.review_reason ? { reject_reason: item.review_reason } : {}),
								...(item.review_reason_code ? { reject_reason_code: item.review_reason_code } : {})
							};
						}
						const line = countedByLine.get(index);
						// The donor's own words stay beside the item staff matched them to.
						const words = item.free_text ? { free_text: item.free_text } : {};
						return line
							? { item_id: line.item_id, ...words, qty: String(line.qty), unit: line.unit }
							: { item_id: item.item_id, ...words, qty: '0', unit: item.unit };
					}),
					...counted
						.filter((c) => c.line_no >= declaredLines.length)
						.map((c) => ({ item_id: c.item_id, qty: String(c.qty), unit: c.unit }))
				];
				const next: Donation = {
					...nextBase,
					received_summary: {
						total_items: summaryItems.length,
						received_at: nextBase.received_at ?? new Date().toISOString(),
						items: summaryItems,
						shortfalls: shortfalls.map((s) => ({
							item_id: s.item_id,
							declared: s.declared,
							counted: s.counted,
							short: s.short
						}))
					}
				};
				// Written against `latest._rev`, not whatever is on file by then: a change landing
				// after the check above conflicts here instead of being overwritten.
				const saved = next === latest ? latest : await this.repo.put(touch(next));
				return { donation: saved, lines, rowsComplete: true, received: true };
			} catch (err) {
				// `ConflictError` is not only a 409: CouchDB's other 4xx answers arrive as one too.
				// A new `_rev` on file means someone did write the booking, so check again from
				// the top: a close whose answer was lost reads as received, a refused line or a
				// donor edit blocks, and a courier number alone is closed over. A booking that
				// keeps moving is left for someone to check.
				if (err instanceof ConflictError && closing) {
					const current = await this.repo.get<Donation>(donation._id).catch(() => null);
					if (current?.status === 'received' && current.received_summary) {
						return { donation: current, lines, rowsComplete: true, received: true };
					}
					if (current && current._rev !== closing._rev) {
						if (attempt < MAX_CLOSE_ATTEMPTS - 1) continue;
						return blocked;
					}
				}
				return {
					donation,
					lines,
					rowsComplete: true,
					received: false,
					transitionError:
						err instanceof Error ? err.message : 'Could not mark the donation received'
				};
			}
		}
	}

	async distributeStock(input: DistributeInput, ctx: AuthorContext): Promise<StockLedger> {
		const operationId = `op_dist_${ulid()}`;
		const entry = createDistributeEntry(input, ctx, operationId);
		const lotRef = entry.lot_ref;
		if (!lotRef) {
			throw new Error('Distribute stock requires a physical lot reference');
		}

		const requestId = `distribution_request:direct-${ulid()}`;
		// Ticket-era ledger rows point at the requisition ticket, while reservation
		// claims retain the distribution_batch namespace required by their schema.
		// Keep those identities separate for direct distribution operations.
		const batchId = entry.ref_id?.startsWith('distribution_batch:')
			? entry.ref_id
			: `distribution_batch:direct-${operationId}`;
		const requestedQty = qtyAbs(entry.qty);
		const resId = await makeLotReservationDocId(lotRef);

		// Acquire reservation claim with remote CouchDB CAS
		const maxRetries = 5;
		let acquired = false;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const ledger = await this.listLedger();
			// Lots never cross items: replay only this item's rows so another item's impossible
			// history cannot block a healthy distribute (same scope as the write-off check).
			const lots = projectStockLotBalances(ledger.filter((row) => row.item_id === entry.item_id));
			const selectedLot = lots.find((lot) => lot.lot_ref === lotRef);

			if (!selectedLot) {
				// Not among this item's lots: either another item's lot or no such lot at all.
				const belongsToOtherItem = ledger.some(
					(row) => row.item_id !== entry.item_id && (row.lot_ref ?? row._id) === lotRef
				);
				if (belongsToOtherItem) {
					throw new Error(
						`Selected stock lot ${lotRef} does not match item ${entry.item_id} and unit ${entry.unit}`
					);
				}
				throw new Error(`Selected stock lot ${lotRef} is not available for item ${entry.item_id}`);
			}
			if (selectedLot.item_id !== entry.item_id || selectedLot.unit !== entry.unit) {
				throw new Error(
					`Selected stock lot ${lotRef} does not match item ${entry.item_id} and unit ${entry.unit}`
				);
			}

			const physicalBalance = selectedLot.qty;

			let resDoc: StockLotReservation;
			const rawRes = await getDoc<{ _id: string }>(this.dbName, resId);
			if (!rawRes) {
				resDoc = createStockLotReservation(
					{ lot_ref: lotRef, pending_claims: [] },
					resId.slice('stock_lot_reservation:'.length),
					ctx
				);
			} else {
				resDoc = assertSemanticReservationMatch(rawRes, {
					_id: resId,
					lot_ref: lotRef,
					shelter_code: ctx.shelterCode
				});
			}

			const existingMyClaim = resDoc.pending_claims.find((c) => c.operation_id === operationId);
			if (existingMyClaim) {
				acquired = true;
				break;
			}

			const recoverableClaimIds = await this.findRecoverableReservationClaims(
				resDoc,
				ledger,
				operationId
			);
			if (recoverableClaimIds.size > 0) {
				try {
					await putDocStrict<StockLotReservation>(this.dbName, {
						...resDoc,
						pending_claims: resDoc.pending_claims.filter(
							(claim) => !recoverableClaimIds.has(claim.operation_id)
						),
						updated_at: now()
					});
				} catch (reconcileErr) {
					if (!(reconcileErr instanceof ConflictError) || attempt === maxRetries) {
						throw reconcileErr;
					}
					await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 20));
				}
				continue;
			}

			// Only deduct claims whose ledger rows have not yet been committed to the physical ledger,
			// to prevent double-counting when a concurrent client has already appended its ledger row.
			const otherUncommittedClaims = resDoc.pending_claims
				.filter((c) => c.operation_id !== operationId)
				.filter((c) => !ledger.some((l) => l._id === `stock_ledger:${c.operation_id}`))
				.reduce((sum, c) => addQty(sum, c.qty), '0');

			const availableForClaim = subQty(physicalBalance, otherUncommittedClaims);

			if (qtyGt(requestedQty, availableForClaim)) {
				throw new InsufficientStockError(
					`Insufficient stock in lot ${lotRef} for item ${entry.item_id} (requested ${requestedQty}, have ${availableForClaim})`
				);
			}

			const otherPending = resDoc.pending_claims.filter((c) => c.operation_id !== operationId);
			const myClaim: StockLotPendingClaim = {
				operation_id: operationId,
				request_id: requestId,
				batch_id: batchId,
				item_id: entry.item_id,
				lot_ref: lotRef,
				qty: persistQty(requestedQty),
				claimed_at: now()
			};

			const nextResDoc: StockLotReservation = {
				...resDoc,
				pending_claims: [...otherPending, myClaim],
				updated_at: now()
			};

			try {
				await putDocStrict(this.dbName, nextResDoc);
				acquired = true;
				break;
			} catch (putErr) {
				if (!(putErr instanceof ConflictError) || attempt === maxRetries) {
					throw putErr;
				}
				await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 20));
			}
		}

		if (!acquired) {
			throw new Error(`Failed to acquire reservation for ${lotRef} after retries`);
		}

		let ledgerResult: StockLedger | undefined;
		let ledgerError: unknown;
		try {
			ledgerResult = await this.addLedgerEntry(entry);
		} catch (err) {
			ledgerError = err;
		}

		try {
			await this.releaseClaimWithRetry(lotRef, operationId, ctx, 5);
		} catch (releaseErr) {
			if (ledgerError) {
				throw new Error(
					`Stock distribution ${operationId} could not commit its ledger entry or release its reservation claim; retry after connectivity is restored`,
					{ cause: releaseErr }
				);
			}
			console.error('Failed to release committed reservation claim for lot', lotRef, releaseErr);
		}

		if (ledgerError) throw ledgerError;
		return ledgerResult!;
	}

	private async findRecoverableReservationClaims(
		resDoc: StockLotReservation,
		ledger: readonly StockLedger[],
		currentOperationId: string
	): Promise<Set<string>> {
		const recoverable = new Set<string>();
		const recoveryCutoff = Date.now() - DIRECT_DISTRIBUTION_CLAIM_RECOVERY_AGE_MS;

		for (const claim of resDoc.pending_claims) {
			if (claim.operation_id === currentOperationId) continue;

			// A committed ledger row makes the claim safe to remove immediately. This
			// repairs the case where the ledger write succeeded but cleanup lost a race.
			if (ledger.some((entry) => entry._id === `stock_ledger:${claim.operation_id}`)) {
				recoverable.add(claim.operation_id);
				continue;
			}

			if (
				!claim.operation_id.startsWith('op_dist_') ||
				Date.parse(claim.claimed_at) > recoveryCutoff
			) {
				continue;
			}

			// Re-check the deterministic ledger ID before releasing an old claim so a
			// stale projection cannot delete a claim whose write already committed.
			const committed = await getDoc<{ _id: string }>(
				this.dbName,
				`stock_ledger:${claim.operation_id}`
			);
			if (!committed) recoverable.add(claim.operation_id);
		}

		return recoverable;
	}

	private async releaseClaimWithRetry(
		lotRef: string,
		operationId: string,
		ctx: AuthorContext,
		maxRetries = 5
	): Promise<void> {
		const resId = await makeLotReservationDocId(lotRef);
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const rawDoc = await getDoc<{ _id: string }>(this.dbName, resId);
				if (!rawDoc) return;

				const resDoc = assertSemanticReservationMatch(rawDoc, {
					_id: resId,
					lot_ref: lotRef,
					shelter_code: ctx.shelterCode
				});

				const hasMyClaim = resDoc.pending_claims.some((c) => c.operation_id === operationId);
				if (!hasMyClaim) return;

				const remaining = resDoc.pending_claims.filter((c) => c.operation_id !== operationId);
				await putDocStrict<StockLotReservation>(this.dbName, {
					...resDoc,
					pending_claims: remaining,
					updated_at: now()
				});
				const confirmedRaw = await getDoc<{ _id: string }>(this.dbName, resId);
				if (!confirmedRaw) return;
				const confirmed = assertSemanticReservationMatch(confirmedRaw, {
					_id: resId,
					lot_ref: lotRef,
					shelter_code: ctx.shelterCode
				});
				if (!confirmed.pending_claims.some((c) => c.operation_id === operationId)) {
					return;
				}
			} catch (err) {
				if (!(err instanceof ConflictError) || attempt === maxRetries) {
					throw err;
				}
				await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 20));
			}
		}
	}

	async adjustStock(input: AdjustInput, ctx: AuthorContext): Promise<StockLedger> {
		const entry = createAdjustEntry(input, ctx);
		const item = await this.loadCatalogItem(entry.item_id);
		if (!item) {
			throw new Error(
				`Unknown item: ${entry.item_id} — item must exist in the catalog before adjusting stock`
			);
		}
		// The expiry rule is for receipts only (CR-156 FR-D2d): a count correction, up or down,
		// may land on a lot recorded before the item gained a shelf life and has no expiry to carry.
		assertReceiveAgainstCatalog(entry, item, { requireExpiry: false });

		if (qtyLte(entry.qty, 0) && entry.lot_ref) {
			// A write-off out of a named lot is replayed against that lot alone, so it must fit
			// that lot as the ledger stands now — not just the item's total (#569).
			assertLotWriteOffsFit(await this.listLedgerByItem(entry.item_id), [entry]);
		} else if (qtyLte(entry.qty, 0)) {
			// No lot named (an older caller): the projection takes it from the item's lots in
			// consumption order, so the item's total is what it has to fit.
			const balances = await this.getBalance();
			const currentQty = balances.get(entry.item_id) ?? '0';
			const requestedQty = qtyAbs(entry.qty);

			if (!qtyGte(currentQty, requestedQty)) {
				throw new Error(
					`Insufficient stock for item ${entry.item_id} (requested adjustment ${entry.qty}, have ${currentQty})`
				);
			}
		}
		return this.addLedgerEntry(entry);
	}

	async applyCycleCount(
		submission: CycleCountSubmission,
		ctx: AuthorContext
	): Promise<CycleCountResult> {
		if (!submission.count_id) throw new Error('A cycle count needs a count id');
		if (submission.lines.length === 0) {
			throw new Error('Nothing to record — every counted lot matches the system');
		}
		const seen = new Set<string>();
		for (const line of submission.lines) {
			const key = `${line.item_id}::${line.lot_key}`;
			if (seen.has(key))
				throw new Error(`Duplicate lot in the count: ${line.item_id} (${line.lot_key})`);
			seen.add(key);
		}

		// Ids are fixed by (count, item, lot): a row left by an earlier attempt is found by id and
		// never written twice. Rows are append-only, so a retry that disagrees with what is already
		// recorded must stop rather than pretend the edit landed.
		const ids = await Promise.all(
			submission.lines.map((l) => deriveCycleCountLineId(submission.count_id, l.item_id, l.lot_key))
		);
		const existing = await Promise.all(ids.map((id) => this.repo.get<StockLedger>(id)));
		const results = new Map<string, CycleCountLineResult>();
		const pending: { index: number; id: string }[] = [];
		submission.lines.forEach((line, index) => {
			const row = existing[index];
			if (!row) {
				pending.push({ index, id: ids[index] });
				return;
			}
			if (row.item_id !== line.item_id || persistQty(row.qty) !== persistQty(line.qty)) {
				throw new Error(
					`Lot ${line.item_id} was already counted as ${row.qty} ${row.unit}; it cannot be changed`
				);
			}
			results.set(line.lot_key + line.item_id, {
				lot_key: line.lot_key,
				item_id: line.item_id,
				state: 'saved',
				ledger_id: ids[index]
			});
		});

		if (pending.length > 0) {
			const toWrite = {
				...submission,
				lines: pending.map(({ index }) => submission.lines[index])
			};
			const entries = createCycleCountEntries(
				toWrite,
				ctx,
				pending.map(({ id }) => id)
			);

			// Validate every row BEFORE writing any: a bad line must not leave its neighbours half
			// recorded. A shortfall names its lot, so it must fit that lot as the ledger stands now
			// (#569) — the count's `system_qty` was read when the walk began. Any row without a
			// lot is checked against the item's total, summed per item (same rules as `adjustStock`).
			const catalog = new Map<string, CatalogItem | null>();
			for (const entry of entries) {
				if (!catalog.has(entry.item_id)) {
					catalog.set(entry.item_id, await this.loadCatalogItem(entry.item_id));
				}
				const item = catalog.get(entry.item_id) ?? null;
				if (!item) {
					throw new Error(
						`Unknown item: ${entry.item_id} — item must exist in the catalog before adjusting stock`
					);
				}
				assertReceiveAgainstCatalog(entry, item, { requireExpiry: false });
			}
			if (entries.some((entry) => entry.lot_ref && qtyLte(entry.qty, 0))) {
				assertLotWriteOffsFit(await this.listLedger(), entries);
			}
			const writeOffs = new Map<string, string>();
			for (const entry of entries) {
				if (qtyLte(entry.qty, 0) && !entry.lot_ref) {
					writeOffs.set(
						entry.item_id,
						addQty(writeOffs.get(entry.item_id) ?? '0', qtyAbs(entry.qty))
					);
				}
			}
			if (writeOffs.size > 0) {
				const balances = await this.getBalance();
				for (const [itemId, total] of writeOffs) {
					const have = balances.get(itemId) ?? '0';
					if (!qtyGte(have, total)) {
						throw new Error(
							`Insufficient stock for item ${itemId} (requested write-off ${total}, have ${have})`
						);
					}
				}
			}

			const outcomes = new Map<string, { ok: boolean; reason: string }>();
			try {
				for (const outcome of await bulkDocsDetailed<StockLedger>(this.dbName, entries)) {
					outcomes.set(outcome.id, {
						ok: outcome.ok,
						reason: outcome.ok ? '' : `${outcome.error}: ${outcome.reason}`
					});
				}
			} catch (err) {
				// Transport failure: nothing is known about any row, so each is read back below.
				const reason = err instanceof Error ? err.message : 'bulk write failed';
				for (const { id } of pending) outcomes.set(id, { ok: false, reason });
			}

			for (const { index, id } of pending) {
				const line = submission.lines[index];
				const outcome = outcomes.get(id);
				let saved = outcome?.ok === true;
				const reason = outcome?.reason ?? 'no result for this row';
				if (!saved) {
					// A 409 on a deterministic id means the row is already there, and a lost response
					// may hide a row that did land: the ledger itself decides.
					try {
						saved = (await this.repo.get<StockLedger>(id)) !== null;
					} catch {
						// keep `saved = false`; the original reason stays the one shown
					}
				}
				results.set(line.lot_key + line.item_id, {
					lot_key: line.lot_key,
					item_id: line.item_id,
					state: saved ? 'saved' : 'failed',
					ledger_id: id,
					...(saved ? {} : { error: reason })
				});
			}
		}

		const lines = submission.lines.map((l) => results.get(l.lot_key + l.item_id)!);
		return { lines, complete: lines.every((l) => l.state === 'saved') };
	}

	/** The shelter this repository's database belongs to (`shelter_sh001` → `SH001`), else null. */
	private shelterCodeOfDb(): string | null {
		return this.dbName.startsWith('shelter_')
			? this.dbName.replace('shelter_', '').toUpperCase()
			: null;
	}

	async mergeItems(input: MergeItemsInput, ctx: AuthorContext): Promise<ItemMergeResult> {
		const shelterCode = this.shelterCodeOfDb();
		const catalog = catalogRepository();
		const [source, target] = await Promise.all([
			catalog.getItemMaster(input.sourceId, shelterCode),
			catalog.getItemMaster(input.targetId, shelterCode)
		]);
		if (!source) throw new ItemMergeError('invalid_target', `Unknown item: ${input.sourceId}`);
		if (!target) throw new ItemMergeError('invalid_target', `Unknown item: ${input.targetId}`);

		const plan = await planItemMerge({
			source,
			target,
			roles: input.roles,
			shelterCode,
			ledger: await this.listLedger(),
			ctx
		});

		// FR-F6: prove the source doc will save (unit master, current _rev) BEFORE any ledger row
		// is written, so a doomed merge writes nothing.
		const current = await catalog.assertItemMasterWritable(plan.source);
		const toSave = { ...plan.source, _rev: current._rev };

		// Then ONE request for every missing pair (FR-F1). The plan skips rows whose deterministic
		// id already exists, so retrying after a ledger write that succeeded but a source update
		// that did not only finishes the source (no second move). NOT atomic across docs.
		if (plan.entries.length > 0) await bulkDocs<StockLedger>(this.dbName, plan.entries);

		const saved = await catalog.updateItemMaster(toSave);
		return { source: saved, target, legs: plan.legs };
	}

	// --- Campaign/Donation/Slot Methods ---

	/** Fetch all donation campaigns from this shelter database. */
	async listCampaigns(): Promise<DonationCampaign[]> {
		return this.repo.allByType('donation_campaign', isDonationCampaign);
	}

	/** Get a single donation campaign by ID. */
	async getCampaign(id: string): Promise<DonationCampaign | null> {
		return this.repo.get<DonationCampaign>(id);
	}

	/** Create a campaign from input and persist it. */
	async createCampaign(input: CampaignInput, ctx: AuthorContext): Promise<DonationCampaign> {
		const campaign = buildCampaign(input, ctx);
		await this.validateCampaignUnits(campaign);
		return this.repo.put(campaign);
	}

	/** Persist updates to a campaign (bumps updated_at timestamp). */
	async updateCampaign(
		campaign: DonationCampaign,
		auditInput?: { action: AuditAction; reason: string; ctx: AuthorContext }
	): Promise<DonationCampaign> {
		// Read-Modify-Write: Fetch the latest _rev from the database to prevent 409 conflict
		const existing = await this.repo.get<DonationCampaign>(campaign._id);
		// An update never creates. A campaign this database does not hold came from
		// another shelter's list (a cache left over from a shelter switch) — writing it
		// here put a stray copy into the wrong shelter, which the public board then read.
		if (!existing) {
			throw new Error(
				`ไม่พบประกาศนี้ในศูนย์ที่เลือก (${this.dbName}) — กรุณาโหลดหน้าใหม่ก่อนแก้ไข`
			);
		}
		await this.validateCampaignUnits(campaign, existing);
		const merged = {
			...campaign,
			_rev: existing._rev
		};

		const updated = await this.repo.put(touch(merged));
		if (auditInput) {
			const audit = createAuditEntry(
				{
					action: auditInput.action,
					target_type: 'donation_campaign',
					target_id: campaign._id,
					reason: auditInput.reason
				},
				auditInput.ctx
			);
			await this.repo.put(audit);
		}

		return updated;
	}

	private async validateCampaignUnits(
		campaign: DonationCampaign,
		current?: DonationCampaign
	): Promise<void> {
		const units = await catalogRepository().listUnitsOfMeasure();
		if (units.length === 0) {
			throw new Error('Unit of measure master is unavailable; campaign write was rejected');
		}

		for (const need of campaign.needs) {
			const previous = current?.needs.find((candidate) => candidate.item_id === need.item_id);
			const legacyUnchanged =
				!!previous && previous.unit === need.unit && isLegacyUnitLabel(need.unit);
			if (legacyUnchanged) continue;

			assertKnownUnitCodes([need.unit], units);
			const item = await this.loadCatalogItem(need.item_id);
			if (!item) {
				throw new Error(`Unknown item: ${need.item_id} — campaign need must reference the catalog`);
			}
			const expected = catalogItemRules(item).unit;
			if (expected !== need.unit) {
				throw new CampaignUnitMismatchError(need.item_id, expected, need.unit);
			}
		}
	}

	/** Fetch all donations in this shelter. */
	async listDonations(): Promise<Donation[]> {
		return this.repo.allByType('donation', isDonation);
	}

	/** Fetch a single donation by ID. */
	async getDonation(id: string): Promise<Donation | null> {
		return this.repo.get<Donation>(id);
	}

	/** Create and persist a new donation. */
	/** Update an existing donation (bumps updated_at and handles CouchDB MVCC). */
	async createDonation(donation: Donation): Promise<Donation> {
		return this.repo.put(donation);
	}

	async updateDonation(donation: Donation): Promise<Donation> {
		const existing = await this.repo.get<Donation>(donation._id);
		const merged = {
			...donation,
			_rev: existing?._rev ?? donation._rev
		};
		return this.repo.put(touch(merged));
	}

	/** Fetch all donation slots from this shelter. */
	async listDonationSlots(): Promise<DonationSlot[]> {
		return this.repo.allByType('donation_slot', isDonationSlot);
	}

	/** Fetch a single donation slot by ID. */
	async getDonationSlot(id: string): Promise<DonationSlot | null> {
		return this.repo.get<DonationSlot>(id);
	}

	/** Create or update a donation slot. */
	async updateDonationSlot(slot: DonationSlot): Promise<DonationSlot> {
		const existing = await this.repo.get<DonationSlot>(slot._id);
		const merged = {
			...slot,
			_rev: existing?._rev ?? slot._rev
		};
		return this.repo.put(touch(merged));
	}

	/**
	 * Delete a window nobody has booked. Counts against a fresh read of the donations,
	 * not the screen's copy, so a booking made since the list loaded still blocks it.
	 */
	async deleteDonationSlot(slot: DonationSlot): Promise<void> {
		const [current, donations] = await Promise.all([
			this.repo.get<DonationSlot>(slot._id),
			this.listDonations()
		]);
		if (!current) return;
		assertDonationSlotDeletable(
			current,
			countSlotBookings(donations, slotMode(current), current.date, current.from)
		);
		await this.repo.remove(current);
	}

	// --- Transfer methods (CR-059 Flow 1 / T-13) ---
	// `stock_transfer` lives in `central_ops`, not this shelter's DB, so these go through the
	// admin BFF (`fetch`), not `this.repo` — mirrors `referral.remote.ts`'s BFF calls.

	async listTransfers(filter?: TransferFilter): Promise<StockTransfer[]> {
		const qs = new URLSearchParams({ shelter_code: getShelterCode() });
		if (filter?.status) qs.append('status', filter.status);
		for (const id of filter?.ids ?? []) qs.append('id', id);
		const res = await fetch(`/api/back-office/transfer?${qs}`, {
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
		if (res.status === 403) throw new TransferForbiddenError();
		if (!res.ok) {
			throw new Error(`Failed to list transfers: ${res.statusText}`);
		}
		const list = await res.json();
		return Array.isArray(list) ? list.filter(isStockTransfer) : [];
	}

	async listTransferDestinations(): Promise<TransferDestination[]> {
		const qs = new URLSearchParams({ shelter_code: getShelterCode() });
		const res = await fetch(`/api/back-office/transfer/destinations?${qs}`, {
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) {
			throw new Error(`Failed to list transfer destinations: ${res.statusText}`);
		}
		const list = await res.json();
		return Array.isArray(list) ? list.filter(isTransferDestination) : [];
	}

	async getTransfer(id: string): Promise<StockTransfer | null> {
		const qs = new URLSearchParams({ shelter_code: getShelterCode() });
		const res = await fetch(`/api/back-office/transfer/${encodeURIComponent(id)}?${qs}`, {
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
		if (res.status === 404) return null;
		if (!res.ok) {
			throw new Error(`Failed to get transfer: ${res.statusText}`);
		}
		const doc = await res.json();
		return isStockTransfer(doc) ? doc : null;
	}

	async createTransfer(input: TransferInput): Promise<StockTransfer> {
		const qs = new URLSearchParams({ shelter_code: getShelterCode() });
		const res = await fetch(`/api/back-office/transfer?${qs}`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(input)
		});
		const payload = await res.json().catch(() => null);
		if (!res.ok) {
			const message =
				payload && typeof payload === 'object' && 'error' in payload
					? String((payload as { error: unknown }).error)
					: `Failed to create transfer (${res.status})`;
			throw new Error(message);
		}
		if (!isStockTransfer(payload)) {
			throw new Error('Create transfer returned an invalid transfer document');
		}
		return payload;
	}

	private async transitionTransfer(
		id: string,
		to: TransferStatus,
		opts?: {
			receivedItems?: { item_id: string; qty: string | number }[];
			notes?: string;
			driver_name?: string;
			vehicle_plate?: string;
			cancel_reason?: string;
			dispute_reason?: string;
		}
	): Promise<StockTransfer> {
		const qs = new URLSearchParams({ shelter_code: getShelterCode() });
		const res = await fetch(
			`/api/back-office/transfer/${encodeURIComponent(id)}/transition?${qs}`,
			{
				method: 'PATCH',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({ to, ...opts })
			}
		);
		const payload = await res.json().catch(() => null);
		if (!res.ok) {
			const message =
				payload && typeof payload === 'object' && 'error' in payload
					? String((payload as { error: unknown }).error)
					: `Transfer transition failed (${res.status})`;
			throw new Error(message);
		}
		if (!isStockTransfer(payload)) {
			throw new Error('Transfer transition returned an invalid transfer document');
		}
		return payload;
	}

	async dispatchTransfer(id: string, info: DispatchInfoInput): Promise<StockTransfer> {
		return this.transitionTransfer(id, 'shipped', {
			driver_name: info.driver_name,
			vehicle_plate: info.vehicle_plate
		});
	}

	async receiveTransfer(
		id: string,
		receivedItems: { item_id: string; qty: string | number }[],
		notes?: string
	): Promise<StockTransfer> {
		return this.transitionTransfer(id, 'received', { receivedItems, notes });
	}

	async cancelTransfer(id: string, info: CancelInfoInput): Promise<StockTransfer> {
		return this.transitionTransfer(id, 'cancelled', { cancel_reason: info.cancel_reason });
	}

	async disputeTransfer(id: string, info: DisputeInfoInput): Promise<StockTransfer> {
		return this.transitionTransfer(id, 'disputed', { dispute_reason: info.dispute_reason });
	}

	async resumeTransfer(id: string): Promise<StockTransfer> {
		// Resume is the one transition that walks the state machine backwards (CR-089 FR-05/FR-07).
		return this.transitionTransfer(id, 'requested');
	}
}

let singleton: OperationsRepository | null = null;
let singletonDbName: string | null = null;

export function operationsRepository(shelterCode?: string): OperationsRepository {
	const currentDb = getShelterDb(shelterCode);
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new OperationsRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}
