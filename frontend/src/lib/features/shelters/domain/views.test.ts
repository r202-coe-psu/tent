import { describe, it, expect, beforeEach } from 'vitest';
import { SHELTER_DASHBOARD_VIEWS } from './views';
import { SHELTER_VIEW_MANIFEST } from './view-manifest';

describe('SHELTER_DASHBOARD_VIEWS Map Functions', () => {
	let emitted: { key: unknown; value: unknown }[] = [];

	// Mock CouchDB emit
	const mockEmit = (key: unknown, value: unknown) => {
		emitted.push({ key, value });
	};

	beforeEach(() => {
		emitted = [];
	});

	const createMapFn = (mapStr: string) => {
		return new Function(
			'doc',
			'emit',
			`
            const fn = ${mapStr};
            fn(doc);
        `
		);
	};

	describe('occupancy', () => {
		const mapFn = createMapFn(SHELTER_DASHBOARD_VIEWS.views.occupancy.map);

		it('ignores non-evacuee docs', () => {
			mapFn({ type: 'other' }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('emits current_stay.status', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'registered' } }, mockEmit);
			expect(emitted).toEqual([{ key: 'registered', value: 1 }]);
		});
	});

	describe('demographics_by_age', () => {
		const mapFn = createMapFn(SHELTER_DASHBOARD_VIEWS.views.demographics_by_age.map);

		it('ignores evacuees who are not active in the shelter', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'pre_registered' } }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('emits a null key if no birth_year', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'active' } }, mockEmit);
			expect(emitted).toEqual([{ key: null, value: 1 }]);
		});

		it('emits the birth year as a deterministic key', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'active' }, birth_year: 2536 }, mockEmit);
			expect(emitted).toEqual([{ key: 2536, value: 1 }]);
		});

		it('counts room_confirmed as in the shelter (CR-170)', () => {
			mapFn(
				{ type: 'evacuee', current_stay: { status: 'room_confirmed' }, birth_year: 2540 },
				mockEmit
			);
			expect(emitted).toEqual([{ key: 2540, value: 1 }]);
		});

		it('ignores arriving and temporary_leave', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'arriving' } }, mockEmit);
			mapFn({ type: 'evacuee', current_stay: { status: 'temporary_leave' } }, mockEmit);
			expect(emitted).toHaveLength(0);
		});
	});

	describe('demographics_by_country', () => {
		const mapFn = createMapFn(SHELTER_DASHBOARD_VIEWS.views.demographics_by_country.map);

		it('ignores evacuees who are not active in the shelter', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'checked_out' } }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('emits UNKNOWN if no country', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'active' } }, mockEmit);
			expect(emitted).toEqual([{ key: 'UNKNOWN', value: 1 }]);
		});

		it('normalizes country names to uppercase and trims', () => {
			mapFn(
				{ type: 'evacuee', current_stay: { status: 'active' }, country: ' thailand ' },
				mockEmit
			);
			expect(emitted).toEqual([{ key: 'THAILAND', value: 1 }]);
		});

		it('counts room_confirmed as in the shelter (CR-170)', () => {
			mapFn(
				{ type: 'evacuee', current_stay: { status: 'room_confirmed' }, country: 'myanmar' },
				mockEmit
			);
			expect(emitted).toEqual([{ key: 'MYANMAR', value: 1 }]);
		});
	});

	describe('registrations_by_date_status', () => {
		const mapFn = createMapFn(SHELTER_DASHBOARD_VIEWS.views.registrations_by_date_status.map);

		it('ignores docs without occurred_at', () => {
			mapFn({ type: 'movement', action: 'check_in' }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('ignores non-movement docs that are not evacuees', () => {
			mapFn({ type: 'other', occurred_at: '2026-07-01T12:00:00Z', action: 'check_in' }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('does not read evacuee occurred_at or action as a movement', () => {
			mapFn({ type: 'evacuee', occurred_at: '2026-07-01T12:00:00Z', action: 'check_in' }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('emits checkin for check_in and transfer_in actions with +7 offset', () => {
			// UTC 2026-07-01 23:00 is 2026-07-02 06:00 in Thailand
			mapFn(
				{ type: 'movement', action: 'check_in', occurred_at: '2026-07-01T23:00:00Z' },
				mockEmit
			);
			expect(emitted).toEqual([{ key: ['2026-07-02', 'checkin'], value: 1 }]);
		});

		it('emits checkout for check_out and transfer_out actions', () => {
			mapFn(
				{ type: 'movement', action: 'transfer_out', occurred_at: '2026-07-01T12:00:00Z' },
				mockEmit
			);
			expect(emitted).toEqual([{ key: ['2026-07-01', 'checkout'], value: 1 }]);
		});

		describe('preregister series', () => {
			const evacuee = (overrides: Record<string, unknown>) => ({
				type: 'evacuee',
				registered_via: 'web',
				created_at: '2026-07-01T05:00:00Z',
				current_stay: { status: 'registered' },
				...overrides
			});

			it.each(['web', 'kiosk', 'api'])('emits preregister for registered_via %s', (via) => {
				mapFn(evacuee({ registered_via: via }), mockEmit);
				expect(emitted).toEqual([{ key: ['2026-07-01', 'preregister'], value: 1 }]);
			});

			it('emits nothing for staff (onsite) registration', () => {
				mapFn(evacuee({ registered_via: 'staff' }), mockEmit);
				expect(emitted).toHaveLength(0);
			});

			it('emits nothing when registered_via is missing or unknown', () => {
				mapFn(evacuee({ registered_via: undefined }), mockEmit);
				mapFn(evacuee({ registered_via: 'import' }), mockEmit);
				expect(emitted).toHaveLength(0);
			});

			it('emits nothing for a cancelled stay', () => {
				mapFn(evacuee({ current_stay: { status: 'cancelled' } }), mockEmit);
				expect(emitted).toHaveLength(0);
			});

			it('emits nothing without created_at', () => {
				mapFn(evacuee({ created_at: undefined }), mockEmit);
				expect(emitted).toHaveLength(0);
			});

			it('buckets by the Asia/Bangkok day of created_at', () => {
				mapFn(evacuee({ created_at: '2026-10-24T20:00:00Z' }), mockEmit);
				expect(emitted).toEqual([{ key: ['2026-10-25', 'preregister'], value: 1 }]);
			});

			it('keeps counting after the person has checked in', () => {
				mapFn(evacuee({ current_stay: { status: 'active' } }), mockEmit);
				expect(emitted).toEqual([{ key: ['2026-07-01', 'preregister'], value: 1 }]);
			});

			it('counts an evacuee without current_stay', () => {
				mapFn(evacuee({ current_stay: undefined }), mockEmit);
				expect(emitted).toEqual([{ key: ['2026-07-01', 'preregister'], value: 1 }]);
			});

			it('leaves movements emitting checkin and checkout', () => {
				mapFn(
					{ type: 'movement', action: 'check_in', occurred_at: '2026-07-01T12:00:00Z' },
					mockEmit
				);
				mapFn(
					{ type: 'movement', action: 'check_out', occurred_at: '2026-07-01T12:00:00Z' },
					mockEmit
				);
				expect(emitted).toEqual([
					{ key: ['2026-07-01', 'checkin'], value: 1 },
					{ key: ['2026-07-01', 'checkout'], value: 1 }
				]);
			});
		});
	});

	describe('bulk_return_pool_item_totals', () => {
		const view = SHELTER_DASHBOARD_VIEWS.views.bulk_return_pool_item_totals;
		const mapFn = createMapFn(view.map);
		const P1 = 'bulk_return_pool:01J00000000000000000000001';
		const P2 = 'bulk_return_pool:01J00000000000000000000002';
		const E1 = 'bulk_return_entry:01J00000000000000000000003';

		it('uses the built-in _sum reduce', () => {
			expect(view.reduce).toBe('_sum');
		});

		it('ignores other doc types', () => {
			mapFn({ type: 'bulk_return_pool', _id: P1 }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('emits [qty, 1] keyed by [pool, item, entry] for an entry', () => {
			mapFn(
				{ type: 'bulk_return_entry', _id: E1, pool_id: P1, item_id: 'item:cot', qty: '3' },
				mockEmit
			);
			expect(emitted).toEqual([{ key: [P1, 'item:cot', E1], value: [3, 1] }]);
		});

		it('emits a negative row for the source pool and a positive row for the target on a move', () => {
			mapFn(
				{
					type: 'bulk_return_entry_move',
					_id: `bulk_return_entry_move:01J00000000000000000000003:0001`,
					entry_id: E1,
					from_pool_id: P1,
					to_pool_id: P2,
					item_id: 'item:cot',
					qty: '3'
				},
				mockEmit
			);
			expect(emitted).toEqual([
				{ key: [P1, 'item:cot', E1], value: [-3, -1] },
				{ key: [P2, 'item:cot', E1], value: [3, 1] }
			]);
		});

		it('emits a negative row for the resolved pool on a void so the entry nets out', () => {
			mapFn(
				{
					type: 'bulk_return_entry_void',
					_id: 'bulk_return_entry_void:01J00000000000000000000003',
					entry_id: E1,
					pool_id: P1,
					item_id: 'item:cot',
					qty: '3'
				},
				mockEmit
			);
			expect(emitted).toEqual([{ key: [P1, 'item:cot', E1], value: [-3, -1] }]);
		});

		it('nets an entry and its void to zero under the same key', () => {
			mapFn(
				{ type: 'bulk_return_entry', _id: E1, pool_id: P1, item_id: 'item:cot', qty: '3' },
				mockEmit
			);
			mapFn(
				{
					type: 'bulk_return_entry_void',
					_id: 'bulk_return_entry_void:01J00000000000000000000003',
					entry_id: E1,
					pool_id: P1,
					item_id: 'item:cot',
					qty: '3'
				},
				mockEmit
			);
			const total = emitted.reduce(
				(sum, row) => {
					const [qty, count] = row.value as [number, number];
					return [sum[0] + qty, sum[1] + count];
				},
				[0, 0]
			);
			expect(emitted.map((row) => row.key)).toEqual([
				[P1, 'item:cot', E1],
				[P1, 'item:cot', E1]
			]);
			expect(total).toEqual([0, 0]);
		});
	});

	describe('station_logs_by_station (CR-192)', () => {
		const mapFn = createMapFn(SHELTER_DASHBOARD_VIEWS.views.station_logs_by_station.map);
		const log = (over: Record<string, unknown> = {}) => ({
			type: 'station_log',
			evacuee_id: 'evacuee:01J',
			station: 1,
			action: 'start',
			channel: 'kiosk',
			occurred_at: '2026-10-25T03:00:00.000Z',
			...over
		});

		it('ignores other doc types', () => {
			mapFn({ type: 'movement', occurred_at: '2026-10-25T03:00:00.000Z' }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('ignores a log without a valid occurred_at', () => {
			mapFn(log({ occurred_at: undefined }), mockEmit);
			mapFn(log({ occurred_at: 'not-a-date' }), mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('emits [date, station, channel, evacuee_id] with action, occurred_at and actor', () => {
			mapFn(log({ device_id: 'KIOSK-01', created_by: 'kiosk:KIOSK-01' }), mockEmit);
			expect(emitted).toEqual([
				{
					key: ['2026-10-25', 1, 'kiosk', 'evacuee:01J'],
					value: { action: 'start', occurred_at: '2026-10-25T03:00:00.000Z', actor: 'KIOSK-01' }
				}
			]);
		});

		it('uses created_by as the actor of a staff event (Amendment 2)', () => {
			mapFn(log({ channel: 'staff', created_by: 'staff01' }), mockEmit);
			expect((emitted[0].value as { actor: unknown }).actor).toBe('staff01');
		});

		it('emits a null actor when the writer is unknown', () => {
			mapFn(log({ channel: 'staff' }), mockEmit);
			expect((emitted[0].value as { actor: unknown }).actor).toBeNull();
		});

		it('buckets by the Asia/Bangkok day of occurred_at', () => {
			mapFn(log({ occurred_at: '2026-10-24T20:00:00.000Z' }), mockEmit);
			expect((emitted[0].key as unknown[])[0]).toBe('2026-10-25');
		});

		it('has no reduce (pairing happens in the BFF)', () => {
			expect('reduce' in SHELTER_DASHBOARD_VIEWS.views.station_logs_by_station).toBe(false);
		});
	});

	// #821 — received-donation search views (view manifest v7).
	describe('donation_received_by_name', () => {
		const mapFn = createMapFn(SHELTER_DASHBOARD_VIEWS.views.donation_received_by_name.map);
		const donation = (name: unknown, over: Record<string, unknown> = {}) => ({
			type: 'donation',
			status: 'received',
			received_at: '2026-10-20T03:00:00.000Z',
			donor: { name },
			...over
		});
		const keys = () => emitted.map((e) => e.key);

		it('emits the whole name and each word, keyed with received_at, value null', () => {
			mapFn(donation('สมชาย ใจดี'), mockEmit);
			expect(emitted).toEqual([
				{ key: ['สมชาย ใจดี', '2026-10-20T03:00:00.000Z'], value: null },
				{ key: ['สมชาย', '2026-10-20T03:00:00.000Z'], value: null },
				{ key: ['ใจดี', '2026-10-20T03:00:00.000Z'], value: null }
			]);
		});

		it('emits a one-word name exactly once', () => {
			mapFn(donation('สมชาย'), mockEmit);
			expect(keys()).toEqual([['สมชาย', '2026-10-20T03:00:00.000Z']]);
		});

		it('emits a repeated word once', () => {
			mapFn(donation('ดี ดี'), mockEmit);
			expect(keys()).toEqual([
				['ดี ดี', '2026-10-20T03:00:00.000Z'],
				['ดี', '2026-10-20T03:00:00.000Z']
			]);
		});

		it('normalizes NFKC, case and runs of spaces before emitting', () => {
			// Fullwidth latin + a no-break space + double space: NFKC folds them.
			mapFn(donation('  ＪＯＨＮ\u00a0  Smith '), mockEmit);
			expect(keys()).toEqual([
				['john smith', '2026-10-20T03:00:00.000Z'],
				['john', '2026-10-20T03:00:00.000Z'],
				['smith', '2026-10-20T03:00:00.000Z']
			]);
		});

		it('ignores donations that are not received, or have no donor name', () => {
			mapFn(donation('สมชาย', { status: 'declared' }), mockEmit);
			mapFn({ type: 'evacuee', status: 'received', donor: { name: 'สมชาย' } }, mockEmit);
			mapFn(donation(undefined), mockEmit);
			mapFn(donation('   '), mockEmit);
			mapFn({ type: 'donation', status: 'received' }, mockEmit);
			expect(emitted).toEqual([]);
		});

		it('does not trip on a word that looks like an Object property', () => {
			mapFn(donation('__proto__ constructor'), mockEmit);
			expect(keys()).toHaveLength(3);
		});
	});

	describe('donation_received_by_item', () => {
		const mapFn = createMapFn(SHELTER_DASHBOARD_VIEWS.views.donation_received_by_item.map);
		const donation = (items: unknown, over: Record<string, unknown> = {}) => ({
			type: 'donation',
			status: 'received',
			received_at: '2026-10-20T03:00:00.000Z',
			items,
			...over
		});

		it('emits [item_id, received_at] once per distinct item of the donation', () => {
			mapFn(
				donation([
					{ item_id: 'item_master:rice', qty: '1', unit: 'kg' },
					{ item_id: 'item_master:rice', qty: '2', unit: 'kg' },
					{ item_id: 'item_master:water', qty: '1', unit: 'ลัง' }
				]),
				mockEmit
			);
			expect(emitted).toEqual([
				{ key: ['item_master:rice', '2026-10-20T03:00:00.000Z'], value: null },
				{ key: ['item_master:water', '2026-10-20T03:00:00.000Z'], value: null }
			]);
		});

		it('skips free_text lines and donations that are not received', () => {
			mapFn(donation([{ free_text: 'น้ำดื่ม', qty: '1', unit: 'ลัง' }]), mockEmit);
			mapFn(donation([{ item_id: 'item_master:rice' }], { status: 'declared' }), mockEmit);
			mapFn(donation([]), mockEmit);
			mapFn(donation(undefined), mockEmit);
			expect(emitted).toEqual([]);
		});
	});

	it('ships the received-donation search views in view manifest v7 (#821)', () => {
		expect(SHELTER_VIEW_MANIFEST.version).toBe(7);
		expect(Object.keys(SHELTER_VIEW_MANIFEST.views)).toEqual(
			expect.arrayContaining(['donation_received_by_name', 'donation_received_by_item'])
		);
	});
});
