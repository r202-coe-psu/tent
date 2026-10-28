import { describe, expect, it } from 'vitest';
import type {
	BulkReturnEntry,
	BulkReturnPoolOverviewRow,
	BulkReturnPoolV3
} from '../../domain/food-supplies';
import {
	CLOSED_LOAN_WARNING_TEXT,
	MISSING_LOAN_WARNING_TEXT,
	RECEIVED_POOL_HIDE_AFTER_DAYS,
	getPoolStatusFilterLabel,
	hasActivePoolFilters,
	poolItemIds,
	poolStatusCounts,
	poolStorageOptions,
	receivedHideCutoff,
	buildHeaderPatch,
	canCancelPool,
	closedLoanRefNotice,
	groupClosedLoanRefsByEntry,
	groupAppliedLoanRefsByEntry,
	groupMissedLoanRefsByEntry,
	snapshotConflictEntryIds,
	canMoveEntry,
	reopenLoanAction,
	reopenedEntryIds,
	canVoidEntry,
	filterPoolRows,
	findDuplicateOpenPoolName,
	getCancelPoolBlockedReason,
	getPoolBoardViewState,
	getPoolStatusBadgeClass,
	getPoolStatusLabel,
	isEntryActionable,
	isPatchEmpty,
	isPoolEditable,
	listMoveTargets,
	liveEntries,
	loanRefsSummary,
	poolStorageLabel,
	resolveItemDisplay,
	returnerDisplayName,
	buildReturnerNames,
	returnerLabel,
	validatePoolName
} from './bulk-return-pool-v3';

type EntryRow = BulkReturnPoolOverviewRow['entries'][number];

function makePool(id: string, overrides: Partial<BulkReturnPoolV3> = {}): BulkReturnPoolV3 {
	return {
		_id: `bulk_return_pool:${id}`,
		type: 'bulk_return_pool',
		schema_v: 3,
		shelter_code: 'SH001',
		created_at: '2026-09-24T08:00:00.000Z',
		updated_at: '2026-09-24T08:00:00.000Z',
		created_by: 'staff',
		name: `Pool ${id}`,
		status: 'OPEN',
		...overrides
	} as BulkReturnPoolV3;
}

function makeEntry(id: string, overrides: Partial<BulkReturnEntry> = {}): BulkReturnEntry {
	return {
		_id: `bulk_return_entry:${id}`,
		type: 'bulk_return_entry',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-09-24T09:00:00.000Z',
		updated_at: '2026-09-24T09:00:00.000Z',
		created_by: 'staff',
		pool_id: 'bulk_return_pool:a',
		item_id: 'item_master:fan',
		qty: '2',
		returner_type: 'unspecified',
		returner_id: null,
		loan_refs: [],
		...overrides
	} as BulkReturnEntry;
}

function makeRow(
	pool: BulkReturnPoolV3,
	opts: { entries?: EntryRow[]; late?: EntryRow[] } = {}
): BulkReturnPoolOverviewRow {
	const entries = opts.entries ?? [];
	const live = entries.filter((e) => !e.voided);
	return {
		pool,
		entry_count: live.length,
		items: [],
		entries,
		late_entries: opts.late ?? [],
		snapshot_conflicts: [],
		unresolved_refs: [],
		closed_loan_refs: [],
		is_empty: live.length === 0
	};
}

const resolved = (entry: BulkReturnEntry, voided = false): EntryRow => ({
	entry,
	pool_id: entry.pool_id,
	voided
});

describe('status helpers', () => {
	it('labels each status in Thai', () => {
		expect(getPoolStatusLabel('OPEN')).toBe('เปิดรับ');
		expect(getPoolStatusLabel('SUBMITTED')).toBe('รอตรวจสอบ');
		expect(getPoolStatusLabel('RECEIVED')).toBe('ตรวจรับแล้ว');
		expect(getPoolStatusLabel('CANCELLED')).toBe('ยกเลิก');
	});

	it('uses full-perimeter borders and no single-side stripe', () => {
		for (const status of ['OPEN', 'SUBMITTED', 'RECEIVED', 'CANCELLED'] as const) {
			const cls = getPoolStatusBadgeClass(status);
			expect(cls).toContain('border ');
			expect(cls).not.toMatch(/border-[lt]-/);
		}
	});
});

