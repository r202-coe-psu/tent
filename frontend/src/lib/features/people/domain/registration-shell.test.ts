import { describe, expect, it } from 'vitest';
import {
	autoHouseholdLabel,
	defaultHouseholdChoice,
	hasMinimumResidence,
	isLeavingLinkedHousehold,
	matchesResidenceAddress,
	resolveHouseholdLeave,
	sectionEVisibility,
	suggestHouseholdsByResidence,
	filterJoinCandidatesByEvacueeQuery
} from './registration-shell';

describe('autoHouseholdLabel', () => {
	it('prefixes the registrant name with ครอบครัว', () => {
		expect(autoHouseholdLabel('สมศรี มีสุข')).toBe('ครอบครัวสมศรี มีสุข');
	});

	it('trims whitespace around the name', () => {
		expect(autoHouseholdLabel('  สมชาย  ')).toBe('ครอบครัวสมชาย');
	});
});

describe('hasMinimumResidence', () => {
	it('requires address_no, province, district, and subdistrict', () => {
		expect(
			hasMinimumResidence({
				address_no: '123/45',
				province: 'สงขลา',
				district: 'หาดใหญ่',
				subdistrict: 'คลองแห'
			})
		).toBe(true);
	});

	it('rejects when any required Residence field is missing or blank', () => {
		expect(
			hasMinimumResidence({
				address_no: '123',
				province: 'สงขลา',
				district: 'หาดใหญ่',
				subdistrict: '  '
			})
		).toBe(false);
		expect(
			hasMinimumResidence({
				address_no: null,
				province: 'สงขลา',
				district: 'หาดใหญ่',
				subdistrict: 'คลองแห'
			})
		).toBe(false);
	});

	it('allows optional village_no and postal_code to be absent', () => {
		expect(
			hasMinimumResidence({
				address_no: '99',
				province: 'กรุงเทพมหานคร',
				district: 'บางรัก',
				subdistrict: 'สีลม',
				village_no: null,
				postal_code: null
			})
		).toBe(true);
	});
});

describe('defaultHouseholdChoice / isLeavingLinkedHousehold', () => {
	it('defaults to create when unlinked and keep when linked', () => {
		expect(defaultHouseholdChoice(false)).toBe('create');
		expect(defaultHouseholdChoice(true)).toBe('keep');
	});

	it('treats create and join as leaving when previously linked', () => {
		expect(isLeavingLinkedHousehold(true, 'create')).toBe(true);
		expect(isLeavingLinkedHousehold(true, 'join')).toBe(true);
		expect(isLeavingLinkedHousehold(true, 'keep')).toBe(false);
		expect(isLeavingLinkedHousehold(true, 'change_residence')).toBe(false);
		expect(isLeavingLinkedHousehold(false, 'create')).toBe(false);
	});
});

describe('matchesResidenceAddress / suggestHouseholdsByResidence', () => {
	const query = {
		address_no: '123/45',
		village_no: 'หมู่ 2',
		subdistrict: 'คลองแห',
		district: 'หาดใหญ่',
		province: 'สงขลา'
	};

	it('matches when house no, village (when present), subdistrict, district, and province align', () => {
		expect(
			matchesResidenceAddress(query, {
				address_no: '123/45',
				village_no: 'หมู่ 2',
				subdistrict: 'คลองแห',
				district: 'หาดใหญ่',
				province: 'สงขลา',
				postal_code: '90110'
			})
		).toBe(true);
	});

	it('does not match when village_no is present on query but differs', () => {
		expect(
			matchesResidenceAddress(query, {
				...query,
				village_no: 'หมู่ 9'
			})
		).toBe(false);
	});

	it('ignores village_no when the query omits it', () => {
		expect(
			matchesResidenceAddress({ ...query, village_no: null }, { ...query, village_no: 'หมู่ 2' })
		).toBe(true);
	});

	it('suggests matching households only when minimum Residence is present', () => {
		const households = [
			{
				_id: 'household:1',
				label: 'ครอบครัวสมศรี',
				address_no: '123/45',
				village_no: 'หมู่ 2',
				subdistrict: 'คลองแห',
				district: 'หาดใหญ่',
				province: 'สงขลา'
			},
			{
				_id: 'household:2',
				label: 'ครอบครัวอื่น',
				address_no: '999',
				village_no: null,
				subdistrict: 'คลองแห',
				district: 'หาดใหญ่',
				province: 'สงขลา'
			}
		];
		expect(suggestHouseholdsByResidence({ address_no: '123' }, households)).toEqual([]);
		expect(suggestHouseholdsByResidence(query, households).map((h) => h._id)).toEqual([
			'household:1'
		]);
	});
});

