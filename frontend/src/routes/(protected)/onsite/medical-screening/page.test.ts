import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'svelte/server';
import { load } from './+page';
import {
	buildMedicalScreeningPath,
	classifyScreeningQueueTab,
	matchesMedicalScreeningSearch,
	parseMedicalScreeningQrCode,
	shouldConfirmLeave
} from './medical-screening.utils';
import ClinicalScreeningForm from './clinical-screening-form.svelte';
import type { Evacuee, Household } from '$lib/features/people';

let mockUserRoles: string[] = [];
let mockIsAuthenticated = true;

vi.mock('$lib/guards/auth', () => ({
	requireMedicalScreening: vi.fn(async () => {
		const allowed = ['medical_staff', 'triage_staff', 'shelter_manager', 'system_admin', '_admin'];
		const hasRole = mockUserRoles.some((r) => allowed.includes(r));
		if (!mockIsAuthenticated || !hasRole) {
			const error = Object.assign(new Error('Redirect'), { status: 302, location: '/portal' });
			throw error;
		}
	})
}));

/**
 * `load` is typed against SvelteKit's full `LoadEvent`, but the guard only needs
 * enough of an event object for `requireMedicalScreening` to run in unit tests.
 */
type LoadArg = Parameters<typeof load>[0];
const loadArg = (): LoadArg =>
	({
		fetch: vi.fn(),
		url: new URL('http://localhost/onsite/medical-screening')
	}) as unknown as LoadArg;

describe('medical-screening +page.ts route guard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsAuthenticated = true;
		mockUserRoles = [];
	});

	it('allows access for medical_staff', async () => {
		mockUserRoles = ['shelter:SH001', 'medical_staff'];
		await expect(load(loadArg())).resolves.not.toThrow();
	});

	it('allows access for triage_staff', async () => {
		mockUserRoles = ['shelter:SH001', 'triage_staff'];
		await expect(load(loadArg())).resolves.not.toThrow();
	});

	it('allows access for shelter_manager', async () => {
		mockUserRoles = ['shelter:SH001', 'shelter_manager'];
		await expect(load(loadArg())).resolves.not.toThrow();
	});

	it('allows access for system_admin', async () => {
		mockUserRoles = ['system_admin'];
		await expect(load(loadArg())).resolves.not.toThrow();
	});

	it('blocks access for registration_staff (redirects to /portal)', async () => {
		mockUserRoles = ['shelter:SH001', 'registration_staff'];
		await expect(load(loadArg())).rejects.toMatchObject({
			status: 302,
			location: '/portal'
		});
	});

	it('blocks access for unauthenticated users', async () => {
		mockIsAuthenticated = false;
		mockUserRoles = [];
		await expect(load(loadArg())).rejects.toMatchObject({
			status: 302,
			location: '/portal'
		});
	});
});

describe('buildMedicalScreeningPath', () => {
	it('builds path-only deep link /onsite/medical-screening/{id}', () => {
		expect(buildMedicalScreeningPath('evacuee:01ABC123')).toBe(
			'/onsite/medical-screening/evacuee:01ABC123'
		);
	});
});

describe('parseMedicalScreeningQrCode', () => {
	it('parses path-form deep link /onsite/medical-screening/{id}', () => {
		expect(parseMedicalScreeningQrCode('/onsite/medical-screening/evacuee:01ABC123')).toBe(
			'evacuee:01ABC123'
		);
	});

	it('parses full URL with path-form id segment', () => {
		expect(
			parseMedicalScreeningQrCode('https://shelter.local/onsite/medical-screening/evacuee:01XYZ987')
		).toBe('evacuee:01XYZ987');
	});

	it('still extracts id from legacy query slips when scanned', () => {
		expect(
			parseMedicalScreeningQrCode('/onsite/medical-screening?evacuee_id=evacuee:01LEGACY')
		).toBe('evacuee:01LEGACY');
	});

	it('parses direct evacuee ID starting with evacuee:', () => {
		const input = 'evacuee:01ABC123';
		expect(parseMedicalScreeningQrCode(input)).toBe('evacuee:01ABC123');
	});

	it('parses direct raw ID string and trims whitespace', () => {
		const input = '  01J7ABCDEF123456  ';
		expect(parseMedicalScreeningQrCode(input)).toBe('01J7ABCDEF123456');
	});

	it('returns null for empty string or invalid URL without screening id', () => {
		expect(parseMedicalScreeningQrCode('')).toBeNull();
		expect(parseMedicalScreeningQrCode('   ')).toBeNull();
		expect(parseMedicalScreeningQrCode('https://example.com/other')).toBeNull();
		expect(parseMedicalScreeningQrCode('/onsite/medical-screening')).toBeNull();
	});
});

