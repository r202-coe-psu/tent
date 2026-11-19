import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { authorizeReferral, resolveShelterCode, handleEndpointError } from '../_auth';
import {
	ACTIVE_LOOKUP_MAX_IDS,
	CouchDbReferralServerRepository
} from '$lib/features/referrals/server/referral.server-repository';
import { adminRaw } from '$lib/server/couch-admin';

export const prerender = false;

const activeLookupBodySchema = z.object({
	evacuee_ids: z
		.array(z.string().trim().min(1))
		.min(1, 'evacuee_ids must not be empty')
		.max(ACTIVE_LOOKUP_MAX_IDS, `evacuee_ids must not exceed ${ACTIVE_LOOKUP_MAX_IDS} items`)
});

type AllDocsRow = { key: string; error?: string; value?: { deleted?: boolean } };

/**
 * Keep only the ids that live in the caller's shelter DB. Referrals sit in the shared `central_ops`,
 * so without this a manager could ask about another shelter's evacuees; the create route answers
 * 409 only for its own (it checks `shelter_<code>` first). One `_all_docs` read, no doc bodies.
 */
async function evacueeIdsInShelter(shelterCode: string, ids: readonly string[]) {
	const db = `shelter_${shelterCode.toLowerCase()}`;
	const res = await adminRaw(`/${db}/_all_docs`, 'POST', { keys: [...new Set(ids)] });
	const rows = (res.data as { rows?: AllDocsRow[] } | null)?.rows;
	if (res.status !== 200 || !Array.isArray(rows)) {
		throw error(502, 'Failed to read shelter evacuees');
	}
	return rows.filter((r) => !r.error && !r.value?.deleted).map((r) => r.key);
}

/**
 * POST /api/back-office/referral/active  (#555)
 * Body: `{ evacuee_ids: string[] }` → `{ evacuee_ids: string[] }`, the subset that already has an
 * active referral (status not closed/rejected) — the same rule as the POST 409 duplicate check.
 * Ids outside the caller's shelter are dropped (never reported active).
 * Asked for the ids the picker shows, never the whole shelter. POST only to keep long id lists
 * out of the URL; it writes nothing.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeReferral(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const body = await request.json().catch(() => null);
		const parsed = activeLookupBodySchema.safeParse(body);
		if (!parsed.success) {
			return json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 422 });
		}

		const repo = new CouchDbReferralServerRepository('central_ops', shelterCode);
		const own = await evacueeIdsInShelter(shelterCode, parsed.data.evacuee_ids);
		const ids = own.length > 0 ? await repo.activeReferralEvacueeIds(own) : [];
		return json({ evacuee_ids: ids });
	} catch (e: unknown) {
		return handleEndpointError(e, 'Referral API Active Lookup POST');
	}
};
