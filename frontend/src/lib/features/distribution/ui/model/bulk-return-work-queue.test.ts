import { describe, expect, it } from 'vitest';
import { compoundCapabilityRole } from '$lib/auth/roles';
import type { BulkReturnPoolOverviewRow } from '../../domain/food-supplies';
import {
	WORK_QUEUE_COPY,
	flaggedPools,
	formatWaitingAge,
	openPoolsAtPoint,
	waitingForReceive,
	workQueuesFor
} from './bulk-return-work-queue';
import { receivedHideCutoff, rowNeedsAttention } from './bulk-return-pool-v3';

const HOUR = 3_600_000;
const NOW = new Date('2026-01-10T12:00:00.000Z');

function row(
	id: string,
	status: string,
	opts: {
		submitted_at?: string;
		received_at?: string;
		created_at?: string;
		late?: number;
		unresolved?: number;
		closed?: number;
		conflicts?: number;
		loanUnavailable?: boolean;
		/** Entries as `{ refs: loan ref count, voided }`. */
		entries?: { refs: number; voided?: boolean }[];
	} = {}
): BulkReturnPoolOverviewRow {
	return {
		pool: {
			_id: id,
			status,
			name: id,
			submitted_at: opts.submitted_at,
			received_at: opts.received_at,
			created_at: opts.created_at ?? '2026-01-01T00:00:00.000Z'
		},
		entry_count: 0,
		items: [],
		entries: (opts.entries ?? []).map((e, i) => ({
			entry: { _id: `${id}-e${i}`, loan_refs: Array.from({ length: e.refs }) },
			voided: e.voided ?? false
		})),
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

	it('flags a pool whose loan refs could not be checked, counting live loan refs only', () => {
		const d = row('d', 'OPEN', {
			loanUnavailable: true,
			entries: [{ refs: 2 }, { refs: 1 }, { refs: 5, voided: true }]
		});
		expect(rowNeedsAttention(d)).toBe(true);
		const out = flaggedPools([d, row('clean', 'OPEN')]);
		expect(out).toHaveLength(1);
		expect(out[0].reasons).toEqual([{ reason: 'loan_unknown', count: 3 }]);
		expect(WORK_QUEUE_COPY.reasonLabels.loan_unknown).toBe('ตรวจยอดยืมไม่ได้');
	});

	it('still excludes a cancelled pool whose loan refs could not be checked', () => {
		const c = row('c', 'CANCELLED', { loanUnavailable: true, entries: [{ refs: 1 }] });
		expect(flaggedPools([c])).toEqual([]);
	});

	describe('RECEIVED pools and the age window', () => {
		const cutoff = receivedHideCutoff(NOW);
		const old = new Date(cutoff.getTime() - HOUR).toISOString();
		const recent = new Date(cutoff.getTime() + HOUR).toISOString();
		const flaggedIds = (rows: BulkReturnPoolOverviewRow[]) =>
			flaggedPools(rows, { hideReceivedBefore: cutoff }).map((f) => f.row.pool._id);

		it('drops an old RECEIVED pool with a closed loan, late entries or an unknown loan state', () => {
			expect(
				flaggedIds([
					row('closed', 'RECEIVED', { received_at: old, closed: 1 }),
					row('late', 'RECEIVED', { received_at: old, late: 1 }),
					row('unknown', 'RECEIVED', {
						received_at: old,
						loanUnavailable: true,
						entries: [{ refs: 1 }]
					})
				])
			).toEqual([]);
		});

		it('keeps a recently received pool flagged, including an outage-flagged one', () => {
			expect(
				flaggedIds([
					row('closed', 'RECEIVED', { received_at: recent, closed: 1 }),
					row('unknown', 'RECEIVED', {
						received_at: recent,
						loanUnavailable: true,
						entries: [{ refs: 1 }]
					})
				]).sort()
			).toEqual(['closed', 'unknown']);
			const [unknown] = flaggedPools(
				[
					row('u', 'RECEIVED', {
						received_at: recent,
						loanUnavailable: true,
						entries: [{ refs: 2 }]
					})
				],
				{ hideReceivedBefore: cutoff }
			);
			expect(unknown.reasons).toEqual([{ reason: 'loan_unknown', count: 2 }]);
		});

		it('keeps a RECEIVED pool exactly at the cutoff and one without received_at', () => {
			expect(
				flaggedIds([
					row('edge', 'RECEIVED', { received_at: cutoff.toISOString(), late: 1 }),
					row('no-date', 'RECEIVED', { late: 1 })
				]).sort()
			).toEqual(['edge', 'no-date']);
		});

		it('never ages out OPEN or SUBMITTED pools and drops nothing without a cutoff', () => {
			expect(
				flaggedIds([row('o', 'OPEN', { late: 1 }), row('s', 'SUBMITTED', { late: 1 })]).sort()
			).toEqual(['o', 's']);
			expect(
				flaggedPools([row('r', 'RECEIVED', { received_at: old, late: 1 })]).map(
					(f) => f.row.pool._id
				)
			).toEqual(['r']);
		});
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
		).toEqual(['waiting_receive', 'flagged', 'my_point']);
		expect(workQueuesFor({ roles: ['system_admin'], shelterCode: code })).toEqual([
			'waiting_receive',
			'flagged',
			'my_point'
		]);
		expect(
			workQueuesFor({
				roles: [
					`shelter:${code}`,
					compoundCapabilityRole(code, 'shelter_manager'),
					compoundCapabilityRole(code, 'distribution_staff')
				],
				shelterCode: code
			})
		).toEqual(['waiting_receive', 'flagged', 'my_point']);
		expect(
			workQueuesFor({
				roles: [
					`shelter:${code}`,
					compoundCapabilityRole(code, 'warehouse_staff'),
					compoundCapabilityRole(code, 'distribution_staff')
				],
				shelterCode: code
			})
		).toEqual(['waiting_receive', 'my_point']);
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
