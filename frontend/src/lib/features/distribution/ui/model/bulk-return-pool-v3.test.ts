import { describe, expect, it } from 'vitest';
import type {
	BulkReturnEntry,
	BulkReturnPoolOverviewRow,
	BulkReturnPoolV3
} from '../../domain/food-supplies';
import {
	buildHeaderPatch,
	canCancelPool,
	canMoveEntry,
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
		expect(getPoolStatusLabel('SUBMITTED')).toBe('ส่งแล้ว');
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

	it('does not mutate the input array', () => {
		const copy = [...rows];
		filterPoolRows(rows, { showCancelled: true });
		expect(rows).toEqual(copy);
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
		).toBe('ย้ายของออกให้หมดก่อน');
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
			returnerLabel({ returner_type: 'volunteer', returner_id: 'volunteer:01HZXY1234567890ABCD' })
		).toBe('อาสาสมัคร …90ABCD');
	});

	it('loanRefsSummary reports none, or count and total with unit', () => {
		expect(loanRefsSummary({ loan_refs: [] })).toBe('ไม่ได้ตัดยอดยืม');
		const refs = [
			{ distribution_log_id: 'distribution_log:1', qty: '2' },
			{ distribution_log_id: 'distribution_log:2', qty: '3' }
		] as BulkReturnEntry['loan_refs'];
		expect(loanRefsSummary({ loan_refs: refs }, 'ชิ้น')).toBe('ตัดยอดยืม 2 รายการ (รวม 5 ชิ้น)');
		expect(loanRefsSummary({ loan_refs: refs })).toBe('ตัดยอดยืม 2 รายการ (รวม 5)');
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