describe('filterPoolRows', () => {
	const rows = [
		makeRow(makePool('o1', { name: 'กองเต็นท์ A', created_at: '2026-09-24T08:00:00.000Z' })),
		makeRow(makePool('o2', { name: 'Tent B', created_at: '2026-09-25T08:00:00.000Z' })),
		makeRow(makePool('s1', { name: 'ส่งแล้ว', status: 'SUBMITTED' })),
		makeRow(makePool('r1', { name: 'รับแล้ว', status: 'RECEIVED' })),
		makeRow(makePool('c1', { name: 'ยกเลิกแล้ว tent', status: 'CANCELLED' }))
	];

	it('hides CANCELLED by default and shows it when toggled', () => {
		expect(filterPoolRows(rows).map((r) => r.pool.status)).not.toContain('CANCELLED');
		expect(filterPoolRows(rows, { showCancelled: true }).map((r) => r.pool.status)).toContain(
			'CANCELLED'
		);
	});

	it('sorts OPEN, SUBMITTED, RECEIVED, CANCELLED and newest first within a status', () => {
		const sorted = filterPoolRows(rows, { showCancelled: true }).map((r) => r.pool._id);
		expect(sorted).toEqual([
			'bulk_return_pool:o2',
			'bulk_return_pool:o1',
			'bulk_return_pool:s1',
			'bulk_return_pool:r1',
			'bulk_return_pool:c1'
		]);
	});

	it('searches names case-insensitively with trimmed input', () => {
		expect(filterPoolRows(rows, { search: '  TENT b ' }).map((r) => r.pool.name)).toEqual([
			'Tent B'
		]);
	});

	it('does not match cancelled pools by search unless shown', () => {
		expect(filterPoolRows(rows, { search: 'tent' }).map((r) => r.pool.name)).toEqual(['Tent B']);
		expect(
			filterPoolRows(rows, { search: 'tent', showCancelled: true }).map((r) => r.pool.name)
		).toContain('ยกเลิกแล้ว tent');
	});

	it('whitespace-only search shows everything visible', () => {
		expect(filterPoolRows(rows, { search: '   ' })).toHaveLength(4);
	});

	describe('search by returner name', () => {
		const somchai = makeEntry('e1', {
			pool_id: 'bulk_return_pool:p1',
			returner_type: 'evacuee',
			returner_id: 'evacuee:01J0000000000000000000AAAA'
		});
		const voidedReturner = makeEntry('e2', {
			pool_id: 'bulk_return_pool:p2',
			returner_type: 'volunteer',
			returner_id: 'volunteer:01J0000000000000000000BBBB'
		});
		const returnerRows = [
			makeRow(makePool('p1', { name: 'Alpha' }), { entries: [resolved(somchai)] }),
			makeRow(makePool('p2', { name: 'Beta' }), { entries: [resolved(voidedReturner, true)] })
		];
		const returnerNames = new Map([
			[somchai.returner_id!, 'สมชาย ใจดี (ชาย)'],
			[voidedReturner.returner_id!, 'จิตอาสา Mali Rak']
		]);
		const poolNames = (search: string) =>
			filterPoolRows(returnerRows, { search, returnerNames }).map((r) => r.pool.name);

		it('matches a live entry returner name case-insensitively and trimmed', () => {
			expect(poolNames('  สมชาย ')).toEqual(['Alpha']);
			expect(poolNames('ชาย)')).toEqual(['Alpha']);
		});

		it('does not match the returner of a voided entry', () => {
			expect(poolNames('mali')).toEqual([]);
		});

		it('still matches the pool name', () => {
			expect(poolNames('beta')).toEqual(['Beta']);
		});

		it('without names it falls back to the label and finds nothing for a real name', () => {
			expect(filterPoolRows(returnerRows, { search: 'สมชาย' })).toEqual([]);
		});
	});

	it('does not mutate the input array', () => {
		const copy = [...rows];
		filterPoolRows(rows, { showCancelled: true });
		expect(rows).toEqual(copy);
	});
});

