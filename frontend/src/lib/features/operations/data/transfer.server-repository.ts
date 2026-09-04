import { ZodError } from 'zod';
import { adminRaw } from '$lib/server/couch-admin';
import type { AuthorContext } from '$lib/db/model';
import { shelterDbName, TRANSFER_MANGO_INDEXES } from '$lib/server/shelter-access-design';
import {
	createTransfer,
	dispatchTransfer,
	receiveTransfer,
	cancelTransfer,
	disputeTransfer,
	resumeTransfer,
	isStockTransfer,
	isStockLedger,
	parseStockTransfer,
	stockBalance,
	transferFilterSchema,
	type StockTransfer,
	type StockLedger,
	type TransferInput,
	type TransferStatus,
	type TransferFilter
} from '../domain/operations';
import {
	assertActorMayTransition,
	assertActorMayDelete,
	assertActorMayRestore,
	TransferAuthorizationError
} from '../domain/transfer.authorization';
import { qtyAbs, qtyGte } from '$lib/utils/qty';

/**
 * Server-only repository for `stock_transfer` (CR-059 Flow 1 / T-13) — writes
 * `central_ops` via `adminRaw`, mirroring `referral.server-repository.ts`.
 *
 * Retry-safety note (CR-059 decision 2026-08-22): ledger entries use the same
 * `stock_ledger:{ulid}` `_id` as every other ledger reason (no deterministic id
 * — that would change stable-core `_id` pattern). Instead, `transition()` checks
 * whether a ledger with this transfer's `ref_id` + `item_id` + `reason` already
 * exists before writing (per item, so multi-item transfers can't have one item's
 * ledger entry shadow another's), so retrying the 409 loop in
 * `[id]/transition/+server.ts` cannot double-write. There is no mirror-write into
 * the other shelter's DB this round
 * (see CR-059 Decision Log 2026-08-22) — cross-shelter status sync is
 * refetch-on-interaction, same as `referral` today.
 *
 * The same already-written check also gates the `shipped` sufficiency check: a
 * retry after the ledger write succeeded but the final `central_ops` PUT below
 * failed must not re-validate stock against a balance this transfer's own
 * (already-committed) ledger entries already reduced — `assertSufficientStock`
 * only runs against ledger entries still pending, never ones already written.
 */

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_ACCEPTED = 202;
const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;

export class TransferServerRepositoryError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly details?: unknown
	) {
		super(message);
		this.name = 'TransferServerRepositoryError';
	}
}

interface MangoFindResponse {
	// `unknown[]` (not `Record<string, unknown>[]`) — StockTransfer/StockLedger are hand-written
	// `interface`s, not Zod-inferred type aliases, so `.filter(isX)`'s type-guard narrowing only
	// type-checks against an `unknown` element type (interfaces aren't implicitly index-signature
	// compatible the way `type` aliases are).
	docs: unknown[];
	warning?: string;
}

interface PutResultResponse {
	ok: boolean;
	id: string;
	rev: string;
}

let centralOpsDbCreated = false;
async function ensureCentralDb() {
	if (centralOpsDbCreated) return;
	const { status } = await adminRaw('/central_ops', 'PUT');
	if (status === 201 || status === 412 || status === 200) {
		centralOpsDbCreated = true;
		for (const def of TRANSFER_MANGO_INDEXES) {
			await adminRaw('/central_ops/_index', 'POST', def);
		}
	}
}

export class TransferServerRepository {
	constructor(
		private readonly dbName: string,
		private readonly contextShelterCode: string
	) {}

	private async couchGet<T>(dbName: string, path: string): Promise<{ status: number; data: T }> {
		if (dbName === 'central_ops') await ensureCentralDb();
		const res = await adminRaw(`/${dbName}${path}`, 'GET');
		return { status: res.status, data: res.data as T };
	}

	private async couchPost<T>(
		dbName: string,
		path: string,
		body: unknown
	): Promise<{ status: number; data: T }> {
		if (dbName === 'central_ops') await ensureCentralDb();
		const res = await adminRaw(`/${dbName}${path}`, 'POST', body);
		return { status: res.status, data: res.data as T };
	}

