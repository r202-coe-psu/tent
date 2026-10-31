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
const STAFF_QR = `TKT-STF-HASH-${'a'.repeat(64)}`;

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
		resolveStaffCard: vi.fn().mockResolvedValue({
			kind: 'staff',
			recipient_id: 'user:somchai',
			display_name: 'สมชาย เจ้าหน้าที่',
			role_label: 'เจ้าหน้าที่แจกจ่าย',
			position: 'หัวหน้าเวร'
		}),
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

	it('resolves a staff card QR on the server and selects the staff member, with no other lookup', async () => {
		const d = deps();
		const result = await resolveScannedRecipient(
			STAFF_QR,
			{ allowVolunteer: true, allowStaff: true },
			d
		);

		expect(result).toEqual({
			kind: 'staff_card',
			selection: {
				recipientType: 'staff',
				recipientId: 'user:somchai',
				label: 'สมชาย เจ้าหน้าที่',
				roleLabel: 'เจ้าหน้าที่แจกจ่าย',
				position: 'หัวหน้าเวร'
			}
		});
		expect(d.resolveStaffCard).toHaveBeenCalledWith(STAFF_QR);
		expect(d.lookupEvacuee).not.toHaveBeenCalled();
		expect(d.lookupVolunteer).not.toHaveBeenCalled();
	});

	it('refuses a staff card where staff cannot be picked, without any lookup', async () => {
		const d = deps();
		const result = await resolveScannedRecipient(
			STAFF_QR,
			{ allowVolunteer: true, allowStaff: false },
			d
		);

		expect(result.kind).toBe('error');
		expect(d.resolveStaffCard).not.toHaveBeenCalled();
		expect(d.lookupVolunteer).not.toHaveBeenCalled();
		expect(d.lookupEvacuee).not.toHaveBeenCalled();
	});

	it('selects the linked volunteer when the server resolves the staff card to one, without a volunteer lookup', async () => {
		const d = deps({
			resolveStaffCard: vi.fn().mockResolvedValue({
				kind: 'volunteer',
				recipient_id: 'volunteer:01J00000000000000000000001',
				display_name: 'สมหญิง อาสา',
				role_label: 'เจ้าหน้าที่แจกจ่าย'
			})
		});
		const result = await resolveScannedRecipient(
			STAFF_QR,
			{ allowVolunteer: true, allowStaff: true },
			d
		);

		expect(result).toEqual({
			kind: 'staff_card',
			selection: {
				recipientType: 'volunteer',
				recipientId: 'volunteer:01J00000000000000000000001',
				label: 'สมหญิง อาสา'
			}
		});
		expect(d.lookupVolunteer).not.toHaveBeenCalled();
	});

	it("reports the server's message when the staff card cannot be resolved", async () => {
		const d = deps({
			resolveStaffCard: vi.fn().mockRejectedValue(new Error('ไม่พบบัตรเจ้าหน้าที่นี้'))
		});
		const result = await resolveScannedRecipient(
			STAFF_QR,
			{ allowVolunteer: true, allowStaff: true },
			d
		);

		expect(result).toEqual({ kind: 'error', message: 'ไม่พบบัตรเจ้าหน้าที่นี้' });
	});

	it('falls back to a generic Thai message when the rejection carries none', async () => {
		const d = deps({ resolveStaffCard: vi.fn().mockRejectedValue(undefined) });
		const result = await resolveScannedRecipient(
			STAFF_QR,
			{ allowVolunteer: true, allowStaff: true },
			d
		);

		expect(result).toMatchObject({
			kind: 'error',
			message: expect.stringContaining('บัตรเจ้าหน้าที่')
		});
	});

	it.each([`TKT-STF-HASH-${'z'.repeat(64)}`, 'tkt-stf-hash-abc', 'TKT-STF-0123'])(
		'rejects a malformed staff card %s without falling through to any lookup',
		async (code) => {
			const d = deps();
			const result = await resolveScannedRecipient(
				code,
				{ allowVolunteer: true, allowStaff: true },
				d
			);

			expect(result).toEqual({ kind: 'error', message: 'QR บัตรเจ้าหน้าที่ไม่ถูกต้อง' });
			expect(d.resolveStaffCard).not.toHaveBeenCalled();
			expect(d.lookupVolunteer).not.toHaveBeenCalled();
			expect(d.lookupEvacuee).not.toHaveBeenCalled();
		}
	);

	it('accepts a lowercase staff card payload', async () => {
		const d = deps();
		const code = STAFF_QR.toLowerCase();
		const result = await resolveScannedRecipient(
			code,
			{ allowVolunteer: true, allowStaff: true },
			d
		);

		expect(result.kind).toBe('staff_card');
		expect(d.resolveStaffCard).toHaveBeenCalledWith(code);
	});

	it('reports an error when no staff card resolver is available', async () => {
		const withoutResolver = deps({ resolveStaffCard: undefined });
		const result = await resolveScannedRecipient(
			STAFF_QR,
			{ allowVolunteer: true, allowStaff: true },
			withoutResolver
		);

		expect(result.kind).toBe('error');
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

	it('rejects a bulk-return pool QR without any lookup', async () => {
		const d = deps();
		const result = await resolveScannedRecipient(
			'bulk_return_pool:01J00000000000000000000001',
			{ allowVolunteer: true },
			d
		);

		expect(result).toEqual({
			kind: 'error',
			message: 'นี่คือ QR ของกองรับคืน กรุณาสแกน QR ผู้คืน'
		});
		expect(d.lookupVolunteer).not.toHaveBeenCalled();
		expect(d.lookupEvacuee).not.toHaveBeenCalled();
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
