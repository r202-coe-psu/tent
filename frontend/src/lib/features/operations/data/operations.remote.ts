import { bulkDocs } from '$lib/db/couch-db';
import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterCode, getShelterDb } from '$lib/db/shelter';
import { touch, type AuthorContext } from '$lib/db/model';
import {
	createCampaign as buildCampaign,
	createPurchase as buildPurchase,
	isDonationCampaign,
	isStockLedger,
	isDonation,
	isDonationSlot,
	isPurchase,
	isStockTransfer,
	canEditPurchase,
	stockBalance,
	createReceiveEntry,
	createDistributeEntry,
	createAdjustEntry,
	keyPurchaseReceipt,
	type DonationCampaign,
	type CampaignInput,
	type StockLedger,
	type ReceiveInput,
	type DistributeInput,
	type AdjustInput,
	type Donation,
	type DonationSlot,
	type Purchase,
	type PurchaseInput,
	type CountedItem,
	type StockTransfer,
	type TransferInput,
	type TransferFilter,
	type TransferStatus
} from '../domain/operations';
import { createAuditEntry, type AuditAction } from '$lib/features/shared';
import type { OperationsRepository } from './operations.repository';
import { supplyRepository, type SupplyItem } from '$lib/features/supply';
import { qtyAbs, qtyGte, qtyLte } from '$lib/utils/qty';

export function assertReceiveAgainstCatalog(entry: StockLedger, item: SupplyItem | null): void {
	if (!item) {
		throw new Error(
			`Unknown item: ${entry.item_id} — item must exist in the catalog before receiving stock`
		);
	}
	if (item.unit !== entry.unit) {
		throw new Error(
			`Unit mismatch for item ${entry.item_id}: expected ${item.unit}, got ${entry.unit}`
		);
	}
	if (item.perishable && !entry.lot?.expiry) {
		throw new Error(`Perishable item ${entry.item_id} requires lot.expiry to be set`);
	}
}

export class OperationsRemoteRepository implements OperationsRepository {
	private readonly dbName: string;
	private readonly repo: Repository;

	constructor(dbName: string = getShelterDb()) {
		this.dbName = dbName;
		this.repo = createRemoteRepository(dbName);
	}

	// --- Ledger Methods ---

	async addLedgerEntry(entry: StockLedger): Promise<StockLedger> {
		return this.repo.put(entry);
	}

	async listLedger(): Promise<StockLedger[]> {
		return this.repo.allByType('stock_ledger', isStockLedger);
	}

	async listLedgerByItem(itemId: string): Promise<StockLedger[]> {
		const ledger = await this.listLedger();
		return ledger.filter((entry) => entry.item_id === itemId);
	}

	async getBalance(): Promise<Map<string, string>> {
		const ledger = await this.listLedger();
		return stockBalance(ledger);
	}

	async receiveStock(input: ReceiveInput, ctx: AuthorContext): Promise<StockLedger> {
		const entry = createReceiveEntry(input, ctx);
		const item = await supplyRepository().getItem(entry.item_id);
		assertReceiveAgainstCatalog(entry, item);
		return this.addLedgerEntry(entry);
	}

	async distributeStock(input: DistributeInput, ctx: AuthorContext): Promise<StockLedger> {
		const entry = createDistributeEntry(input, ctx);

		// WARNING (C-1): This read-then-write is not atomic. Concurrent distributes
		// may both pass the balance check before either write lands, potentially
		// causing negative stock. Acceptable for single-user shelter scenario;
		// tracked for future hardening.
		const balances = await this.getBalance();
		const currentQty = balances.get(entry.item_id) ?? '0';
		const requestedQty = qtyAbs(entry.qty);

		if (!qtyGte(currentQty, requestedQty)) {
			throw new Error(
				`Insufficient stock for item ${entry.item_id} (requested ${requestedQty}, have ${currentQty})`
			);
		}
		return this.addLedgerEntry(entry);
	}

