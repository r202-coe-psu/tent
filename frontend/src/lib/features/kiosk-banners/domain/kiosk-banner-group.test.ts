import { describe, expect, it } from 'vitest';
import {
	KIOSK_BANNER_GROUP_LIMITS,
	createKioskBannerGroup,
	isDuplicateGroupName,
	kioskBannerGroupDocSchema,
	kioskBannerGroupInputSchema
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

describe('createKioskBannerGroup', () => {
	const ctx = { shelterCode: 'SH-007', createdBy: 'user:bob' };
	const now = new Date('2026-10-21T08:30:00.000Z');
	const input = kioskBannerGroupInputSchema.parse({ name: 'ตู้หน้าประตู', description: 'ทางเข้า' });

	it('stamps the envelope and mints a kiosk_banner_group id', () => {
		const doc = createKioskBannerGroup(input, ctx, now);
		expect(doc).toMatchObject({
			type: 'kiosk_banner_group',
			schema_v: 1,
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
			{ schema_v: 2 },
			{ shelter_code: '' },
			{ created_by: '' }
		]) {
			expect(kioskBannerGroupDocSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
		}
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
