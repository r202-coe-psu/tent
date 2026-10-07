import type { AuthorContext } from '$lib/db/model';
import { qtyGt, qtyNeg } from '$lib/utils/qty';
import {
	ITEM_MASTER_SCHEMA_V,
	canMergeItem,
	convertItemQty,
	isMergedItem,
	isShelterLocalItem,
	itemMasterUnit,
	resolveItemUnitConversion,
	type ItemMaster
} from '$lib/features/catalog';
import { deriveDeterministicLedgerId } from './deterministic-ledger-id';
import {
	createStockLedger,
	projectStockLotBalances,
	sortStockLotsByConsumptionOrder,
	type StockLedger,
	type StockLotBalance
} from './operations';

/**
 * Merging a duplicate item into another (CR-143 §F). `planItemMerge` turns the source's
 * on-hand lots into paired `adjust`/`merge` ledger rows (FR-F1) and the deactivated,
 * `merged_into`-stamped source doc (FR-F2); the repository writes them. The ledger stays
 * append-only: stock moves by offsetting rows, never by editing history.
 */

export type ItemMergeErrorCode =
	/** FR-F4 — the actor may not merge this item. */
	| 'forbidden'
	| 'same_item'
	/** The source was already merged into a different item. */
	| 'already_merged'
	/** The destination is deactivated, merged away, or not one this shelter may hold stock in. */
	| 'invalid_target'
	/** FR-F3 — base units differ and no exact conversion exists. */
	| 'unit_mismatch';

export class ItemMergeError extends Error {
	readonly code: ItemMergeErrorCode;
	constructor(code: ItemMergeErrorCode, message: string) {
		super(message);
		this.name = 'ItemMergeError';
		this.code = code;
	}
}

export interface ItemMergeCheckInput {
	source: ItemMaster;
	target: ItemMaster;
	roles: readonly string[];
	/** The shelter whose ledger moves (the actor's active shelter). */
	shelterCode: string | null;
}

/**
 * The reason a merge is refused before any stock is looked at, or `null` when it may go ahead.
 * Cheap and synchronous, so the dialog can use it to explain why a candidate is not offered.
 */
export function checkItemMerge(input: ItemMergeCheckInput): ItemMergeError | null {
	const { source, target, roles, shelterCode } = input;

	if (source._id === target._id) {
		return new ItemMergeError('same_item', 'ไม่สามารถรวมสินค้ากับตัวมันเองได้');
	}
	if (!canMergeItem(roles, shelterCode, source)) {
		return new ItemMergeError(
			'forbidden',
			isShelterLocalItem(source, shelterCode)
				? 'เฉพาะผู้จัดการหรือเจ้าหน้าที่คลังของศูนย์นี้เท่านั้นที่รวมสินค้านี้ได้'
				: 'สินค้าส่วนกลางรวมได้เฉพาะผู้ดูแลระบบ'
		);
	}
	// Resuming a half-finished merge into the SAME destination is allowed; any other is not.
	if (isMergedItem(source) && source.merged_into !== target._id) {
		return new ItemMergeError('already_merged', 'สินค้านี้ถูกรวมเข้ากับรายการอื่นแล้ว');
	}
	if (target.deactivated || isMergedItem(target)) {
		return new ItemMergeError('invalid_target', 'สินค้าปลายทางถูกปิดใช้งานหรือถูกรวมไปแล้ว');
	}
	// A shelter's own item is invisible elsewhere, so it can never be the destination of
	// another shelter's stock, and a central item must not end up pointing at one.
	const targetIsLocal = isShelterLocalItem(target, shelterCode);
	if (target.shelter_code && !target.override && !targetIsLocal) {
		return new ItemMergeError('invalid_target', 'สินค้าปลายทางเป็นของศูนย์อื่น');
	}
	// local -> central is fine; central -> local would leave a central doc pointing at a local one.
	if (!isShelterLocalItem(source, shelterCode) && targetIsLocal) {
		return new ItemMergeError(
			'invalid_target',
			'สินค้าส่วนกลางต้องรวมเข้ากับสินค้าส่วนกลางด้วยกันเท่านั้น'
		);
	}
	if (!resolveItemUnitConversion(source, target)) {
		return new ItemMergeError(
			'unit_mismatch',
			`หน่วยฐานไม่ตรงกัน (${itemMasterUnit(source)} → ${itemMasterUnit(target)}) และไม่มีการแปลงหน่วย จึงรวมไม่ได้`
		);
	}
	return null;
}