describe('classifyScreeningQueueTab', () => {
	const base: Evacuee = {
		_id: 'evacuee:01J7',
		type: 'evacuee',
		schema_v: 9,
		shelter_code: 'SH001',
		created_at: '2026-09-02T10:00:00Z',
		updated_at: '2026-09-02T10:00:00Z',
		created_by: 'staff1',
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		gender: 'male',
		phone: '0812345678',
		country: 'TH',
		special_needs: [],
		current_stay: {
			status: 'arriving',
			zone: null,
			since: '2026-09-02T10:00:00Z'
		},
		privacy: { search_excluded: false },
		registered_via: 'staff',
		household_id: null
	};

	it('classifies arriving/pre_registered without screening as pending (รอตรวจ)', () => {
		const screened = new Set<string>();
		expect(classifyScreeningQueueTab(base, screened)).toBe('pending');
		expect(
			classifyScreeningQueueTab(
				{ ...base, current_stay: { ...base.current_stay, status: 'pre_registered' } },
				screened
			)
		).toBe('pending');
	});

	it('classifies evacuees with a screening record as screened (ตรวจแล้ว)', () => {
		expect(classifyScreeningQueueTab(base, new Set(['evacuee:01J7']))).toBe('screened');
	});

	it('excludes active without screening from either queue tab', () => {
		expect(
			classifyScreeningQueueTab(
				{ ...base, current_stay: { ...base.current_stay, status: 'active' } },
				new Set()
			)
		).toBeNull();
	});
});

describe('shouldConfirmLeave', () => {
	it('asks to confirm only when the form is dirty and not submitting', () => {
		expect(shouldConfirmLeave({ isDirty: true, isSubmitting: false })).toBe(true);
		expect(shouldConfirmLeave({ isDirty: false, isSubmitting: false })).toBe(false);
		expect(shouldConfirmLeave({ isDirty: true, isSubmitting: true })).toBe(false);
	});
});

describe('matchesMedicalScreeningSearch', () => {
	const sampleEvacuee: Evacuee = {
		_id: 'evacuee:01J7',
		type: 'evacuee',
		schema_v: 9,
		shelter_code: 'SH001',
		created_at: '2026-09-02T10:00:00Z',
		updated_at: '2026-09-02T10:00:00Z',
		created_by: 'staff1',
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		gender: 'male',
		phone: '0812345678',
		country: 'TH',
		person_id: {
			cardType: 'national_id',
			number: '1234567890123'
		},
		special_needs: ['wheelchair'],
		current_stay: {
			status: 'arriving',
			zone: null,
			since: '2026-09-02T10:00:00Z'
		},
		privacy: { search_excluded: false },
		registered_via: 'staff',
		household_id: 'household:01J7'
	};

	const sampleHousehold: Household = {
		_id: 'household:01J7',
		type: 'household',
		schema_v: 4,
		shelter_code: 'SH001',
		created_at: '2026-09-02T10:00:00Z',
		updated_at: '2026-09-02T10:00:00Z',
		created_by: 'staff1',
		label: 'บ้านใจดี',
		head_evacuee_id: 'evacuee:01J7',
		status: 'arriving',
		checkout_destination: null,
		municipality_zone: null,
		community: null,
		address_no: '99/1',
		village_no: '3',
		subdistrict: 'แม่สาย',
		district: 'แม่สาย',
		province: 'เชียงราย',
		postal_code: '57130',
		pets: [],
		vehicles: [],
		assets: null
	};

	it('returns true when query is empty', () => {
		expect(matchesMedicalScreeningSearch(sampleEvacuee, '')).toBe(true);
		expect(matchesMedicalScreeningSearch(sampleEvacuee, '   ')).toBe(true);
	});

	it('matches first name or last name', () => {
		expect(matchesMedicalScreeningSearch(sampleEvacuee, 'สมชาย')).toBe(true);
		expect(matchesMedicalScreeningSearch(sampleEvacuee, 'ใจดี')).toBe(true);
		expect(matchesMedicalScreeningSearch(sampleEvacuee, 'สมหญิง')).toBe(false);
	});

	it('matches phone number', () => {
		expect(matchesMedicalScreeningSearch(sampleEvacuee, '0812345678')).toBe(true);
		expect(matchesMedicalScreeningSearch(sampleEvacuee, '081-234-5678')).toBe(true);
		expect(matchesMedicalScreeningSearch(sampleEvacuee, '0899999999')).toBe(false);
	});

	it('matches national ID / citizen ID', () => {
		expect(matchesMedicalScreeningSearch(sampleEvacuee, '1234567890123')).toBe(true);
		expect(matchesMedicalScreeningSearch(sampleEvacuee, '1-2345-67890-12-3')).toBe(true);
	});

	it('matches household address fields (subdistrict, district, province)', () => {
		expect(matchesMedicalScreeningSearch(sampleEvacuee, 'แม่สาย', sampleHousehold)).toBe(true);
		expect(matchesMedicalScreeningSearch(sampleEvacuee, 'เชียงราย', sampleHousehold)).toBe(true);
		expect(matchesMedicalScreeningSearch(sampleEvacuee, '99/1', sampleHousehold)).toBe(true);
		expect(matchesMedicalScreeningSearch(sampleEvacuee, 'ภูเก็ต', sampleHousehold)).toBe(false);
	});
});

