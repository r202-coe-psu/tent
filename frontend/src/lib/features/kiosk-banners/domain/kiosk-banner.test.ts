import { describe, expect, it } from 'vitest';
import {
	createKioskBanner,
	findOrderConflicts,
	isActiveAt,
	kioskBannerDocSchema,
	kioskBannerInputSchema,
	matchesScreen,
	nextBannerOrder,
	sortBanners,
	splitByView
} from './kiosk-banner';

const validInput = {
	title: 'ยินดีต้อนรับ',
	caption: 'ศูนย์พักพิงชั่วคราว',
	order: 1,
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

	it('enforces duration_sec 3-60 and order >= 1, as integers', () => {
		const parse = (patch: object) => kioskBannerInputSchema.safeParse({ ...validInput, ...patch });
		expect(parse({ duration_sec: 3 }).success).toBe(true);
		expect(parse({ duration_sec: 60 }).success).toBe(true);
		expect(parse({ duration_sec: 2 }).success).toBe(false);
		expect(parse({ duration_sec: 61 }).success).toBe(false);
		expect(parse({ duration_sec: 10.5 }).success).toBe(false);
		expect(parse({ order: 1 }).success).toBe(true);
		expect(parse({ order: 0 }).success).toBe(false);
		expect(parse({ order: 1.5 }).success).toBe(false);
	});

	it('applies defaults for order, duration_sec and status', () => {
		const result = kioskBannerInputSchema.safeParse({
			title: 't',
			start_at: validInput.start_at,
			end_at: validInput.end_at
		});
		expect(result).toMatchObject({
			success: true,
			data: { order: 1, duration_sec: 10, status: 'active' }
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

const validDoc = {
	...validInput,
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
			{ schema_v: 2 },
			{ created_by: '' }
		]) {
			expect(kioskBannerDocSchema.safeParse({ ...validDoc, ...patch }).success).toBe(false);
		}
	});

	it('accepts a legacy doc without screen_type and a portrait doc', () => {
		const parsed = kioskBannerDocSchema.safeParse(validDoc);
		expect(parsed.success && parsed.data.screen_type).toBeUndefined();
		expect(kioskBannerDocSchema.safeParse({ ...validDoc, screen_type: 'portrait' }).success).toBe(
			true
		);
		expect(kioskBannerDocSchema.safeParse({ ...validDoc, screen_type: 'tv' }).success).toBe(false);
	});

	it('still enforces end_at > start_at', () => {
		const result = kioskBannerDocSchema.safeParse({ ...validDoc, end_at: validDoc.start_at });
		expect(result.success).toBe(false);
	});
});

describe('createKioskBanner', () => {
	const ctx = { shelterCode: 'SH-007', createdBy: 'user:bob' };
	const now = new Date('2026-10-15T08:30:00.000Z');

	it('stamps envelope fields from ctx and now', () => {
		const input = kioskBannerInputSchema.parse(validInput);
		const doc = createKioskBanner(input, ctx, now);
		expect(doc).toMatchObject({
			type: 'kiosk_banner',
			schema_v: 1,
			shelter_code: 'SH-007',
			created_by: 'user:bob',
			created_at: '2026-10-15T08:30:00.000Z',
			updated_at: '2026-10-15T08:30:00.000Z',
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
			title: 't',
			start_at: validInput.start_at,
			end_at: validInput.end_at
		});
		const a = createKioskBanner(input, ctx, now);
		const b = createKioskBanner(input, ctx, now);
		expect(a._id).not.toBe(b._id);
		expect(a).toMatchObject({ order: 1, duration_sec: 10, status: 'active' });
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

describe('order conflicts (FR-KBR-45)', () => {
	const now = new Date('2026-10-16T00:00:00.000Z');
	const banner = (
		id: string,
		order: number,
		extra: { screen_type?: 'compact' | 'portrait'; end_at?: string } = {}
	) => ({
		_id: `kiosk_banner:${id}`,
		order,
		end_at: extra.end_at ?? '2026-10-20T00:00:00.000Z',
		screen_type: extra.screen_type
	});

	describe('findOrderConflicts', () => {
		it('returns banners with the same order and screen type', () => {
			const a = banner('a', 2, { screen_type: 'compact' });
			const list = [a, banner('b', 3, { screen_type: 'compact' })];
			expect(findOrderConflicts(list, { order: 2, screen_type: 'compact', now })).toEqual([a]);
		});

		it('ignores another screen type', () => {
			const list = [banner('a', 2, { screen_type: 'portrait' })];
			expect(findOrderConflicts(list, { order: 2, screen_type: 'compact', now })).toEqual([]);
		});

		it('counts a legacy banner (no screen type) as compact', () => {
			const legacy = banner('a', 2);
			expect(findOrderConflicts([legacy], { order: 2, screen_type: 'compact', now })).toEqual([
				legacy
			]);
			expect(findOrderConflicts([legacy], { order: 2, screen_type: 'portrait', now })).toEqual([]);
		});

		it('ignores expired banners but keeps one ending exactly now', () => {
			const expired = banner('a', 2, { end_at: '2026-10-15T23:59:59.000Z' });
			const endsNow = banner('b', 2, { end_at: now.toISOString() });
			expect(
				findOrderConflicts([expired, endsNow], { order: 2, screen_type: 'compact', now })
			).toEqual([endsNow]);
		});

		it('excludes the banner being edited', () => {
			const a = banner('a', 2);
			const b = banner('b', 2);
			expect(
				findOrderConflicts([a, b], {
					order: 2,
					screen_type: 'compact',
					excludeId: 'kiosk_banner:a',
					now
				})
			).toEqual([b]);
		});
	});

	describe('nextBannerOrder', () => {
		it('is max order + 1 among current banners of that screen type', () => {
			const list = [
				banner('a', 2),
				banner('b', 5, { screen_type: 'compact' }),
				banner('c', 9, { screen_type: 'portrait' }),
				banner('d', 7, { end_at: '2026-10-01T00:00:00.000Z' })
			];
			expect(nextBannerOrder(list, 'compact', now)).toBe(6);
			expect(nextBannerOrder(list, 'portrait', now)).toBe(10);
		});

		it('is the default order (1) when there is none', () => {
			expect(nextBannerOrder([], 'compact', now)).toBe(1);
			expect(nextBannerOrder([banner('a', 4, { screen_type: 'portrait' })], 'compact', now)).toBe(
				1
			);
		});
	});
});
