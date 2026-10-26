import { sha256Hex } from '$lib/db/hash';
import { TRACKING_TOKEN_HASH_PREFIX } from '$lib/features/volunteer-portal/server';
import { adminFetch } from '$lib/server/couch-admin';
import { KioskLookupUnavailableError } from './kiosk-check-in.server';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { maskLastName } from '$lib/utils/mask';
import { normalizeKioskPhone, phoneVariants } from '../domain/phone';

export type KioskVolunteerCard = {
	display_name: string;
	volunteer_code: string;
	qr_payload: string;
};

export class KioskVolunteerCardNotFoundError extends Error {
	constructor() {
		super('No volunteer role card for this phone');
		this.name = 'KioskVolunteerCardNotFoundError';
	}
}

const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/i;

type VolunteerDoc = {
	phone?: string | null;
	first_name?: string;
	last_name?: string;
	nickname?: string;
	volunteer_code?: string;
	tracking_token_hash?: string | null;
};

/**
 * Read-only: finds the volunteer in this shelter's DB and rebuilds the EXISTING role-card
 * payload from the stored hash. It never mints, rotates or backfills a token.
 */
export async function resolveKioskVolunteerCard(
	shelterCode: string,
	canonicalPhone: string
): Promise<KioskVolunteerCard> {
	let result: { docs?: VolunteerDoc[] };
	try {
		result = await adminFetch<{ docs?: VolunteerDoc[] }>(`/${shelterDbName(shelterCode)}/_find`, {
			method: 'POST',
			body: JSON.stringify({
				selector: {
					type: 'volunteer',
					status: 'active',
					$or: [
						{ phone_hash: await sha256Hex(canonicalPhone) },
						{ phone: { $in: phoneVariants(canonicalPhone) } }
					]
				},
				limit: 10
			})
		});
	} catch {
		throw new KioskLookupUnavailableError();
	}
	// phone_hash can go stale when the phone is edited; the stored phone is the truth.
	const matches = (result.docs ?? []).filter(
		(candidate) => normalizeKioskPhone(candidate.phone ?? '') === canonicalPhone
	);
	// A duplicate phone is ambiguous: showing either card could hand over someone else's.
	const [doc] = matches;
	if (matches.length !== 1 || !doc || !TOKEN_HASH_PATTERN.test(doc.tracking_token_hash ?? '')) {
		throw new KioskVolunteerCardNotFoundError();
	}

	// Legacy or imported docs may lack a name part; never print "undefined" or stray spaces.
	const name = [doc.first_name?.trim(), maskLastName(doc.last_name)].filter(Boolean).join(' ');
	const nickname = doc.nickname?.trim();
	return {
		display_name: nickname ? `${name} (${nickname})` : name,
		volunteer_code: doc.volunteer_code ?? '',
		qr_payload: `${TRACKING_TOKEN_HASH_PREFIX}${doc.tracking_token_hash!.toUpperCase()}`
	};
}
