import { describe, expect, it } from 'vitest';
import {
	KIOSK_BANNER_GROUP_LIMITS,
	createKioskBannerGroup,
	generateTvCode,
	internalBannerUrl,
	isDuplicateGroupName,
	kioskBannerGroupDocSchema,
	kioskBannerGroupInputSchema,
	needsTvCode,
	tvCodeSchema
} from './kiosk-banner-group';

describe('kioskBannerGroupInputSchema', () => {
	const parse = (value: unknown) => kioskBannerGroupInputSchema.safeParse(value);

	it('trims the name and enforces 1-60 characters with Thai messages', () => {
		expect(KIOSK_BANNER_GROUP_LIMITS).toEqual({ nameMax: 60, descriptionMax: 200 });
		expect(parse({ name: '  ตู้หน้าประตู  ' })).toMatchObject({
			success: true,
			data: { name: 'ตู้หน้าประตู' }
		});
		expect(parse({ name: 'a'.repeat(60) }).success).toBe(true);
		expect(parse({ name: 'a'.repeat(61) }).error?.issues[0].message).toBe(
			'ชื่อกลุ่มยาวเกิน 60 ตัวอักษร'
		);
		expect(parse({ name: '   ' }).error?.issues[0].message).toBe('ระบุชื่อกลุ่ม');
	});

	it('allows a description up to 200 characters, null or absent', () => {
		expect(parse({ name: 'A', description: 'a'.repeat(200) }).success).toBe(true);
		expect(parse({ name: 'A', description: null }).success).toBe(true);
		expect(parse({ name: 'A' }).success).toBe(true);
		expect(parse({ name: 'A', description: 'a'.repeat(201) }).error?.issues[0].message).toBe(
			'คำอธิบายยาวเกิน 200 ตัวอักษร'
		);
	});
});

describe('tvCodeSchema', () => {
	const ok = (value: unknown) => tvCodeSchema.safeParse(value).success;

	it('accepts exactly six ASCII digits, keeping leading zeros', () => {
		expect(ok('123456')).toBe(true);
		expect(ok('000123')).toBe(true);
		expect(ok('000000')).toBe(true);
		expect(ok('999999')).toBe(true);
	});

	it('rejects wrong length, non-digits, Thai digits and whitespace', () => {
		for (const bad of [
			'12345',
			'1234567',
			'12345a',
			'๑๒๓๔๕๖',
			' 12345',
			'12345 ',
			'123 456',
			'',
			123456
		]) {
			expect(ok(bad)).toBe(false);
		}
	});
});

describe('generateTvCode', () => {
	const fillWith =
		(...values: number[]) =>
		(arr: Uint32Array<ArrayBuffer>) => {
			arr[0] = values.shift()!;
			return arr;
		};

	it('zero-pads the random value to six digits', () => {
		expect(generateTvCode(fillWith(42))).toBe('000042');
		expect(generateTvCode(fillWith(0))).toBe('000000');
		expect(generateTvCode(fillWith(123_456))).toBe('123456');
	});

	it('maps the random value into 000000-999999 by modulo', () => {
		expect(generateTvCode(fillWith(1_000_007))).toBe('000007');
		expect(generateTvCode(fillWith(4_293_999_999))).toBe('999999');
	});

	it('redraws values from the biased tail above 4,294,000,000', () => {
		expect(generateTvCode(fillWith(4_294_000_000, 4_294_967_295, 5))).toBe('000005');
	});

	it('produces a valid tv code from the default crypto source', () => {
		expect(tvCodeSchema.safeParse(generateTvCode()).success).toBe(true);
	});
});

describe('createKioskBannerGroup', () => {
	const ctx = { shelterCode: 'SH-007', createdBy: 'user:bob', tvCode: '000123' };
	const now = new Date('2026-10-21T08:30:00.000Z');
	const input = kioskBannerGroupInputSchema.parse({ name: 'ตู้หน้าประตู', description: 'ทางเข้า' });

	it('stamps the envelope and mints a kiosk_banner_group id', () => {
		const doc = createKioskBannerGroup(input, ctx, now);
		expect(doc).toMatchObject({
			type: 'kiosk_banner_group',
			schema_v: 2,
			tv_code: '000123',
			shelter_code: 'SH-007',
			name: 'ตู้หน้าประตู',
			description: 'ทางเข้า',
			created_by: 'user:bob',
			created_at: '2026-10-21T08:30:00.000Z',
			updated_at: '2026-10-21T08:30:00.000Z'
		});
		expect(doc._id).toMatch(/^kiosk_banner_group:[0-9A-Za-z]+$/);
		expect(doc._rev).toBeUndefined();
		expect(createKioskBannerGroup(input, ctx, now)._id).not.toBe(doc._id);
		expect(kioskBannerGroupDocSchema.safeParse(doc).success).toBe(true);
	});
});

