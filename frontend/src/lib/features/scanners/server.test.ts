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
		photo_base64: 'data:image/jpeg;base64,...',
		issuer: 'ที่ว่าการอำเภอ',
		issue_date: '25600101',
		expire_date: '25700101'
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Branch 1: creates draft evacuee when no record exists', async () => {
		vi.mocked(couchAdmin.adminFetch).mockImplementation(async (url) => {
			if (url.includes('_find')) {
				return { docs: [] };
			}
			return { ok: true };
		});

		const res = await repo.processCardScan('SH001', 'DEV-01', 'โต๊ะ 1', mockCard);

		expect(res.status).toBe('created_draft');
		expect(res.evacuee.current_stay.status).toBe('draft');
		expect(res.evacuee.household_id).toBeNull();
		expect(res.evacuee.first_name).toBe('สมชาย');
		expect(res.evacuee.last_name).toBe('ใจดี');
		expect(res.evacuee.card_snapshot?.citizen_id).toBe('1234567890123');
		expect(res.evacuee.card_snapshot?.station_name).toBe('โต๊ะ 1');
		expect(res.message).toContain('อ่านบัตรสำเร็จ');
	});

	it('Branch 2: overwrites evacuee personal details and attaches card_snapshot when pre_registered exists', async () => {
		const existingPreReg: Evacuee = {
			_id: 'evacuee:PREREG01',
			type: 'evacuee',
			schema_v: 8,
			shelter_code: 'SH001',
			created_by: 'public',
			created_at: '2026-08-29T00:00:00Z',
			updated_at: '2026-08-29T00:00:00Z',
			first_name: 'สมชายเก่า',
			last_name: 'ใจดีเก่า',
			gender: 'female',
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

		expect(res.status).toBe('attached_to_preregistered');
		expect(res.evacuee.current_stay.status).toBe('pre_registered');
		// Overwritten from card data
		expect(res.evacuee.first_name).toBe('สมชาย');
		expect(res.evacuee.last_name).toBe('ใจดี');
		expect(res.evacuee.gender).toBe('male');
		expect(res.evacuee.birth_year).toBe(2535); // 1992 + 543
		expect(res.evacuee.age).toBe(34);
		expect(res.evacuee.photo).toBe('data:image/jpeg;base64,...');
		expect(res.evacuee.card_snapshot?.citizen_id).toBe('1234567890123');
		expect(res.message).toContain('พบข้อมูลการจองล่วงหน้าและอัปเดตข้อมูลจากบัตรแล้ว');
	});

	it('Branch 3: rejects with duplicate_draft when draft already exists with custom warning message', async () => {
		const existingDraft: Evacuee = {
			_id: 'evacuee:DRAFT01',
			type: 'evacuee',
			schema_v: 8,
			shelter_code: 'SH001',
			created_by: 'scanner:DEV-01',
			created_at: '2026-08-29T00:00:00Z',
			updated_at: '2026-08-29T00:00:00Z',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: null,
			person_id: { cardType: 'national_id', number: '1234567890123' },
			country: 'THAILAND',
			special_needs: [],
			household_id: null,
			current_stay: { status: 'draft', zone: null, since: '2026-08-29T00:00:00Z' },
			privacy: { search_excluded: false },
			registered_via: 'kiosk'
		};

		vi.mocked(couchAdmin.adminFetch).mockImplementation(async (url) => {
			if (url.includes('_find')) {
				return { docs: [existingDraft] };
			}
			return { ok: true };
		});

		const res = await repo.processCardScan('SH001', 'DEV-01', 'โต๊ะ 1', mockCard);

		expect(res.status).toBe('duplicate_draft');
		if (res.status === 'duplicate_draft') {
			expect(res.error).toBe('ท่านได้เคยเสียบบัตรเพื่อบันทึกข้อมูลแล้ว');
			expect(res.message).toBe('ท่านได้เคยเสียบบัตรเพื่อบันทึกข้อมูลแล้ว');
		}
	});

	it('Branch 4: rejects with already_active when evacuee is currently active in shelter', async () => {
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
			registered_via: 'app'
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
});
