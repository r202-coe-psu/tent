import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee, Household } from '../../domain/people';
import EvacueeProfileHouseholdCard from './evacuee-profile-household-card.svelte';

// Master data and the shelter zones come from CouchDB; serve fixed answers instead.
vi.mock('$lib/features/master-data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/master-data')>()),
	useMasterData: () => ({
		data: {
			items: [{ code: 'owned_house', label_th: 'บ้านของตนเอง', label_en: 'Owned house' }]
		},
		isPending: false
	})
}));
vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelter: () => ({ data: { zones: [] }, isPending: false })
}));

function makeEvacuee(id: string, firstName: string, overrides: Partial<Evacuee> = {}): Evacuee {
	return {
		_id: id,
		_rev: '1-abc',
		type: 'evacuee',
		schema_v: 9,
		first_name: firstName,
		last_name: 'Schmidt',
		gender: 'female',
		age: 40,
		vulnerable_groups: [],
		special_needs: [],
		current_stay: { status: 'active', zone: null, since: '2026-09-02T10:00:00.000Z' },
		privacy: { search_excluded: false },
		registered_via: 'staff',
		household_id: 'household:test-123',
		shelter_code: 'SH001',
		created_at: '2026-09-02T10:00:00.000Z',
		created_by: 'staff-1',
		updated_at: '2026-09-02T10:00:00.000Z',
		...overrides
	} as Evacuee;
}

const head = makeEvacuee('evacuee:head', 'Anna');
const child = makeEvacuee('evacuee:child', 'Max', {
	age: 12,
	current_stay: { status: 'active', zone: 'A', since: '2026-09-02T10:00:00.000Z' }
});

const household: Household = {
	_id: 'household:test-123',
	_rev: '1-abc',
	type: 'household',
	schema_v: 9,
	label: 'Schmidt family',
	head_evacuee_id: 'evacuee:head',
	status: 'checked_in',
	checkout_destination: null,
	municipality_zone: '5',
	community: 'Green Park',
	pets: [],
	vehicles: [],
	notes: 'Needs a ground floor',
	housing_type: 'owned_house',
	residence_landmark: 'Next to the market',
	address_no: '12',
	village_no: 'Moo 3',
	subdistrict: 'Bang Rak',
	district: 'Muang',
	province: 'Chiang Mai',
	postal_code: '50000',
	created_at: '2026-09-02T10:00:00.000Z',
	created_by: 'staff-1',
	updated_at: '2026-09-02T10:00:00.000Z'
};

function renderCard(
	language: 'th' | 'en',
	data: { household: Household | null; members: Evacuee[] } = {
		household,
		members: [head, child]
	}
) {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(EvacueeProfileHouseholdCard, {
			props: {
				evacuee: head,
				...data,
				readonly: false,
				onOpenAddressModal: () => {},
				onOpenHouseholdModal: () => {},
				onViewMember: () => {}
			}
		}).body;
	} finally {
		langState.current = previous;
	}
}

describe('EvacueeProfileHouseholdCard', () => {
	it('shows English labels and no Thai text when the staff language is EN', () => {
		const body = renderCard('en');
		expect(body).toContain('Household / family');
		expect(body).toContain('Edit household affiliation');
		expect(body).toContain('Household name');
		expect(body).toContain('Checked in');
		expect(body).toContain('Role: head');
		expect(body).toContain('Housing type');
		expect(body).toContain('Owned house');
		expect(body).toContain('Nearby landmark');
		expect(body).toContain('Zone 5');
		expect(body).toContain('Community Green Park');
		expect(body).toContain(
			'12 Moo 3 Bang Rak Subdistrict Muang District Chiang Mai Province 50000'
		);
		expect(body).toContain('Edit address');
		expect(body).toContain('Household notes');
		expect(body).toContain('Members (2)');
		expect(body).toContain('Viewing');
		expect(body).toContain('Age 12 yrs');
		expect(body).toContain('View profile');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('shows English empty states and no Thai text when the staff language is EN', () => {
		const noHousehold = renderCard('en', { household: null, members: [] });
		expect(noHousehold).toContain('Not in a household yet');
		expect(noHousehold).toContain('Choose / link a household');
		expect(noHousehold).not.toMatch(/[฀-๿]/);

		const bare = renderCard('en', {
			household: {
				...household,
				housing_type: null,
				address_no: null,
				village_no: null,
				subdistrict: null,
				district: null,
				province: null,
				postal_code: null
			},
			members: []
		});
		expect(bare).toContain('No stored address');
		expect(bare).toContain('No members in this household');
		expect(bare).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const body = renderCard('th');
		expect(body).toContain('ครัวเรือน / ครอบครัว');
		expect(body).toContain('แก้ไขสังกัดครัวเรือน');
		expect(body).toContain('ชื่อครัวเรือน');
		expect(body).toContain('เช็คอินแล้ว');
		expect(body).toContain('บทบาท: หัวหน้า');
		expect(body).toContain('ประเภทที่อยู่อาศัย');
		expect(body).toContain('บ้านของตนเอง');
		expect(body).toContain('เขต 5');
		expect(body).toContain('ชุมชน Green Park');
		expect(body).toContain('12 Moo 3 ต.Bang Rak อ.Muang จ.Chiang Mai 50000');
		expect(body).toContain('รายชื่อสมาชิก (2 คน)');
		expect(body).toContain('กำลังดู');
		expect(body).toContain('อายุ 12 ปี');
		expect(body).toContain('โซน A');
		expect(body).toContain('ดูโปรไฟล์');
	});
});