describe('pool filters (#659)', () => {
	const now = new Date('2026-10-25T12:00:00.000Z');
	const cutoff = receivedHideCutoff(now);

	function withItems(row: BulkReturnPoolOverviewRow, ...ids: string[]): BulkReturnPoolOverviewRow {
		return { ...row, items: ids.map((item_id) => ({ item_id, qty: '1' })) as never };
	}
	const late = resolved(makeEntry('late'));
	const unresolved = [{ entry_id: 'e', kind: 'move' }] as never;

	const open1 = withItems(
		makeRow(
			makePool('o1', { location_storage_point_id: 'sp-1', location_storage_zone: 'โกดัง 1' })
		),
		'item_master:fan',
		'item_master:tent'
	);
	const open2 = withItems(makeRow(makePool('o2')), 'item_master:fan');
	const sub = {
		...withItems(
			makeRow(
				makePool('s1', {
					status: 'SUBMITTED',
					location_storage_point_id: 'sp-2',
					location_storage_zone: 'โกดัง 2'
				}),
				{ late: [late] }
			),
			'item_master:tent'
		)
	};
	const recentReceived = makeRow(
		makePool('r1', { status: 'RECEIVED', received_at: '2026-10-20T00:00:00.000Z' })
	);
	const oldReceived = makeRow(
		makePool('r2', { status: 'RECEIVED', received_at: '2026-10-01T00:00:00.000Z' })
	);
	const noReceivedAt = makeRow(makePool('r3', { status: 'RECEIVED' }));
	const cancelled = makeRow(makePool('c1', { status: 'CANCELLED' }));
	const unresolvedRow = { ...makeRow(makePool('o3')), unresolved_refs: unresolved };
	const rows = [
		open1,
		open2,
		sub,
		recentReceived,
		oldReceived,
		noReceivedAt,
		cancelled,
		unresolvedRow
	];
	const ids = (list: BulkReturnPoolOverviewRow[]) =>
		list.map((r) => r.pool._id.replace('bulk_return_pool:', ''));

	it('cutoff is exactly N days before now', () => {
		expect(RECEIVED_POOL_HIDE_AFTER_DAYS).toBe(7);
		expect(cutoff.toISOString()).toBe('2026-10-18T12:00:00.000Z');
	});

	it('filters by status; all keeps every status', () => {
		expect(ids(filterPoolRows(rows, { status: 'SUBMITTED' }))).toEqual(['s1']);
		expect(ids(filterPoolRows(rows, { status: 'OPEN' }))).toEqual(['o3', 'o2', 'o1']);
		expect(ids(filterPoolRows(rows, { status: 'all' }))).toHaveLength(7);
	});

	it('status filter never reveals CANCELLED', () => {
		expect(ids(filterPoolRows(rows, { status: 'all' }))).not.toContain('c1');
	});

	it('filters by item id', () => {
		expect(ids(filterPoolRows(rows, { itemId: 'item_master:tent' })).sort()).toEqual(['o1', 's1']);
		expect(filterPoolRows(rows, { itemId: 'item_master:none' })).toEqual([]);
	});

	it('filters by storage point and unspecified', () => {
		expect(ids(filterPoolRows(rows, { storagePointId: 'sp-2' }))).toEqual(['s1']);
		const unspecified = ids(filterPoolRows(rows, { storagePointId: 'unspecified' }));
		expect(unspecified).not.toContain('o1');
		expect(unspecified).not.toContain('s1');
		expect(unspecified).toContain('o2');
	});

	it('needsAttention keeps pools with late entries or unresolved refs', () => {
		expect(ids(filterPoolRows(rows, { needsAttention: true })).sort()).toEqual(['o3', 's1']);
	});

	it('needsAttention also keeps pools with snapshot conflicts', () => {
		const conflictRow = {
			...makeRow(makePool('o5')),
			snapshot_conflicts: [{ entry_id: 'bulk_return_entry:x', kind: 'void' }]
		} as unknown as BulkReturnPoolOverviewRow;
		expect(ids(filterPoolRows([...rows, conflictRow], { needsAttention: true })).sort()).toEqual([
			'o3',
			'o5',
			's1'
		]);
	});

	it('needsAttention also keeps pools with closed-loan refs', () => {
		const closedRow = {
			...makeRow(makePool('o4')),
			closed_loan_refs: [
				{ entry_id: 'bulk_return_entry:x', distribution_log_id: 'distribution_log:y', qty: '1' }
			]
		} as unknown as BulkReturnPoolOverviewRow;
		expect(ids(filterPoolRows([...rows, closedRow], { needsAttention: true })).sort()).toEqual([
			'o3',
			'o4',
			's1'
		]);
	});

	it('hides RECEIVED older than the cutoff, keeps boundary, recent and undated pools', () => {
		const shown = ids(filterPoolRows(rows, { hideReceivedBefore: cutoff }));
		expect(shown).not.toContain('r2');
		expect(shown).toEqual(expect.arrayContaining(['r1', 'r3']));
		expect(ids(filterPoolRows(rows, {}))).toContain('r2');

		const boundary = makeRow(
			makePool('b', { status: 'RECEIVED', received_at: cutoff.toISOString() })
		);
		expect(filterPoolRows([boundary], { hideReceivedBefore: cutoff })).toHaveLength(1);
		const justOlder = makeRow(
			makePool('b2', {
				status: 'RECEIVED',
				received_at: new Date(cutoff.getTime() - 1).toISOString()
			})
		);
		expect(filterPoolRows([justOlder], { hideReceivedBefore: cutoff })).toHaveLength(0);
	});

	it('combines filters (AND)', () => {
		expect(
			ids(
				filterPoolRows(rows, {
					status: 'OPEN',
					itemId: 'item_master:fan',
					storagePointId: 'sp-1',
					search: 'pool o'
				})
			)
		).toEqual(['o1']);
		expect(
			filterPoolRows(rows, { status: 'OPEN', needsAttention: true, itemId: 'item_master:tent' })
		).toEqual([]);
	});

	it('poolStatusCounts counts after toggles, before other filters', () => {
		expect(poolStatusCounts(rows, { hideReceivedBefore: cutoff })).toEqual({
			all: 6,
			OPEN: 3,
			SUBMITTED: 1,
			RECEIVED: 2
		});
		expect(poolStatusCounts(rows, {})).toEqual({ all: 7, OPEN: 3, SUBMITTED: 1, RECEIVED: 3 });
		expect(poolStatusCounts(rows, { showCancelled: true, hideReceivedBefore: cutoff }).all).toBe(7);
		expect(poolStatusCounts([])).toEqual({ all: 0, OPEN: 0, SUBMITTED: 0, RECEIVED: 0 });
	});

	it('poolItemIds lists distinct item ids', () => {
		expect(poolItemIds(rows).sort()).toEqual(['item_master:fan', 'item_master:tent']);
	});

	it('poolStorageOptions derives labelled points plus unspecified', () => {
		expect(
			poolStorageOptions(rows)
				.map((o) => o.value)
				.sort()
		).toEqual(['sp-1', 'sp-2', 'unspecified'].sort());
		expect(poolStorageOptions([open1])).toEqual([{ value: 'sp-1', label: 'โกดัง 1' }]);
		expect(poolStorageOptions([open2])).toEqual([{ value: 'unspecified', label: 'ไม่ระบุ' }]);
		const noZone = makeRow(makePool('z', { location_storage_point_id: 'sp-9' }));
		expect(poolStorageOptions([noZone])).toEqual([{ value: 'sp-9', label: 'sp-9' }]);
	});

	it('hasActivePoolFilters ignores the toggles', () => {
		expect(hasActivePoolFilters({})).toBe(false);
		expect(hasActivePoolFilters({ showCancelled: true, hideReceivedBefore: cutoff })).toBe(false);
		expect(hasActivePoolFilters({ search: '  ', status: 'all' })).toBe(false);
		expect(hasActivePoolFilters({ search: 'x' })).toBe(true);
		expect(hasActivePoolFilters({ status: 'OPEN' })).toBe(true);
		expect(hasActivePoolFilters({ itemId: 'a' })).toBe(true);
		expect(hasActivePoolFilters({ storagePointId: 'unspecified' })).toBe(true);
		expect(hasActivePoolFilters({ needsAttention: true })).toBe(true);
	});

	it('status filter labels reuse the status labels', () => {
		expect(getPoolStatusFilterLabel('all')).toBe('ทั้งหมด');
		expect(getPoolStatusFilterLabel('RECEIVED')).toBe('ตรวจรับแล้ว');
	});
});

