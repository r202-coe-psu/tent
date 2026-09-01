import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ScannerServerRepository, type SmartCardData } from './server';
import * as couchAdmin from '$lib/server/couch-admin';
import type { Evacuee } from '$lib/features/people';

vi.mock('$lib/server/couch-admin', () => ({
	adminFetch: vi.fn(),
	adminRaw: vi.fn()
}));

describe('ScannerServerRepository.processCardScan', () => {
	const repo = new ScannerServerRepository();

	const mockCard: SmartCardData = {
		citizen_id: '1234567890123',
		title_th: 'นาย',
		first_name_th: 'สมชาย',
		last_name_th: 'ใจดี',
		full_name_th: 'นาย สมชาย ใจดี',
		title_en: 'Mr.',
		first_name_en: 'Somchai',
		last_name_en: 'Jaidee',
		full_name_en: 'Mr. Somchai Jaidee',
		birth_date: '25350101',
		birth_year_ce: 1992,
		age: 34,
		gender: 'male',
		address_raw: '99/1#หมู่ 2#ซอยสุขใจ#ถนนสุขุมวิท#บางนา#บางนา#กรุงเทพมหานคร',
		address_no: '99/1',
		village_no: '2',
		lane: 'ซอยสุขใจ',
		road: 'ถนนสุขุมวิท',
		subdistrict: 'บางนา',
		district: 'บางนา',
		province: 'กรุงเทพมหานคร',
		postal_code: null,
		photo_base64: 'data:image/jpeg;base64,...',
		issuer: 'ที่ว่าการอำเภอ',
		issue_date: '25600101',
		expire_date: '25700101'
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Branch 1: creates pre_registered evacuee directly when no record exists', async () => {
		vi.mocked(couchAdmin.adminFetch).mockImplementation(async (url) => {
			if (url.includes('_find')) {
				return { docs: [] };
			}
			return { ok: true };
		});

		const res = await repo.processCardScan('SH001', 'DEV-01', 'โต๊ะ 1', mockCard);

		expect(res.status).toBe('created_pre_registered');
		expect(res.evacuee.current_stay.status).toBe('pre_registered');
		expect(res.evacuee.registered_via).toBe('kiosk');
		expect(res.evacuee.household_id).toBeNull();
		expect(res.evacuee.first_name).toBe('สมชาย');
		expect(res.evacuee.last_name).toBe('ใจดี');
		expect(res.evacuee.card_snapshot?.citizen_id).toBe('1234567890123');
		expect(res.evacuee.card_snapshot?.station_name).toBe('โต๊ะ 1');
		expect(res.evacuee.card_snapshot?.postal_code).toBe('10260');
		expect(res.message).toContain('อ่านบัตรสำเร็จ');
	});

	it('Branch 2: rejects with already_pre_registered when pre_registered evacuee scans again', async () => {
		const existingPreReg: Evacuee = {
			_id: 'evacuee:PREREG01',
			type: 'evacuee',
			schema_v: 8,
			shelter_code: 'SH001',
			created_by: 'public',
			created_at: '2026-08-29T00:00:00Z',
			updated_at: '2026-08-29T00:00:00Z',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0812345678',
			person_id: { cardType: 'national_id', number: '1234567890123' },
			country: 'THAILAND',
			special_needs: [],
			household_id: 'household:H1',
			current_stay: { status: 'pre_registered', zone: null, since: '2026-08-29T00:00:00Z' },
			privacy: { search_excluded: false },
			registered_via: 'web'
		};

		vi.mocked(couchAdmin.adminFetch).mockImplementation(async (url) => {
			if (url.includes('_find')) {
				return { docs: [existingPreReg] };
			}
			return { ok: true };
		});

		const res = await repo.processCardScan('SH001', 'DEV-01', 'โต๊ะ 1', mockCard);

		expect(res.status).toBe('already_pre_registered');
		if (res.status === 'already_pre_registered') {
			expect(res.error).toBe('ท่านมีข้อมูลในระบบแล้ว กรุณาไปพบเจ้าหน้าที่');
			expect(res.message).toBe('ท่านมีข้อมูลในระบบแล้ว กรุณาไปพบเจ้าหน้าที่');
		}
	});

	it('Branch 3: rejects with already_active when evacuee is currently active in shelter', async () => {
		const existingActive: Evacuee = {
			_id: 'evacuee:ACTIVE01',
			type: 'evacuee',
			schema_v: 8,
			shelter_code: 'SH001',
			created_by: 'staff1',
			created_at: '2026-08-29T00:00:00Z',
			updated_at: '2026-08-29T00:00:00Z',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0812345678',
			person_id: { cardType: 'national_id', number: '1234567890123' },
			country: 'THAILAND',
			special_needs: [],
			household_id: 'household:H1',
			current_stay: { status: 'active', zone: 'A1', since: '2026-08-29T00:00:00Z' },
			privacy: { search_excluded: false },
			registered_via: 'staff'
		};

		vi.mocked(couchAdmin.adminFetch).mockImplementation(async (url) => {
			if (url.includes('_find')) {
				return { docs: [existingActive] };
			}
			return { ok: true };
		});

		const res = await repo.processCardScan('SH001', 'DEV-01', 'โต๊ะ 1', mockCard);

		expect(res.status).toBe('already_active');
		if (res.status === 'already_active') {
			expect(res.error).toBe('ท่านได้เช็คอินเข้าพักในศูนย์แล้ว');
		}
	});

	it('Branch 4: rejects with already_temporary_leave when evacuee is currently on temporary leave', async () => {
		const existingLeave: Evacuee = {
			_id: 'evacuee:LEAVE01',
			type: 'evacuee',
			schema_v: 8,
			shelter_code: 'SH001',
			created_by: 'staff1',
			created_at: '2026-08-29T00:00:00Z',
			updated_at: '2026-08-29T00:00:00Z',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0812345678',
			person_id: { cardType: 'national_id', number: '1234567890123' },
			country: 'THAILAND',
			special_needs: [],
			household_id: 'household:H1',
			current_stay: { status: 'temporary_leave', zone: 'A1', since: '2026-08-29T00:00:00Z' },
			privacy: { search_excluded: false },
			registered_via: 'staff'
		};

		vi.mocked(couchAdmin.adminFetch).mockImplementation(async (url) => {
			if (url.includes('_find')) {
				return { docs: [existingLeave] };
			}
			return { ok: true };
		});

		const res = await repo.processCardScan('SH001', 'DEV-01', 'โต๊ะ 1', mockCard);

		expect(res.status).toBe('already_temporary_leave');
		if (res.status === 'already_temporary_leave') {
			expect(res.error).toContain('ออกชั่วคราว');
			expect(res.evacuee._id).toBe('evacuee:LEAVE01');
		}
	});

	it('Branch 5: rejects with previously_stayed when evacuee is checked_out or transferred', async () => {
		const existingCheckedOut: Evacuee = {
			_id: 'evacuee:CHECKOUT01',
			type: 'evacuee',
			schema_v: 8,
			shelter_code: 'SH001',
			created_by: 'staff1',
			created_at: '2026-08-29T00:00:00Z',
			updated_at: '2026-08-29T00:00:00Z',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0812345678',
			person_id: { cardType: 'national_id', number: '1234567890123' },
			country: 'THAILAND',
			special_needs: [],
			household_id: 'household:H1',
			current_stay: { status: 'checked_out', zone: 'A1', since: '2026-08-29T00:00:00Z' },
			privacy: { search_excluded: false },
			registered_via: 'staff'
		};

		vi.mocked(couchAdmin.adminFetch).mockImplementation(async (url) => {
			if (url.includes('_find')) {
				return { docs: [existingCheckedOut] };
			}
			return { ok: true };
		});

		const res = await repo.processCardScan('SH001', 'DEV-01', 'โต๊ะ 1', mockCard);

		expect(res.status).toBe('previously_stayed');
		if (res.status === 'previously_stayed') {
			expect(res.error).toContain('ประวัติการเข้าพัก');
			expect(res.evacuee._id).toBe('evacuee:CHECKOUT01');
		}
	});

	it('Branch 6: rejects with deceased_record when evacuee record is deceased (terminal)', async () => {
		const existingDeceased: Evacuee = {
			_id: 'evacuee:DEC01',
			type: 'evacuee',
			schema_v: 8,
			shelter_code: 'SH001',
			created_by: 'staff1',
			created_at: '2026-08-29T00:00:00Z',
			updated_at: '2026-08-29T00:00:00Z',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0812345678',
			person_id: { cardType: 'national_id', number: '1234567890123' },
			country: 'THAILAND',
			special_needs: [],
			household_id: 'household:H1',
			current_stay: { status: 'deceased', zone: null, since: '2026-08-29T00:00:00Z' },
			privacy: { search_excluded: false },
			registered_via: 'staff'
		};

		vi.mocked(couchAdmin.adminFetch).mockImplementation(async (url) => {
			if (url.includes('_find')) {
				return { docs: [existingDeceased] };
			}
			return { ok: true };
		});

		const res = await repo.processCardScan('SH001', 'DEV-01', 'โต๊ะ 1', mockCard);

		expect(res.status).toBe('deceased_record');
		if (res.status === 'deceased_record') {
			expect(res.error).toContain('เสียชีวิต');
			expect(res.evacuee._id).toBe('evacuee:DEC01');
		}
	});

	it('Branch 7: reactivates cancelled evacuee doc to pre_registered without creating duplicate doc ID', async () => {
		const existingCancelled: Evacuee = {
			_id: 'evacuee:CANCEL01',
			type: 'evacuee',
			schema_v: 8,
			shelter_code: 'SH001',
			created_by: 'public',
			created_at: '2026-08-29T00:00:00Z',
			updated_at: '2026-08-29T00:00:00Z',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0812345678',
			person_id: { cardType: 'national_id', number: '1234567890123' },
			country: 'THAILAND',
			special_needs: [],
			household_id: null,
			current_stay: { status: 'cancelled', zone: null, since: '2026-08-29T00:00:00Z' },
			privacy: { search_excluded: false },
			registered_via: 'web'
		};

		let putUrl = '';
		let putBody = '';

		vi.mocked(couchAdmin.adminFetch).mockImplementation(async (url, options) => {
			if (url.includes('_find')) {
				return { docs: [existingCancelled] };
			}
			if (options?.method === 'PUT') {
				putUrl = url;
				putBody = options.body as string;
				return { ok: true };
			}
			return { ok: true };
		});

		const res = await repo.processCardScan('SH001', 'DEV-01', 'โต๊ะ 1', mockCard);

		expect(res.status).toBe('created_pre_registered');
		expect(res.evacuee._id).toBe('evacuee:CANCEL01'); // preserves original doc ID
		expect(res.evacuee.current_stay.status).toBe('pre_registered');
		expect(res.evacuee.registered_via).toBe('kiosk');
		expect(res.evacuee.card_snapshot?.citizen_id).toBe('1234567890123');
		expect(putUrl).toContain('evacuee%3ACANCEL01');
		expect(JSON.parse(putBody)._id).toBe('evacuee:CANCEL01');
	});

	it('optimizes Mango index selector when citizen_id contains only digits', async () => {
		let findPayload: { selector: Record<string, unknown> } | null = null;
		vi.mocked(couchAdmin.adminFetch).mockImplementation(async (url, options) => {
			if (url.includes('_find')) {
				findPayload = JSON.parse(options?.body as string);
				return { docs: [] };
			}
			return { ok: true };
		});

		await repo.processCardScan('SH001', 'DEV-01', 'โต๊ะ 1', {
			...mockCard,
			citizen_id: '1234567890123'
		});

		expect(findPayload?.selector).toEqual({
			type: 'evacuee',
			'person_id.number': '1234567890123'
		});
		expect(findPayload?.selector.$or).toBeUndefined();
	});

	it('uses $or in Mango selector when citizen_id contains formatted characters', async () => {
		let findPayload: { selector: Record<string, unknown> } | null = null;
		vi.mocked(couchAdmin.adminFetch).mockImplementation(async (url, options) => {
			if (url.includes('_find')) {
				findPayload = JSON.parse(options?.body as string);
				return { docs: [] };
			}
			return { ok: true };
		});

		await repo.processCardScan('SH001', 'DEV-01', 'โต๊ะ 1', {
			...mockCard,
			citizen_id: '1-2345-67890-12-3'
		});

		expect(findPayload?.selector).toEqual({
			type: 'evacuee',
			$or: [{ 'person_id.number': '1-2345-67890-12-3' }, { 'person_id.number': '1234567890123' }]
		});
	});
});
