import type { Evacuee } from '$lib/features/people';

/** Minimal valid evacuee for export tests; override what a case cares about. */
export function fakeEvacuee(id: string, over: Partial<Evacuee> = {}): Evacuee {
	return {
		_id: `evacuee:${id}`,
		type: 'evacuee',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-11-01T00:00:00.000Z',
		updated_at: '2026-11-01T00:00:00.000Z',
		created_by: 'test',
		first_name: id,
		last_name: 'Doe',
		gender: null,
		phone: null,
		country: 'MYANMAR',
		vulnerable_groups: [],
		special_needs: [],
		household_id: null,
		current_stay: { status: 'active', zone: null, since: '2026-11-02T03:05:00.000Z' },
		privacy: { search_excluded: false },
		registered_via: 'staff',
		...over
	} as Evacuee;
}

/**
 * The mixed roster the export tests share: matching country in different casing /
 * whitespace, another country, THAILAND, every excluded status, anonymized,
 * search_excluded, consent basic, religion other, vulnerable groups, special needs and
 * missing birth year / age.
 */
export function mixedRoster(): Evacuee[] {
	return [
		fakeEvacuee('Zaw', {
			last_name: 'Min',
			gender: 'male',
			birth_year: 2530,
			age: 43,
			country: ' myanmar ',
			person_id: { cardType: 'passport', number: 'MA0123456' },
			phone: '0812345678',
			current_stay: { status: 'active', zone: 'z1', since: '2026-11-02T03:05:00.000Z' },
			emergency_contact: { name: 'Aye Min', phone: '0899999999', relation: 'ภรรยา' },
			religion: 'buddhist',
			vulnerable_groups: ['bedridden', 'disability_other'],
			disability_other_detail: 'ใช้ไม้เท้า',
			special_needs: ['อาหารเจ', 'ยาประจำตัว']
		}),
		fakeEvacuee('Aung', {
			last_name: 'Kyaw',
			gender: 'female',
			age: 30,
			country: 'MYANMAR',
			person_id: { cardType: 'anonymous', number: 'ANON-1' },
			current_stay: { status: 'checked_out', zone: null, since: '2026-11-03T17:30:00.000Z' },
			religion: 'other',
			religion_other: 'ผี',
			privacy: { search_excluded: true },
			consent: { mode: 'basic' } as never
		}),
		fakeEvacuee('Aung', {
			last_name: 'Aye',
			country: 'Myanmar',
			current_stay: { status: 'deceased', zone: 'z9', since: '2026-11-04T00:00:00.000Z' }
		}),
		fakeEvacuee('Hla', {
			country: 'MYANMAR',
			current_stay: { status: 'transferred', zone: null, since: 'bad' }
		}),
		fakeEvacuee('PreReg', {
			current_stay: { status: 'pre_registered', zone: null, since: '2026-11-01T00:00:00.000Z' }
		}),
		fakeEvacuee('Kiosk', {
			current_stay: { status: 'kiosk_registered', zone: null, since: '2026-11-01T00:00:00.000Z' }
		}),
		fakeEvacuee('Cancelled', {
			current_stay: { status: 'cancelled', zone: null, since: '2026-11-01T00:00:00.000Z' }
		}),
		fakeEvacuee('Purged', { anonymized: true }),
		fakeEvacuee('Somchai', { country: 'THAILAND' }),
		fakeEvacuee('John', { country: 'LAOS' })
	];
}