describe('getPoolBoardViewState', () => {
	it('resolves each state in priority order', () => {
		expect(getPoolBoardViewState(true, true, 0, 0)).toBe('loading');
		expect(getPoolBoardViewState(false, true, 3, 3)).toBe('error');
		expect(getPoolBoardViewState(false, false, 0, 0)).toBe('empty');
		expect(getPoolBoardViewState(false, false, 3, 0)).toBe('search_empty');
		expect(getPoolBoardViewState(false, false, 3, 2)).toBe('ready');
	});
});

describe('validatePoolName', () => {
	it('requires a non-blank name', () => {
		expect(validatePoolName('').isValid).toBe(false);
		expect(validatePoolName('   ').isValid).toBe(false);
		expect(validatePoolName('   ').error).toBe('กรุณาระบุชื่อกอง');
	});

	it('accepts 80 characters and rejects 81', () => {
		expect(validatePoolName('ก'.repeat(80)).isValid).toBe(true);
		const tooLong = validatePoolName('ก'.repeat(81));
		expect(tooLong.isValid).toBe(false);
		expect(tooLong.error).toContain('80');
	});

	it('measures length after trimming', () => {
		const result = validatePoolName(`  ${'a'.repeat(80)}  `);
		expect(result.isValid).toBe(true);
		expect(result.normalized).toBe('a'.repeat(80));
	});
});

describe('findDuplicateOpenPoolName', () => {
	const rows = [
		makeRow(makePool('a', { name: 'Tent A' })),
		makeRow(makePool('b', { name: 'Tent B', status: 'SUBMITTED' })),
		makeRow(makePool('c', { name: 'Tent C', status: 'CANCELLED' }))
	];

	it('flags a case-insensitive, trimmed match among OPEN pools', () => {
		expect(findDuplicateOpenPoolName(rows, '  tent a ')?._id).toBe('bulk_return_pool:a');
	});

	it('does not flag names of non-OPEN pools', () => {
		expect(findDuplicateOpenPoolName(rows, 'Tent B')).toBeNull();
		expect(findDuplicateOpenPoolName(rows, 'Tent C')).toBeNull();
	});

	it('excludes the pool being renamed', () => {
		expect(findDuplicateOpenPoolName(rows, 'Tent A', 'bulk_return_pool:a')).toBeNull();
	});

	it('returns null for a blank name', () => {
		expect(findDuplicateOpenPoolName(rows, '   ')).toBeNull();
	});
});

describe('pool capabilities', () => {
	const locked = {
		op: 'CANCEL',
		op_id: 'x',
		locked_at: '2026-09-24T08:00:00.000Z',
		locked_by: 'u'
	};

	it('isPoolEditable: OPEN and not locked only', () => {
		expect(isPoolEditable(makePool('a'))).toBe(true);
		expect(isPoolEditable(makePool('a', { lock: locked as BulkReturnPoolV3['lock'] }))).toBe(false);
		expect(isPoolEditable(makePool('a', { status: 'SUBMITTED' }))).toBe(false);
	});

	it('canCancelPool requires OPEN, unlocked and empty', () => {
		expect(canCancelPool(makeRow(makePool('a')))).toBe(true);
		expect(canCancelPool(makeRow(makePool('a'), { entries: [resolved(makeEntry('1'))] }))).toBe(
			false
		);
		expect(
			canCancelPool(makeRow(makePool('a', { lock: locked as BulkReturnPoolV3['lock'] })))
		).toBe(false);
		expect(canCancelPool(makeRow(makePool('a', { status: 'SUBMITTED' })))).toBe(false);
	});

	it('a pool holding only voided entries is still cancellable', () => {
		const row = makeRow(makePool('a'), { entries: [resolved(makeEntry('1'), true)] });
		expect(canCancelPool(row)).toBe(true);
	});

	it('explains why cancel is blocked', () => {
		expect(getCancelPoolBlockedReason(makeRow(makePool('a')))).toBeNull();
		expect(
			getCancelPoolBlockedReason(makeRow(makePool('a'), { entries: [resolved(makeEntry('1'))] }))
		).toBe('ยกเลิกไม่ได้เนื่องจากยังมีรายการค้างอยู่ในกอง — ย้ายหรือยกเลิกรายการให้หมดก่อน');
		expect(getCancelPoolBlockedReason(makeRow(makePool('a', { status: 'RECEIVED' })))).toContain(
			'เปิดรับ'
		);
		expect(
			getCancelPoolBlockedReason(
				makeRow(makePool('a', { lock: locked as BulkReturnPoolV3['lock'] }))
			)
		).toContain('กำลังถูกดำเนินการ');
	});
});

