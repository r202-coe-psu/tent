import { describe, expect, it } from 'vitest';
import { compoundCapabilityRole } from '$lib/auth/roles';
import type { BulkReturnPoolOverviewRow } from '../../domain/food-supplies';
import {
	flaggedPools,
	formatWaitingAge,
	openPoolsAtPoint,
	rowNeedsAttention,
	waitingForReceive,
	workQueuesFor
} from './bulk-return-work-queue';

const HOUR = 3_600_000;
const NOW = new Date('2026-01-10T12:00:00.000Z');

function row(
	id: string,
	status: string,
	opts: {
		submitted_at?: string;
		created_at?: string;
		late?: number;
		unresolved?: number;
		closed?: number;
		conflicts?: number;
		loanUnavailable?: boolean;
	} = {}
): BulkReturnPoolOverviewRow {
	return {
		pool: {
			_id: id,
			status,
			name: id,
			submitted_at: opts.submitted_at,
			created_at: opts.created_at ?? '2026-01-01T00:00:00.000Z'
		},
		entry_count: 0,
		items: [],
		entries: [],
		late_entries: Array.from({ length: opts.late ?? 0 }),
		is_empty: true,
		unresolved_refs: Array.from({ length: opts.unresolved ?? 0 }),
		closed_loan_refs: Array.from({ length: opts.closed ?? 0 }),
		loan_refs_unavailable: opts.loanUnavailable ?? false,
		snapshot_conflicts: Array.from({ length: opts.conflicts ?? 0 }, (_, i) => ({
			entry_id: `e${i}`,
			kind: 'void'
		}))
	} as unknown as BulkReturnPoolOverviewRow;
}

describe('waitingForReceive', () => {
	it('keeps only SUBMITTED, oldest first, with age', () => {
		const out = waitingForReceive(
			[
				row('new', 'SUBMITTED', { submitted_at: '2026-01-10T11:00:00.000Z' }),
				row('open', 'OPEN'),
				row('old', 'SUBMITTED', { submitted_at: '2026-01-09T12:00:00.000Z' }),
				row('done', 'RECEIVED')
			],
			NOW
		);
		expect(out.map((w) => w.row.pool._id)).toEqual(['old', 'new']);
		expect(out[0].ageMs).toBe(24 * HOUR);
		expect(out[1].ageMs).toBe(HOUR);
	});

	it('clamps a future submitted_at to zero age', () => {
		const out = waitingForReceive(
			[row('f', 'SUBMITTED', { submitted_at: '2026-01-11T00:00:00.000Z' })],
			NOW
		);
		expect(out[0].ageMs).toBe(0);
	});
});

describe('flaggedPools', () => {
	it('excludes cancelled and clean pools and tags reasons with counts', () => {
		const out = flaggedPools([
			row('clean', 'OPEN'),
			row('cancelled', 'CANCELLED', { late: 2 }),
			row('a', 'SUBMITTED', { late: 2, closed: 1 })
		]);
		expect(out).toHaveLength(1);
		expect(out[0].reasons).toEqual([
			{ reason: 'late', count: 2 },
			{ reason: 'closed_loan', count: 1 }
		]);
	});

	it('flags a pool with snapshot conflicts', () => {
		expect(rowNeedsAttention(row('c', 'SUBMITTED', { conflicts: 1 }))).toBe(true);
		expect(rowNeedsAttention(row('ok', 'SUBMITTED'))).toBe(false);
		const out = flaggedPools([row('c', 'SUBMITTED', { conflicts: 2 })]);
		expect(out[0].reasons).toEqual([{ reason: 'snapshot_conflict', count: 2 }]);
	});

	it('does not flag a pool only because its loan refs could not be checked (CR-193 item 23)', () => {
		expect(rowNeedsAttention(row('d', 'OPEN', { loanUnavailable: true }))).toBe(false);
		expect(flaggedPools([row('d', 'OPEN', { loanUnavailable: true })])).toEqual([]);
	});

	it('sorts by most reasons, then oldest created_at', () => {
		const out = flaggedPools([
			row('one-new', 'OPEN', { late: 1, created_at: '2026-01-05T00:00:00.000Z' }),
			row('one-old', 'OPEN', { unresolved: 1, created_at: '2026-01-02T00:00:00.000Z' }),
			row('three', 'OPEN', {
				late: 1,
				unresolved: 1,
				closed: 1,
				created_at: '2026-01-08T00:00:00.000Z'
			})
		]);
		expect(out.map((f) => f.row.pool._id)).toEqual(['three', 'one-old', 'one-new']);
		expect(out[0].reasons.map((r) => r.reason)).toEqual(['late', 'pending_sync', 'closed_loan']);
	});
});

