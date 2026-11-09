import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee, Medical } from '../../domain/people';
import EvacueeProfileIdentityRail from './evacuee-profile-identity-rail.svelte';

// The shelter zones come from CouchDB; serve a fixed answer instead.
vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelter: () => ({ data: { zones: [] }, isPending: false })
}));

const evacuee: Evacuee = {
	_id: 'evacuee:test-123',
	_rev: '1-abc',
	type: 'evacuee',
	schema_v: 9,
	first_name: 'Anna',
	last_name: 'Schmidt',
	gender: 'female',
	age: 40,
	phone: '0812345678',
	country: 'GERMANY',
	person_id: { cardType: 'passport', number: 'C01X00T47' },
	emergency_contact: { name: 'Hans', phone: '0899999999', relation: 'Brother' },
	vulnerable_groups: [],
	special_needs: [],
	current_stay: { status: 'active', zone: 'A', since: '2026-09-02T10:00:00.000Z' },
	privacy: { search_excluded: false },
	registered_via: 'staff',
	household_id: null,
	shelter_code: 'SH001',
	created_at: '2026-09-02T10:00:00.000Z',
	created_by: 'staff-1',
	updated_at: '2026-09-02T10:00:00.000Z'
};

const medical = { conditions: ['asthma'], notes: null, track: 'normal' } as unknown as Medical;
const statusInfo = {
	label: 'Check-in',
	shortLabel: 'Check-in',
	colorClass: 'bg-green-100',
	dotClass: 'bg-green-500'
};

function renderRail(
	language: 'th' | 'en',
	overrides: { readonly?: boolean; evacuee?: Evacuee } = {}
) {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(EvacueeProfileIdentityRail, {
			props: {
				evacuee: overrides.evacuee ?? evacuee,
				medical,
				screening: null,
				shelterName: 'Riverside shelter',
				statusInfo,
				readonly: overrides.readonly ?? false,
				onOpenZoneModal: () => {},
				onOpenStatusModal: () => {},
				onOpenQrModal: () => {},
				onOpenHandoverSlip: () => {},
				onOpenPersonalEdit: () => {},
				onOpenEmergencyEdit: () => {}
			}
		}).body;
	} finally {
		langState.current = previous;
	}
}

describe('EvacueeProfileIdentityRail', () => {
	it('shows English labels and no Thai text when the staff language is EN', () => {
		const body = renderRail('en');
		expect(body).toContain('Edit personal information');
		expect(body).toContain('Zone A');
		expect(body).toContain('Health watch');
		expect(body).toContain('Female');
		expect(body).toContain('Age 40 yrs');
		expect(body).toContain('Germany');
		expect(body).toContain('Phone: 0812345678');
		expect(body).toContain('Emergency:');
		expect(body).toContain('Edit emergency contact');
		expect(body).toContain('Change zone');
		expect(body).toContain('Change status');
		expect(body).toContain('Print QR');
		expect(body).toContain('Print referral slip');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('shows English fallbacks and the read-only action in EN', () => {
		const bare = renderRail('en', {
			readonly: true,
			evacuee: {
				...evacuee,
				gender: null,
				age: undefined,
				country: '',
				phone: null,
				emergency_contact: undefined
			}
		});
		expect(bare).toContain('Not specified');
		expect(bare).toContain('Nationality not specified');
		expect(bare).toContain('No phone');
		expect(bare).toContain('View full record');
		expect(bare).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const body = renderRail('th');
		expect(body).toContain('แก้ไขข้อมูลส่วนบุคคล');
		expect(body).toContain('โซน A');
		expect(body).toContain('เฝ้าระวังสุขภาพ');
		expect(body).toContain('หญิง');
		expect(body).toContain('อายุ 40 ปี');
		expect(body).toContain('เยอรมนี');
		expect(body).toContain('โทร: 0812345678');
		expect(body).toContain('ฉุกเฉิน:');
		expect(body).toContain('แก้ไขข้อมูลติดต่อฉุกเฉิน');
		expect(body).toContain('ย้ายโซน');
		expect(body).toContain('เปลี่ยนสถานะ');
		expect(body).toContain('พิมพ์ใบส่งตัว');

		const bare = renderRail('th', {
			readonly: true,
			evacuee: { ...evacuee, country: '', phone: null, emergency_contact: undefined }
		});
		expect(bare).toContain('ไม่ระบุสัญชาติ');
		expect(bare).toContain('โทร: ไม่มีเบอร์');
		expect(bare).toContain('ดูข้อมูลเต็ม');
	});
});