describe('listMoveTargets', () => {
	it('lists other OPEN unlocked pools only', () => {
		const lockedPool = makePool('l', {
			lock: {
				op: 'SUBMIT',
				op_id: 'x',
				locked_at: '2026-09-24T08:00:00.000Z',
				locked_by: 'u'
			} as BulkReturnPoolV3['lock']
		});
		const rows = [
			makeRow(makePool('a', { name: 'A' })),
			makeRow(makePool('b', { name: 'B' })),
			makeRow(makePool('s', { status: 'SUBMITTED' })),
			makeRow(makePool('c', { status: 'CANCELLED' })),
			makeRow(lockedPool)
		];
		expect(listMoveTargets(rows, 'bulk_return_pool:a').map((p) => p._id)).toEqual([
			'bulk_return_pool:b'
		]);
	});

	it('returns an empty list when the source is the only open pool', () => {
		expect(listMoveTargets([makeRow(makePool('a'))], 'bulk_return_pool:a')).toEqual([]);
	});
});

describe('entries', () => {
	const live = makeEntry('1');
	const voidedEntry = makeEntry('2');
	const lateEntry = makeEntry('3');

	it('liveEntries drops voided entries and flags late ones', () => {
		const row = makeRow(makePool('a', { status: 'SUBMITTED' }), {
			entries: [resolved(live), resolved(voidedEntry, true), resolved(lateEntry)],
			late: [resolved(lateEntry)]
		});
		const result = liveEntries(row);
		expect(result.map((e) => e.entry._id)).toEqual([live._id, lateEntry._id]);
		expect(result.map((e) => e.late)).toEqual([false, true]);
	});

	it('canMoveEntry allows any entry while OPEN, only late entries once the pool left OPEN', () => {
		const open = makeRow(makePool('a'), { entries: [resolved(live)] });
		expect(canMoveEntry(open, live._id)).toBe(true);

		const submitted = makeRow(makePool('a', { status: 'SUBMITTED' }), {
			entries: [resolved(live), resolved(lateEntry)],
			late: [resolved(lateEntry)]
		});
		expect(canMoveEntry(submitted, live._id)).toBe(false);
		expect(canMoveEntry(submitted, lateEntry._id)).toBe(true);
	});

	it('canVoidEntry only while the pool is OPEN and unlocked', () => {
		expect(canVoidEntry(makeRow(makePool('a')))).toBe(true);
		const submitted = makeRow(makePool('a', { status: 'SUBMITTED' }), {
			entries: [resolved(lateEntry)],
			late: [resolved(lateEntry)]
		});
		expect(canVoidEntry(submitted)).toBe(false);
	});

	it('isEntryActionable covers OPEN pools and pools with late entries', () => {
		expect(isEntryActionable(makeRow(makePool('a')))).toBe(true);
		expect(isEntryActionable(makeRow(makePool('a', { status: 'RECEIVED' })))).toBe(false);
		expect(
			isEntryActionable(
				makeRow(makePool('a', { status: 'SUBMITTED' }), {
					entries: [resolved(lateEntry)],
					late: [resolved(lateEntry)]
				})
			)
		).toBe(true);
	});
});

