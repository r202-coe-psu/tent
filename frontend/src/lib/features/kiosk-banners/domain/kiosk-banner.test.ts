import { describe, expect, it } from 'vitest';
import {
	createKioskBanner,
	groupOf,
	isActiveAt,
	kioskBannerDocSchema,
	kioskBannerInputSchema,
	matchesScreen,
	matchesSlot,
	nextBannerOrder,
	orderableBanners,
	planReorder,
	sortBanners,
	splitByView
} from './kiosk-banner';

const GROUP = 'kiosk_banner_group:A';

const validInput = {
	group_id: GROUP,
	title: 'ยินดีต้อนรับ',
	caption: 'ศูนย์พักพิงชั่วคราว',
	duration_sec: 10,
	start_at: '2026-10-15T00:00:00.000Z',
	end_at: '2026-10-16T00:00:00.000Z',
	status: 'active'
};

describe('kioskBannerInputSchema', () => {
	it('accepts a valid input', () => {
		const result = kioskBannerInputSchema.safeParse(validInput);
		expect(result.success).toBe(true);
	});

	it('requires a banner group, reporting a Thai message on group_id', () => {
		const withoutGroup: Partial<typeof validInput> = { ...validInput };
		delete withoutGroup.group_id;
		for (const value of [withoutGroup, { ...validInput, group_id: '' }]) {
			const result = kioskBannerInputSchema.safeParse(value);
			expect(result.error?.issues).toEqual([
				expect.objectContaining({ path: ['group_id'], message: 'เลือกกลุ่มแบนเนอร์' })
			]);
		}
	});

	it('enforces title length 1-120 after trimming', () => {
		const parse = (title: string) => kioskBannerInputSchema.safeParse({ ...validInput, title });
		expect(parse('a'.repeat(120)).success).toBe(true);
		expect(parse('a'.repeat(121)).success).toBe(false);
		expect(parse('   ').success).toBe(false);
		expect(parse('  hi  ')).toMatchObject({ success: true, data: { title: 'hi' } });
	});

	it('allows caption up to 200 chars, null or absent', () => {
		const parse = (caption: unknown) =>
			kioskBannerInputSchema.safeParse({ ...validInput, caption });
		expect(parse('a'.repeat(200)).success).toBe(true);
		expect(parse('a'.repeat(201)).success).toBe(false);
		expect(parse(null).success).toBe(true);
		const withoutCaption: Partial<typeof validInput> = { ...validInput };
		delete withoutCaption.caption;
		expect(kioskBannerInputSchema.safeParse(withoutCaption).success).toBe(true);
	});

	it('enforces duration_sec 3-60 as an integer', () => {
		const parse = (patch: object) => kioskBannerInputSchema.safeParse({ ...validInput, ...patch });
		expect(parse({ duration_sec: 3 }).success).toBe(true);
		expect(parse({ duration_sec: 60 }).success).toBe(true);
		expect(parse({ duration_sec: 2 }).success).toBe(false);
		expect(parse({ duration_sec: 61 }).success).toBe(false);
		expect(parse({ duration_sec: 10.5 }).success).toBe(false);
	});

	it('strips an order sent by the client (the server assigns it)', () => {
		const parsed = kioskBannerInputSchema.parse({ ...validInput, order: 9 });
		expect(parsed).not.toHaveProperty('order');
	});

	it('applies defaults for duration_sec and status', () => {
		const result = kioskBannerInputSchema.safeParse({
			group_id: GROUP,
			title: 't',
			start_at: validInput.start_at,
			end_at: validInput.end_at
		});
		expect(result).toMatchObject({
			success: true,
			data: { duration_sec: 10, status: 'active' }
		});
	});

	it('defaults screen_type to compact and accepts portrait', () => {
		expect(kioskBannerInputSchema.parse(validInput).screen_type).toBe('compact');
		expect(
			kioskBannerInputSchema.parse({ ...validInput, screen_type: 'portrait' }).screen_type
		).toBe('portrait');
	});

	it('rejects an unknown screen_type', () => {
		const result = kioskBannerInputSchema.safeParse({ ...validInput, screen_type: 'landscape' });
		expect(result.success).toBe(false);
	});

	it('rejects unknown status', () => {
		const result = kioskBannerInputSchema.safeParse({ ...validInput, status: 'paused' });
		expect(result.success).toBe(false);
	});

	it('requires end_at strictly after start_at, reported on end_at', () => {
		const parse = (end_at: string) => kioskBannerInputSchema.safeParse({ ...validInput, end_at });
		expect(parse('2026-10-15T00:00:00.001Z').success).toBe(true);
		for (const end_at of [validInput.start_at, '2026-10-14T23:59:59.000Z']) {
			const result = parse(end_at);
			expect(result.success).toBe(false);
			expect(result.error?.issues).toEqual([
				expect.objectContaining({ path: ['end_at'], message: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม' })
			]);
		}
	});

	it('rejects non-ISO datetimes', () => {
		const result = kioskBannerInputSchema.safeParse({ ...validInput, start_at: 'tomorrow' });
		expect(result.success).toBe(false);
	});
});

const legacyInput: Partial<typeof validInput> = { ...validInput };
delete legacyInput.group_id;

/** A banner stored before groups existed (schema_v 1, no group_id). */
const validDoc = {
	...legacyInput,
	order: 1,
	_id: 'kiosk_banner:01J9ZZZZZZZZZZZZZZZZZZZZZZ',
	_rev: '1-abc',
	type: 'kiosk_banner',
	schema_v: 1,
	shelter_code: 'SH-001',
	created_at: '2026-10-14T00:00:00.000Z',
	updated_at: '2026-10-14T00:00:00.000Z',
	created_by: 'user:alice'
};

describe('kioskBannerDocSchema', () => {
	it('accepts a valid doc, with or without _rev', () => {
		expect(kioskBannerDocSchema.safeParse(validDoc).success).toBe(true);
		const noRev: Partial<typeof validDoc> = { ...validDoc };
		delete noRev._rev;
		expect(kioskBannerDocSchema.safeParse(noRev).success).toBe(true);
	});

	it('rejects empty shelter_code, wrong _id prefix, wrong type and schema_v', () => {
		for (const patch of [
			{ shelter_code: '' },
			{ _id: 'announcement:01J9' },
			{ type: 'announcement' },
			{ schema_v: 3 },
			{ created_by: '' }
		]) {
			expect(kioskBannerDocSchema.safeParse({ ...validDoc, ...patch }).success).toBe(false);
		}
	});

	it('accepts a v1 doc without group_id and a v2 doc with one', () => {
		const v1 = kioskBannerDocSchema.safeParse(validDoc);
		expect(v1.success && v1.data.group_id).toBeUndefined();
		const v2 = kioskBannerDocSchema.safeParse({ ...validDoc, schema_v: 2, group_id: GROUP });
		expect(v2.success && v2.data.group_id).toBe(GROUP);
	});

	it('rejects a v2 doc without group_id or with a malformed one', () => {
		expect(kioskBannerDocSchema.safeParse({ ...validDoc, schema_v: 2 }).success).toBe(false);
		expect(
			kioskBannerDocSchema.safeParse({ ...validDoc, schema_v: 2, group_id: 'nope:1' }).success
		).toBe(false);
	});

	it('accepts a legacy doc without screen_type and a portrait doc', () => {
		const parsed = kioskBannerDocSchema.safeParse(validDoc);
		expect(parsed.success && parsed.data.screen_type).toBeUndefined();
		expect(kioskBannerDocSchema.safeParse({ ...validDoc, screen_type: 'portrait' }).success).toBe(
			true
		);
		expect(kioskBannerDocSchema.safeParse({ ...validDoc, screen_type: 'tv' }).success).toBe(false);
	});

	it('still enforces end_at > start_at on v1 and v2', () => {
		const sameTime = { end_at: validDoc.start_at };
		expect(kioskBannerDocSchema.safeParse({ ...validDoc, ...sameTime }).success).toBe(false);
		expect(
			kioskBannerDocSchema.safeParse({ ...validDoc, schema_v: 2, group_id: GROUP, ...sameTime })
				.success
		).toBe(false);
	});
});

describe('createKioskBanner', () => {
	const ctx = { shelterCode: 'SH-007', createdBy: 'user:bob', order: 3 };
	const now = new Date('2026-10-15T08:30:00.000Z');

	it('stamps envelope fields from ctx and now', () => {
		const input = kioskBannerInputSchema.parse(validInput);
		const doc = createKioskBanner(input, ctx, now);
		expect(doc).toMatchObject({
			type: 'kiosk_banner',
			schema_v: 2,
			group_id: GROUP,
			shelter_code: 'SH-007',
			created_by: 'user:bob',
			created_at: '2026-10-15T08:30:00.000Z',
			updated_at: '2026-10-15T08:30:00.000Z',
			order: 3,
			title: 'ยินดีต้อนรับ',
			caption: 'ศูนย์พักพิงชั่วคราว',
			start_at: validInput.start_at,
			end_at: validInput.end_at
		});
		expect(doc._id).toMatch(/^kiosk_banner:[0-9A-Za-z]+$/);
		expect(doc._rev).toBeUndefined();
		expect(kioskBannerDocSchema.safeParse(doc).success).toBe(true);
	});

	it('stores the input screen_type on the doc', () => {
		const input = kioskBannerInputSchema.parse({ ...validInput, screen_type: 'portrait' });
		const doc = createKioskBanner(input, ctx, now);
		expect(doc.screen_type).toBe('portrait');
		expect(kioskBannerDocSchema.safeParse(doc).success).toBe(true);
		expect(createKioskBanner(kioskBannerInputSchema.parse(validInput), ctx, now).screen_type).toBe(
			'compact'
		);
	});

	it('mints a distinct _id per call and applies input defaults', () => {
		const input = kioskBannerInputSchema.parse({
			group_id: GROUP,
			title: 't',
			start_at: validInput.start_at,
			end_at: validInput.end_at
		});
		const a = createKioskBanner(input, ctx, now);
		const b = createKioskBanner(input, ctx, now);
		expect(a._id).not.toBe(b._id);
		expect(a).toMatchObject({ order: 3, duration_sec: 10, status: 'active' });
	});
});

describe('matchesScreen', () => {
	it('matches the stored screen type, treating a missing one as compact', () => {
		expect(matchesScreen({ screen_type: 'portrait' }, 'portrait')).toBe(true);
		expect(matchesScreen({ screen_type: 'portrait' }, 'compact')).toBe(false);
		expect(matchesScreen({ screen_type: 'compact' }, 'compact')).toBe(true);
		expect(matchesScreen({}, 'compact')).toBe(true);
		expect(matchesScreen({}, 'portrait')).toBe(false);
	});
});

describe('matchesSlot', () => {
	const group = 'kiosk_banner_group:A';

	it('matches only the same group and screen type; an ungrouped banner never matches', () => {
		const slot = { group_id: group, screen_type: 'portrait' } as const;
		expect(matchesSlot({ group_id: group, screen_type: 'portrait' }, slot)).toBe(true);
		expect(matchesSlot({ group_id: group, screen_type: 'compact' }, slot)).toBe(false);
		expect(matchesSlot({ group_id: 'kiosk_banner_group:B', screen_type: 'portrait' }, slot)).toBe(
			false
		);
		expect(matchesSlot({ screen_type: 'portrait' }, slot)).toBe(false);
		expect(matchesSlot({ group_id: group }, { group_id: group, screen_type: 'compact' })).toBe(
			true
		);
	});

	it('accepts a banner doc with group_id and still parses one without', () => {
		const doc = {
			_id: 'kiosk_banner:b1',
			type: 'kiosk_banner',
			schema_v: 2,
			shelter_code: 'SH1',
			...legacyInput,
			order: 1,
			created_at: validInput.start_at,
			updated_at: validInput.start_at,
			created_by: 'alice'
		};
		expect(kioskBannerDocSchema.parse({ ...doc, group_id: group }).group_id).toBe(group);
		expect(kioskBannerDocSchema.parse({ ...doc, schema_v: 1 }).group_id).toBeUndefined();
		expect(kioskBannerDocSchema.safeParse({ ...doc, group_id: 'nope:1' }).success).toBe(false);
	});
});

describe('groupOf', () => {
	it('is the banner group id, or null for an ungrouped banner', () => {
		expect(groupOf({ group_id: GROUP })).toBe(GROUP);
		expect(groupOf({})).toBeNull();
		expect(groupOf({ group_id: null })).toBeNull();
	});
});

describe('isActiveAt', () => {
	const banner = {
		status: 'active' as const,
		start_at: validInput.start_at,
		end_at: validInput.end_at
	};

	it('is half-open: active at start_at, inactive at end_at', () => {
		expect(isActiveAt(banner, new Date('2026-10-14T23:59:59.999Z'))).toBe(false);
		expect(isActiveAt(banner, new Date(validInput.start_at))).toBe(true);
		expect(isActiveAt(banner, new Date('2026-10-15T12:00:00.000Z'))).toBe(true);
		expect(isActiveAt(banner, new Date('2026-10-15T23:59:59.999Z'))).toBe(true);
		expect(isActiveAt(banner, new Date(validInput.end_at))).toBe(false);
	});

	it('is false when status is inactive even inside the window', () => {
		const inactive = { ...banner, status: 'inactive' as const };
		expect(isActiveAt(inactive, new Date('2026-10-15T12:00:00.000Z'))).toBe(false);
	});
});

describe('sortBanners', () => {
	const b = (_id: string, order: number, start_at: string) => ({ _id, order, start_at });

	it('sorts by order, then start_at, then _id, without mutating the input', () => {
		const input = [
			b('kiosk_banner:C', 2, '2026-10-01T00:00:00.000Z'),
			b('kiosk_banner:B', 1, '2026-10-02T00:00:00.000Z'),
			b('kiosk_banner:E', 1, '2026-10-01T00:00:00.000Z'),
			b('kiosk_banner:A', 1, '2026-10-01T00:00:00.000Z'),
			b('kiosk_banner:D', 3, '2026-09-01T00:00:00.000Z')
		];
		const snapshot = input.map((x) => x._id);
		const sorted = sortBanners(input);
		expect(sorted.map((x) => x._id)).toEqual([
			'kiosk_banner:A',
			'kiosk_banner:E',
			'kiosk_banner:B',
			'kiosk_banner:C',
			'kiosk_banner:D'
		]);
		expect(sorted).not.toBe(input);
		expect(input.map((x) => x._id)).toEqual(snapshot);
	});
});

describe('splitByView', () => {
	const b = (_id: string, start_at: string, end_at: string) => ({ _id, start_at, end_at });
	const now = new Date('2026-10-15T00:00:00.000Z');

	it('puts end_at >= now in current (start_at asc) and the rest in expired (end_at desc)', () => {
		const { current, expired } = splitByView(
			[
				b('late', '2026-10-20T00:00:00.000Z', '2026-10-25T00:00:00.000Z'),
				b('old1', '2026-09-01T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
				b('ending-now', '2026-10-01T00:00:00.000Z', '2026-10-15T00:00:00.000Z'),
				b('old2', '2026-09-05T00:00:00.000Z', '2026-10-14T23:59:59.999Z'),
				b('running', '2026-10-10T00:00:00.000Z', '2026-11-01T00:00:00.000Z')
			],
			now
		);
		expect(current.map((x) => x._id)).toEqual(['ending-now', 'running', 'late']);
		expect(expired.map((x) => x._id)).toEqual(['old2', 'old1']);
	});

	it('returns empty lists for empty input', () => {
		expect(splitByView([], now)).toEqual({ current: [], expired: [] });
	});
});

describe('next banner order', () => {
	const now = new Date('2026-10-16T00:00:00.000Z');
	const OTHER = 'kiosk_banner_group:B';
	const banner = (
		id: string,
		order: number,
		extra: { group_id?: string; screen_type?: 'compact' | 'portrait'; end_at?: string } = {}
	) => ({
		_id: `kiosk_banner:${id}`,
		order,
		end_at: extra.end_at ?? '2026-10-20T00:00:00.000Z',
		group_id: 'group_id' in extra ? extra.group_id : GROUP,
		screen_type: extra.screen_type
	});

	describe('nextBannerOrder', () => {
		it('is max order + 1 among current banners of that group and screen type', () => {
			const list = [
				banner('a', 2),
				banner('b', 5, { screen_type: 'compact' }),
				banner('c', 9, { screen_type: 'portrait' }),
				banner('d', 7, { end_at: '2026-10-01T00:00:00.000Z' })
			];
			expect(nextBannerOrder(list, { group_id: GROUP, screen_type: 'compact' }, now)).toBe(6);
			expect(nextBannerOrder(list, { group_id: GROUP, screen_type: 'portrait' }, now)).toBe(10);
		});

		it('does not count banners of another group or ungrouped ones', () => {
			const list = [
				banner('a', 2),
				banner('other', 8, { group_id: OTHER }),
				banner('legacy', 9, { group_id: undefined })
			];
			expect(nextBannerOrder(list, { group_id: GROUP, screen_type: 'compact' }, now)).toBe(3);
			expect(nextBannerOrder(list, { group_id: OTHER, screen_type: 'compact' }, now)).toBe(9);
		});

		it('is the default order (1) when the slot is empty', () => {
			const slot = { group_id: GROUP, screen_type: 'compact' } as const;
			expect(nextBannerOrder([], slot, now)).toBe(1);
			expect(nextBannerOrder([banner('a', 4, { screen_type: 'portrait' })], slot, now)).toBe(1);
			expect(nextBannerOrder([banner('a', 4, { group_id: OTHER })], slot, now)).toBe(1);
		});
	});
});

describe('orderableBanners', () => {
	const now = new Date('2026-10-16T00:00:00.000Z');
	const GROUP_A = 'kiosk_banner_group:A';
	const GROUP_B = 'kiosk_banner_group:B';
	const banner = (
		id: string,
		order: number,
		extra: {
			group_id?: string;
			screen_type?: 'compact' | 'portrait';
			start_at?: string;
			end_at?: string;
			status?: string;
		} = {}
	) => ({
		_id: `kiosk_banner:${id}`,
		order,
		start_at: extra.start_at ?? '2026-10-15T00:00:00.000Z',
		end_at: extra.end_at ?? '2026-10-20T00:00:00.000Z',
		screen_type: extra.screen_type,
		group_id: 'group_id' in extra ? extra.group_id : GROUP_A,
		status: extra.status
	});
	const slotA = { group_id: GROUP_A, screen_type: 'compact' as const };

	it('keeps current banners of the slot, sorted, and drops expired ones', () => {
		const list = [
			banner('c', 3, { screen_type: 'compact' }),
			banner('a', 1),
			banner('old', 2, { end_at: '2026-10-15T23:59:59.000Z' }),
			banner('b', 2, { screen_type: 'compact' })
		];
		expect(orderableBanners(list, slotA, now).map((b) => b._id)).toEqual([
			'kiosk_banner:a',
			'kiosk_banner:b',
			'kiosk_banner:c'
		]);
	});

	it('drops banners of another group, another screen type and ungrouped banners', () => {
		const list = [
			banner('mine', 1),
			banner('other-group', 1, { group_id: GROUP_B }),
			banner('other-screen', 1, { screen_type: 'portrait' }),
			banner('ungrouped', 1, { group_id: undefined })
		];
		expect(orderableBanners(list, slotA, now).map((b) => b._id)).toEqual(['kiosk_banner:mine']);
		expect(
			orderableBanners(list, { group_id: GROUP_A, screen_type: 'portrait' }, now).map((b) => b._id)
		).toEqual(['kiosk_banner:other-screen']);
	});

	it('includes inactive and not-yet-started banners', () => {
		const list = [
			banner('a', 1, { status: 'inactive' }),
			banner('b', 2, { start_at: '2026-10-18T00:00:00.000Z' })
		];
		expect(orderableBanners(list, slotA, now).map((b) => b._id)).toEqual([
			'kiosk_banner:a',
			'kiosk_banner:b'
		]);
	});
});

describe('planReorder', () => {
	const rows = (...orders: number[]) =>
		orders.map((order, i) => ({ _id: `kiosk_banner:${'abc'[i]}`, order }));

	it('plans no changes when the order is unchanged', () => {
		expect(
			planReorder(rows(1, 2, 3), ['kiosk_banner:a', 'kiosk_banner:b', 'kiosk_banner:c'])
		).toEqual({ ok: true, changes: [] });
	});

	it('renumbers every banner when the last one moves to the front', () => {
		expect(
			planReorder(rows(1, 2, 3), ['kiosk_banner:c', 'kiosk_banner:a', 'kiosk_banner:b'])
		).toEqual({
			ok: true,
			changes: [
				{ id: 'kiosk_banner:c', order: 1 },
				{ id: 'kiosk_banner:a', order: 2 },
				{ id: 'kiosk_banner:b', order: 3 }
			]
		});
	});

	it('closes gaps and duplicates, changing only banners whose order differs', () => {
		expect(
			planReorder(rows(2, 2, 5), ['kiosk_banner:a', 'kiosk_banner:b', 'kiosk_banner:c'])
		).toEqual({
			ok: true,
			changes: [
				{ id: 'kiosk_banner:a', order: 1 },
				{ id: 'kiosk_banner:c', order: 3 }
			]
		});
		expect(
			planReorder(rows(1, 2, 5), ['kiosk_banner:a', 'kiosk_banner:b', 'kiosk_banner:c'])
		).toEqual({ ok: true, changes: [{ id: 'kiosk_banner:c', order: 3 }] });
	});

	it('rejects a repeated id', () => {
		expect(planReorder(rows(1, 2), ['kiosk_banner:a', 'kiosk_banner:a'])).toEqual({
			ok: false,
			reason: 'duplicate'
		});
	});

	it('rejects ids that are missing or extra', () => {
		const mismatch = { ok: false, reason: 'mismatch' };
		expect(planReorder(rows(1, 2), ['kiosk_banner:a'])).toEqual(mismatch);
		expect(planReorder(rows(1, 2), ['kiosk_banner:a', 'kiosk_banner:b', 'kiosk_banner:z'])).toEqual(
			mismatch
		);
		expect(planReorder(rows(1, 2), ['kiosk_banner:a', 'kiosk_banner:z'])).toEqual(mismatch);
	});

	it('plans nothing for an empty list', () => {
		expect(planReorder([], [])).toEqual({ ok: true, changes: [] });
	});
});
