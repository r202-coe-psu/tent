import { requireEvacueeRegistration } from '$lib/guards/auth';
import type { PageLoad } from './$types';

/** Ticked ids from ClaimDialog (CR-140 addendum) — nothing has been claimed yet at this point. */
function splitIds(raw: string | null): string[] {
	if (!raw) return [];
	return raw
		.split(',')
		.map((id) => id.trim())
		.filter((id) => id.length > 0);
}

export const load = (async ({ fetch, params, url }) => {
	await requireEvacueeRegistration(fetch);
	return {
		registrationId: params.id,
		memberIds: splitIds(url.searchParams.get('memberIds')),
		petIds: splitIds(url.searchParams.get('petIds')),
		shelterCode: url.searchParams.get('shelterCode')
	};
}) satisfies PageLoad;
