import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee, Medical } from '../../domain/people';
import EvacueeProfileHeaderCard from './evacuee-profile-header-card.svelte';

const evacuee: Evacuee = {
	_id: 'evacuee:test-123',
	_rev: '1-abc',
	type: 'evacuee',
	schema_v: 9,
	first_name: 'Anna',
	last_name: 'Schmidt',
	gender: 'female',
	age: 40,
	phone: null,
	country: 'GERMANY',
	person_id: { cardType: 'passport', number: 'C01X00T47' },
	vulnerable_groups: [],
	special_needs: ['wheelchair'],
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
	colorClass: 'bg-green-100',
	dotClass: 'bg-green-500'
};

function renderHeader(language: 'th' | 'en', readonly = false) {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(EvacueeProfileHeaderCard, {
			props: {
				evacuee,
				medical,
				screening: null,
				statusInfo,
				readonly,
				onOpenZoneModal: () => {},
				onOpenStatusModal: () => {},
				onOpenQrModal: () => {},
				onOpenProfileEdit: () => {}
			}
		}).body;
	} finally {
		langState.current = previous;
	}
}

describe('EvacueeProfileHeaderCard', () => {
	it('shows English labels and no Thai text when the staff language is EN', () => {
		const body = renderHeader('en');
		expect(body).toContain('Illness / health watch');
		expect(body).toContain('Vulnerable group');
		expect(body).toContain('Personal information');
		expect(body).toContain('Change zone');
		expect(body).toContain('Print QR');
		expect(body).not.toMatch(/[฀-๿]/);

		const readonlyBody = renderHeader('en', true);
		expect(readonlyBody).toContain('View full record / edit');
		expect(readonlyBody).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const body = renderHeader('th');
		expect(body).toContain('มีอาการป่วย/เฝ้าระวัง');
		expect(body).toContain('กลุ่มเปราะบาง');
		expect(body).toContain('ข้อมูลส่วนบุคคล');
		expect(body).toContain('ย้ายโซน (Change Zone)');
		expect(body).toContain('พิมพ์ QR');

		expect(renderHeader('th', true)).toContain('ดูข้อมูลเต็ม / แก้ไข');
	});
});
