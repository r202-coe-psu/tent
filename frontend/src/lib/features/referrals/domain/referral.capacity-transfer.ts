/**
 * T-34 capacity transfer — pure builders for cross-shelter hand-off docs.
 *
 * Never rewrite `shelter_code` inside the source DB (validate_doc_update forbids it).
 * Source: transfer_out → stay `transferred` (occupancy −1).
 * Destination: new/updated evacuee + transfer_in → stay `active` (occupancy +1).
 */

import {
	applyMovementToStay,
	createMovement,
	type Evacuee,
	type Movement
} from '$lib/features/people/domain/people';
import type { AuthorContext } from '$lib/db/model';

export class CapacityTransferError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CapacityTransferError';
	}
}

export interface CapacityTransferDocs {
	sourceMovement: Movement;
	sourceEvacuee: Evacuee;
	destEvacuee: Evacuee;
	destMovement: Movement;
}

/**
 * Build the four docs required to complete an inter-shelter capacity transfer.
 * Does not perform I/O — callers write via admin (cross-DB) or session (source-only).
 */
export function buildCapacityTransferDocs(params: {
	evacuee: Evacuee;
	fromShelterCode: string;
	toShelterCode: string;
	actor: string;
	nowIso: string;
	reason?: string;
}): CapacityTransferDocs {
	const { evacuee, fromShelterCode, toShelterCode, actor, nowIso, reason } = params;

	if (!toShelterCode.trim()) {
		throw new CapacityTransferError('Target shelter code is required for capacity transfer');
	}
	if (toShelterCode.toUpperCase() === fromShelterCode.toUpperCase()) {
		throw new CapacityTransferError(`Cannot transfer to the same shelter (${fromShelterCode})`);
	}
	if (evacuee.shelter_code !== fromShelterCode) {
		throw new CapacityTransferError(
			`Evacuee shelter_code (${evacuee.shelter_code}) does not match source (${fromShelterCode})`
		);
	}

	const stay = evacuee.current_stay.status;
	if (stay === 'deceased') {
		throw new CapacityTransferError('Cannot transfer a deceased evacuee');
	}
	if (stay === 'transferred') {
		throw new CapacityTransferError(
			`Evacuee ${evacuee._id} is already transferred — cannot transfer_out again`
		);
	}
	if (stay !== 'active' && stay !== 'temporary_leave') {
		throw new CapacityTransferError(
			`Cannot transfer evacuee from stay status '${stay}' (need active or temporary_leave)`
		);
	}

	const sourceCtx: AuthorContext = { shelterCode: fromShelterCode, createdBy: actor };

	const sourceMovement = createMovement(
		{
			evacuee_id: evacuee._id,
			action: 'transfer_out',
			zone: null,
			destination: { kind: 'shelter', shelter_code: toShelterCode },
			...(reason ? { reason } : {}),
			occurred_at: nowIso
		},
		sourceCtx
	);

	const sourceEvacuee = {
		...applyMovementToStay(evacuee, sourceMovement),
		// Must remain the source DB's code — never rewrite to destination.
		shelter_code: fromShelterCode,
		updated_at: nowIso
	};

	const { destEvacuee, destMovement } = buildDestinationIntakeDocs({
		evacuee,
		fromShelterCode,
		toShelterCode,
		actor,
		nowIso,
		reason
	});

	return { sourceMovement, sourceEvacuee, destEvacuee, destMovement };
}

/**
 * Destination-only intake docs (evacuee copy + transfer_in).
 * Used for full transfer and for repairing a dest DB after source already transferred.
 */
export function buildDestinationIntakeDocs(params: {
	evacuee: Evacuee;
	fromShelterCode: string;
	toShelterCode: string;
	actor: string;
	nowIso: string;
	reason?: string;
}): { destEvacuee: Evacuee; destMovement: Movement } {
	const { evacuee, fromShelterCode, toShelterCode, actor, nowIso, reason } = params;
	const destCtx: AuthorContext = { shelterCode: toShelterCode, createdBy: actor };

	const { _rev: _, ...evacueeWithoutRev } = evacuee;
	void _;
	const destSeed: Evacuee = {
		...evacueeWithoutRev,
		shelter_code: toShelterCode,
		created_at: evacuee.created_at,
		updated_at: nowIso,
		created_by: actor,
		// Seed a non-active stay so transfer_in can move to active cleanly.
		current_stay: {
			status: 'pre_registered',
			zone: null,
			since: nowIso
		}
	};

	const destMovement = createMovement(
		{
			evacuee_id: evacuee._id,
			action: 'transfer_in',
			zone: null,
			destination: { kind: 'shelter', shelter_code: fromShelterCode },
			...(reason ? { reason } : {}),
			occurred_at: nowIso
		},
		destCtx
	);

	const destEvacuee = {
		...applyMovementToStay(destSeed, destMovement),
		shelter_code: toShelterCode,
		updated_at: nowIso
	};

	return { destEvacuee, destMovement };
}
