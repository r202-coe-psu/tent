import { describe, expect, it } from 'vitest';
import { distributionRequestDocSchema } from './distribution';
import { analyzeLegacyDuplicateDistributionRequest } from './legacy-request-duplicate-migration';

function requestDoc(items: unknown[]) {
	return {
		_id: 'distribution_request:LEGACY001',
		_rev: '3-legacy',
		type: 'distribution_request',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-08-30T00:00:00.000Z',
		updated_at: '2026-08-30T00:00:00.000Z',
		created_by: 'legacy-user',
		status: 'pending',
		requested_by: 'legacy-user',
		requested_at: '2026-08-30T00:00:00.000Z',
		purpose: 'Legacy request',
		active_headcount_snapshot: '100',
		buffer_percent: 10,
		legacy_audit_note: 'must remain untouched',
		items
	};
}

function item(
	itemId: string,
	requestedQty: string,
	targetQty: string,
	unit = 'kg',
	distributionType: 'one_time' | 'consumable' = 'consumable'
) {
	return {
		item_id: itemId,
		requested_qty: requestedQty,
		unit,
		distribution_type_snapshot: distributionType,
		target_qty_snapshot: targetQty
	};
}

describe('legacy distribution request duplicate migration', () => {
	it('leaves an already-clean request unchanged', () => {
		const result = analyzeLegacyDuplicateDistributionRequest(
			requestDoc([item('item:rice', '50', '50'), item('item:water', '20', '20', 'bottle')])
		);

		expect(result).toEqual({ kind: 'clean', docId: 'distribution_request:LEGACY001' });
	});

	it('merges one compatible duplicate group with decimal-safe totals and preserves unrelated fields', () => {
		const source = requestDoc([
			item('item:rice', '0.1', '57'),
			item('item:rice', '0.2', '57'),
			item('item:water', '2', '2', 'bottle')
		]);
		const result = analyzeLegacyDuplicateDistributionRequest(source);

		expect(result.kind).toBe('update');
		if (result.kind !== 'update') return;
		expect(result.duplicateGroups).toEqual([
			{
				itemId: 'item:rice',
				rowCount: 2,
				requestedQtys: ['0.1', '0.2'],
				targetQtys: ['57', '57']
			}
		]);
		expect(result.doc.legacy_audit_note).toBe('must remain untouched');
		expect(result.doc.status).toBe('pending');
		expect(result.doc.items).toEqual([
			item('item:rice', '0.3', '57'),
			item('item:water', '2', '2', 'bottle')
		]);
		expect(distributionRequestDocSchema.safeParse(result.doc).success).toBe(true);
	});

	it('merges every compatible duplicate group in first-row order', () => {
		const result = analyzeLegacyDuplicateDistributionRequest(
			requestDoc([
				item('item:rice', '30', '50'),
				item('item:water', '1', '10', 'bottle'),
				item('item:rice', '20', '50'),
				item('item:water', '2', '10', 'bottle')
			])
		);

		expect(result.kind).toBe('update');
		if (result.kind !== 'update') return;
		expect(result.doc.items).toEqual([
			item('item:rice', '50', '50'),
			item('item:water', '3', '10', 'bottle')
		]);
	});

	it('reports incompatible duplicate metadata as a collision without constructing an update', () => {
		const result = analyzeLegacyDuplicateDistributionRequest(
			requestDoc([item('item:rice', '30', '30', 'kg'), item('item:rice', '20', '20', 'bag')])
		);

		expect(result).toEqual({
			kind: 'collision',
			docId: 'distribution_request:LEGACY001',
			reason: 'item:rice has conflicting unit or distribution_type_snapshot metadata'
		});
	});

	it('reports conflicting request-level target snapshots as a collision', () => {
		const result = analyzeLegacyDuplicateDistributionRequest(
			requestDoc([item('item:rice', '30', '57'), item('item:rice', '20', '58')])
		);

		expect(result).toEqual({
			kind: 'collision',
			docId: 'distribution_request:LEGACY001',
			reason: 'item:rice has conflicting target_qty_snapshot values'
		});
	});

	it('preserves approved lifecycle and batch references while canonicalizing only items', () => {
		const source = {
			...requestDoc([item('item:rice', '30', '57'), item('item:rice', '20', '57')]),
			status: 'approved' as const,
			approval_operation_id: 'approval:LEGACY001',
			approved_by: 'warehouse-user',
			approved_at: '2026-08-30T01:00:00.000Z',
			batch_id: 'distribution_batch:LEGACY001'
		};

		const result = analyzeLegacyDuplicateDistributionRequest(source);
		expect(result.kind).toBe('update');
		if (result.kind !== 'update') return;
		expect(result.doc).toMatchObject({
			status: 'approved',
			approval_operation_id: 'approval:LEGACY001',
			approved_by: 'warehouse-user',
			approved_at: '2026-08-30T01:00:00.000Z',
			batch_id: 'distribution_batch:LEGACY001',
			items: [item('item:rice', '50', '57')]
		});
	});

	it('reports malformed rows as invalid without constructing an update', () => {
		const result = analyzeLegacyDuplicateDistributionRequest(
			requestDoc([
				item('item:rice', '30', '30'),
				{ ...item('item:rice', '20', '20'), requested_qty: '0' }
			])
		);

		expect(result).toEqual({
			kind: 'invalid',
			docId: 'distribution_request:LEGACY001',
			reason: 'items[1] is malformed'
		});
	});

	it('is idempotent: a migrated fixture requires no second update', () => {
		const first = analyzeLegacyDuplicateDistributionRequest(
			requestDoc([item('item:rice', '30', '50'), item('item:rice', '20', '50')])
		);
		expect(first.kind).toBe('update');
		if (first.kind !== 'update') return;

		expect(analyzeLegacyDuplicateDistributionRequest(first.doc)).toEqual({
			kind: 'clean',
			docId: 'distribution_request:LEGACY001'
		});
	});
});
