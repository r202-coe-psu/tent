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
		listQrPrints: vi.fn().mockResolvedValue([]),
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

describe('resolveScannedRecipient handover-slip path (CR-233 W1)', () => {
	const SLIP = `/onsite/medical-screening/${evacuee._id}`;
	const prints = [{ printed_at: '2026-11-08T01:00:00.000Z', hash: 'abcdef' }];

	it('rejects a slip once a Person QR was printed, without resolving the recipient', async () => {
		const d = deps({ listQrPrints: vi.fn().mockResolvedValue(prints) });
		const result = await resolveScannedRecipient(SLIP, { allowVolunteer: false }, d);

		expect(result).toMatchObject({ kind: 'error', expiredQr: true });
		expect(d.lookupEvacuee).not.toHaveBeenCalled();
	});

	it('records the override when staff accept the expired slip', async () => {
		const d = deps({ listQrPrints: vi.fn().mockResolvedValue(prints) });
		const result = await resolveScannedRecipient(
			SLIP,
			{ allowVolunteer: false, acceptExpiredQr: true },
			d
		);

		expect(result).toMatchObject({
			kind: 'evacuee',
			qrOverride: { issued_at: null, current_printed_at: prints[0].printed_at }
		});
		expect(d.lookupEvacuee).toHaveBeenCalledWith(evacuee._id);
	});

	it('still resolves a slip when no Person QR was ever printed', async () => {
		const d = deps();
		const result = await resolveScannedRecipient(SLIP, { allowVolunteer: false }, d);

		expect(result).toMatchObject({ kind: 'evacuee' });
	});
});

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

describe('resolveScannedRecipient — Person QR rule (CR-233)', () => {
	const NEW = { printed_at: '2026-11-05T09:41:12.512Z', hash: '2d23a3' };
	const OLD = { printed_at: '2026-11-03T02:10:00.000Z', hash: '289170' };
	const opts = { allowVolunteer: false };

	it('resolves the latest QR and looks the evacuee up by the id without @', async () => {
		const d = deps({ listQrPrints: vi.fn().mockResolvedValue([OLD, NEW]) });
		const result = await resolveScannedRecipient(`${evacuee._id}@2d23a3`, opts, d);

		expect(result).toEqual({ kind: 'evacuee', evacuee });
		expect(d.lookupEvacuee).toHaveBeenCalledWith(evacuee._id);
	});

	it('rejects an expired QR with a dated message and resolves nobody', async () => {
		const d = deps({ listQrPrints: vi.fn().mockResolvedValue([OLD, NEW]) });
		const result = await resolveScannedRecipient(`${evacuee._id}@289170`, opts, d);

		expect(result).toMatchObject({ kind: 'error' });
		expect(result.kind === 'error' && result.message).toContain('มีใบใหม่วันที่');
		expect(d.lookupEvacuee).not.toHaveBeenCalled();
	});

	it('marks an expired QR as acceptable but never an invalid one (CR-233 A1)', async () => {
		const expired = await resolveScannedRecipient(
			`${evacuee._id}@289170`,
			opts,
			deps({ listQrPrints: vi.fn().mockResolvedValue([OLD, NEW]) })
		);
		const invalid = await resolveScannedRecipient(
			`${evacuee._id}@ffffff`,
			opts,
			deps({ listQrPrints: vi.fn().mockResolvedValue([NEW]) })
		);

		expect(expired).toMatchObject({ kind: 'error', expiredQr: true });
		expect(invalid.kind === 'error' && invalid.expiredQr).toBeUndefined();
	});

	it('resolves the evacuee with the QR dates when the expired QR is accepted', async () => {
		const d = deps({ listQrPrints: vi.fn().mockResolvedValue([OLD, NEW]) });
		const result = await resolveScannedRecipient(
			`${evacuee._id}@289170`,
			{ ...opts, acceptExpiredQr: true },
			d
		);

		expect(result).toMatchObject({
			kind: 'evacuee',
			evacuee,
			qrOverride: { issued_at: OLD.printed_at, current_printed_at: NEW.printed_at }
		});
		expect(result.kind === 'evacuee' && result.qrOverride?.overridden_at).toEqual(
			expect.any(String)
		);
		expect(d.lookupEvacuee).toHaveBeenCalledWith(evacuee._id);
	});

	it('still rejects an invalid QR when acceptExpiredQr is set', async () => {
		const d = deps({ listQrPrints: vi.fn().mockResolvedValue([NEW]) });
		const result = await resolveScannedRecipient(
			`${evacuee._id}@ffffff`,
			{ ...opts, acceptExpiredQr: true },
			d
		);

		expect(result.kind).toBe('error');
		expect(d.lookupEvacuee).not.toHaveBeenCalled();
	});

	it('adds no override to a valid QR even when acceptExpiredQr is set', async () => {
		const d = deps({ listQrPrints: vi.fn().mockResolvedValue([OLD, NEW]) });
		const result = await resolveScannedRecipient(
			`${evacuee._id}@2d23a3`,
			{ ...opts, acceptExpiredQr: true },
			d
		);

		expect(result).toEqual({ kind: 'evacuee', evacuee });
	});

	it('rejects an invalid hash', async () => {
		const d = deps({ listQrPrints: vi.fn().mockResolvedValue([NEW]) });
		const result = await resolveScannedRecipient(`${evacuee._id}@ffffff`, opts, d);

		expect(result.kind === 'error' && result.message).toContain('QR ไม่ถูกต้อง');
		expect(d.lookupEvacuee).not.toHaveBeenCalled();
	});

	it('accepts a legacy QR without @ when there is no log, rejects it once a log exists', async () => {
		const empty = deps();
		expect((await resolveScannedRecipient(evacuee._id, opts, empty)).kind).toBe('evacuee');

		const logged = deps({ listQrPrints: vi.fn().mockResolvedValue([NEW]) });
		expect((await resolveScannedRecipient(evacuee._id, opts, logged)).kind).toBe('error');
		expect(logged.lookupEvacuee).not.toHaveBeenCalled();
	});

	it('propagates a log read failure instead of resolving the recipient', async () => {
		const d = deps({ listQrPrints: vi.fn().mockRejectedValue(new Error('offline')) });
		await expect(resolveScannedRecipient(`${evacuee._id}@2d23a3`, opts, d)).rejects.toThrow(
			'offline'
		);
		expect(d.lookupEvacuee).not.toHaveBeenCalled();
	});

	it('skips the rule for a bare ULID registration ticket (FR-EQR-31)', async () => {
		const d = deps();
		await resolveScannedRecipient('01J00000000000000000000001', opts, d);
		expect(d.listQrPrints).not.toHaveBeenCalled();
	});
});