describe('labels', () => {
	it('poolStorageLabel falls back to ไม่ระบุ', () => {
		expect(poolStorageLabel(makePool('a'))).toBe('ไม่ระบุ');
		expect(poolStorageLabel(makePool('a', { location_storage_zone: '  ' }))).toBe('ไม่ระบุ');
		expect(poolStorageLabel(makePool('a', { location_storage_zone: 'โกดัง 1' }))).toBe('โกดัง 1');
	});

	it('returnerLabel handles unspecified, evacuee and volunteer', () => {
		expect(returnerLabel({ returner_type: 'unspecified', returner_id: null })).toBe(
			'ไม่ระบุผู้คืน'
		);
		expect(returnerLabel({ returner_type: 'evacuee', returner_id: 'evacuee:abc' })).toBe(
			'ผู้พักพิง abc'
		);
		expect(
			returnerLabel({
				returner_type: 'volunteer',
				returner_id: 'volunteer:01HZXY1234567890ABCDEFGHJK'
			})
		).toBe('อาสาสมัคร …EFGHJK');
	});

	it('returnerLabel truncates a non-ULID id from the front', () => {
		expect(
			returnerLabel({ returner_type: 'evacuee', returner_id: 'evacuee:seed-st:sh001:0000' })
		).toBe('ผู้พักพิง …sh001:0000');
		expect(returnerLabel({ returner_type: 'volunteer', returner_id: 'volunteer:seed-vol:7' })).toBe(
			'อาสาสมัคร seed-vol:7'
		);
		expect(returnerLabel({ returner_type: 'evacuee', returner_id: 'plain-id-12345678901' })).toBe(
			'ผู้พักพิง …-12345678901'
		);
	});

	it('returnerDisplayName resolves a name, else falls back to returnerLabel', () => {
		const names = new Map([['evacuee:abc', 'สมชาย ใจดี']]);
		expect(
			returnerDisplayName({ returner_type: 'evacuee', returner_id: 'evacuee:abc' }, names)
		).toBe('สมชาย ใจดี');
		// unresolved id -> short-id label
		expect(
			returnerDisplayName({ returner_type: 'evacuee', returner_id: 'evacuee:zzz' }, names)
		).toBe('ผู้พักพิง zzz');
		expect(returnerDisplayName({ returner_type: 'evacuee', returner_id: 'evacuee:abc' })).toBe(
			'ผู้พักพิง abc'
		);
		// unspecified stays the unspecified label even if a name were mapped
		expect(returnerDisplayName({ returner_type: 'unspecified', returner_id: null }, names)).toBe(
			'ไม่ระบุผู้คืน'
		);
	});

	it('loanRefsSummary reports none, or count and total with unit', () => {
		expect(loanRefsSummary([])).toBe('ไม่ได้ตัดยอดยืม');
		const refs = [{ qty: '2' }, { qty: '3' }];
		expect(loanRefsSummary(refs, 'ชิ้น')).toBe('ตัดยอดยืม 2 รายการ (รวม 5 ชิ้น)');
		expect(loanRefsSummary(refs)).toBe('ตัดยอดยืม 2 รายการ (รวม 5)');
	});

	it('groupAppliedLoanRefsByEntry groups by entry id keeping ref order', () => {
		const ref = (entry_id: string, distribution_log_id: string) => ({
			entry_id,
			distribution_log_id,
			qty: '1',
			loan_status: 'returned' as const,
			revertable: true
		});
		const grouped = groupAppliedLoanRefsByEntry([ref('e1', 'a'), ref('e2', 'b'), ref('e1', 'c')]);
		expect(grouped.get('e1')?.map((r) => r.distribution_log_id)).toEqual(['a', 'c']);
		expect(grouped.get('e3')).toBeUndefined();
	});

	it('groupMissedLoanRefsByEntry groups by entry id keeping ref order', () => {
		const ref = (entry_id: string, distribution_log_id: string) => ({
			entry_id,
			distribution_log_id,
			qty: '1'
		});
		const grouped = groupMissedLoanRefsByEntry([ref('e1', 'a'), ref('e2', 'b'), ref('e1', 'c')]);
		expect(grouped.get('e1')?.map((r) => r.distribution_log_id)).toEqual(['a', 'c']);
		expect(grouped.get('e3')).toBeUndefined();
		expect(groupMissedLoanRefsByEntry([]).size).toBe(0);
	});

	it('snapshotConflictEntryIds collects entry ids and tolerates no row', () => {
		const ids = snapshotConflictEntryIds({
			snapshot_conflicts: [
				{ entry_id: 'e1', kind: 'void' },
				{ entry_id: 'e2', kind: 'move' }
			]
		});
		expect([...ids]).toEqual(['e1', 'e2']);
		expect(snapshotConflictEntryIds(null).size).toBe(0);
	});

	it('resolveItemDisplay uses the catalog or a cleaned id fallback', () => {
		const catalog = [{ _id: 'item_master:fan', name: 'พัดลม', base_unit: 'เครื่อง' }];
		expect(resolveItemDisplay('item_master:fan', catalog)).toEqual({
			name: 'พัดลม',
			unit: 'เครื่อง'
		});
		expect(resolveItemDisplay('item_master:gone', catalog)).toEqual({ name: 'gone', unit: '' });
	});
});

describe('closed-loan warning copy', () => {
	it('uses the main text for a closed loan', () => {
		expect(closedLoanRefNotice({ reason: 'closed', qty: '2', outstanding: '3' }, 'ชิ้น')).toBe(
			CLOSED_LOAN_WARNING_TEXT
		);
		expect(CLOSED_LOAN_WARNING_TEXT).toBe(
			'ยอดยืมใบนี้ถูกปิดไปก่อนที่ของจะเข้ากอง — โปรดตรวจสอบว่าปิดถูกต้องหรือไม่'
		);
	});

	it('adds the qty and outstanding for an insufficient loan', () => {
		const text = closedLoanRefNotice(
			{ reason: 'insufficient', qty: '2', outstanding: '1' },
			'ชิ้น'
		);
		expect(text).toContain(CLOSED_LOAN_WARNING_TEXT);
		expect(text).toContain('จำนวน 2 ชิ้น ไม่ถูกหักจากยอดยืม');
		expect(text).toContain('เหลือเพียง 1 ชิ้น');
		expect(closedLoanRefNotice({ reason: 'insufficient', qty: '2' })).toContain('เหลือเพียง 0');
	});

	it('has its own text for a missing loan', () => {
		expect(closedLoanRefNotice({ reason: 'missing', qty: '1' })).toBe(MISSING_LOAN_WARNING_TEXT);
	});

	it('groups refs by entry id keeping order', () => {
		const ref = (entry_id: string, distribution_log_id: string) => ({
			entry_id,
			distribution_log_id,
			qty: '1',
			reason: 'closed' as const
		});
		const grouped = groupClosedLoanRefsByEntry([ref('e1', 'a'), ref('e2', 'b'), ref('e1', 'c')]);
		expect(grouped.get('e1')?.map((r) => r.distribution_log_id)).toEqual(['a', 'c']);
		expect(grouped.get('e2')).toHaveLength(1);
		expect(grouped.get('e3')).toBeUndefined();
	});
});

