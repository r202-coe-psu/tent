import { z } from 'zod';
import { isListedHouseholdMember, isReprintableStatus } from '../domain/check-in-status';
import { normalizeKioskPhone, phoneVariants } from '../domain/phone';
import { intakeStationsPassed } from '$lib/features/people/domain/intake-pipeline';
import { labelZoneName, type ZoneLabelSource } from '$lib/features/people/domain/people';
import { adminFetch } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { findMasterByCode } from '$lib/server/shelters.admin';
import {
	evacueeIdSchema,
	getById,
	KioskInputError,
	KioskLookupUnavailableError,
	toLabelIdentity,
	type EvacueeDoc,
	type KioskLabelIdentity
} from './kiosk-check-in.server';

const reprintBase = {
	phone: z.string().min(1).max(20),
	primary_evacuee_id: evacueeIdSchema,
	evacuee_ids: z.array(evacueeIdSchema).min(1).max(20)
};

/**
 * The reprint gate: the visitor typed a phone number and then either the last four digits of the
 * citizen id of the person who owns it (the phone-matched primary) or a staff PIN, never both.
 * The PIN's shape is not checked here: the verifier treats a malformed one as wrong. Reading
 * only; a reprint never writes.
 */
export const kioskReprintInputSchema = z.union([
	z.strictObject({ ...reprintBase, id_last4: z.string().regex(/^\d{4}$/) }),
	z.strictObject({ ...reprintBase, staff_pin: z.string().max(32) })
]);

export type KioskReprintInput = z.infer<typeof kioskReprintInputSchema>;

export type KioskReprintMember = {
	evacuee_id: string;
	qr_payload: string;
	/**
	 * `zone` is the member's current zone (short name, else full name), or null before Station 3
	 * assigns one; `stations_passed` (0–3) is how many checklist boxes the label ticks.
	 */
	label: KioskLabelIdentity & { zone: string | null; stations_passed: number };
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

/** The staff PIN was wrong, or no PIN verifier is available (fail closed). */
export class KioskReprintStaffPinInvalidError extends Error {
	constructor() {
		super('Staff PIN is not accepted');
		this.name = 'KioskReprintStaffPinInvalidError';
	}
}

/** The kiosk has no staff PIN configured, so a PIN reprint cannot be authorised. */
export class KioskReprintStaffPinNotSetError extends Error {
	constructor() {
		super('No staff PIN is set for this kiosk');
		this.name = 'KioskReprintStaffPinNotSetError';
	}
}

/** The device's staff PIN queue is full: the check was not even attempted, try again later. */
export class KioskReprintStaffPinBusyError extends Error {
	constructor() {
		super('The staff PIN check is busy');
		this.name = 'KioskReprintStaffPinBusyError';
	}
}

/** What the injected staff PIN check answers; the route supplies the real verifier. */
export type KioskStaffPinResult =
	{ kind: 'ok' } | { kind: 'wrong' } | { kind: 'not_set' } | { kind: 'busy' };

export type KioskReprintDeps = {
	verifyStaffPin?: (pin: string) => Promise<KioskStaffPinResult>;
};

function normalizeEvacueeId(id: string): string {
	return `evacuee:${id.slice('evacuee:'.length).toUpperCase()}`;
}

/** The shelter's zones for naming a stay zone; none (codes print as-is) if the registry fails. */
async function shelterZones(shelterCode: string): Promise<readonly ZoneLabelSource[]> {
	try {
		return (await findMasterByCode(shelterCode))?.zones ?? [];
	} catch {
		return [];
	}
}

/** Which of `ids` have a screening record; none if the lookup fails (the label ticks fewer). */
async function screenedEvacueeIds(dbName: string, ids: string[]): Promise<Set<string>> {
	if (ids.length === 0) return new Set();
	try {
		const result = await adminFetch<{ docs?: { evacuee_id?: unknown }[] }>(`/${dbName}/_find`, {
			method: 'POST',
			body: JSON.stringify({
				selector: { type: 'screening', evacuee_id: { $in: ids } },
				fields: ['evacuee_id'],
				limit: 1000
			})
		});
		return new Set(
			(result.docs ?? [])
				.map((doc) => doc.evacuee_id)
				.filter((id): id is string => typeof id === 'string')
		);
	} catch {
		return new Set();
	}
}

function citizenIdLast4(primary: EvacueeDoc): string | null {
	const number = primary.person_id?.number;
	if (typeof number !== 'string') return null;
	const digits = number.replace(/[\s-]/g, '');
	if (!/^\d{4,}$/.test(digits)) return null;
	return digits.slice(-4);
}

/**
 * Labels for the selected, already checked-in members of the phone owner's household, after the
 * last four digits of the owner's citizen id are verified. Members that are not in the household,
 * not yet checked in, gone, or hidden are skipped silently; not found if none are left. Never writes.
 */
export async function reprintKioskLabels(
	shelterCode: string,
	input: KioskReprintInput,
	deps: KioskReprintDeps = {}
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
		!isListedHouseholdMember(primary) ||
		!primary.phone ||
		!phoneVariants(canonical).includes(primary.phone)
	) {
		throw new KioskReprintNotFoundError();
	}

	if ('id_last4' in input) {
		const last4 = citizenIdLast4(primary);
		if (last4 === null) throw new KioskReprintUnverifiableError();
		if (last4 !== input.id_last4) throw new KioskReprintVerifyFailedError();
	} else {
		// Fail closed: only an explicit ok from the injected verifier lets the reprint through.
		const result = await deps.verifyStaffPin?.(input.staff_pin);
		switch (result?.kind) {
			case 'ok':
				break;
			case 'not_set':
				throw new KioskReprintStaffPinNotSetError();
			case 'busy':
				throw new KioskReprintStaffPinBusyError();
			default:
				throw new KioskReprintStaffPinInvalidError();
		}
	}

	const eligible: EvacueeDoc[] = [];
	for (const evacueeId of new Set(input.evacuee_ids.map(normalizeEvacueeId))) {
		const member = evacueeId === primary._id ? primary : await load(evacueeId);
		if (
			!member ||
			member.shelter_code !== shelterCode ||
			!(
				member._id === primary._id ||
				(Boolean(primary.household_id) && member.household_id === primary.household_id)
			) ||
			!isListedHouseholdMember(member) ||
			!isReprintableStatus(member.current_stay?.status)
		) {
			continue;
		}
		eligible.push(member);
	}
	// Nothing left to print (all checked out meanwhile, say): never report a print of zero labels.
	if (eligible.length === 0) throw new KioskReprintNotFoundError();

	// Read the zone names only when someone already has a zone; a reprint never fails over them.
	const zones = eligible.some((member) => member.current_stay?.zone?.trim())
		? await shelterZones(shelterCode)
		: [];
	// Screening only changes the tick count for members not yet given a zone.
	const screened = await screenedEvacueeIds(
		dbName,
		eligible
			.filter((member) => intakeStationsPassed(member.current_stay, true) < 3)
			.map((member) => member._id)
	);
	return eligible.map((member) => ({
		evacuee_id: member._id,
		qr_payload: member._id,
		label: {
			...toLabelIdentity(member),
			zone: labelZoneName(member.current_stay?.zone, zones),
			stations_passed: intakeStationsPassed(member.current_stay, screened.has(member._id))
		}
	}));
}
