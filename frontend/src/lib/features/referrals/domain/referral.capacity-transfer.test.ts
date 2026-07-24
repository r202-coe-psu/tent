import { describe, it, expect } from 'vitest';
import {
	createEvacuee,
	createMovement,
	applyMovementToStay
} from '$lib/features/people/domain/people';
import type { AuthorContext } from '$lib/db/model';
import {
	buildCapacityTransferDocs,
	buildDestinationIntakeDocs,
	CapacityTransferError
} from './referral.capacity-transfer';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff1' };
const NOW = '2026-07-24T04:00:00.000Z';

function activeEvacuee() {
	const e = createEvacuee(
		{ first_name: 'สมชาย', last_name: 'ใจดี', gender: 'male', phone: '0812345678' },
		ctx
	);
	const checkIn = createMovement(
		{ evacuee_id: e._id, action: 'check_in', zone: 'A', occurred_at: NOW },
		ctx
	);
	return applyMovementToStay(e, checkIn);
}

describe('buildCapacityTransferDocs', () => {
	it('keeps source shelter_code and marks stay transferred; dest is active with dest code', () => {
		const evacuee = activeEvacuee();
		const docs = buildCapacityTransferDocs({
			evacuee,
			fromShelterCode: 'SH001',
			toShelterCode: 'SH002',
			actor: 'manager1',
			nowIso: NOW,
			referralId: 'referral:01CAPACITY',
			reason: 'Capacity full'
		});

		expect(docs.sourceMovement.action).toBe('transfer_out');
		expect(docs.sourceMovement._id).toBe('movement:capacity_transfer_out:01CAPACITY');
		expect(docs.sourceMovement.shelter_code).toBe('SH001');
		expect(docs.sourceMovement.destination).toEqual({
			kind: 'shelter',
			shelter_code: 'SH002'
		});

		expect(docs.sourceEvacuee.shelter_code).toBe('SH001');
		expect(docs.sourceEvacuee.current_stay.status).toBe('transferred');

		expect(docs.destMovement.action).toBe('transfer_in');
		expect(docs.destMovement._id).toBe('movement:capacity_transfer_in:01CAPACITY');
		expect(docs.destMovement.shelter_code).toBe('SH002');
		expect(docs.destEvacuee.shelter_code).toBe('SH002');
		expect(docs.destEvacuee.current_stay.status).toBe('active');
		expect(docs.destEvacuee._id).toBe(evacuee._id);
		expect(docs.destEvacuee._rev).toBeUndefined();
	});

	it('rejects same-shelter and already-transferred', () => {
		const evacuee = activeEvacuee();
		expect(() =>
			buildCapacityTransferDocs({
				evacuee,
				fromShelterCode: 'SH001',
				toShelterCode: 'SH001',
				actor: 'manager1',
				nowIso: NOW,
				referralId: 'referral:01CAPACITY'
			})
		).toThrow(CapacityTransferError);

		const transferred = {
			...evacuee,
			current_stay: { status: 'transferred' as const, zone: null, since: NOW }
		};
		expect(() =>
			buildCapacityTransferDocs({
				evacuee: transferred,
				fromShelterCode: 'SH001',
				toShelterCode: 'SH002',
				actor: 'manager1',
				nowIso: NOW,
				referralId: 'referral:01CAPACITY'
			})
		).toThrow(/already transferred/);
	});
});

describe('buildDestinationIntakeDocs', () => {
	it('builds dest intake even when source stay is already transferred', () => {
		const evacuee = {
			...activeEvacuee(),
			current_stay: { status: 'transferred' as const, zone: null, since: NOW }
		};
		const docs = buildDestinationIntakeDocs({
			evacuee,
			fromShelterCode: 'SH001',
			toShelterCode: 'SH002',
			actor: 'manager1',
			nowIso: NOW,
			referralId: 'referral:01CAPACITY'
		});
		expect(docs.destEvacuee.shelter_code).toBe('SH002');
		expect(docs.destEvacuee.current_stay.status).toBe('active');
		expect(docs.destMovement.action).toBe('transfer_in');
		expect(docs.destMovement._id).toBe('movement:capacity_transfer_in:01CAPACITY');
	});
});
