/**
 * Unit tests — executeUnassignedRegistration Mongo executor (#255).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedRegistrationInput } from '$lib/features/people/server';
import {
	executeUnassignedRegistration,
	UnassignedRegistrationWriteError
} from './execute-unassigned-registration.server';

vi.mock('$lib/server/fastapi', () => ({
	fastapiBaseUrl: () => 'http://fastapi.test',
	fastapiServiceHeaders: (extra: Record<string, string> = {}) => ({
		Authorization: 'Bearer secret',
		...extra
	}),
	unwrapFastapiError: (body: Record<string, unknown>) => body
}));

function sampleInput(): UnifiedRegistrationInput {
	return {
		members: [
			{
				first_name: 'สมชาย',
				last_name: 'ใจดี',
				gender: 'male',
				phone: '0812345678',
				nickname: '',
				religion: 'unknown',
				person_id: { cardType: 'national_id', number: '1234567890123' },
				country: 'THAILAND',
				vulnerable_groups: [],
				special_needs: [],
				emergency_contact: { name: '', phone: '', relation: '' },
				photo: null,
				medical_conditions: [],
				medical_allergies: [],
				medical_medications: []
			}
		],
		household: {
			housing_type: 'owned_house',
			residence_landmark: null,
			address_no: '123/45',
			village_no: null,
			subdistrict: 'คอหงส์',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postal_code: '90110',
			pets: [],
			vehicles: [],
			assets: null
		}
	};
}

describe('executeUnassignedRegistration (#255)', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('POSTs mapped UnifiedRegistrationInput to FastAPI with Bearer', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({
				success: true,
				id: '01HTEST',
				schema_v: 2,
				reserved_household_id: 'household:01H',
				members: [{ reserved_evacuee_id: 'evacuee:01H', status: 'open', first_name: 'สมชาย', last_name: 'ใจดี' }],
				registered_via: 'web',
				status: 'open',
				created_at: '2026-09-09T00:00:00Z'
			})
		});

		const result = await executeUnassignedRegistration(sampleInput(), {
			fetch: fetchMock as unknown as typeof fetch
		});

		expect(result.id).toBe('01HTEST');
		expect(result.schema_v).toBe(2);
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe('http://fastapi.test/public/v1/unassigned-registrations');
		expect(init.method).toBe('POST');
		expect(init.headers.Authorization).toBe('Bearer secret');
		const body = JSON.parse(init.body as string);
		expect(body.registered_via).toBe('web');
		expect(body.members[0].first_name).toBe('สมชาย');
		expect(body.members[0].emergency_contact).toBeUndefined();
		expect(body.household.address_no).toBe('123/45');
	});

	it('throws UnassignedRegistrationWriteError on upstream failure', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 409,
			json: async () => ({ error: 'DUPLICATE_OPEN_IDENTITY' })
		});

		await expect(
			executeUnassignedRegistration(sampleInput(), {
				fetch: fetchMock as unknown as typeof fetch
			})
		).rejects.toBeInstanceOf(UnassignedRegistrationWriteError);
	});
});