describe('filterJoinCandidatesByEvacueeQuery', () => {
	const evacuees = [
		{
			_id: 'evacuee:1',
			first_name: 'สมศรี',
			last_name: 'มีสุข',
			phone: '0812345678',
			household_id: 'household:1',
			current_stay: { status: 'pre_registered' as const }
		},
		{
			_id: 'evacuee:2',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			phone: '0899999999',
			household_id: null,
			current_stay: { status: 'arriving' as const }
		},
		{
			_id: 'evacuee:3',
			first_name: 'สมปอง',
			last_name: 'รักดี',
			phone: '0811111111',
			household_id: 'household:2',
			current_stay: { status: 'active' as const }
		}
	];

	it('returns only shelter evacuees that already have a household_id', () => {
		const hits = filterJoinCandidatesByEvacueeQuery('สม', evacuees);
		expect(hits.map((e) => e._id).sort()).toEqual(['evacuee:1', 'evacuee:3']);
	});

	it('matches by phone digits and includes any stay status', () => {
		const hits = filterJoinCandidatesByEvacueeQuery('081234', evacuees);
		expect(hits.map((e) => e._id)).toEqual(['evacuee:1']);
		expect(hits[0]?.current_stay.status).toBe('pre_registered');
	});

	it('returns empty for blank query', () => {
		expect(filterJoinCandidatesByEvacueeQuery('  ', evacuees)).toEqual([]);
	});
});

describe('sectionEVisibility', () => {
	it('returns editable with nav chip when any allow flag is true', () => {
		expect(
			sectionEVisibility(
				{ allow_pets: true, allow_assets: false, allow_vehicles: false },
				{ pets: [], assets: null, vehicles: [] }
			)
		).toEqual({
			mode: 'editable',
			showNavChip: true,
			allow: { pets: true, assets: false, vehicles: false }
		});
	});

	it('returns hidden when all flags are false and there is no existing data', () => {
		expect(
			sectionEVisibility(
				{ allow_pets: false, allow_assets: false, allow_vehicles: false },
				{ pets: [], assets: null, vehicles: [] }
			)
		).toEqual({
			mode: 'hidden',
			showNavChip: false,
			allow: { pets: false, assets: false, vehicles: false }
		});
	});

	it('returns readonly when all flags are false but existing pets data is present', () => {
		expect(
			sectionEVisibility(
				{ allow_pets: false, allow_assets: false, allow_vehicles: false },
				{ pets: [{ species: 'dog', count: 1 }], assets: null, vehicles: [] }
			)
		).toEqual({
			mode: 'readonly',
			showNavChip: true,
			allow: { pets: false, assets: false, vehicles: false }
		});
	});

	it('returns readonly when only existing assets or vehicles are present', () => {
		expect(
			sectionEVisibility(
				{ allow_pets: false, allow_assets: false, allow_vehicles: false },
				{ pets: [], assets: { description: 'bag', image_url: null }, vehicles: [] }
			).mode
		).toBe('readonly');
		expect(
			sectionEVisibility(
				{ allow_pets: false, allow_assets: false, allow_vehicles: false },
				{ pets: [], assets: null, vehicles: [{ type: 'car', license_plate: '1กก' }] }
			).mode
		).toBe('readonly');
	});

	it('marks only allowed sub-areas editable when some flags are true', () => {
		expect(
			sectionEVisibility(
				{ allow_pets: false, allow_assets: true, allow_vehicles: true },
				{ pets: [], assets: null, vehicles: [] }
			)
		).toEqual({
			mode: 'editable',
			showNavChip: true,
			allow: { pets: false, assets: true, vehicles: true }
		});
	});
});

describe('resolveHouseholdLeave', () => {
	it('requires a new head when subject is head and other members remain', () => {
		expect(
			resolveHouseholdLeave({
				subjectId: 'evacuee:head',
				headId: 'evacuee:head',
				memberIds: ['evacuee:head', 'evacuee:a', 'evacuee:b'],
				newHeadId: null
			})
		).toEqual({ ok: false, reason: 'new_head_required' });
	});

	it('leaves and transfers head atomically when a current member is chosen', () => {
		expect(
			resolveHouseholdLeave({
				subjectId: 'evacuee:head',
				headId: 'evacuee:head',
				memberIds: ['evacuee:head', 'evacuee:a', 'evacuee:b'],
				newHeadId: 'evacuee:a'
			})
		).toEqual({
			ok: true,
			transferHead: true,
			newHeadId: 'evacuee:a',
			dissolvePrior: false
		});
	});

	it('rejects a new head who is not a current household member', () => {
		expect(
			resolveHouseholdLeave({
				subjectId: 'evacuee:head',
				headId: 'evacuee:head',
				memberIds: ['evacuee:head', 'evacuee:a'],
				newHeadId: 'evacuee:outsider'
			})
		).toEqual({ ok: false, reason: 'invalid_new_head' });
	});

	it('rejects choosing the leaving subject as the new head', () => {
		expect(
			resolveHouseholdLeave({
				subjectId: 'evacuee:head',
				headId: 'evacuee:head',
				memberIds: ['evacuee:head', 'evacuee:a'],
				newHeadId: 'evacuee:head'
			})
		).toEqual({ ok: false, reason: 'invalid_new_head' });
	});

	it('leaves without head transfer when subject is not the head', () => {
		expect(
			resolveHouseholdLeave({
				subjectId: 'evacuee:member',
				headId: 'evacuee:head',
				memberIds: ['evacuee:head', 'evacuee:member'],
				newHeadId: null
			})
		).toEqual({
			ok: true,
			transferHead: false,
			newHeadId: null,
			dissolvePrior: false
		});
	});

	it('dissolves the prior household when the subject is the last member', () => {
		expect(
			resolveHouseholdLeave({
				subjectId: 'evacuee:solo',
				headId: 'evacuee:solo',
				memberIds: ['evacuee:solo'],
				newHeadId: null
			})
		).toEqual({
			ok: true,
			transferHead: false,
			newHeadId: null,
			dissolvePrior: true
		});
	});
});