	private async couchPut<T>(
		dbName: string,
		path: string,
		body: unknown
	): Promise<{ status: number; data: T }> {
		if (dbName === 'central_ops') await ensureCentralDb();
		const res = await adminRaw(`/${dbName}${path}`, 'PUT', body);
		return { status: res.status, data: res.data as T };
	}

	private async couchDelete<T>(dbName: string, path: string): Promise<{ status: number; data: T }> {
		if (dbName === 'central_ops') await ensureCentralDb();
		const res = await adminRaw(`/${dbName}${path}`, 'DELETE');
		return { status: res.status, data: res.data as T };
	}

	private async putDoc(dbName: string, doc: { _id: string; _rev?: string }): Promise<string> {
		const { status, data } = await this.couchPut<PutResultResponse>(
			dbName,
			`/${encodeURIComponent(doc._id)}`,
			doc
		);
		if (status !== HTTP_CREATED && status !== HTTP_OK) {
			throw new TransferServerRepositoryError(
				`Failed to write ${doc._id} in ${dbName}`,
				status,
				data
			);
		}
		return data.rev;
	}

	/** Retry-safety state-check (see file header) — has this transition's ledger entry already
	 * been written for this transfer? */
	private async ledgerAlreadyWritten(
		dbName: string,
		transferId: string,
		itemId: string,
		reason: string
	): Promise<boolean> {
		const { status, data } = await this.couchPost<MangoFindResponse>(dbName, '/_find', {
			selector: { type: 'stock_ledger', ref_id: transferId, item_id: itemId, reason },
			limit: 1,
			fields: ['_id']
		});
		if (status !== HTTP_OK) return false;
		return (data.docs || []).length > 0;
	}

	/** Mirrors `OperationsRemoteRepository.distributeStock`'s balance check (same non-atomic
	 * read-then-write caveat), run against the source shelter's own DB via admin access. */
	private async assertSufficientStock(
		shelterCode: string,
		items: { item_id: string; qty: string }[]
	): Promise<void> {
		const db = shelterDbName(shelterCode);
		const itemIds = items.map((i) => i.item_id);
		const { status, data } = await this.couchPost<MangoFindResponse>(db, '/_find', {
			selector: { type: 'stock_ledger', item_id: { $in: itemIds } },
			limit: 10000
		});
		if (status !== HTTP_OK) {
			throw new TransferServerRepositoryError(
				'Failed to read stock ledger for balance check',
				status,
				data
			);
		}
		const ledger = (data.docs || []).filter(isStockLedger);
		const balances = stockBalance(ledger);
		for (const item of items) {
			const currentQty = balances.get(item.item_id) ?? '0';
			if (!qtyGte(currentQty, item.qty)) {
				throw new TransferServerRepositoryError(
					`Insufficient stock for item ${item.item_id} (requested ${item.qty}, have ${currentQty})`,
					HTTP_UNPROCESSABLE
				);
			}
		}
	}

	async list(filter?: TransferFilter): Promise<StockTransfer[]> {
		const parsed = transferFilterSchema.parse(filter ?? {});
		const selector: Record<string, unknown> = {
			type: 'stock_transfer',
			$or: [{ from_shelter: this.contextShelterCode }, { to_shelter: this.contextShelterCode }]
		};
		if (parsed.status) {
			selector.status = parsed.status;
		}

		const sort =
			parsed.sort === 'created_at_asc'
				? [{ type: 'asc' }, { created_at: 'asc' }]
				: [{ type: 'desc' }, { created_at: 'desc' }];

		const { status, data } = await this.couchPost<MangoFindResponse>(this.dbName, '/_find', {
			selector,
			limit: parsed.limit,
			skip: parsed.skip,
			sort
		});

		if (status !== HTTP_OK) {
			throw new TransferServerRepositoryError('CouchDB _find query failed', status, data);
		}

		return (data.docs || []).filter((d): d is StockTransfer => isStockTransfer(d));
	}

	async get(id: string): Promise<StockTransfer | null> {
		const { status, data } = await this.couchGet<unknown>(
			this.dbName,
			`/${encodeURIComponent(id)}`
		);

		if (status === HTTP_NOT_FOUND) return null;
		if (status !== HTTP_OK) {
			throw new TransferServerRepositoryError('Failed to fetch transfer', status, data);
		}

		return isStockTransfer(data) ? data : null;
	}