describe('formatWaitingAge', () => {
	it('handles boundaries', () => {
		expect(formatWaitingAge(0)).toBe('ไม่ถึง 1 ชม.');
		expect(formatWaitingAge(HOUR - 1)).toBe('ไม่ถึง 1 ชม.');
		expect(formatWaitingAge(HOUR)).toBe('1 ชม.');
		expect(formatWaitingAge(24 * HOUR - 1)).toBe('23 ชม.');
		expect(formatWaitingAge(24 * HOUR)).toBe('1 วัน');
		expect(formatWaitingAge(49 * HOUR)).toBe('2 วัน');
	});
});

describe('workQueuesFor', () => {
	it('maps roles to queues', () => {
		const code = 'SH1';
		expect(
			workQueuesFor({
				roles: [`shelter:${code}`, compoundCapabilityRole(code, 'shelter_manager')],
				shelterCode: code
			})
		).toEqual(['waiting_receive', 'flagged']);
		expect(workQueuesFor({ roles: ['system_admin'], shelterCode: code })).toEqual([
			'waiting_receive',
			'flagged'
		]);
		expect(
			workQueuesFor({
				roles: [`shelter:${code}`, compoundCapabilityRole(code, 'warehouse_staff')],
				shelterCode: code
			})
		).toEqual(['waiting_receive']);
		expect(
			workQueuesFor({
				roles: [`shelter:${code}`, compoundCapabilityRole(code, 'supply_coordinator')],
				shelterCode: code
			})
		).toEqual(['waiting_receive']);
		expect(
			workQueuesFor({
				roles: [`shelter:${code}`, compoundCapabilityRole(code, 'distribution_staff')],
				shelterCode: code
			})
		).toEqual(['my_point']);
		expect(workQueuesFor({ roles: [], shelterCode: code })).toEqual([]);
	});
});

describe('openPoolsAtPoint', () => {
	function at(id: string, status: string, point: string | undefined, created: string) {
		const r = row(id, status, { created_at: created });
		(r.pool as { location_storage_point_id?: string }).location_storage_point_id = point;
		return r;
	}
	const rows = [
		at('a-old', 'OPEN', 'p1', '2026-01-01T00:00:00.000Z'),
		at('a-new', 'OPEN', 'p1', '2026-01-05T00:00:00.000Z'),
		at('a-sub', 'SUBMITTED', 'p1', '2026-01-06T00:00:00.000Z'),
		at('b', 'OPEN', 'p2', '2026-01-03T00:00:00.000Z'),
		at('none', 'OPEN', undefined, '2026-01-02T00:00:00.000Z')
	];

	it('keeps OPEN pools at the point, newest first', () => {
		expect(openPoolsAtPoint(rows, 'p1').map((r) => r.pool._id)).toEqual(['a-new', 'a-old']);
	});

	it('unspecified matches pools without a point', () => {
		expect(openPoolsAtPoint(rows, 'unspecified').map((r) => r.pool._id)).toEqual(['none']);
	});

	it('returns empty for an unknown point', () => {
		expect(openPoolsAtPoint(rows, 'zzz')).toEqual([]);
	});
});
