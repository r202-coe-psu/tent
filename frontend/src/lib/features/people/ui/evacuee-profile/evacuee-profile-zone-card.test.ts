import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee } from '../../domain/people';
import EvacueeProfileZoneCard from './evacuee-profile-zone-card.svelte';

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
	phone: null,
	country: 'GERMANY',
	gender: 'female',
	age: 40,
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

function renderCard(language: 'th' | 'en') {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(EvacueeProfileZoneCard, {
			props: { evacuee, shelterName: 'Riverside shelter', readonly: false, onOpenEdit: () => {} }
		}).body;
	} finally {
		langState.current = previous;
	}
}

describe('EvacueeProfileZoneCard', () => {
	it('shows English labels and no Thai text when the staff language is EN', () => {
		const body = renderCard('en');
		expect(body).toContain('Zone and shelter location');
		expect(body).toContain('Edit living zone');
		expect(body).toContain('Shelter:');
		expect(body).toContain('Living zone:');
		expect(body).toContain('Zone A');
		expect(body).toContain('Bed / spot number:');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const body = renderCard('th');
		expect(body).toContain('พิกัดโซนและศูนย์พักพิง');
		expect(body).toContain('แก้ไขโซนพักอาศัย');
		expect(body).toContain('ศูนย์อพยพ:');
		expect(body).toContain('โซนพักอาศัย:');
		expect(body).toContain('โซน A');
		expect(body).toContain('หมายเลขเตียง/จุดพัก:');
	});
});