	async create(input: TransferInput, ctx: AuthorContext): Promise<StockTransfer> {
		const doc = createTransfer(input, ctx);

		const { status, data } = await this.couchPut<PutResultResponse>(
			this.dbName,
			`/${encodeURIComponent(doc._id)}`,
			doc
		);

		if (status !== HTTP_CREATED && status !== HTTP_OK) {
			throw new TransferServerRepositoryError('Failed to write transfer doc', status, data);
		}

		return { ...doc, _rev: data.rev };
	}

	async transition(
		id: string,
		to: TransferStatus,
		actor: string,
		actorShelter: string,
		opts?: {
			receivedItems?: { item_id: string; qty: string | number }[];
			notes?: string;
			driver_name?: string;
			vehicle_plate?: string;
			cancel_reason?: string;
			dispute_reason?: string;
		}
	): Promise<StockTransfer> {
		const latest = await this.get(id);
		if (!latest) {
			throw new TransferServerRepositoryError('Transfer not found', HTTP_NOT_FOUND);
		}

		try {
			assertActorMayTransition(latest, to, actorShelter);
		} catch (e: unknown) {
			if (e instanceof TransferAuthorizationError) {
				throw new TransferServerRepositoryError(e.message, HTTP_FORBIDDEN);
			}
			throw e;
		}

		const ctx: AuthorContext = { shelterCode: actorShelter, createdBy: actor };

		let transfer: StockTransfer;
		let ledgers: StockLedger[] = [];

		if (to === 'shipped') {
			// The domain schema rejects a missing driver/plate before any ledger row is built —
			// passing the raw values through keeps that the single enforcement point (CR-089 FR-01).
			({ transfer, ledgers } = dispatchTransfer(latest, ctx, {
				driver_name: opts?.driver_name ?? '',
				vehicle_plate: opts?.vehicle_plate ?? ''
			}));
		} else if (to === 'received') {
			({ transfer, ledgers } = receiveTransfer(
				latest,
				opts?.receivedItems ?? [],
				ctx,
				opts?.notes
			));
		} else if (to === 'cancelled') {
			({ transfer } = cancelTransfer(latest, { cancel_reason: opts?.cancel_reason ?? '' }));
		} else if (to === 'disputed') {
			({ transfer } = disputeTransfer(latest, ctx, {
				dispute_reason: opts?.dispute_reason ?? ''
			}));
		} else if (to === 'requested') {
			({ transfer } = resumeTransfer(latest));
		} else {
			throw new TransferServerRepositoryError(
				`Unsupported transition to "${to}"`,
				HTTP_UNPROCESSABLE
			);
		}

		// A retry after a partial failure (ledger already written, but the central status PUT
		// below failed last time — e.g. a 409) must not re-validate stock against a balance this
		// same transfer's own ledger entries already reduced. Only the entries NOT yet written
		// are "pending" — sufficiency and the write itself apply to those only.
		const ledgerDb = shelterDbName(actorShelter);
		const pendingLedgers: StockLedger[] = [];
		for (const ledger of ledgers) {
			const alreadyWritten = await this.ledgerAlreadyWritten(
				ledgerDb,
				transfer._id,
				ledger.item_id,
				ledger.reason
			);
			if (!alreadyWritten) {
				pendingLedgers.push(ledger);
			}
		}

		if (to === 'shipped' && pendingLedgers.length > 0) {
			await this.assertSufficientStock(
				latest.from_shelter,
				pendingLedgers.map((ledger) => ({ item_id: ledger.item_id, qty: qtyAbs(ledger.qty) }))
			);
		}

		for (const ledger of pendingLedgers) {
			await this.putDoc(ledgerDb, ledger);
		}

		const { status, data } = await this.couchPut<PutResultResponse>(
			this.dbName,
			`/${encodeURIComponent(transfer._id)}`,
			transfer
		);

		if (status !== HTTP_CREATED && status !== HTTP_OK) {
			throw new TransferServerRepositoryError('Failed to update transfer transition', status, data);
		}

		return { ...transfer, _rev: data.rev };
	}

