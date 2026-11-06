import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee } from '../../domain/people';
import EvacueeProfileEmergencyCard from './evacuee-profile-emergency-card.svelte';

const evacuee: Evacuee = {
	_id: 'evacuee:test-123',
	_rev: '1-abc',
	type: 'evacuee',
	schema_v: 9,
	first_name: 'Anna',
	last_name: 'Schmidt',
	gender: 'female',
	phone: null,
	country: 'GERMANY',
	vulnerable_groups: [],
	special_needs: [],
	emergency_contact: { name: 'Hans Schmidt', phone: '0898765432', relation: 'Husband' },
	current_stay: { status: 'arriving', zone: null, since: '2026-09-02T10:00:00.000Z' },
	privacy: { search_excluded: false },
	registered_via: 'staff',
	household_id: null,
	shelter_code: 'SH001',
	created_at: '2026-09-02T10:00:00.000Z',
	created_by: 'staff-1',
	updated_at: '2026-09-02T10:00:00.000Z'
};

function renderCard(language: 'th' | 'en', value: Evacuee = evacuee) {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(EvacueeProfileEmergencyCard, {
			props: { evacuee: value, readonly: false, onOpenEdit: () => {} }
		}).body;
	} finally {
		langState.current = previous;
	}
}

describe('EvacueeProfileEmergencyCard', () => {
	it('shows English labels and no Thai text when the staff language is EN', () => {
		const body = renderCard('en');
		expect(body).toContain('Emergency contact');
		expect(body).toContain('Relative / contact person:');
		expect(body).toContain('Emergency phone number:');
		expect(body).toContain('Relationship:');
		expect(body).toContain('Hans Schmidt');
		expect(body).toContain('Edit emergency contact');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('shows English fallbacks when no emergency contact is recorded and the language is EN', () => {
		const body = renderCard('en', { ...evacuee, emergency_contact: undefined });
		expect(body).toContain('No contact person specified');
		expect(body).toContain('Not specified');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const body = renderCard('th');
		expect(body).toContain('ข้อมูลติดต่อฉุกเฉิน');
		expect(body).toContain('ญาติ / ผู้ติดต่อ:');
		expect(body).toContain('เบอร์โทรศัพท์ฉุกเฉิน:');
		expect(body).toContain('ความสัมพันธ์:');
		expect(body).toContain('แก้ไขข้อมูลติดต่อฉุกเฉิน');
		const empty = renderCard('th', { ...evacuee, emergency_contact: undefined });
		expect(empty).toContain('ไม่ระบุบุคคล');
		expect(empty).toContain('ไม่ระบุ');
	});
});
