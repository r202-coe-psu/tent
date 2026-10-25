import { describe, expect, it } from 'vitest';
import { applyClosedAtBackfill, planClosedAtBackfill } from './closed-at-backfill';

const NOW = '2026-10-25T03:00:00.000Z';
const base = { _id: 'shelter:01', type: 'shelter', code: 'SH001', operation_status: 'closed' };

describe('planClosedAtBackfill', () => {
	it('derives closed_at from updated_at, normalized to ISO UTC', () => {
		expect(planClosedAtBackfill({ ...base, updated_at: '2026-09-01T07:00:00+07:00' }, NOW)).toEqual(
			{
				shelter_code: 'SH001',
				closed_at: '2026-09-01T00:00:00.000Z',
				source: 'updated_at'
			}
		);
	});

	it('falls back to the run time when updated_at is missing or unparseable', () => {
		for (const updated_at of [undefined, '', 'not-a-date', 42]) {
			expect(planClosedAtBackfill({ ...base, updated_at }, NOW)).toMatchObject({
				closed_at: NOW,
				source: 'now'
			});
		}
	});

	it('selects legacy docs whose status is only in the pre-CR-008 `status` field', () => {
		const legacy = { _id: 'shelter:02', type: 'shelter', code: 'SH002', status: 'closed' };
		expect(
			planClosedAtBackfill({ ...legacy, updated_at: '2026-08-01T00:00:00Z' }, NOW)
		).toMatchObject({
			shelter_code: 'SH002'
		});
	});

	it('treats an empty closed_at as missing', () => {
		for (const closed_at of [null, '', undefined]) {
			expect(planClosedAtBackfill({ ...base, closed_at, updated_at: NOW }, NOW)).not.toBeNull();
		}
	});

	it('skips shelters that already have closed_at (idempotent rerun)', () => {
		expect(
			planClosedAtBackfill({ ...base, closed_at: '2026-09-01T00:00:00.000Z' }, NOW)
		).toBeNull();
	});

	it.each(['active', 'standby', 'full_capacity', 'cancelled'])('skips a %s shelter', (status) => {
		expect(planClosedAtBackfill({ ...base, operation_status: status }, NOW)).toBeNull();
	});

	it('skips non-shelter docs', () => {
		expect(planClosedAtBackfill({ ...base, type: 'config' }, NOW)).toBeNull();
	});
});

describe('applyClosedAtBackfill', () => {
	it('changes only closed_at, updated_at and updated_by', () => {
		const doc = {
			...base,
			_rev: '1-a',
			name: 'x',
			schema_v: 7,
			updated_at: '2026-09-01T00:00:00Z'
		};
		const plan = planClosedAtBackfill(doc, NOW)!;
		expect(applyClosedAtBackfill(doc, plan, NOW, 'run1')).toEqual({
			...doc,
			closed_at: '2026-09-01T00:00:00.000Z',
			updated_at: NOW,
			updated_by: 'migration:run1'
		});
	});
});
