import { adminRaw } from '$lib/server/couch-admin';
import type { AuthorContext } from '$lib/db/model';
import { shelterDbName, TRANSFER_MANGO_INDEXES } from '$lib/server/shelter-access-design';
import {
	createTransfer,
	dispatchTransfer,
	receiveTransfer,
	cancelTransfer,
	isStockTransfer,
	isStockLedger,
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
	TransferAuthorizationError
} from '../domain/transfer.authorization';
import { qtyGte } from '$lib/utils/qty';

/**
 * Server-only repository for `stock_transfer` (CR-059 Flow 1 / T-13) — writes
 * `central_ops` via `adminRaw`, mirroring `referral.server-repository.ts`.
 *
 * Retry-safety note (CR-059 decision 2026-08-22): ledger entries use the same
 * `stock_ledger:{ulid}` `_id` as every other ledger reason (no deterministic id
 * — that would change stable-core `_id` pattern). Instead, `transition()` checks
 * whether a ledger with this transfer's `ref_id` + `reason` already exists before
 * writing, so retrying the 409 loop in `[id]/transition/+server.ts` cannot
 * double-write. There is no mirror-write into the other shelter's DB this round
 * (see CR-059 Decision Log 2026-08-22) — cross-shelter status sync is
 * refetch-on-interaction, same as `referral` today.
 */

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;
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
		reason: string
	): Promise<boolean> {
		const { status, data } = await this.couchPost<MangoFindResponse>(dbName, '/_find', {
			selector: { type: 'stock_ledger', ref_id: transferId, reason },
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
		opts?: { receivedItems?: { item_id: string; qty: string | number }[]; notes?: string }
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
			await this.assertSufficientStock(latest.from_shelter, latest.items);
			({ transfer, ledgers } = dispatchTransfer(latest, ctx));
		} else if (to === 'received') {
			({ transfer, ledgers } = receiveTransfer(
				latest,
				opts?.receivedItems ?? [],
				ctx,
				opts?.notes
			));
		} else if (to === 'cancelled') {
			({ transfer } = cancelTransfer(latest));
		} else {
			throw new TransferServerRepositoryError(
				`Unsupported transition to "${to}"`,
				HTTP_UNPROCESSABLE
			);
		}

		const ledgerDb = shelterDbName(actorShelter);
		for (const ledger of ledgers) {
			const alreadyWritten = await this.ledgerAlreadyWritten(ledgerDb, transfer._id, ledger.reason);
			if (!alreadyWritten) {
				await this.putDoc(ledgerDb, ledger);
			}
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
}
