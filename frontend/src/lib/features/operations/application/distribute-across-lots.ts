/**
 * Issue one request across several lots (CR-143 §A, FR-A8, FR-A9).
 *
 * Runs `distributeStock` once per planned lot, in plan order, every row sharing
 * the one requisition `ref_id`. Each call keeps its own reservation claim (so
 * concurrent writers stay safe) and the ledger is append-only, so rows that
 * already landed are NEVER rolled back: when one fails, the run stops and
 * reports what was cut and what is left (FR-A9).
 */

import type { AuthorContext } from '$lib/db/model';
import { addQty, subQty } from '$lib/utils/qty';
import type { DistributeInput, StockLedger, StockLotBalance } from '../domain/operations';
import type { LotAllocation } from '../domain/lot-split';

/** The only repository call this flow needs. */
export interface LotDistributor {
	distributeStock(input: DistributeInput, ctx: AuthorContext): Promise<StockLedger>;
}

export interface DistributedLot {
	lot_ref: string;
	/** Base-unit quantity cut from this lot. */
	qty: string;
	entry: StockLedger;
}

export interface FailedLot {
	lot_ref: string;
	/** Base-unit quantity the failed row tried to cut. */
	qty: string;
	message: string;
}

export interface DistributeAcrossLotsResult {
	/** Same `ref_id` on every row (FR-A8). */
	ref_id: string;
	/** Rows that landed, in plan order. */
	distributed: DistributedLot[];
	/** Sum of `distributed`. */
	distributedQty: string;
	/** Planned quantity not yet cut: 0 on success, the failed row plus later ones otherwise. */
	remainingQty: string;
	/** Set when a row failed; later lots were not attempted. */
	failure?: FailedLot;
	/** `true` when every planned row landed. */
	complete: boolean;
}

export interface DistributeAcrossLotsArgs {
	allocations: readonly LotAllocation<Pick<StockLotBalance, 'lot_ref' | 'qty' | 'lot' | 'unit'>>[];
	item_id: string;
	/** Requisition ticket shared by every row, `requisition_ticket:direct-…`. */
	ref_id: string;
	note?: string;
	occurred_at?: string;
}

function errorMessage(err: unknown): string {
	return err instanceof Error && err.message ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล';
}

/**
 * Never throws for a failed row — the caller needs the partial result to report
 * it (FR-A9). Each row is cut in the lot's own (base) unit.
 */
export async function distributeAcrossLots(
	repo: LotDistributor,
	args: DistributeAcrossLotsArgs,
	ctx: AuthorContext
): Promise<DistributeAcrossLotsResult> {
	const distributed: DistributedLot[] = [];
	let distributedQty = '0';
	let plannedQty = '0';
	for (const a of args.allocations) plannedQty = addQty(plannedQty, a.qty);

	for (const allocation of args.allocations) {
		try {
			const entry = await repo.distributeStock(
				{
					item_id: args.item_id,
					qty: allocation.qty,
					unit: allocation.lot.unit,
					ref_id: args.ref_id,
					lot_ref: allocation.lot_ref,
					...(args.note ? { note: args.note } : {}),
					...(args.occurred_at ? { occurred_at: args.occurred_at } : {})
				},
				ctx
			);
			distributed.push({ lot_ref: allocation.lot_ref, qty: allocation.qty, entry });
			distributedQty = addQty(distributedQty, allocation.qty);
		} catch (err) {
			return {
				ref_id: args.ref_id,
				distributed,
				distributedQty,
				remainingQty: subQty(plannedQty, distributedQty),
				failure: { lot_ref: allocation.lot_ref, qty: allocation.qty, message: errorMessage(err) },
				complete: false
			};
		}
	}

	return {
		ref_id: args.ref_id,
		distributed,
		distributedQty,
		remainingQty: '0',
		complete: true
	};
}