describe('kioskBannerGroupDocSchema', () => {
	const valid = {
		_id: 'kiosk_banner_group:01J9',
		_rev: '1-abc',
		type: 'kiosk_banner_group',
		schema_v: 1,
		shelter_code: 'SH-001',
		name: 'A',
		created_at: '2026-10-21T00:00:00.000Z',
		updated_at: '2026-10-21T00:00:00.000Z',
		created_by: 'user:alice'
	};

	it('rejects a wrong _id prefix, type, schema_v, empty shelter_code or created_by', () => {
		expect(kioskBannerGroupDocSchema.safeParse(valid).success).toBe(true);
		for (const patch of [
			{ _id: 'kiosk_banner:01J9' },
			{ type: 'kiosk_banner' },
			{ schema_v: 3 },
			{ shelter_code: '' },
			{ created_by: '' }
		]) {
			expect(kioskBannerGroupDocSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
		}
	});
});

describe('kioskBannerGroupDocSchema schema_v 2 (tv_code)', () => {
	const v1 = {
		_id: 'kiosk_banner_group:01J9',
		_rev: '1-abc',
		type: 'kiosk_banner_group',
		schema_v: 1,
		shelter_code: 'SH-001',
		name: 'A',
		created_at: '2026-10-21T00:00:00.000Z',
		updated_at: '2026-10-21T00:00:00.000Z',
		created_by: 'user:alice'
	};
	const v2 = { ...v1, schema_v: 2, tv_code: '000123' };
	const ok = (doc: unknown) => kioskBannerGroupDocSchema.safeParse(doc).success;

	it('accepts a v2 doc with a valid tv_code', () => {
		expect(ok(v2)).toBe(true);
	});

	it('rejects a v2 doc without tv_code or with an invalid one', () => {
		const withoutCode: Record<string, unknown> = { ...v2 };
		delete withoutCode.tv_code;
		expect(ok(withoutCode)).toBe(false);
		expect(ok({ ...v2, tv_code: '12345' })).toBe(false);
		expect(ok({ ...v2, tv_code: 'abcdef' })).toBe(false);
		expect(ok({ ...v2, tv_code: null })).toBe(false);
	});

	it('still accepts a v1 doc that has no tv_code', () => {
		expect(ok(v1)).toBe(true);
	});
});

describe('needsTvCode', () => {
	it('is true for a v1 group and false once it has a tv_code (v2)', () => {
		expect(needsTvCode({ schema_v: 1 })).toBe(true);
		expect(needsTvCode({ schema_v: 2 })).toBe(false);
	});
});

describe('isDuplicateGroupName', () => {
	const groups = [
		{ _id: 'kiosk_banner_group:a', name: 'ตู้หน้าประตู' },
		{ _id: 'kiosk_banner_group:b', name: 'Canteen' }
	];

	it('matches another group name after trim, ignoring case', () => {
		expect(isDuplicateGroupName(groups, '  canteen ')).toBe(true);
		expect(isDuplicateGroupName(groups, 'ตู้หน้าประตู')).toBe(true);
		expect(isDuplicateGroupName(groups, 'Lobby')).toBe(false);
	});

	it('lets a group keep its own name via exceptId', () => {
		expect(isDuplicateGroupName(groups, 'canteen', 'kiosk_banner_group:b')).toBe(false);
		expect(isDuplicateGroupName(groups, 'canteen', 'kiosk_banner_group:a')).toBe(true);
	});
});

describe('internalBannerUrl', () => {
	it('builds the TV link from the origin, the shelter and the tv code', () => {
		expect(internalBannerUrl('https://tent.example.go.th', 'SH001', '048213')).toBe(
			'https://tent.example.go.th/banner/SH001/internal?c=048213'
		);
	});

	it('URL-encodes the shelter code', () => {
		expect(internalBannerUrl('http://192.168.1.10:5173', 'SH 01/ก', '000123')).toBe(
			'http://192.168.1.10:5173/banner/SH%2001%2F%E0%B8%81/internal?c=000123'
		);
	});
});
