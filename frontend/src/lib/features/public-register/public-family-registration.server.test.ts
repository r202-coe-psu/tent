import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	executePublicFamilyRegistration,
	PublicRegistrationWriteError
} from './public-family-registration.server';
import { bulkAsPublicWriter, rollbackAsPublicWriter } from '$lib/server/couch-public-writer';
import type { UnifiedRegistrationInput } from '$lib/features/people/server';

vi.mock('$lib/server/couch-public-writer', () => ({
	bulkAsPublicWriter: vi.fn(),
	rollbackAsPublicWriter: vi.fn()
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
		const input = sampleInput();
		const result = await executePublicFamilyRegistration(input, { shelterCode: 'SH001' });

		expect(result.household).toBeDefined();
		expect(result.evacuees).toHaveLength(2);

		// Household checks
		expect(result.household.type).toBe('household');
		expect(result.household.status).toBe('pre_registered');
		expect(result.household.head_evacuee_id).toBe(result.evacuees[0]._id);
		expect(result.household.pets).toEqual([{ species: 'dog', count: 1 }]);
		expect(result.household.vehicles).toEqual([{ type: 'car', license_plate: 'กก 1234' }]);
		expect(result.household.assets?.description).toBe('สร้อยคอทองคำ');

		// Evacuee checks
		for (const evacuee of result.evacuees) {
			expect(evacuee.type).toBe('evacuee');
			expect(evacuee.household_id).toBe(result.household._id);
			expect(evacuee.registered_via).toBe('web');
			expect(evacuee.current_stay.status).toBe('pre_registered');
		}

		// Verify bulk write call
		expect(bulkAsPublicWriter).toHaveBeenCalledTimes(1);
		const [dbName, docs] = vi.mocked(bulkAsPublicWriter).mock.calls[0];
		expect(dbName).toBe('shelter_sh001');
		expect(docs).toHaveLength(3); // 1 household + 2 evacuees
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
