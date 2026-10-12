import { z } from 'zod';
import { isAlreadyCheckedInStatus, isListedHouseholdMember } from '../domain/check-in-status';
import { normalizeKioskPhone, phoneVariants } from '../domain/phone';
import { shelterDbName } from '$lib/server/shelter-access-design';
import {
	evacueeIdSchema,
	getById,
	isKioskEligibleChannel,
	KioskInputError,
	KioskLookupUnavailableError,
	toLabelIdentity,
	type EvacueeDoc,
	type KioskLabelIdentity
} from './kiosk-check-in.server';

/**
 * The reprint gate: the visitor typed a phone number and then the last four digits of the
 * citizen id of the person who owns it (the phone-matched primary). Reading only; a reprint
 * never writes.
 */
export const kioskReprintInputSchema = z.object({
	phone: z.string().min(1).max(20),
	primary_evacuee_id: evacueeIdSchema,
	id_last4: z.string().regex(/^\d{4}$/),
	evacuee_ids: z.array(evacueeIdSchema).min(1).max(20)
});

export type KioskReprintInput = z.infer<typeof kioskReprintInputSchema>;

export type KioskReprintMember = {
	evacuee_id: string;
	qr_payload: string;
	label: KioskLabelIdentity;
};

/** No such primary for this phone in this shelter (unknown, other shelter, wrong channel). */
export class KioskReprintNotFoundError extends Error {
	constructor() {
		super('No reprintable record for this phone');
		this.name = 'KioskReprintNotFoundError';
	}
}

/** The primary has no usable citizen id, so there is nothing to verify against. */
export class KioskReprintUnverifiableError extends Error {
	constructor() {
		super('The primary has no citizen id to verify against');
		this.name = 'KioskReprintUnverifiableError';
	}
}

export class KioskReprintVerifyFailedError extends Error {
	constructor() {
		super('Citizen id last four digits do not match');
		this.name = 'KioskReprintVerifyFailedError';
	}
}

function normalizeEvacueeId(id: string): string {
	return `evacuee:${id.slice('evacuee:'.length).toUpperCase()}`;
}

function citizenIdLast4(primary: EvacueeDoc): string | null {
	const number = primary.person_id?.number;
	if (typeof number !== 'string' || !/^\d{4,}$/.test(number)) return null;
	return number.slice(-4);
}

/**
 * Labels for the selected, already checked-in members of the phone owner's household, after the
 * last four digits of the owner's citizen id are verified. Members that are not in the household,
 * not yet checked in, gone, or hidden are skipped silently. Never writes.
 */
export async function reprintKioskLabels(
	shelterCode: string,
	input: KioskReprintInput
): Promise<KioskReprintMember[]> {
	const canonical = normalizeKioskPhone(input.phone);
	if (!canonical) throw new KioskInputError();

	const dbName = shelterDbName(shelterCode);
	const load = async (id: string): Promise<EvacueeDoc | null> => {
		try {
			return await getById(dbName, id);
		} catch {
			throw new KioskLookupUnavailableError();
		}
	};

	const primary = await load(normalizeEvacueeId(input.primary_evacuee_id));
	if (
		!primary ||
		primary.shelter_code !== shelterCode ||
		!isKioskEligibleChannel(primary) ||
		!isListedHouseholdMember(primary) ||
		!primary.phone ||
		!phoneVariants(canonical).includes(primary.phone)
	) {
		throw new KioskReprintNotFoundError();
	}

	const last4 = citizenIdLast4(primary);
	if (last4 === null) throw new KioskReprintUnverifiableError();
	if (last4 !== input.id_last4) throw new KioskReprintVerifyFailedError();

	const members: KioskReprintMember[] = [];
	for (const evacueeId of new Set(input.evacuee_ids.map(normalizeEvacueeId))) {
		const member = evacueeId === primary._id ? primary : await load(evacueeId);
		if (
			!member ||
			member.shelter_code !== shelterCode ||
			!(
				member._id === primary._id ||
				(Boolean(primary.household_id) && member.household_id === primary.household_id)
			) ||
			!isKioskEligibleChannel(member) ||
			!isListedHouseholdMember(member) ||
			!isAlreadyCheckedInStatus(member.current_stay?.status)
		) {
			continue;
		}
		members.push({
			evacuee_id: member._id,
			qr_payload: member._id,
			label: toLabelIdentity(member)
		});
	}
	return members;
}