	/**
	 * CR-090 FR-01/FR-02/FR-03 — hard-delete a transfer request.
	 *
	 * This is the only hard delete in the operations feature, so the two guards below carry the
	 * whole weight of it: the status is re-read from `central_ops` and re-checked HERE, not trusted
	 * from the client, because a transfer that already reached `shipped` has `stock_ledger` rows
	 * pointing at its `_id` and deleting it would orphan them (FR-03).
	 *
	 * Returns the deleted body along with the tombstone `rev` so the caller can offer an undo
	 * (FR-04/FR-09). The body comes from this fresh read rather than from the client, so a restore
	 * built on it matches what was actually deleted.
	 */
	async remove(
		id: string,
		actorShelter: string
	): Promise<{ id: string; rev: string; doc: StockTransfer }> {
		const latest = await this.get(id);
		if (!latest) {
			throw new TransferServerRepositoryError('Transfer not found', HTTP_NOT_FOUND);
		}

		try {
			assertActorMayDelete(latest, actorShelter);
		} catch (e: unknown) {
			if (e instanceof TransferAuthorizationError) {
				throw new TransferServerRepositoryError(e.message, HTTP_FORBIDDEN);
			}
			throw e;
		}

		if (latest.status !== 'requested') {
			throw new TransferServerRepositoryError(
				`Cannot delete a transfer in status "${latest.status}" — only "requested" may be deleted`,
				HTTP_UNPROCESSABLE
			);
		}

		if (!latest._rev) {
			throw new TransferServerRepositoryError(
				'Transfer is missing a revision and cannot be deleted',
				HTTP_UNPROCESSABLE
			);
		}

		const { status, data } = await this.couchDelete<PutResultResponse>(
			this.dbName,
			`/${encodeURIComponent(id)}?rev=${encodeURIComponent(latest._rev)}`
		);

		if (status !== HTTP_OK && status !== HTTP_ACCEPTED) {
			throw new TransferServerRepositoryError('Failed to delete transfer doc', status, data);
		}

		return { id, rev: data.rev, doc: latest };
	}

	/**
	 * CR-090 FR-05/FR-08/FR-10 — put a deleted transfer back exactly as it was.
	 *
	 * Two rules this method exists to hold:
	 *
	 * 1. The body is PUT verbatim. It must NOT go through `createTransfer()`/`makeDoc()`, which
	 *    would mint a fresh `_id` and re-stamp `created_at`/`created_by`/`timeline.requested` with
	 *    the time of the undo — the opposite of "identical in every field" (FR-08).
	 * 2. No `_rev` is attached. The 2026-09-04 spike (see the CR) measured CouchDB 3.5.2: a PUT of
	 *    the original `_id` with no `_rev` succeeds and continues the revision chain from the
	 *    tombstone, while attaching the tombstone `_rev` returns `409` every time (FR-09).
	 *
	 * That same rev-less PUT is what stops this path from overwriting a live document: CouchDB
	 * answers `409` when the `_id` still exists, so FR-10's no-overwrite rule is enforced by the
	 * storage layer rather than by a read-then-write check that could lose a race.
	 */
	async restore(doc: unknown, actorShelter: string): Promise<StockTransfer> {
		let parsed: StockTransfer;
		try {
			parsed = parseStockTransfer(doc);
		} catch (e: unknown) {
			throw new TransferServerRepositoryError(
				'Restore body is not a valid transfer document',
				HTTP_UNPROCESSABLE,
				e instanceof ZodError ? e.format() : undefined
			);
		}

		try {
			assertActorMayRestore(parsed, actorShelter);
		} catch (e: unknown) {
			if (e instanceof TransferAuthorizationError) {
				throw new TransferServerRepositoryError(e.message, HTTP_FORBIDDEN);
			}
			throw e;
		}

		// Strip `_rev` even if the client echoed one back — see rule 2 above.
		const { _rev: _ignored, ...body } = parsed;
		void _ignored;

		const { status, data } = await this.couchPut<PutResultResponse>(
			this.dbName,
			`/${encodeURIComponent(parsed._id)}`,
			body
		);

		if (status === HTTP_CONFLICT) {
			throw new TransferServerRepositoryError(
				`Transfer ${parsed._id} already exists and cannot be restored over`,
				HTTP_CONFLICT,
				data
			);
		}

		if (status !== HTTP_CREATED && status !== HTTP_OK) {
			throw new TransferServerRepositoryError('Failed to restore transfer doc', status, data);
		}

		return { ...(body as StockTransfer), _rev: data.rev };
	}
}
