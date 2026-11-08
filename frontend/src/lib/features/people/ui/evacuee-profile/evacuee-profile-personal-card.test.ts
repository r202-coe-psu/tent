import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee } from '../../domain/people';
import EvacueeProfilePersonalCard from './evacuee-profile-personal-card.svelte';

const evacuee: Evacuee = {
	_id: 'evacuee:test-123',
	_rev: '1-abc',
	type: 'evacuee',
	schema_v: 9,
	first_name: 'Anna',
	last_name: 'Schmidt',
	nickname: 'Annie',
	gender: 'female',
	age: 40,
	birth_year: 2527,
	religion: 'christian',
	phone: '0812345678',
	person_id: { cardType: 'passport', number: 'C01X00T47' },
	country: 'GERMANY',
	vulnerable_groups: [],
	special_needs: [],
	current_stay: { status: 'arriving', zone: null, since: '2026-09-02T10:00:00.000Z' },
	privacy: { search_excluded: false },
	registered_via: 'staff',
	household_id: null,
	shelter_code: 'SH001',
	created_at: '2026-09-02T10:00:00.000Z',
	created_by: 'staff-1',
	updated_at: '2026-09-02T10:00:00.000Z'
};

function renderCard(language: 'th' | 'en') {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(EvacueeProfilePersonalCard, {
			props: { evacuee, readonly: false, onOpenEdit: () => {} }
		}).body;
	} finally {
		langState.current = previous;
	}
}

describe('EvacueeProfilePersonalCard', () => {
	it('shows English labels and no Thai text when the staff language is EN', () => {
		const body = renderCard('en');
		expect(body).toContain('Personal information');
		expect(body).toContain('Full name');
		expect(body).toContain('Passport');
		expect(body).toContain('Female');
		expect(body).toContain('Germany');
		expect(body).toContain('Christian');
		expect(body).toContain('C.E. 1984');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const body = renderCard('th');
		expect(body).toContain('ข้อมูลส่วนบุคคล');
		expect(body).toContain('ชื่อ - นามสกุล');
		expect(body).toContain('หนังสือเดินทาง');
		expect(body).toContain('หญิง');
		expect(body).toContain('เยอรมนี');
		expect(body).toContain('40 ปี');
		expect(body).toContain('พ.ศ. 2527');
		expect(body).toContain('แก้ไขข้อมูลส่วนบุคคล');
	});
});
