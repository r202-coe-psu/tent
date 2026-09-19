import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	executePublicFamilyRegistration,
	PublicRegistrationWriteError
} from './public-family-registration.server';
import { bulkAsPublicWriter, rollbackAsPublicWriter } from '$lib/server/couch-public-writer';
import { adminRaw } from '$lib/server/couch-admin';
import type { UnifiedRegistrationInput } from '$lib/features/people/server';

vi.mock('$lib/server/couch-public-writer', () => ({
	bulkAsPublicWriter: vi.fn(),
	rollbackAsPublicWriter: vi.fn()
}));

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

function sampleInput(over: Partial<UnifiedRegistrationInput> = {}): UnifiedRegistrationInput {
	return {
		members: [
			{
				first_name: 'สมชาย',
				last_name: 'ใจดี',
				gender: 'male',
				phone: '0812345678',
				nickname: 'ชาย',
				country: 'THAILAND',
				religion: 'buddhist',
				person_id: { cardType: 'national_id', number: '1234567890123' },
				vulnerable_groups: [],
				special_needs: [],
				medical_conditions: [],
				medical_allergies: [],
				medical_medications: [],
				emergency_contact: { name: 'สมหญิง', phone: '0899999999', relation: 'คู่สมรส' },
				photo: null
			},
			{
				first_name: 'สมหญิง',
				last_name: 'ใจดี',
				gender: 'female',
				phone: '0899999999',
				nickname: 'หญิง',
				country: 'THAILAND',
				religion: 'buddhist',
				person_id: { cardType: 'national_id', number: '1234567890124' },
				vulnerable_groups: [],
				special_needs: [],
				medical_conditions: [],
				medical_allergies: [],
				medical_medications: [],
				emergency_contact: undefined,
				photo: null
			}
		],
		household: {
			housing_type: 'owned_house',
			residence_landmark: null,
			address_no: '123/45',
			village_no: '4',
			subdistrict: 'คอหงส์',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postal_code: '90110',
			pets: [{ species: 'dog', count: 1 }],
			vehicles: [{ type: 'car', license_plate: 'กก 1234' }],
			assets: { description: 'สร้อยคอทองคำ', image_url: null }
		},
		...over
	};
}

