import { describe, expect, it, vi } from 'vitest';
import type { Evacuee } from '$lib/features/people';
import type { Volunteer } from '$lib/features/volunteers';
import {
	resolveScannedRecipient,
	searchVolunteers,
	toVolunteerSelection,
	type RecipientScanDeps
} from './recipient-scan';

const PASS_URL = 'https://shelter.example/volunteer/ticket/TKT-VOL-ABC123';

function volunteer(overrides: Partial<Volunteer> = {}): Volunteer {
	return {
		_id: 'volunteer:01J00000000000000000000001',
		first_name: 'สมหญิง',
		last_name: 'อาสา',
		nickname: null,
		phone: '0812345678',
		volunteer_code: 'V-001',
		status: 'active',
		...overrides
	} as Volunteer;
}

const evacuee = { _id: 'evacuee:01J00000000000000000000001' } as Evacuee;

function deps(overrides: Partial<RecipientScanDeps> = {}): RecipientScanDeps {
	return {
		lookupEvacuee: vi.fn().mockResolvedValue(evacuee),
		lookupVolunteer: vi.fn().mockResolvedValue(volunteer()),
		...overrides
	};
}

describe('resolveScannedRecipient', () => {
	it('routes a volunteer pass QR to the volunteer lookup only', async () => {
		const d = deps();
		const result = await resolveScannedRecipient(PASS_URL, { allowVolunteer: true }, d);

		expect(result).toEqual({ kind: 'volunteer', volunteer: volunteer() });
		expect(d.lookupVolunteer).toHaveBeenCalledWith(PASS_URL);
		expect(d.lookupEvacuee).not.toHaveBeenCalled();
	});

	it('routes an evacuee card to the evacuee lookup', async () => {
		const d = deps();
		const result = await resolveScannedRecipient('evacuee:01JX', { allowVolunteer: true }, d);

		expect(result).toEqual({ kind: 'evacuee', evacuee });
		expect(d.lookupVolunteer).not.toHaveBeenCalled();
	});

	it('refuses a volunteer QR where volunteers cannot be picked, without a lookup', async () => {
		const d = deps();
		const result = await resolveScannedRecipient(PASS_URL, { allowVolunteer: false }, d);

		expect(result.kind).toBe('error');
		expect(d.lookupVolunteer).not.toHaveBeenCalled();
		expect(d.lookupEvacuee).not.toHaveBeenCalled();
	});

	it('reports an unknown volunteer pass', async () => {
		const d = deps({ lookupVolunteer: vi.fn().mockResolvedValue(null) });
		const result = await resolveScannedRecipient(PASS_URL, { allowVolunteer: true }, d);

		expect(result).toMatchObject({
			kind: 'error',
			message: expect.stringContaining('ไม่พบจิตอาสา')
		});
	});

	it('rejects a soft-deleted (inactive) volunteer profile', async () => {
		const d = deps({
			lookupVolunteer: vi.fn().mockResolvedValue(volunteer({ status: 'inactive' }))
		});
		const result = await resolveScannedRecipient(PASS_URL, { allowVolunteer: true }, d);

		expect(result).toMatchObject({ kind: 'error', message: expect.stringContaining('ปิดใช้งาน') });
	});

	it('reports an unknown evacuee card', async () => {
		const d = deps({ lookupEvacuee: vi.fn().mockResolvedValue(null) });
		const result = await resolveScannedRecipient('01JX', { allowVolunteer: true }, d);

		expect(result).toMatchObject({
			kind: 'error',
			message: expect.stringContaining('ไม่พบผู้ประสบภัย')
		});
	});
});

describe('toVolunteerSelection', () => {
	it('builds a volunteer recipient keyed by the volunteer doc id', () => {
		expect(toVolunteerSelection(volunteer({ nickname: 'หญิง' }))).toEqual({
			recipientType: 'volunteer',
			recipientId: 'volunteer:01J00000000000000000000001',
			label: 'สมหญิง อาสา (หญิง)',
			phone: '0812345678',
			volunteerCode: 'V-001'
		});
	});
});

describe('searchVolunteers', () => {
	const list = [
		volunteer(),
		volunteer({
			_id: 'volunteer:2',
			first_name: 'มานะ',
			volunteer_code: 'V-002',
			phone: '0899999999'
		})
	];

	it('matches name, code and phone case-insensitively', () => {
		expect(searchVolunteers(list, 'มานะ').map((v) => v._id)).toEqual(['volunteer:2']);
		expect(searchVolunteers(list, 'v-001').map((v) => v._id)).toEqual([
			'volunteer:01J00000000000000000000001'
		]);
		expect(searchVolunteers(list, '0899').map((v) => v._id)).toEqual(['volunteer:2']);
	});

	it('returns nothing for a blank term and honours the limit', () => {
		expect(searchVolunteers(list, '  ')).toEqual([]);
		expect(searchVolunteers(list, 'อาสา', 1)).toHaveLength(1);
	});
});