describe('buildHeaderPatch', () => {
	const pool = makePool('a', {
		name: 'Tent A',
		location_storage_point_id: 'sp-1',
		location_storage_zone: 'โกดัง 1',
		notes: 'หมายเหตุเดิม'
	});
	const points = [
		{ id: 'sp-1', name: 'โกดัง 1' },
		{ id: 'sp-2', name: 'โกดัง 2' }
	];
	const resolve = (id: string) => points.find((p) => p.id === id);
	const same = { name: 'Tent A', storagePointId: 'sp-1', notes: 'หมายเหตุเดิม' };

	it('is empty when nothing changed (trim-insensitive)', () => {
		const patch = buildHeaderPatch(
			pool,
			{ ...same, name: '  Tent A  ', notes: ' หมายเหตุเดิม ' },
			resolve
		);
		expect(isPatchEmpty(patch)).toBe(true);
	});

	it('sends only the changed name', () => {
		expect(buildHeaderPatch(pool, { ...same, name: ' New ' }, resolve)).toEqual({ name: 'New' });
	});

	it('sends the new storage point as {id, name}', () => {
		expect(buildHeaderPatch(pool, { ...same, storagePointId: 'sp-2' }, resolve)).toEqual({
			storagePoint: { id: 'sp-2', name: 'โกดัง 2' }
		});
	});

	it('clears storage with null and notes with null', () => {
		expect(buildHeaderPatch(pool, { ...same, storagePointId: '', notes: '  ' }, resolve)).toEqual({
			storagePoint: null,
			notes: null
		});
	});

	it('does not clear storage on a pool that never had one', () => {
		const bare = makePool('b', { name: 'X' });
		expect(
			isPatchEmpty(buildHeaderPatch(bare, { name: 'X', storagePointId: '', notes: '' }, resolve))
		).toBe(true);
	});

	it('skips an unknown storage point id', () => {
		expect(isPatchEmpty(buildHeaderPatch(pool, { ...same, storagePointId: 'zzz' }, resolve))).toBe(
			true
		);
	});
});

describe('buildReturnerNames', () => {
	it('maps evacuees (with nickname) and volunteers to display names', () => {
		const names = buildReturnerNames(
			[
				{ _id: 'evacuee:a', first_name: 'สมชาย', last_name: 'ใจดี', nickname: 'ชาย' },
				{ _id: 'evacuee:b', first_name: 'สมหญิง', last_name: 'รักดี' }
			],
			[{ _id: 'volunteer:c', first_name: 'มานี', last_name: 'มีนา' }]
		);
		expect(names.get('evacuee:a')).toBe('สมชาย ใจดี (ชาย)');
		expect(names.get('evacuee:b')).toBe('สมหญิง รักดี');
		expect(names.get('volunteer:c')).toBe('จิตอาสา มานี มีนา');
		expect(names.get('evacuee:z')).toBeUndefined();
	});
});