describe('executePublicFamilyRegistration (#254)', () => {
	beforeEach(() => {
		vi.mocked(bulkAsPublicWriter).mockReset();
		vi.mocked(rollbackAsPublicWriter).mockReset();
		vi.mocked(adminRaw).mockReset();
		vi.mocked(bulkAsPublicWriter).mockResolvedValue({
			status: 201,
			failed: [],
			written: [
				{ id: 'household:H1', rev: '1-a' },
				{ id: 'evacuee:E1', rev: '1-b' },
				{ id: 'evacuee:E2', rev: '1-c' }
			]
		});
		vi.mocked(rollbackAsPublicWriter).mockResolvedValue({
			rolledBack: ['evacuee:E1'],
			orphaned: []
		});
	});

	it('creates 1 Household and N Evacuees at pre_registered and registered_via web', async () => {
		const input = sampleInput({
			members: [
				{
					...sampleInput().members[0]!,
					photo: 'image:01ARZ3NDEKTSV4RRFFQ69G5FAV'
				},
				sampleInput().members[1]!
			],
			household: {
				...sampleInput().household!,
				pets: [
					{
						species: 'dog',
						count: 1,
						image_url: 'image:01BX5ZZKBKACTAV9WEVGEMMVRZ'
					}
				]
			}
		});
		const result = await executePublicFamilyRegistration(input, { shelterCode: 'SH001' });

		expect(result.household).toBeDefined();
		expect(result.evacuees).toHaveLength(2);

		expect(result.household.type).toBe('household');
		expect(result.household.status).toBe('pre_registered');
		expect(result.household.head_evacuee_id).toBe(result.evacuees[0]._id);
		expect(result.household.pets).toEqual([
			{ species: 'dog', count: 1, image_url: 'image:01BX5ZZKBKACTAV9WEVGEMMVRZ' }
		]);
		expect(result.household.vehicles).toEqual([{ type: 'car', license_plate: 'กก 1234' }]);
		expect(result.household.assets?.description).toBe('สร้อยคอทองคำ');

		expect(result.evacuees[0].photo).toBe('image:01ARZ3NDEKTSV4RRFFQ69G5FAV');
		for (const evacuee of result.evacuees) {
			expect(evacuee.type).toBe('evacuee');
			expect(evacuee.household_id).toBe(result.household._id);
			expect(evacuee.registered_via).toBe('web');
			expect(evacuee.current_stay.status).toBe('pre_registered');
		}

		expect(bulkAsPublicWriter).toHaveBeenCalledTimes(1);
		const [dbName, docs] = vi.mocked(bulkAsPublicWriter).mock.calls[0]!;
		expect(dbName).toBe('shelter_sh001');
		expect(docs).toHaveLength(3);
	});

	it('joins an existing Household without minting a new Household or changing head', async () => {
		vi.mocked(adminRaw).mockResolvedValueOnce({
			status: 200,
			data: {
				_id: 'household:existing',
				_rev: '3-xyz',
				type: 'household',
				label: 'ครอบครัวเดิม',
				head_evacuee_id: 'evacuee:head',
				status: 'pre_registered',
				address_no: '123/45',
				subdistrict: 'คอหงส์',
				district: 'หาดใหญ่',
				province: 'สงขลา',
				pets: [{ species: 'cat', count: 1 }],
				vehicles: [],
				assets: null
			}
		});
		vi.mocked(bulkAsPublicWriter).mockResolvedValueOnce({
			status: 201,
			failed: [],
			written: [
				{ id: 'evacuee:E1', rev: '1-b' },
				{ id: 'evacuee:E2', rev: '1-c' },
				{ id: 'household:existing', rev: '4-abc' }
			]
		});

		const result = await executePublicFamilyRegistration(
			sampleInput({ join_household_id: 'household:existing' }),
			{ shelterCode: 'SH001' }
		);

		expect(result.household._id).toBe('household:existing');
		expect(result.household.head_evacuee_id).toBe('evacuee:head');
		expect(result.household.address_no).toBe('123/45');
		expect(result.evacuees.every((e) => e.household_id === 'household:existing')).toBe(true);
		expect(result.household.pets).toEqual([
			{ species: 'cat', count: 1 },
			{ species: 'dog', count: 1 }
		]);

		const [, docs] = vi.mocked(bulkAsPublicWriter).mock.calls[0]!;
		const typed = docs as Array<{ _id: string; type?: string }>;
		expect(typed.some((d) => d.type === 'household' && d._id === 'household:existing')).toBe(true);
		expect(typed.filter((d) => d.type === 'evacuee')).toHaveLength(2);
		expect(typed.filter((d) => d.type === 'household')).toHaveLength(1);
	});

	it('triggers rollbackAsPublicWriter and throws PublicRegistrationWriteError on partial failure', async () => {
		vi.mocked(bulkAsPublicWriter).mockResolvedValueOnce({
			status: 201,
			failed: [{ id: 'evacuee:E2', reason: 'conflict' }],
			written: [
				{ id: 'household:H1', rev: '1-a' },
				{ id: 'evacuee:E1', rev: '1-b' }
			]
		});

		const input = sampleInput();
		await expect(executePublicFamilyRegistration(input, { shelterCode: 'SH001' })).rejects.toThrow(
			PublicRegistrationWriteError
		);

		expect(rollbackAsPublicWriter).toHaveBeenCalledWith('shelter_sh001', [
			{ id: 'household:H1', rev: '1-a' },
			{ id: 'evacuee:E1', rev: '1-b' }
		]);
	});
});