export interface PlanItemMergeInput extends ItemMergeCheckInput {
	/** The shelter's ledger (any items; the source's rows are picked out). */
	ledger: readonly StockLedger[];
	ctx: AuthorContext;
	/** Test seam — defaults to now. */
	occurredAt?: string;
}

/** One physical source lot and what it becomes at the destination. */
export interface ItemMergeLeg {
	/** The source lot being emptied. */
	lotRef: string;
	/** Qty leaving the source, in the source lot's unit. */
	sourceQty: string;
	/** Qty arriving at the destination, in the destination's base unit. */
	targetQty: string;
	lot: StockLotBalance['lot'];
}

export interface ItemMergePlan {
	/** Paired `adjust`/`merge` rows, written in ONE `bulkDocs` (out then in, lot by lot). */
	entries: StockLedger[];
	legs: ItemMergeLeg[];
	/** The source doc with `merged_into`, `deactivated: true` and `schema_v: 5` (FR-F2). */
	source: ItemMaster;
}

/**
 * Validate the merge and build everything it writes. Throws {@link ItemMergeError} when it
 * is refused (FR-F3/F4). Row ids are deterministic per (shelter, source, destination, lot),
 * so a double submit lands as a conflict instead of moving the stock twice.
 */
export async function planItemMerge(input: PlanItemMergeInput): Promise<ItemMergePlan> {
	const refusal = checkItemMerge(input);
	if (refusal) throw refusal;

	const { source, target, ledger, ctx, occurredAt } = input;
	// `checkItemMerge` already proved a conversion exists.
	const conversion = resolveItemUnitConversion(source, target)!;
	const targetUnit = itemMasterUnit(target);
	const scope = (input.shelterCode ?? '').toUpperCase();

	const lots = sortStockLotsByConsumptionOrder(
		projectStockLotBalances(ledger.filter((entry) => entry.item_id === source._id))
	).filter((lot) => qtyGt(lot.qty, 0));

	const entries: StockLedger[] = [];
	const legs: ItemMergeLeg[] = [];

	for (const lot of lots) {
		const targetQty = convertItemQty(lot.qty, conversion);
		if (targetQty === null) {
			throw new ItemMergeError(
				'unit_mismatch',
				`แปลงยอด ${lot.qty} ${lot.unit} เป็น ${targetUnit} ไม่ลงตัว จึงรวมไม่ได้`
			);
		}

		const outId = await deriveDeterministicLedgerId(
			'item_merge',
			scope,
			source._id,
			target._id,
			lot.lot_ref,
			'out'
		);
		const inId = await deriveDeterministicLedgerId(
			'item_merge',
			scope,
			source._id,
			target._id,
			lot.lot_ref,
			'in'
		);

		// −qty at the source, against its own physical lot; `note` names the other side.
		entries.push(
			createStockLedger(
				{
					item_id: source._id,
					qty: qtyNeg(lot.qty),
					unit: lot.unit,
					reason: 'adjust',
					ref_id: null,
					lot_ref: lot.lot_ref,
					adjust_reason: 'merge',
					note: target._id,
					occurred_at: occurredAt
				},
				ctx,
				outId
			)
		);
		// +qty at the destination as a new physical lot that keeps the original lot facts
		// (expiry, produced_at, storage point, lot no.).
		entries.push(
			createStockLedger(
				{
					item_id: target._id,
					qty: targetQty,
					unit: targetUnit,
					reason: 'adjust',
					ref_id: null,
					...(lot.lot ? { lot: { ...lot.lot } } : {}),
					adjust_reason: 'merge',
					note: source._id,
					occurred_at: occurredAt
				},
				ctx,
				inId
			)
		);
		legs.push({ lotRef: lot.lot_ref, sourceQty: lot.qty, targetQty, lot: lot.lot });
	}

	return {
		entries,
		legs,
		source: {
			...source,
			schema_v: ITEM_MASTER_SCHEMA_V,
			merged_into: target._id,
			deactivated: true
		}
	};
}

/** What the UI asks the repository to merge. */
export interface MergeItemsInput {
	sourceId: string;
	targetId: string;
	/** The actor's roles — the domain re-checks FR-F4 against them before any write. */
	roles: readonly string[];
}

export interface ItemMergeResult {
	/** The deactivated source as saved. */
	source: ItemMaster;
	target: ItemMaster;
	legs: ItemMergeLeg[];
}