	async adjustStock(input: AdjustInput, ctx: AuthorContext): Promise<StockLedger> {
		const entry = createAdjustEntry(input, ctx);
		const item = await supplyRepository().getItem(entry.item_id);
		if (!item) {
			throw new Error(
				`Unknown item: ${entry.item_id} — item must exist in the catalog before adjusting stock`
			);
		}
		if (item.unit !== entry.unit) {
			throw new Error(
				`Unit mismatch for item ${entry.item_id}: expected ${item.unit}, got ${entry.unit}`
			);
		}
		if (item.perishable && !entry.lot?.expiry) {
			throw new Error(`Perishable item ${entry.item_id} requires lot.expiry to be set`);
		}

		// NOTE: This balance check is aggregate (cross-lot total), not per-lot.
		// Acceptable for single-user shelter; per-lot validation requires FIFO tracking.
		if (qtyLte(entry.qty, 0)) {
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
		return this.repo.put(buildCampaign(input, ctx));
	}

	/** Persist updates to a campaign (bumps updated_at timestamp). */
	async updateCampaign(
		campaign: DonationCampaign,
		auditInput?: { action: AuditAction; reason: string; ctx: AuthorContext }
	): Promise<DonationCampaign> {
		// Read-Modify-Write: Fetch the latest _rev from the database to prevent 409 conflict
		const existing = await this.repo.get<DonationCampaign>(campaign._id);
		const merged = {
			...campaign,
			_rev: existing?._rev ?? undefined
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

	/** Fetch all donations in this shelter. */
	async listDonations(): Promise<Donation[]> {
		return this.repo.allByType('donation', isDonation);
	}

	/** Fetch a single donation by ID. */
	async getDonation(id: string): Promise<Donation | null> {
		return this.repo.get<Donation>(id);
	}

	/** Create and persist a new donation. */
	async createDonation(donation: Donation): Promise<Donation> {
		return this.repo.put(donation);
	}

	/** Update an existing donation (bumps updated_at and handles CouchDB MVCC). */
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

	// --- Purchase Methods (CR-032) ---

	/** Persist a new procurement record. Stock only moves once staff key the receipt. */
	async createPurchase(input: PurchaseInput, ctx: AuthorContext): Promise<Purchase> {
		return this.repo.put(buildPurchase(input, ctx));
	}

	/** Fetch all procurement records in this shelter. */
	async listPurchases(): Promise<Purchase[]> {
		return this.repo.allByType('purchase', isPurchase);
	}

	/** Fetch a single procurement record by ID. */
	async getPurchase(id: string): Promise<Purchase | null> {
		return this.repo.get<Purchase>(id);
	}

	/**
	 * Correct a purchase that nothing has been keyed against yet (CR-032).
	 * Editing `items` after a receipt would move what the receipt status and the
	 * ordered-vs-actual audit compare against, so it is refused instead.
	 */
	async updatePurchase(purchase: Purchase): Promise<Purchase> {
		if (!canEditPurchase(purchase, await this.listLedger())) {
			throw new Error(
				`updatePurchase: ${purchase._id} has already been received — record a correction entry instead`
			);
		}

		const existing = await this.repo.get<Purchase>(purchase._id);
		const merged = {
			...purchase,
			_rev: existing?._rev ?? purchase._rev
		};
		return this.repo.put(touch(merged));
	}

	/**
	 * Key a counted receipt against an already-committed purchase doc: one
	 * positive `purchase` ledger entry per counted line, each pointing back at the
	 * purchase. The purchase doc was written in an earlier step, so this is a
	 * plain append — no cross-doc write to keep consistent (CR-032, Option A).
	 *
	 * Every line is validated against the item catalog before anything is written,
	 * so a bad line rejects the whole receipt instead of half-writing it.
	 */
	async receivePurchase(
		purchase: Purchase,
		counted: CountedItem[],
		ctx: AuthorContext
	): Promise<StockLedger[]> {
		const rows = keyPurchaseReceipt(purchase, counted, ctx);
		if (rows.length === 0) {
			throw new Error(`receivePurchase: ${purchase._id} needs at least one counted line`);
		}

		const catalog = new Map<string, SupplyItem | null>();
		for (const row of rows) {
			if (!catalog.has(row.item_id)) {
				catalog.set(row.item_id, await supplyRepository().getItem(row.item_id));
			}
			assertReceiveAgainstCatalog(row, catalog.get(row.item_id) ?? null);
		}

		// One request for the whole receipt (mirrors kitchen `issueRequisition`).
		// Append-only, so a partially applied receipt can simply be re-keyed for
		// the missing lines — the purchase doc stays valid either way.
		return bulkDocs(this.dbName, rows);
	}

	// --- Transfer methods (CR-059 Flow 1 / T-13) ---
	// `stock_transfer` lives in `central_ops`, not this shelter's DB, so these go through the
	// admin BFF (`fetch`), not `this.repo` — mirrors `referral.remote.ts`'s BFF calls.

	async listTransfers(filter?: TransferFilter): Promise<StockTransfer[]> {
		const qs = new URLSearchParams({ shelter_code: getShelterCode() });
		if (filter?.status) qs.append('status', filter.status);
		const res = await fetch(`/api/back-office/transfer?${qs}`, {
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) {
			throw new Error(`Failed to list transfers: ${res.statusText}`);
		}
		const list = await res.json();
		return Array.isArray(list) ? list.filter(isStockTransfer) : [];
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
		opts?: { receivedItems?: { item_id: string; qty: string | number }[]; notes?: string }
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

	async dispatchTransfer(id: string): Promise<StockTransfer> {
		return this.transitionTransfer(id, 'shipped');
	}

	async receiveTransfer(
		id: string,
		receivedItems: { item_id: string; qty: string | number }[],
		notes?: string
	): Promise<StockTransfer> {
		return this.transitionTransfer(id, 'received', { receivedItems, notes });
	}

	async cancelTransfer(id: string): Promise<StockTransfer> {
		return this.transitionTransfer(id, 'cancelled');
	}
}

let singleton: OperationsRepository | null = null;
let singletonDbName: string | null = null;

export function operationsRepository(): OperationsRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new OperationsRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}
