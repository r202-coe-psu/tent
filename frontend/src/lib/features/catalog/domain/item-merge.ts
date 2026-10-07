import {
	hasCapabilityInShelter,
	isSystemAdmin,
	SHELTER_MANAGER,
	WAREHOUSE_STAFF
} from '$lib/auth/roles';
import { parseQty, persistQty, qtyGt, type QtyValue } from '$lib/utils/qty';
import { itemMasterUnit, type ItemMaster } from './catalog';

/**
 * Merging duplicate items (CR-143 §F). Pure helpers shared by the catalog lists
 * (hide + alias search, FR-F5) and the stock-side merge flow (permission FR-F4,
 * unit compatibility FR-F3). The ledger moves themselves live in `operations`.
 */

type MergeRef = Pick<ItemMaster, 'merged_into'>;

/** A merged-away source: it points at its destination and must not be offered any more. */
export function isMergedItem(item: MergeRef): boolean {
	return typeof item.merged_into === 'string' && item.merged_into !== '';
}

/**
 * Names of the merged-away sources, keyed by their final destination id, so a search for
 * an old name still finds the item that is on offer (FR-F5). A chain (A merged into B,
 * later B into C) credits both names to C; a cycle is cut rather than looped on.
 */
export function mergedAliasesByTarget(
	items: readonly Pick<ItemMaster, '_id' | 'name' | 'merged_into'>[]
): Map<string, string[]> {
	const next = new Map<string, string>();
	for (const item of items) {
		if (item.merged_into) next.set(item._id, item.merged_into);
	}
	const aliases = new Map<string, string[]>();
	for (const item of items) {
		if (!item.merged_into || !item.name) continue;
		let destination = item.merged_into;
		const seen = new Set([item._id]);
		while (next.has(destination) && !seen.has(destination)) {
			seen.add(destination);
			destination = next.get(destination)!;
		}
		const list = aliases.get(destination) ?? [];
		list.push(item.name);
		aliases.set(destination, list);
	}
	return aliases;
}

// ---------------------------------------------------------------- permission (FR-F4)

type ScopeRef = Pick<ItemMaster, 'shelter_code' | 'override'>;

const sameShelter = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** Authored by `shelterCode` itself (not a central item, not a shelter override of one). */
export function isShelterLocalItem(item: ScopeRef, shelterCode: string | null): boolean {
	return (
		!!shelterCode &&
		!!item.shelter_code &&
		!item.override &&
		sameShelter(item.shelter_code, shelterCode)
	);
}

/**
 * Who may merge `item` away (FR-F4, amended FR-F4a): only a shelter's own item, by SA or that
 * shelter's shelter_manager / warehouse_staff. A central item (or an override of one) can never
 * be a source, not even for SA: its `merged_into` would hide it in every shelter while the stock
 * moves in only one.
 */
export function canMergeItem(
	roles: readonly string[],
	shelterCode: string | null,
	item: ScopeRef
): boolean {
	if (!isShelterLocalItem(item, shelterCode)) return false;
	if (isSystemAdmin(roles)) return true;
	return (
		hasCapabilityInShelter(roles, shelterCode, SHELTER_MANAGER) ||
		hasCapabilityInShelter(roles, shelterCode, WAREHOUSE_STAFF)
	);
}

// ---------------------------------------------------------------- unit compatibility (FR-F3)

type UnitSource = Pick<ItemMaster, 'conversions'> & { base_unit?: string; unit?: string };

/** How a source-base-unit qty maps onto the destination's base unit. */
export type ItemUnitConversion =
	| { kind: 'same' }
	/** destination qty = source qty × factor (destination lists the source unit as a packaging UOM). */
	| { kind: 'multiply'; factor: string }
	/** destination qty = source qty ÷ divisor (source lists the destination unit as a packaging UOM). */
	| { kind: 'divide'; divisor: string };

const unitKey = (code: string) => code.trim().toLowerCase();

function multiplierOf(item: UnitSource, uom: string): string | null {
	const hit = (item.conversions ?? []).find(
		(c) => c.uom_name && unitKey(c.uom_name) === unitKey(uom)
	);
	if (!hit) return null;
	try {
		return qtyGt(hit.multiplier, 0) ? persistQty(hit.multiplier) : null;
	} catch {
		return null;
	}
}

/**
 * Whether stock counted in `source`'s base unit can be expressed in `target`'s: same unit,
 * or one item declares the other's base unit as a packaging conversion (`1 uom = m base`).
 * `null` means no conversion exists, so the merge must be refused.
 */
export function resolveItemUnitConversion(
	source: UnitSource,
	target: UnitSource
): ItemUnitConversion | null {
	const from = itemMasterUnit(source);
	const to = itemMasterUnit(target);
	if (unitKey(from) === unitKey(to)) return { kind: 'same' };

	// target: 1 <from> = m <to>  ->  qty × m
	const asTargetPackaging = multiplierOf(target, from);
	if (asTargetPackaging) return { kind: 'multiply', factor: asTargetPackaging };

	// source: 1 <to> = m <from>  ->  qty ÷ m
	const asSourcePackaging = multiplierOf(source, to);
	if (asSourcePackaging) return { kind: 'divide', divisor: asSourcePackaging };

	return null;
}

/**
 * Apply a conversion to one lot's qty. `null` when the result does not land exactly on the
 * ledger's 4-decimal scale: silently rounding would invent or lose stock in an append-only ledger.
 */
export function convertItemQty(qty: QtyValue, conversion: ItemUnitConversion): string | null {
	const value = parseQty(qty);
	const exact =
		conversion.kind === 'same'
			? value
			: conversion.kind === 'multiply'
				? value.times(conversion.factor)
				: value.div(conversion.divisor);
	const stored = persistQty(exact);
	return parseQty(stored).equals(exact) ? stored : null;
}