describe('ClinicalScreeningForm component', () => {
	const sampleEvacuee = {
		_id: 'evacuee:01TEST',
		type: 'evacuee',
		schema_v: 9,
		shelter_code: 'SH001',
		created_at: '2026-09-02T10:00:00Z',
		updated_at: '2026-09-02T10:00:00Z',
		created_by: 'staff1',
		first_name: 'สมศรี',
		last_name: 'พร้อมเพรียง',
		gender: 'female',
		phone: '0812345678',
		country: 'TH',
		special_needs: ['wheelchair'],
		current_stay: {
			status: 'arriving',
			zone: null,
			since: '2026-09-02T10:00:00Z'
		},
		privacy: { search_excluded: false },
		registered_via: 'staff',
		household_id: null
	} as Evacuee;

	it('renders clinical form with EWAR, medical, vitals — without zone/check-in actions', () => {
		const result = render(ClinicalScreeningForm, {
			props: {
				evacuee: sampleEvacuee,
				onSuccess: vi.fn()
			}
		});

		expect(result.body).toContain('ข้อจำกัด / ความต้องการพิเศษ');
		expect(result.body).toContain('ใช้วีลแชร์');
		expect(result.body).toContain('สัญญาณชีพ');
		expect(result.body).toContain('ความดันโลหิต');
		expect(result.body).toContain('ชีพจร');
		expect(result.body).toContain('SpO2');
		expect(result.body).toContain('อาการเฝ้าระวัง');
		expect(result.body).toContain('หมู่เลือด');
		expect(result.body).toContain('โรคประจำตัว');
		expect(result.body).toContain('ยาที่ใช้ประจำ');
		expect(result.body).toContain('ประวัติการแพ้');
		expect(result.body).toContain('ระดับความเร่งด่วน (Triage Level)');
		expect(result.body).toContain('สีเขียว');
		expect(result.body).toContain('สีเหลือง');
		expect(result.body).toContain('สีแดง');
		expect(result.body).toContain('สถานะการส่งต่อ');
		expect(result.body).toContain('บันทึกผลคัดกรอง');
		expect(result.body).not.toContain('จัดโซนและเช็คอินเข้าพักทันที');
		expect(result.body).not.toContain('บันทึกผลตรวจและส่งต่อไปจุดจัดโซน');
		expect(result.body).not.toContain('บันทึกและจัดโซนทันที');
	});

	it('shows re-edit banner when prior screening context is provided', () => {
		const result = render(ClinicalScreeningForm, {
			props: {
				evacuee: sampleEvacuee,
				priorScreening: {
					screeningCount: 2,
					lastScreenedAt: '2026-09-02T12:30:00Z',
					lastScreenedBy: 'nurse.one'
				},
				onSuccess: vi.fn()
			}
		});

		expect(result.body).toContain('แก้ไขผลการคัดกรอง');
		expect(result.body).toMatch(/2/);
		expect(result.body).toContain('nurse.one');
	});
});

describe('medical-screening queue page (+page.svelte)', () => {
	it('renders รอตรวจ / ตรวจแล้ว tabs, navigates by path, and has no side-panel form', async () => {
		const { readFile } = await import('node:fs/promises');
		const { fileURLToPath } = await import('node:url');
		const pagePath = fileURLToPath(new URL('./+page.svelte', import.meta.url));
		const source = await readFile(pagePath, 'utf8');

		expect(source).toContain('รอตรวจ');
		expect(source).toContain('ตรวจแล้ว');
		expect(source).toContain('buildMedicalScreeningPath');
		expect(source).not.toContain('ClinicalScreeningForm');
		expect(source).not.toContain("searchParams.get('evacuee_id')");
		expect(source).not.toContain("searchParams.set('evacuee_id'");
	});
});

describe('medical-screening form page ([evacuee_id]/+page.svelte)', () => {
	it('hosts ClinicalScreeningForm full-screen with sticky footer save and dirty leave confirm', async () => {
		const { readFile } = await import('node:fs/promises');
		const { fileURLToPath } = await import('node:url');
		const pagePath = fileURLToPath(new URL('./[evacuee_id]/+page.svelte', import.meta.url));
		const source = await readFile(pagePath, 'utf8');

		expect(source).toContain('ClinicalScreeningForm');
		expect(source).toContain('shouldConfirmLeave');
		expect(source).toContain('/onsite/medical-screening');
		expect(source).not.toContain('ZoneSelectionFields');
		expect(source).not.toContain('directCheckIn');
	});
});
