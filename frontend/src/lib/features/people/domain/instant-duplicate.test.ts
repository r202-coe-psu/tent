import { describe, expect, it, vi } from 'vitest';
import {
	isValidThaiIdCandidate,
	isValidPhoneCandidate,
	checkPublicDuplicate,
	resolveInstantDuplicateAction,
	performFederatedDuplicateLookup
} from './instant-duplicate';
import type { Evacuee } from './people';
import type { UnassignedRegistrationSearchHit } from '$lib/features/unassigned-registration';

describe('Instant ThaiID Duplicate Check (#389)', () => {
	describe('isValidThaiIdCandidate', () => {
		it('accepts 13 numeric digits for national_id card type', () => {
			expect(isValidThaiIdCandidate('1234567890123', 'national_id')).toBe(true);
		});

		it('accepts 13 numeric digits when cardType is undefined/null (default national_id)', () => {
			expect(isValidThaiIdCandidate('1234567890123')).toBe(true);
			expect(isValidThaiIdCandidate('1234567890123', null)).toBe(true);
		});

		it('accepts 13 digits formatted with dashes or spaces', () => {
			expect(isValidThaiIdCandidate('1-2345-67890-12-3', 'national_id')).toBe(true);
			expect(isValidThaiIdCandidate('1 2345 67890 12 3', 'national_id')).toBe(true);
		});

		it('rejects anonymous IDs (ANON-*)', () => {
			expect(isValidThaiIdCandidate('ANON-01JA7X2M4R', 'national_id')).toBe(false);
			expect(isValidThaiIdCandidate('ANON-1234567890', 'anonymous')).toBe(false);
		});

		it('rejects card types other than national_id', () => {
			expect(isValidThaiIdCandidate('1234567890123', 'passport')).toBe(false);
			expect(isValidThaiIdCandidate('1234567890123', 'pink_card')).toBe(false);
			expect(isValidThaiIdCandidate('1234567890123', 'other')).toBe(false);
		});

		it('rejects numbers that do not have exactly 13 digits', () => {
			expect(isValidThaiIdCandidate('123456789012', 'national_id')).toBe(false); // 12 digits
			expect(isValidThaiIdCandidate('12345678901234', 'national_id')).toBe(false); // 14 digits
			expect(isValidThaiIdCandidate('', 'national_id')).toBe(false);
			expect(isValidThaiIdCandidate(null, 'national_id')).toBe(false);
			expect(isValidThaiIdCandidate(undefined, 'national_id')).toBe(false);
			expect(isValidThaiIdCandidate('abcdefghijklm', 'national_id')).toBe(false);
		});
	});

	describe('resolveInstantDuplicateAction', () => {
		it('routes local pre_registered hit to report-in flow', () => {
			const action = resolveInstantDuplicateAction({
				source: 'local',
				id: 'evacuee-1',
				status: 'pre_registered'
			});
			expect(action.actionUrl).toBe('/onsite/people/evacuee-1/report-in');
			expect(action.actionLabel).toBe('ไปที่ข้อมูลเดิม / เช็คอิน');
		});

		it('routes other local stay statuses to evacuee-profile-view', () => {
			const actionActive = resolveInstantDuplicateAction({
				source: 'local',
				id: 'evacuee-2',
				status: 'active'
			});
			expect(actionActive.actionUrl).toBe('/onsite/people/evacuee-profile-view/evacuee-2');

			const actionCheckedOut = resolveInstantDuplicateAction({
				source: 'local',
				id: 'evacuee-3',
				status: 'checked_out'
			});
			expect(actionCheckedOut.actionUrl).toBe('/onsite/people/evacuee-profile-view/evacuee-3');
		});

		it('routes unassigned pool hit to unassigned report-in page with memberIds', () => {
			const action = resolveInstantDuplicateAction({
				source: 'unassigned',
				id: 'reg-pool-1',
				status: 'unassigned_open',
				memberIds: ['mem-1', 'mem-2']
			});
			expect(action.actionUrl).toBe(
				'/onsite/unassigned/reg-pool-1/report-in?memberIds=mem-1,mem-2'
			);
			expect(action.actionLabel).toBe('ไปที่ข้อมูลเดิม / เช็คอิน');
		});
	});

	describe('performFederatedDuplicateLookup', () => {
		const mockEvacuee: Evacuee = {
			_id: 'evacuee:test1',
			_rev: '1-abc',
			type: 'evacuee',
			schema_v: 9,
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			nickname: 'ชาย',
			gender: 'male',
			phone: '0812345678',
			person_id: { cardType: 'national_id', number: '1234567890123' },
			country: 'THAILAND',
			vulnerable_groups: [],
			special_needs: [],
			current_stay: {
				status: 'pre_registered',
				zone: null,
				since: '2026-10-09T00:00:00Z'
			},
			privacy: { search_excluded: false },
			registered_via: 'staff',
			household_id: 'hh:test1',
			shelter_code: 'SH001',
			created_at: '2026-10-09T00:00:00Z',
			created_by: 'staff-1',
			updated_at: '2026-10-09T00:00:00Z'
		};

		const mockPoolHit: UnassignedRegistrationSearchHit = {
			id: 'pool:test1',
			reserved_household_id: 'hh:pool1',
			registered_via: 'web',
			status: 'open',
			created_at: '2026-10-09T00:00:00Z',
			open_members: [
				{
					reserved_evacuee_id: 'evacuee:reserved1',
					status: 'open',
					first_name: 'สมหญิง',
					last_name: 'รักดี',
					gender: 'female',
					phone: '0812345678',
					country: 'THAILAND',
					vulnerable_groups: [],
					special_needs: [],
					person_id: { cardType: 'national_id', number: '1234567890123' }
				}
			]
		};

		it('returns matches when both local shelter and unassigned pool have hits', async () => {
			const searchLocal = vi.fn().mockResolvedValue(new Map([['1234567890123', [mockEvacuee]]]));
			const searchPool = vi.fn().mockResolvedValue({ results: [mockPoolHit] });

			const results = await performFederatedDuplicateLookup('1234567890123', {
				searchLocal,
				searchPool
			});

			expect(searchLocal).toHaveBeenCalledWith('1234567890123');
			expect(searchPool).toHaveBeenCalledWith('1234567890123');
			expect(results).toHaveLength(2);

			expect(results[0].source).toBe('local');
			expect(results[0].name).toContain('สมชาย');
			expect(results[0].actionUrl).toBe('/onsite/people/evacuee:test1/report-in');

			expect(results[1].source).toBe('unassigned');
			expect(results[1].name).toContain('สมหญิง');
			expect(results[1].actionUrl).toContain('/onsite/unassigned/pool:test1/report-in');
		});

		it('gracefully handles pool error/rejection without failing local check', async () => {
			const searchLocal = vi.fn().mockResolvedValue(new Map([['1234567890123', [mockEvacuee]]]));
			const searchPool = vi.fn().mockRejectedValue(new Error('Network error / 500'));

			const results = await performFederatedDuplicateLookup('1234567890123', {
				searchLocal,
				searchPool
			});

			expect(results).toHaveLength(1);
			expect(results[0].source).toBe('local');
			expect(results[0].name).toContain('สมชาย');
		});

		it('gracefully handles local error/rejection without failing pool check', async () => {
			const searchLocal = vi.fn().mockRejectedValue(new Error('CouchDB offline'));
			const searchPool = vi.fn().mockResolvedValue({ results: [mockPoolHit] });

			const results = await performFederatedDuplicateLookup('1234567890123', {
				searchLocal,
				searchPool
			});

			expect(results).toHaveLength(1);
			expect(results[0].source).toBe('unassigned');
			expect(results[0].name).toContain('สมหญิง');
		});

		it('returns empty array if both fail without throwing an unhandled rejection', async () => {
			const searchLocal = vi.fn().mockRejectedValue(new Error('CouchDB offline'));
			const searchPool = vi.fn().mockRejectedValue(new Error('Mongo offline'));

			const results = await performFederatedDuplicateLookup('1234567890123', {
				searchLocal,
				searchPool
			});

			expect(results).toEqual([]);
		});

		it('returns empty array if input does not have 13 digits', async () => {
			const searchLocal = vi.fn();
			const searchPool = vi.fn();

			const results = await performFederatedDuplicateLookup('123', {
				searchLocal,
				searchPool
			});

			expect(results).toEqual([]);
			expect(searchLocal).not.toHaveBeenCalled();
			expect(searchPool).not.toHaveBeenCalled();
		});
	});

	describe('isValidPhoneCandidate', () => {
		it('accepts 10-digit mobile numbers starting with 0', () => {
			expect(isValidPhoneCandidate('0812345678')).toBe(true);
			expect(isValidPhoneCandidate('091-234-5678')).toBe(true);
			expect(isValidPhoneCandidate('061 234 5678')).toBe(true);
		});

		it('accepts 9-digit landline numbers starting with 0', () => {
			expect(isValidPhoneCandidate('021234567')).toBe(true);
			expect(isValidPhoneCandidate('02-123-4567')).toBe(true);
		});

		it('rejects numbers not starting with 0', () => {
			expect(isValidPhoneCandidate('1812345678')).toBe(false);
			expect(isValidPhoneCandidate('812345678')).toBe(false);
		});

		it('rejects empty, short, or overly long phone strings', () => {
			expect(isValidPhoneCandidate('')).toBe(false);
			expect(isValidPhoneCandidate(null)).toBe(false);
			expect(isValidPhoneCandidate('08123456')).toBe(false); // 8 digits
			expect(isValidPhoneCandidate('081234567890')).toBe(false); // 12 digits
		});
	});

	describe('checkPublicDuplicate', () => {
		it('returns duplicate result from public endpoint', async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ success: true, duplicate: true, field: 'phone' })
			} as unknown as Response);

			const result = await checkPublicDuplicate({ phone: '0812345678' }, mockFetch);
			expect(result).toEqual({ duplicate: true, field: 'phone' });
			expect(mockFetch).toHaveBeenCalledWith(
				'/api/public/v1/registrations/check-duplicate',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ phone: '0812345678' })
				})
			);
		});

		it('gracefully handles network error and returns false', async () => {
			const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
			const result = await checkPublicDuplicate({ national_id: '1234567890123' }, mockFetch);
			expect(result).toEqual({ duplicate: false, field: null });
		});
	});
});
