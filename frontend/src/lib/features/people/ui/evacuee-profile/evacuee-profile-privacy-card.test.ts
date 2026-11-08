import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee } from '../../domain/people';
import EvacueeProfilePrivacyCard from './evacuee-profile-privacy-card.svelte';

// The mutation talks to CouchDB through TanStack Query; serve an idle one instead.
vi.mock('../../application/queries', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../application/queries')>()),
	useSetSearchVisibility: () => ({ mutate: () => {}, isPending: false })
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
	phone: null,
	country: 'GERMANY',
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

function renderCard(language: 'th' | 'en', searchExcluded = false) {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(EvacueeProfilePrivacyCard, {
			props: {
				evacuee: { ...evacuee, privacy: { search_excluded: searchExcluded } },
				readonly: false,
				getAuthorContext: () => ({ shelterCode: 'SH001', createdBy: 'staff-1' })
			}
		}).body;
	} finally {
		langState.current = previous;
	}
}

describe('EvacueeProfilePrivacyCard', () => {
	it('shows English labels and no Thai text when the staff language is EN', () => {
		const visible = renderCard('en');
		expect(visible).toContain('Privacy');
		expect(visible).toContain('Show in relative search');
		expect(visible).toContain('Relatives can search by name and shelter');
		expect(visible).not.toMatch(/[฀-๿]/);

		const hidden = renderCard('en', true);
		expect(hidden).toContain('Hidden from relative search');
		expect(hidden).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const visible = renderCard('th');
		expect(visible).toContain('ความเป็นส่วนตัว');
		expect(visible).toContain('แสดงในระบบค้นหาญาติ');
		expect(visible).toContain('ญาติค้นหาชื่อและศูนย์ที่พักได้');
		expect(renderCard('th', true)).toContain('ซ่อนจากระบบค้นหาญาติ');
	});
});
