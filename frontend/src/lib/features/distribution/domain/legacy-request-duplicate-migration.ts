import { addQty, persistQty, type QtyValue } from '$lib/utils/qty';
import {
	distributionRequestDocSchema,
	distributionRequestItemSchema,
	type DistributionRequestItem
} from './distribution';

type UnknownRecord = Record<string, unknown>;

export interface DuplicateRequestItemGroup {
	itemId: string;
	rowCount: number;
	requestedQtys: string[];
	targetQtys: string[];
}

export type LegacyDuplicateRequestMigration =
	| {
			kind: 'clean';
			docId: string;
	  }
	| {
			kind: 'update';
			docId: string;
			originalRev: string;
			duplicateGroups: DuplicateRequestItemGroup[];
			doc: UnknownRecord;
	  }
	| {
			kind: 'collision';
			docId: string;
			reason: string;
	  }
	| {
			kind: 'invalid';
			docId: string;
			reason: string;
	  };

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function docIdOf(value: unknown): string {
	return isRecord(value) && typeof value._id === 'string' ? value._id : '(missing _id)';
}

function quantityTotal(
	items: readonly DistributionRequestItem[],
	field: 'requested_qty' | 'target_qty_snapshot'
): string {
	return persistQty(items.reduce<QtyValue>((total, item) => addQty(total, item[field]), '0'));
}

/**
 * Converts pre-e148112 distribution-request duplicate rows into the current
 * one-row-per-item representation without changing document identity, lifecycle,
 * provenance, or any non-item field. Compatible legacy rows are combined because
 * approval already treats requested quantities as an item_id aggregate. The NFI
 * target is request-level data copied to every row, so its one matching snapshot
 * is retained rather than summed.
 *
 * A conflicting unit, distribution type, or target snapshot has no lossless
 * canonical row and is deliberately reported as a collision. Malformed documents
 * are never repaired.
 */
export function analyzeLegacyDuplicateDistributionRequest(
	doc: unknown
): LegacyDuplicateRequestMigration {
	const docId = docIdOf(doc);
	if (!isRecord(doc)) return { kind: 'invalid', docId, reason: 'Document is not an object' };
	if (doc.type !== 'distribution_request') {
		return { kind: 'invalid', docId, reason: 'Document type is not distribution_request' };
	}
	if (typeof doc._rev !== 'string' || doc._rev === '') {
		return { kind: 'invalid', docId, reason: 'Document has no _rev for a safe update' };
	}
	if (!Array.isArray(doc.items)) {
		return { kind: 'invalid', docId, reason: 'items is not an array' };
	}

	const items: DistributionRequestItem[] = [];
	for (const [index, item] of doc.items.entries()) {
		const parsed = distributionRequestItemSchema.safeParse(item);
		if (!parsed.success) {
			return { kind: 'invalid', docId, reason: `items[${index}] is malformed` };
		}
		items.push(parsed.data);
	}

	const groups = new Map<string, DistributionRequestItem[]>();
	for (const item of items) {
		const group = groups.get(item.item_id) ?? [];
		group.push(item);
		groups.set(item.item_id, group);
	}
	const duplicateGroups = [...groups.entries()].filter(([, group]) => group.length > 1);

	if (duplicateGroups.length === 0) {
		const parsed = distributionRequestDocSchema.safeParse(doc);
		return parsed.success
			? { kind: 'clean', docId }
			: { kind: 'invalid', docId, reason: 'Document does not satisfy the current request schema' };
	}

	for (const [itemId, group] of duplicateGroups) {
		const first = group[0];
		if (
			group.some(
				(item) =>
					item.unit !== first.unit ||
					item.distribution_type_snapshot !== first.distribution_type_snapshot
			)
		) {
			return {
				kind: 'collision',
				docId,
				reason: `${itemId} has conflicting unit or distribution_type_snapshot metadata`
			};
		}
		if (group.some((item) => item.target_qty_snapshot !== first.target_qty_snapshot)) {
			return {
				kind: 'collision',
				docId,
				reason: `${itemId} has conflicting target_qty_snapshot values`
			};
		}
	}

	const emitted = new Set<string>();
	const canonicalItems: DistributionRequestItem[] = [];
	for (const item of items) {
		if (emitted.has(item.item_id)) continue;
		emitted.add(item.item_id);
		const group = groups.get(item.item_id)!;
		canonicalItems.push({
			...item,
			requested_qty: quantityTotal(group, 'requested_qty'),
			target_qty_snapshot: item.target_qty_snapshot
		});
	}

	const migrated = { ...doc, items: canonicalItems };
	if (!distributionRequestDocSchema.safeParse(migrated).success) {
		return {
			kind: 'invalid',
			docId,
			reason: 'Canonical result does not satisfy the current request schema'
		};
	}

	return {
		kind: 'update',
		docId,
		originalRev: doc._rev,
		duplicateGroups: duplicateGroups.map(([itemId, group]) => ({
			itemId,
			rowCount: group.length,
			requestedQtys: group.map((item) => item.requested_qty),
			targetQtys: group.map((item) => item.target_qty_snapshot)
		})),
		doc: migrated
	};
}