describe('reopenLoanAction', () => {
	const entryId = 'bulk_return_entry:01HZX0000000000000000000A1';
	const closed = (status: 'SUBMITTED' | 'RECEIVED') =>
		makePool('r', { status, entry_ids: [entryId] });
	const pool = closed('SUBMITTED');
	const ok = { revertable: true, loan_status: 'returned' } as const;
	const lost = { revertable: false, loan_status: 'lost' } as const;
	const waived = { revertable: false, loan_status: 'waived' } as const;
	const active = { revertable: false, loan_status: 'active' } as const;
	type Args = Parameters<typeof reopenLoanAction>[0];
	const act = (appliedRefs: Args['appliedRefs'], extra: Partial<Args> = {}) =>
		reopenLoanAction({
			pool,
			entryId,
			appliedRefs,
			canReopen: true,
			reopened: false,
			reopenedKnown: true,
			...extra
		});
	const notice = (appliedRefs: Args['appliedRefs']) => act(appliedRefs).blockedNotice;
	const HIDDEN = { showButton: false, blockedNotice: null };

	it('shows for a SUBMITTED / RECEIVED pool holding the entry, with applied refs, when permitted', () => {
		for (const status of ['SUBMITTED', 'RECEIVED'] as const) {
			expect(act([ok], { pool: closed(status) })).toEqual({
				showButton: true,
				blockedNotice: null
			});
		}
	});

	it('hides without permission', () => {
		expect(act([ok, ok], { canReopen: false })).toEqual(HIDDEN);
	});

	it('hides when no loan ref is applied', () => {
		expect(act([])).toEqual(HIDDEN);
	});

	it('hides for OPEN / CANCELLED pools', () => {
		for (const status of ['OPEN', 'CANCELLED'] as const) {
			expect(act([ok], { pool: makePool('r', { status, entry_ids: [entryId] }) })).toEqual(HIDDEN);
		}
	});

	it('hides when the entry is not in the pool snapshot', () => {
		expect(
			act([ok], {
				pool: closed('RECEIVED'),
				entryId: 'bulk_return_entry:01HZX0000000000000000000B2'
			})
		).toEqual(HIDDEN);
	});

	it('hides the button when any applied ref is not revertable (the workflow rejects the whole entry)', () => {
		const result = act([ok, lost]);
		expect(result.showButton).toBe(false);
		expect(result.blockedNotice).not.toBeNull();
	});

	it('still shows the button for a reopened entry whose refs are all revertable', () => {
		expect(act([ok], { reopened: true })).toEqual({ showButton: true, blockedNotice: null });
	});

	it('offers the replay for a reopened entry with a revertable ref left, never a notice', () => {
		expect(act([ok, lost], { reopened: true })).toEqual({ showButton: true, blockedNotice: null });
	});

	it('hides a reopened entry with no revertable ref left', () => {
		expect(act([active], { reopened: true })).toEqual(HIDDEN);
		expect(act([lost], { reopened: true })).toEqual(HIDDEN);
	});

	it('shows nothing for a blocked entry while the reopened state is unknown', () => {
		expect(act([ok, lost], { reopenedKnown: false })).toEqual(HIDDEN);
		expect(act([lost], { reopenedKnown: false })).toEqual(HIDDEN);
	});

	it('keeps the button for an all-revertable entry while the reopened state is unknown', () => {
		expect(act([ok], { reopenedKnown: false })).toEqual({
			showButton: true,
			blockedNotice: null
		});
	});

	it('explains an entry whose applied loans are all lost', () => {
		expect(notice([lost])).toBe('เปิดยอดยืมกลับไม่ได้ ยอดยืมถูกปิดเป็นสูญหายแล้ว');
		expect(notice([lost, lost])).toBe('เปิดยอดยืมกลับไม่ได้ ยอดยืมถูกปิดเป็นสูญหายแล้ว');
	});

	it('explains an entry whose applied loans are all waived', () => {
		expect(notice([waived])).toBe('เปิดยอดยืมกลับไม่ได้ ยอดยืมถูกปิดเป็นยกเว้นแล้ว');
	});

	it('explains a mix of lost and waived', () => {
		expect(notice([lost, waived])).toBe('เปิดยอดยืมกลับไม่ได้ ยอดยืมถูกปิดเป็นสูญหาย/ยกเว้นแล้ว');
	});

	it('counts the closed loans when only some are blocked', () => {
		expect(notice([ok, lost])).toBe(
			'เปิดยอดยืมกลับไม่ได้ ยอดยืม 1 จาก 2 รายการถูกปิดเป็นสูญหายแล้ว'
		);
		expect(notice([waived, ok, lost])).toBe(
			'เปิดยอดยืมกลับไม่ได้ ยอดยืม 2 จาก 3 รายการถูกปิดเป็นสูญหาย/ยกเว้นแล้ว'
		);
	});

	it('says the status changed for a blocked loan that is neither lost nor waived', () => {
		expect(notice([active])).toBe('เปิดยอดยืมกลับไม่ได้ ยอดยืมเปลี่ยนไปแล้ว');
		expect(notice([ok, active])).toBe('เปิดยอดยืมกลับไม่ได้ ยอดยืม 1 จาก 2 รายการเปลี่ยนไปแล้ว');
	});

	it('uses the generic changed copy with the full blocked count when mixed with another status', () => {
		expect(notice([lost, active])).toBe('เปิดยอดยืมกลับไม่ได้ ยอดยืมเปลี่ยนไปแล้ว');
		expect(notice([ok, lost, active])).toBe(
			'เปิดยอดยืมกลับไม่ได้ ยอดยืม 2 จาก 3 รายการเปลี่ยนไปแล้ว'
		);
	});

	it('is null where the button would not be offered anyway', () => {
		expect(act([lost], { canReopen: false }).blockedNotice).toBeNull();
		expect(
			act([lost], { pool: makePool('r', { status: 'OPEN', entry_ids: [entryId] }) }).blockedNotice
		).toBeNull();
		expect(
			act([lost], { entryId: 'bulk_return_entry:01HZX0000000000000000000B2' }).blockedNotice
		).toBeNull();
		expect(notice([])).toBeNull();
	});

	it('is null when every applied ref is revertable (the button shows instead)', () => {
		expect(notice([ok, ok])).toBeNull();
	});
});

describe('reopenedEntryIds', () => {
	it('collects entry ids of loan_reopened events only', () => {
		const ids = reopenedEntryIds([
			{ kind: 'loan_reopened', entry_id: 'e1' },
			{ kind: 'voided', entry_id: 'e2' },
			{ kind: 'loan_reopened' }
		]);
		expect([...ids]).toEqual(['e1']);
	});

	it('is empty for undefined', () => {
		expect(reopenedEntryIds(undefined).size).toBe(0);
	});
});
