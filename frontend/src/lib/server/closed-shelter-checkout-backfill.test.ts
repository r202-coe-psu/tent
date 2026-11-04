import { describe, expect, it } from 'vitest';
import {
	BACKFILL_CREATED_BY,
	buildBackfillSummaryAudit,
	parseBackfillArgs,
	selectClosedShelters
} from './closed-shelter-checkout-backfill';

describe('parseBackfillArgs', () => {
	it('defaults to dry-run', () => {
		expect(parseBackfillArgs([])).toEqual({ ok: true, mode: 'dry-run', shelter: null });
		expect(parseBackfillArgs(['--dry-run'])).toEqual({ ok: true, mode: 'dry-run', shelter: null });
	});

	it('write needs --confirm and cannot combine with --dry-run', () => {
		expect(parseBackfillArgs(['--write']).ok).toBe(false);
		expect(parseBackfillArgs(['--write', '--dry-run', '--confirm']).ok).toBe(false);
		expect(parseBackfillArgs(['--confirm']).ok).toBe(false);
		expect(parseBackfillArgs(['--write', '--confirm'])).toEqual({
			ok: true,
			mode: 'write',
			shelter: null
		});
	});

	it('parses --shelter in both forms and rejects a missing value or unknown flag', () => {
		expect(parseBackfillArgs(['--shelter', 'SH001'])).toMatchObject({ shelter: 'SH001' });
		expect(parseBackfillArgs(['--shelter=SH002', '--dry-run'])).toMatchObject({ shelter: 'SH002' });
		expect(parseBackfillArgs(['--shelter']).ok).toBe(false);
		expect(parseBackfillArgs(['--shelter', '--dry-run']).ok).toBe(false);
		expect(parseBackfillArgs(['--wat']).ok).toBe(false);
	});
});

describe('selectClosedShelters', () => {
	const docs = [
		{
			type: 'shelter',
			code: 'SH002',
			operation_status: 'closed',
			closed_at: '2026-10-01T00:00:00Z'
		},
		{ type: 'shelter', code: 'SH001', status: 'closed' }, // legacy `status`, no closed_at
		{ type: 'shelter', code: 'SH003', operation_status: 'open' },
		{ type: 'shelter', code: 'SH004', operation_status: 'cancelled' },
		{ type: 'other', code: 'SH005', operation_status: 'closed' },
		{ type: 'shelter', operation_status: 'closed' }
	];

	it('selects only closed shelters, sorted, keeping closed_at or null', () => {
		expect(selectClosedShelters(docs)).toEqual({
			ok: true,
			shelters: [
				{ code: 'SH001', closed_at: null },
				{ code: 'SH002', closed_at: '2026-10-01T00:00:00Z' }
			]
		});
	});

	it('limits to one shelter, case-insensitively', () => {
		expect(selectClosedShelters(docs, 'sh002')).toEqual({
			ok: true,
			shelters: [{ code: 'SH002', closed_at: '2026-10-01T00:00:00Z' }]
		});
	});

	it('errors for a shelter that is not closed or not found', () => {
		expect(selectClosedShelters(docs, 'SH003')).toMatchObject({ ok: false });
		expect(selectClosedShelters(docs, 'NOPE')).toMatchObject({ ok: false });
	});
});

describe('buildBackfillSummaryAudit', () => {
	const target = { code: 'SH001', closed_at: '2026-10-01T00:00:00Z' };

	it('is null when nothing changed and nothing failed (idempotent re-run)', () => {
		expect(
			buildBackfillSummaryAudit(target, {
				checked_out: 0,
				cancelled: 0,
				households_repaired: 0,
				failed: []
			})
		).toBeNull();
	});

	it('is written when the run only repaired households (FR-30a)', () => {
		const audit = buildBackfillSummaryAudit(target, {
			checked_out: 0,
			cancelled: 0,
			households_repaired: 3,
			failed: []
		});
		expect(audit?.context).toMatchObject({ checked_out: 0, cancelled: 0, households_repaired: 3 });
	});

	it('records the backfill context on the shelter', () => {
		const audit = buildBackfillSummaryAudit(target, {
			checked_out: 450,
			cancelled: 2,
			households_repaired: 4,
			failed: [{ evacuee_id: 'evacuee:1', error: 'boom' }]
		});
		expect(audit).toMatchObject({
			type: 'audit',
			action: 'other',
			target_type: 'shelter',
			target_id: 'SH001',
			reason: 'shelter_closed',
			shelter_code: 'SH001',
			created_by: BACKFILL_CREATED_BY,
			context: {
				backfill: true,
				shelter_closed_at: '2026-10-01T00:00:00Z',
				checked_out: 450,
				cancelled: 2,
				failed: 1,
				households_repaired: 4
			}
		});
	});

	it('stores a null shelter_closed_at when the registry has none', () => {
		const audit = buildBackfillSummaryAudit(
			{ code: 'SH001', closed_at: null },
			{ checked_out: 1, cancelled: 0, households_repaired: 0, failed: [] }
		);
		expect(audit?.context).toMatchObject({ shelter_closed_at: null });
	});

	it('is written for a failure-only run', () => {
		expect(
			buildBackfillSummaryAudit(target, {
				checked_out: 0,
				cancelled: 0,
				households_repaired: 0,
				failed: [{ evacuee_id: 'evacuee:1', error: 'x' }]
			})
		).not.toBeNull();
	});
});
